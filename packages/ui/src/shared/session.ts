// Ending the local session. Lives here rather than inside a screen because more than one
// place needs it: Settings → Account offers it as "Log out", and the Hosts & devices page
// offers it as the remedy when the ~1h session has lapsed.

/**
 * Clear the local session/host config and reload, which drops back to onboarding → sign-in.
 * The account, license and host data all live on the server, so nothing is lost: signing back
 * in re-adopts the existing host. This is also the only escape from the app back to sign-in —
 * a release build has no devtools to clear storage by hand.
 */
export function signOut(): void {
  try {
    ["pc.session", "pc.conn", "pc.license", "pc.demo"].forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore storage failure */
  }
  location.reload();
}
