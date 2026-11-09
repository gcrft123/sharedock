-- Rate limiting.
--
-- Nothing in the control plane was throttled. Login accepted unlimited attempts against a
-- stored verifier, pairing codes could be guessed at full speed, share tokens enumerated,
-- and relay admission was unbounded. That last one is the expensive one: relay bandwidth is
-- the only recurring cost in a business with no recurring revenue.
--
-- A fixed window in D1 rather than a Durable Object or the edge rate limiter: the endpoints
-- that need it are low-volume and high-value (a handful of writes per sign-in attempt), and
-- this way the limits are exercised by the same end-to-end suite as everything else instead
-- of being invisible until production.
CREATE TABLE IF NOT EXISTS rate_limit (
  bucket       TEXT PRIMARY KEY,   -- "<action>:<subject>", subject hashed when it is a secret
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
