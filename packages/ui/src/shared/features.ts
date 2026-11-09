// Feature flags for surfaces the prototypes render but the backend does not yet
// implement. Kept in one place so the hidden surfaces read as intentional, deferred
// follow-ups rather than dead UI. See docs/not-yet-built.md.
//
// Flip a flag to `true` only once its backend actually exists.

export const FEATURES = {
  /** Public share links. Sharing lives on the Files page; no dashboard surface. */
  SHARING: true,
  /** Activity feed + terminal-log history, wired to `api.getActivity()`. */
  ACTIVITY_LOG: true,
  /** Per-host live read/write: the connected host shows real rate, others `--`. */
  PER_HOST_THROUGHPUT: true,
  /** Real transport (`getConnection().path`) for the connected host in the console. */
  DIRECT_P2P_TELEMETRY: true,
} as const;

export type FeatureFlag = keyof typeof FEATURES;
