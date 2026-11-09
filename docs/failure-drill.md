# Failure drill

What Sharedock does when things go wrong, and how to check it still does.

A storage product is judged on its bad days. The bar throughout is the same: **fail loudly,
lose nothing, stay usable.** Silently losing data is the worst outcome; silently *appearing*
to have lost data is a close second, because a customer who believes their files are gone
acts on that belief.

## Automated

`crates/host-agent/tests/failure_drill.rs`, run by CI on every push:

| Case | Asserted |
|---|---|
| Partition full | The write is refused, no partial entry is left behind, and the store still accepts a later write |
| Full partition, existing data | Files written before a refused write still read back byte-for-byte |
| Two writes to one path | Exactly one entry survives, and its bytes are one whole write, never a blend of both |
| Corrupt metadata database | Opening it is an **error**, not an empty drive. A store that reads as empty would tell a customer their files are gone |

## By hand, on real hardware

These cannot be provoked in a unit test. Run them before the first customer does.

### 1. Power cut mid-upload
1. Start a large upload (over 1 GB) from a client to a host.
2. Halfway through, **pull the host's power cord.** Not a clean shutdown: the point is the
   absence of one.
3. Boot the host. The launchd agent should bring the daemon back with no intervention.
4. **Pass:** the partial file is either absent or present and complete. Never present and
   truncated. Files written before it are intact. The daemon serves normally.

### 2. Genuinely full disk
1. Fill the host's volume to under 100 MB free (`mkfile -n 100g /path/filler` on macOS).
2. Attempt an upload larger than the remaining space.
3. **Pass:** a clear refusal in the console, the store still readable, and no corruption of
   what was already there. Delete the filler and confirm writes resume.

### 3. Host disappears mid-transfer
1. Start a download, then pull the host's network cable.
2. **Pass:** the transfer fails with a stated reason. The console does not sit on a spinner
   forever, and does not report success.

### 4. Clock skew between hosts
1. With mirroring on, set one host's clock 25 hours ahead.
2. Edit the same file on both.
3. **Pass:** replication converges. Note which copy wins: mirroring is last-write-wins on
   mtime, so a skewed clock wins wrongly. **This is a known weakness and is why the drill
   exists.** If it loses the newer edit, that is a bug worth fixing before launch.

### 5. Restore from a mirror
1. With two hosts mirroring and files on both, wipe host A's data directory entirely.
2. Re-enrol it.
3. **Pass:** the files come back from host B. If they do not, mirroring is not a backup and
   the marketing must not imply it is.

## What is not covered anywhere yet

- **Silent bit rot.** Chunks are content-addressed and AEAD-tagged, so corruption is
  *detected* on read, but nothing scrubs proactively and nothing repairs from a mirror copy.
- **Trash retention.** Trash never auto-purges; it grows until somebody empties it.
- **Versioning.** There is none. An overwrite is final once the trash is emptied.
