// dock_allocate — how much disk to lend. The slider max is capped at the license quota
// (baked into pending.max). "Create partition" commits the host behind the provision
// loader: for this-computer (Tauri) it starts the local daemon and waits for it, for a
// remote machine it waits for the host to publish itself; both then resolve the host's
// dial info from listHosts() and saveConfig().

import React from "react";
import { saveConfig, loadSession, type DiscoveredHost } from "@app/rpc-client";
import { cp, CONTROL_URL, relayOrigin } from "../shared/cp";
import { isTauri, invoke } from "../shared/tauri";
import { useOb, MSG, sleep, rv, Title, Sub } from "./machine";
import { prefetchDashboard } from "../dashboard/prefetch";
import { ObIcon } from "./icons";

/** Poll listHosts until a host not in `before` appears, or return null after `attempts`. */
async function findNewHost(account: string, before: Set<string>, attempts: number): Promise<DiscoveredHost | null> {
  for (let i = 0; i < attempts; i++) {
    let hosts: DiscoveredHost[] = [];
    try {
      hosts = await cp().listHosts(account);
    } catch {
      /* transient */
    }
    const fresh = hosts.find((h) => !before.has(h.endpoint_id));
    if (fresh) return fresh;
    await sleep(2500);
  }
  return null;
}

/**
 * A docked host self-enrolls as PENDING (approved = 0); the control plane withholds its serving
 * credential until the owner approves it. During onboarding the owner IS this session, so we
 * approve automatically. We approve EVERY pending host we see (no baseline): "dock this machine"
 * enrolls a moment after start_host_daemon, and "pair another machine" is already pending before
 * we get here — a baseline would wrongly skip the latter. Polls until at least one is approved.
 */
async function approvePendingHosts(attempts: number): Promise<number> {
  const approved = new Set<string>();
  for (let i = 0; i < attempts; i++) {
    try {
      for (const d of await cp().pendingHosts()) {
        if (!approved.has(d.id)) {
          await cp().approveDevice(d.id);
          approved.add(d.id);
        }
      }
      if (approved.size > 0) return approved.size;
    } catch {
      /* transient — keep polling */
    }
    await sleep(2500);
  }
  return approved.size;
}

export function DockAllocate(): JSX.Element {
  const { state, set, go, runLoader } = useOb();
  const p = state.pending;
  // The slider ceiling is how much this host can lend — its free disk, not a license byte
  // quota (the license only grants host seats). For a remote host that has already published,
  // read its real free disk; fall back to the pending placeholder until it arrives.
  const [max, setMax] = React.useState(p?.max ?? 1000);
  const [cap, setCap] = React.useState(p?.cap ?? 500);

  React.useEffect(() => {
    if (p?.kind !== "other") return;
    const account = loadSession()?.account ?? state.account;
    if (!account) return;
    let cancelled = false;
    cp()
      .listHosts(account)
      .then((hosts) => {
        if (cancelled) return;
        const diskGb = hosts
          .map((h) => Math.floor((h.disk_bytes ?? 0) / 1e9))
          .filter((g) => g > 0)
          .sort((a, b) => b - a)[0];
        if (diskGb) {
          setMax(diskGb);
          setCap((c) => Math.min(c, diskGb));
        }
      })
      .catch(() => {
        /* keep the placeholder max */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.kind]);

  const commit = () => {
    if (!p) return;
    const account = loadSession()?.account ?? state.account;
    const hostName = p.name;
    const quotaGb = cap;
    runLoader({
      variant: "modal",
      messages: MSG.provision,
      run: async () => {
        if (!account) throw new Error("Your session expired. Sign in again.");
        // Baseline of already-approved hosts, so findNewHost waits for the one THIS dock brings up.
        let beforeHosts = new Set<string>();
        try {
          beforeHosts = new Set((await cp().listHosts(account)).map((h) => h.endpoint_id));
        } catch {
          /* best-effort baseline */
        }
        if (p.kind === "this") {
          if (!isTauri()) throw new Error("Hosting this computer needs the Sharedock desktop app.");
          let claim = state.claimCode;
          if (!claim) claim = (await cp().createHostClaim(hostName)).code;
          // The host serves over the same relay origin the client dials (the control-plane
          // /signal DO by default), so client↔host browsing works over the relay.
          await invoke("start_host_daemon", {
            args: { controlUrl: CONTROL_URL, relayUrl: relayOrigin(), quotaGb, hostName, claim },
          });
        }
        // Wait for the docked host to come online + publish its endpoint, then save its dial info.
        // "Set up a host from here" is the owner's own machine → approve it here (no prompt) and it
        // publishes a NEW host AFTER we start it, so use the baseline to spot the new one. "Pair
        // another machine" was approved on the previous screen and has very likely ALREADY
        // published by now, so DON'T baseline it out — just take the published host.
        const attempts = p.kind === "this" ? 24 : 48;
        if (p.kind === "this") await approvePendingHosts(attempts);
        const host = await findNewHost(account, p.kind === "this" ? beforeHosts : new Set<string>(), attempts);
        if (!host) throw new Error("The host did not come online. Check the agent and try again.");
        // Persist the allocation (GiB → bytes) so ApiProvider pushes it to the host on connect;
        // the host enforces it (clamped to the licensed quota) instead of lending its whole disk.
        saveConfig({
          relayUrl: relayOrigin(),
          account,
          hostPub: host.agreement_pub ?? "",
          quotaBytes: quotaGb * 1024 ** 3,
        });
      },
      onDone: () => {
        set((s) => ({
          ...s,
          hosts: [...s.hosts, { name: p.name, kind: p.kind, icon: p.icon, cap: quotaGb }],
          pending: null,
          claimCode: null,
        }));
        // Preload the dashboard's control-plane data now that a host is docked, so it's warm
        // (usually already resolved) by the time the console opens — skeleton stays a fallback.
        if (account) prefetchDashboard(account);
        go("host_added");
      },
    });
  };

  return (
    <>
      <Title>How much of {p?.name ?? "the disk"} to lend?</Title>
      <Sub>Reserve a slice of this machine&rsquo;s disk for the encrypted partition. You can resize it later.</Sub>
      <div className="o-body">
        <div className="alloc rv" style={rv(1)}>
          <div className="top">
            <div className="t-stat" id="amt">
              {cap}
              <em>GB</em>
            </div>
          </div>
          <input
            className="rng"
            id="rng"
            type="range"
            min={1}
            max={max}
            step={1}
            value={cap}
            onChange={(e) => setCap(+e.target.value)}
          />
        </div>
        <div className="actions rv" style={rv(3)}>
          <button className="btn" onClick={() => go(p?.kind === "other" ? "dock_remote" : "dock_where")}>
            &larr; Back
          </button>
          <span className="sp" />
          <button className="btn btn-primary" onClick={commit}>
            Create partition <ObIcon name="arrow" />
          </button>
        </div>
      </div>
    </>
  );
}
