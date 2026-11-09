-- Failure reports from clients.
--
-- There was no way to learn that anything had broken: no crash reporting, no error
-- reporting, and no status endpoint for the two pieces operated centrally. The first sign of
-- a problem would have been a customer email, and for most of this product's life it could
-- neither send nor receive one.
--
-- Deliberately thin. A category, a short message, the surface and the version. No file names,
-- no paths, no keys: a failure report that leaked what somebody was storing would undo the
-- whole proposition to save a support round trip. Lengths are clipped on the way in as well,
-- because a bounded column is cheaper than trusting every future caller to be careful.
CREATE TABLE IF NOT EXISTS error_report (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users(id),
  kind        TEXT NOT NULL,   -- short category, e.g. 'upload' | 'mount' | 'connect'
  message     TEXT NOT NULL,   -- clipped to 500 chars
  surface     TEXT,            -- 'web' | 'desktop'
  version     TEXT,
  reported_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_error_report_time ON error_report(reported_at);
