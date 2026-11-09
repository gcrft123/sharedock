-- The license grants host SEATS, not a byte quota — a host lends from its own disk. Record
-- each host's free disk (bytes) so the console's allocate slider reflects real capacity.
ALTER TABLE host_endpoints ADD COLUMN disk_bytes INTEGER NOT NULL DEFAULT 0;
