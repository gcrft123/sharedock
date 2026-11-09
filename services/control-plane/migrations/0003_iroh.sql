-- Host Iroh endpoint discovery: the daemon publishes its EndpointAddr here so
-- clients can dial it directly over QUIC (the LAN fast path). Public addressing
-- only — never secrets. One row per account (the host).
CREATE TABLE IF NOT EXISTS host_endpoints (
  account       TEXT PRIMARY KEY,
  endpoint_id   TEXT NOT NULL,   -- Iroh EndpointId (= host device pubkey)
  relay_url     TEXT,            -- home relay URL, if any
  direct_addrs  TEXT,            -- JSON array of "ip:port" direct addresses
  updated_at    INTEGER NOT NULL
);
