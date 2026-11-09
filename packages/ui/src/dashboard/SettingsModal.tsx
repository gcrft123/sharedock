import React from "react";
import { loadSession } from "@app/rpc-client";
import type { License } from "@app/rpc-client";
import { Icon, type IconName } from "./icons";
import { useModalLayer } from "../shared/modal";
import { signOut } from "../shared/session";
import { isTauri } from "../shared/tauri";
import { tierOf } from "../onboarding/machine";
import { MountControl } from "./MountControl";
import { AboutPage, AccountDangerZone, NetworkPage, SecurityPage } from "./SettingsPages";
import { HostsDevicesPage } from "./HostsDevicesPage";

// Settings modal (#settingsscrim) — category sidebar + content pane.
//
// Every category here is real. The sidebar used to list nine, of which six rendered "No
// options yet", which reads as unfinished rather than minimal on the screen a new owner opens
// right after paying. Notifications and Appearance were removed rather than filled: there is
// no notification system, and the design system is deliberately a single dark world, so both
// would have been invented settings. General went the same way, its one honest inhabitant
// (this machine as a host) already living on Hosts & devices.
//
// Device + host management lives entirely on the Hosts & devices page — Account used to
// carry a second, read-mostly copy of the device list, which meant two places to keep in
// sync and two answers to "where do I revoke this?".

interface Cat {
  key: string;
  label: string;
  icon: IconName;
}

const CATS: Cat[] = [
  { key: "account", label: "Account", icon: "user" },
  { key: "drive", label: "Drive & storage", icon: "server" },
  { key: "devices", label: "Hosts & devices", icon: "devices" },
  { key: "network", label: "Network", icon: "global" },
  { key: "security", label: "Security", icon: "shield" },
  { key: "about", label: "About", icon: "info" },
];

/** The stored license (written by DockIntro after purchase / dev-license). */
function loadLicense(): License | null {
  try {
    const raw = localStorage.getItem("pc.license");
    return raw ? (JSON.parse(raw) as License) : null;
  } catch {
    return null;
  }
}

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function AccountPage(): JSX.Element {
  const session = loadSession();
  const email = session?.email ?? "—";
  const name = email.includes("@") ? email.split("@")[0] : "You";
  const initial = (email[0] ?? "?").toUpperCase();
  const license = loadLicense();

  return (
    <div className="set-page">
      <section className="set-sec">
        <div className="set-sec-h">Profile</div>
        <div className="set-profile">
          <div className="set-avatar">{initial}</div>
          <div className="set-fields">
            <div className="set-field">
              <span className="sf-l">Name</span>
              <span className="sf-v">{name}</span>
            </div>
            <div className="set-field">
              <span className="sf-l">Email</span>
              <span className="sf-v">{email}</span>
            </div>
          </div>
        </div>
      </section>
      <section className="set-sec">
        <div className="set-sec-h">License</div>
        <div className="set-license">
          <span className="lic-badge">
            <Icon name="crown" size={22} />
          </span>
          <div className="lic-main">
            <div className="lic-top">
              <b>{(() => {
                const t = license ? tierOf(license.tier) : null;
                return t ? t.n : license ? cap(license.tier) : "No license";
              })()}</b>
              {license && (
                <span className="chip chip-o">
                  <i></i>Active
                </span>
              )}
            </div>
            <span className="lic-sub">
              {(() => {
                if (!license) return "No active license on this account.";
                const h = license.hostSeats;
                const hosts = h ? `${h} host${h === 1 ? "" : "s"}` : "unlimited hosts";
                if (license.tier === "self-hosted") return `${hosts} · self-hosted`;
                return `${hosts} · one-time purchase · lifetime`;
              })()}
            </span>
          </div>
        </div>
      </section>
      <section className="set-sec">
        <div className="set-sec-h">Session</div>
        <div className="set-actions">
          <button className="btn btn-ghost" onClick={signOut}>
            <span className="bi">
              <Icon name="logout" size={15} />
            </span>
            Log out
          </button>
        </div>
      </section>

      {/* Licence re-delivery, data export and deletion. The button that used to sit above was
          decoration: it had no handler at all, so "Delete account" did nothing. */}
      <AccountDangerZone />
    </div>
  );
}

export function SettingsModal({
  open,
  setCat,
  onSetCat,
  onClose,
}: {
  open: boolean;
  setCat: string;
  onSetCat: (key: string) => void;
  onClose: () => void;
}): JSX.Element {
  const cur = CATS.find((c) => c.key === setCat) || CATS[0];
  const dlg = React.useRef<HTMLDivElement>(null);
  useModalLayer(open, onClose, dlg);
  return (
    <div
      className={`dlg-scrim ${open ? "on" : ""}`}
      id="settingsscrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={dlg} tabIndex={-1} className="dlg set-dlg" role="dialog" aria-modal="true" aria-label="Settings">
        <aside className="set-nav">
          <div className="set-cats" id="setcats">
            {CATS.map((c) => (
              <button
                className={`set-cat ${setCat === c.key ? "on" : ""}`}
                data-setcat={c.key}
                key={c.key}
                onClick={() => onSetCat(c.key)}
              >
                <span className="ci">
                  <Icon name={c.icon} size={18} />
                </span>
                {c.label}
              </button>
            ))}
          </div>
        </aside>
        <div className="set-main">
          <div className="set-main-head">
            <span id="setcattitle">{cur.label}</span>
            <button className="btn btn-ghost btn-sm" data-act="setclose" aria-label="Close" onClick={onClose}>
              Esc
            </button>
          </div>
          <div className="set-main-body" id="setbody">
            {setCat === "account" ? (
              <AccountPage />
            ) : setCat === "security" ? (
              <SecurityPage />
            ) : setCat === "network" ? (
              <NetworkPage />
            ) : setCat === "about" ? (
              <AboutPage />
            ) : setCat === "devices" ? (
              // `open` gates its refresh loop — the modal body stays mounted when closed.
              <HostsDevicesPage active={open} />
            ) : setCat === "drive" && isTauri() ? (
              <MountControl />
            ) : (
              <div className="set-empty">
                <span className="se-ic">
                  <Icon name={cur.icon} size={40} />
                </span>
                <span className="se-t">{cur.label}</span>
                <span className="se-s">No options yet</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
