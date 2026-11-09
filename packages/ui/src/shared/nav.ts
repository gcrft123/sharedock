// The app's top-level pages, mirroring the dashboard prototype's rail
// (`NAV = [home, dash, files]`). "home" stays inert as designed; "dashboard" and
// "files" are the real pages. Settings is a modal overlay (opened from the rail on
// any page), not a page — see AppRoot.

export type NavKey = "dashboard" | "files";
