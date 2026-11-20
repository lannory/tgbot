-- Admin panel: users, activity, notification history, errors, audit log.
-- Additive only: new tables, new nullable columns, indexes.

CREATE TABLE IF NOT EXISTS bot_users (
	chat_id TEXT PRIMARY KEY,
	username TEXT,
	first_name TEXT,
	language_code TEXT,           -- language reported by Telegram
	lang TEXT,                    -- language chosen in the bot (uk / en)
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	last_seen_at TIMESTAMPTZ,
	bot_blocked_at TIMESTAMPTZ,   -- user blocked the bot (Telegram 403 / my_chat_member)
	admin_blocked_at TIMESTAMPTZ, -- blocked by an admin in the panel
	admin_block_reason TEXT
);

CREATE INDEX IF NOT EXISTS bot_users_created_at_idx ON bot_users (created_at);
CREATE INDEX IF NOT EXISTS bot_users_last_seen_at_idx ON bot_users (last_seen_at);

-- Existing chats get a row; registration date is approximated by their
-- earliest known record, since it was never stored before.
INSERT INTO bot_users (chat_id, created_at)
SELECT chat_id, min(created_at)
FROM (
	SELECT chat_id, created_at FROM searches
	UNION ALL SELECT chat_id, created_at FROM snipes
	UNION ALL SELECT chat_id, updated_at FROM ebay_tokens
) known
GROUP BY chat_id
ON CONFLICT (chat_id) DO NOTHING;

-- One row per user per day with any interaction: daily-active chart and
-- 7/30-day active counts that last_seen_at alone can't reconstruct.
CREATE TABLE IF NOT EXISTS user_activity_daily (
	chat_id TEXT NOT NULL,
	day DATE NOT NULL,
	PRIMARY KEY (chat_id, day)
);

CREATE INDEX IF NOT EXISTS user_activity_daily_day_idx ON user_activity_daily (day);

-- History of notifications. `notifications` stays a delivery queue (rows are
-- deleted when the bot picks them up); this table keeps what was sent.
-- No FK to searches, so history survives a deleted search.
CREATE TABLE IF NOT EXISTS notification_log (
	id BIGSERIAL PRIMARY KEY,
	chat_id TEXT NOT NULL,
	search_id INTEGER,
	platform TEXT,
	kind TEXT NOT NULL DEFAULT 'listing',
	title TEXT,
	url TEXT,
	status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
	error TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notification_log_chat_idx ON notification_log (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_log_created_at_idx ON notification_log (created_at);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS log_id BIGINT;

ALTER TABLE searches ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_errors (
	id BIGSERIAL PRIMARY KEY,
	chat_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	message TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_errors_chat_idx ON user_errors (chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_log (
	id BIGSERIAL PRIMARY KEY,
	admin TEXT NOT NULL,
	action TEXT NOT NULL,
	target_type TEXT,
	target_id TEXT,
	reason TEXT,
	details JSONB,
	ip TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx ON admin_audit_log (target_type, target_id);

-- Session store for the admin panel (connect-pg-simple layout)
CREATE TABLE IF NOT EXISTS admin_sessions (
	sid VARCHAR NOT NULL PRIMARY KEY,
	sess JSON NOT NULL,
	expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_sessions_expire_idx ON admin_sessions (expire);
