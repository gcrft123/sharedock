import React from "react";
import type { NavKey } from "./nav";
import { Rail } from "../dashboard/Rail";
import { Dashboard } from "../dashboard/Dashboard";
import { SettingsModal } from "../dashboard/SettingsModal";
import { Files } from "../files/Files";

// The signed-in, licensed, host-configured app: a persistent left rail plus a main
// area that swaps between Dashboard and Files. Settings is a modal overlay opened from
// the rail (on any page), matching the prototype. Onboarding gates this (see App.tsx);
// once here, the user has a session, a license, and a host config.

export function AppRoot() {
  const [nav, setNav] = React.useState<NavKey>("dashboard");
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [setCat, setSetCat] = React.useState("account");

  // Open settings on a given category — the Hosts panel routes its real "Add host" / "Retire"
  // to Settings → Hosts & devices, where those actions have their confirm + result UI.
  const openSettings = React.useCallback((cat = "account") => {
    setSetCat(cat);
    setSettingsOpen(true);
  }, []);

  return (
    <div className="app-shell">
      <Rail active={nav} onNav={setNav} onOpenSettings={() => setSettingsOpen(true)} />
      <main className="app-main">
        {/* Dashboard stays MOUNTED across tabs (just hidden) so its loaded data + live loops
            persist — switching to Files and back never re-shows skeletons or re-fetches. */}
        <div style={nav === "dashboard" ? undefined : { display: "none" }}>
          <Dashboard onOpenSettings={openSettings} />
        </div>
        {nav === "files" && <Files />}
      </main>
      <SettingsModal
        open={settingsOpen}
        setCat={setCat}
        onSetCat={setSetCat}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
