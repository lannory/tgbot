-- Monetization groundwork: plans, subscriptions, payments.
-- Money is stored in minor units (kopecks / cents / stars) as integers.
-- No card data is ever stored, only provider identifiers.

CREATE TABLE IF NOT EXISTS plans (
	id SERIAL PRIMARY KEY,
	code TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	price_minor INTEGER NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
	currency TEXT NOT NULL DEFAULT 'UAH',
	duration_days INTEGER CHECK (duration_days > 0),          -- NULL = never expires
	max_searches INTEGER CHECK (max_searches >= 0),           -- NULL = unlimited
	platforms TEXT[] NOT NULL DEFAULT ARRAY['ebay', 'olx'],
	check_interval_sec INTEGER NOT NULL DEFAULT 90 CHECK (check_interval_sec >= 10),
	is_active BOOLEAN NOT NULL DEFAULT true,
	is_default BOOLEAN NOT NULL DEFAULT false,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one default plan (the one users without a subscription are on)
CREATE UNIQUE INDEX IF NOT EXISTS plans_single_default_idx ON plans (is_default) WHERE is_default;

-- Free plan mirrors today's behaviour: both platforms, the 90 s poll cycle,
-- and a search limit no existing user is already above.
INSERT INTO plans (code, name, price_minor, currency, duration_days, max_searches, platforms, check_interval_sec, is_default)
SELECT 'free', 'Free', 0, 'UAH', NULL,
	GREATEST(5, COALESCE((SELECT max(c) FROM (SELECT count(*) AS c FROM searches GROUP BY chat_id) per_chat), 0)),
	ARRAY['ebay', 'olx'], 90, true
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE is_default);

CREATE TABLE IF NOT EXISTS subscriptions (
	id SERIAL PRIMARY KEY,
	chat_id TEXT NOT NULL,
	plan_id INTEGER NOT NULL REFERENCES plans(id),
	status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'cancelled', 'trial')),
	source TEXT NOT NULL CHECK (source IN ('payment', 'manual', 'trial')),
	started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	ends_at TIMESTAMPTZ,                                       -- NULL = no end
	created_by TEXT,                                           -- admin username for manual grants
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_chat_idx ON subscriptions (chat_id, status);
CREATE INDEX IF NOT EXISTS subscriptions_ends_at_idx ON subscriptions (ends_at) WHERE status IN ('active', 'trial');

CREATE TABLE IF NOT EXISTS payments (
	id BIGSERIAL PRIMARY KEY,
	chat_id TEXT NOT NULL,
	plan_id INTEGER REFERENCES plans(id),
	subscription_id INTEGER REFERENCES subscriptions(id),
	amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
	currency TEXT NOT NULL,
	provider TEXT NOT NULL,
	external_id TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
	raw_payload JSONB,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	paid_at TIMESTAMPTZ,
	UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS payments_chat_idx ON payments (chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_paid_at_idx ON payments (paid_at) WHERE status = 'paid';

-- The single definition of "the subscription that applies right now".
-- Used by entitlements and by the admin panel alike.
CREATE OR REPLACE VIEW current_subscriptions AS
SELECT DISTINCT ON (s.chat_id) s.*
FROM subscriptions s
WHERE s.status IN ('active', 'trial')
	AND s.started_at <= now()
	AND (s.ends_at IS NULL OR s.ends_at > now())
ORDER BY s.chat_id, s.ends_at DESC NULLS FIRST, s.id DESC;
