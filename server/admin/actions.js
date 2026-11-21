import { withTransaction } from '../lib/tx.js';
import { grantSubscription, cancelCurrentSubscriptions } from '../billing/subscriptions.js';
import { writeAudit } from './audit.js';

export class ActionError extends Error {}

// Each action changes data and writes the audit record in one transaction.

export function blockUser(pool, who, { chatId, reason }) {
	return withTransaction(pool, async (db) => {
		const { rows } = await db.query(
			`UPDATE bot_users SET admin_blocked_at = now(), admin_block_reason = $2
			 WHERE chat_id = $1 AND admin_blocked_at IS NULL RETURNING chat_id`,
			[chatId, reason]
		);
		if (!rows[0]) throw new ActionError('Користувача не знайдено або він уже заблокований');
		await writeAudit(db, { ...who, action: 'user.block', targetType: 'user', targetId: chatId, reason });
	});
}

export function unblockUser(pool, who, { chatId, reason }) {
	return withTransaction(pool, async (db) => {
		const { rows } = await db.query(
			`UPDATE bot_users SET admin_blocked_at = NULL, admin_block_reason = NULL
			 WHERE chat_id = $1 AND admin_blocked_at IS NOT NULL
			 RETURNING chat_id`,
			[chatId]
		);
		if (!rows[0]) throw new ActionError('Користувач не заблокований');
		await writeAudit(db, { ...who, action: 'user.unblock', targetType: 'user', targetId: chatId, reason });
	});
}

function searchSnapshot(s) {
	return { chat_id: s.chat_id, source: s.source, query: s.query, active: s.active };
}

export function setSearchActive(pool, who, { searchId, active, reason }) {
	return withTransaction(pool, async (db) => {
		const { rows } = await db.query(
			'UPDATE searches SET active = $2 WHERE id = $1 AND active <> $2 RETURNING *',
			[searchId, active]
		);
		const search = rows[0];
		if (!search) throw new ActionError('Пошук не знайдено або стан уже такий');
		await writeAudit(db, {
			...who,
			action: active ? 'search.enable' : 'search.disable',
			targetType: 'search',
			targetId: searchId,
			reason,
			details: searchSnapshot(search),
		});
		return search;
	});
}

export function deleteSearch(pool, who, { searchId, reason }) {
	return withTransaction(pool, async (db) => {
		const { rows } = await db.query('DELETE FROM searches WHERE id = $1 RETURNING *', [searchId]);
		const search = rows[0];
		if (!search) throw new ActionError('Пошук не знайдено');
		await writeAudit(db, {
			...who,
			action: 'search.delete',
			targetType: 'search',
			targetId: searchId,
			reason,
			details: { ...searchSnapshot(search), category_id: search.category_id, min_price: search.min_price, max_price: search.max_price },
		});
		return search;
	});
}

export function grantManualSubscription(pool, who, { chatId, planId, days, reason }) {
	return withTransaction(pool, async (db) => {
		const { rows: users } = await db.query('SELECT 1 FROM bot_users WHERE chat_id = $1', [chatId]);
		if (!users[0]) throw new ActionError('Користувача не знайдено');
		const { rows: plans } = await db.query('SELECT * FROM plans WHERE id = $1 AND is_active', [planId]);
		const plan = plans[0];
		if (!plan) throw new ActionError('Тариф не знайдено або він неактивний');

		const result = await grantSubscription(db, { chatId, planId, days, source: 'manual', createdBy: who.admin });
		await writeAudit(db, {
			...who,
			action: result.extended ? 'subscription.extend' : 'subscription.grant',
			targetType: 'user',
			targetId: chatId,
			reason,
			details: {
				subscription_id: result.subscription.id,
				plan: plan.code,
				days,
				ends_at: result.subscription.ends_at,
				cancelled_subscriptions: result.cancelled ?? [],
			},
		});
		return result;
	});
}

export function cancelSubscription(pool, who, { chatId, reason }) {
	return withTransaction(pool, async (db) => {
		const ids = await cancelCurrentSubscriptions(db, chatId);
		if (ids.length === 0) throw new ActionError('Немає активної підписки');
		await writeAudit(db, {
			...who,
			action: 'subscription.cancel',
			targetType: 'user',
			targetId: chatId,
			reason,
			details: { cancelled_subscriptions: ids },
		});
	});
}

const PLAN_FIELDS = ['code', 'name', 'price_minor', 'currency', 'duration_days', 'max_searches', 'platforms', 'check_interval_sec', 'is_active', 'is_default'];

export function savePlan(pool, who, { id = null, plan }) {
	return withTransaction(pool, async (db) => {
		let before = null;
		if (id != null) {
			const { rows } = await db.query('SELECT * FROM plans WHERE id = $1 FOR UPDATE', [id]);
			before = rows[0];
			if (!before) throw new ActionError('Тариф не знайдено');
			if (before.is_default && !plan.is_default) {
				throw new ActionError('Не можна зняти позначку «за замовчуванням»: позначте інший тариф як тариф за замовчуванням');
			}
		}
		if (plan.is_default && !plan.is_active) throw new ActionError('Тариф за замовчуванням має бути активним');

		const { rows: dup } = await db.query('SELECT id FROM plans WHERE code = $1 AND id IS DISTINCT FROM $2', [plan.code, id]);
		if (dup[0]) throw new ActionError(`Код «${plan.code}» уже зайнятий`);

		if (plan.is_default) {
			await db.query('UPDATE plans SET is_default = false, updated_at = now() WHERE is_default AND id IS DISTINCT FROM $1', [id]);
		}

		const values = PLAN_FIELDS.map((f) => plan[f]);
		let saved;
		if (id == null) {
			const { rows } = await db.query(
				`INSERT INTO plans (${PLAN_FIELDS.join(', ')}) VALUES (${PLAN_FIELDS.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
				values
			);
			saved = rows[0];
		} else {
			const { rows } = await db.query(
				`UPDATE plans SET ${PLAN_FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ')}, updated_at = now()
				 WHERE id = $1 RETURNING *`,
				[id, ...values]
			);
			saved = rows[0];
		}

		const changes = {};
		for (const f of PLAN_FIELDS) {
			const a = before ? before[f] : undefined;
			if (JSON.stringify(a) !== JSON.stringify(saved[f])) changes[f] = { from: a ?? null, to: saved[f] };
		}

		await writeAudit(db, {
			...who,
			action: id == null ? 'plan.create' : 'plan.update',
			targetType: 'plan',
			targetId: saved.id,
			details: { code: saved.code, changes },
		});
		return saved;
	});
}
