-- Multi-host pooling / mirroring.
--
-- An account may now run SEVERAL hosts, so `host_endpoints` becomes one row per
-- (account, host) instead of one per account, and gains the host's X25519 agreement
-- pubkey (the client session handshake seals to it — previously typed in by hand).
-- A per-account `account_topology` row records the mode, pool fill strategy, and
-- capacity model. Additive + backfill-safe: existing single-host rows carry over, and
-- accounts with no topology row default to single-host behaviour.

-- SQLite/D1 can't alter a primary key in place, so recreate the table.
CREATE TABLE host_endpoints_new (
  account       TEXT NOT NULL,
  endpoint_id   TEXT NOT NULL,   -- Iroh EndpointId (= host device pubkey)
  agreement_pub TEXT,            -- host X25519 agreement pubkey (hex), for the session handshake
  relay_url     TEXT,            -- home relay URL, if any
  direct_addrs  TEXT,            -- JSON array of "ip:port" direct addresses
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (account, endpoint_id)
);
INSERT INTO host_endpoints_new (account, endpoint_id, agreement_pub, relay_url, direct_addrs, updated_at)
  SELECT account, endpoint_id, NULL, relay_url, direct_addrs, updated_at FROM host_endpoints;
DROP TABLE host_endpoints;
ALTER TABLE host_endpoints_new RENAME TO host_endpoints;

-- Per-account multi-host configuration.
CREATE TABLE IF NOT EXISTS account_topology (
  account       TEXT PRIMARY KEY,
  mode          TEXT NOT NULL DEFAULT 'single',    -- single | pool | mirror
  strategy      TEXT NOT NULL DEFAULT 'balanced',  -- balanced | sequential  (pool fill order)
  capacity_mode TEXT NOT NULL DEFAULT 'license',   -- license | sum          (sum = sum-of-disks, pooling)
  updated_at    INTEGER NOT NULL
);
