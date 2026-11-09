import { loadSession } from "@app/rpc-client";
import type { NavKey } from "../shared/nav";
import { Icon, type IconName } from "./icons";
import { LOGO_SRC } from "./logo";
import "./dashboard.css";

/** The signed-in account chip data: real email + license tier, no fixtures. */
function acctChip(): { email: string; initial: string; tier: string } {
  const email = loadSession()?.email ?? "Signed in";
  let tier = "";
  try {
    const l = JSON.parse(localStorage.getItem("pc.license") ?? "null") as { tier?: string } | null;
    if (l?.tier) tier = `${l.tier.charAt(0).toUpperCase()}${l.tier.slice(1)} license`;
  } catch {
    /* no license stored */
  }
  return { email, initial: (email[0] ?? "?").toUpperCase(), tier };
}

// Left rail (#rail) — brand mark, primary nav (Home / Dashboard / Files), a Settings
// button and the account chip. Ported from the prototype's `#railnav` builder + the
// static `.rail-bot`. "Home" stays inert as in the prototype; Dashboard/Files/Settings
// route via `onNav`, and the account chip also opens Settings (per spec).

type NavItem = { key: string; label: string; icon: IconName; target: NavKey | null };

const NAV: NavItem[] = [
  { key: "home", label: "Home", icon: "home", target: null },
  { key: "dash", label: "Dashboard", icon: "dash", target: "dashboard" },
  { key: "files", label: "Files", icon: "files", target: "files" },
];

export function Rail({
  active,
  onNav,
  onOpenSettings,
  pinned = false,
}: {
  active: NavKey | null;
  onNav: (k: NavKey) => void;
  onOpenSettings: () => void;
  /** Force the expanded state (used pinned-open during onboarding). */
  pinned?: boolean;
}): JSX.Element {
  return (
    <aside className={`rail${pinned ? " rail-pinned" : ""}`} id="rail">
      <div className="rail-brand">
        <img src={LOGO_SRC} alt="Sharedock" />
      </div>
      <nav className="rail-nav" id="railnav">
        {NAV.map((n) => {
          const on = n.target !== null && n.target === active;
          return (
            <button
              key={n.key}
              className={`rail-item ${on ? "on" : ""}`}
              data-nav={n.key}
              onClick={() => n.target && onNav(n.target)}
            >
              <span className="ri-ic">
                <Icon name={n.icon} size={22} />
              </span>
              <span className="ri-l">{n.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="rail-bot">
        <button className="rail-item" data-nav="settings" onClick={onOpenSettings}>
          <span className="ri-ic">
            <Icon name="settings" size={22} />
          </span>
          <span className="ri-l">Settings</span>
        </button>
        {/* A button, not a div: this opens Settings, so it has to be reachable and
            operable by keyboard like any other control. */}
        {(() => {
          const a = acctChip();
          return (
            <button
              className="rail-acct"
              type="button"
              onClick={onOpenSettings}
              aria-label={`Open settings for ${a.email}`}
            >
              <span className="av">{a.initial}</span>
              <span className="who">
                <b>{a.email}</b>
                <span>{a.tier}</span>
              </span>
            </button>
          );
        })()}
      </div>
    </aside>
  );
}
