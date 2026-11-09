import React from "react";
import { loadConfig, getAccountKeyHex } from "@app/rpc-client";
import { isTauri, invoke } from "../shared/tauri";

// Native-only: mount an encrypted drive in Finder (a drive letter in Explorer on Windows)
// via the Tauri app's embedded WebDAV server — the LOCAL store or a REMOTE host (Iroh fast
// path, relay fallback). Renders nothing in the browser. Lives on the Settings → Drive &
// storage page.

interface MountInfo {
  mountpoint: string;
  /** Windows: Explorer copies are capped until the WebClient file limit is raised. */
  notice?: string | null;
}

const onWindows = /Win/.test(navigator.platform) || /Windows/.test(navigator.userAgent);
const inFinder = onWindows ? "In Explorer" : "In Finder";
const mountVerb = onWindows ? "Map as a drive" : "Mount in Finder";
const mountRemoteVerb = onWindows ? "Map remote as a drive" : "Mount remote in Finder";
const mountBlurb = onWindows
  ? "Map the local encrypted store to a drive letter."
  : "Mount the local encrypted store in Finder.";

export function MountControl(): JSX.Element | null {
  const [info, setInfo] = React.useState<MountInfo | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const saved = React.useMemo(() => loadConfig(), []);
  const [relayUrl, setRelayUrl] = React.useState(saved?.relayUrl ?? "ws://127.0.0.1:8790");
  const [account, setAccount] = React.useState(saved?.account ?? "demo");
  const [hostPub, setHostPub] = React.useState(saved?.hostPub ?? "");
  const [hostEid, setHostEid] = React.useState("");
  const [hostAddrs, setHostAddrs] = React.useState("");

  // The last mount request, so the drive can be re-mapped after the WebClient service
  // restarts (raising its file limit drops every mapping).
  const last = React.useRef<{ cmd: string; args?: Record<string, unknown> } | null>(null);

  React.useEffect(() => {
    if (!isTauri()) return;
    invoke<MountInfo | null>("mount_status")
      .then((s) => setInfo(s ?? null))
      .catch(() => {});
  }, []);

  if (!isTauri()) return null;

  const run = async (cmd: string, args?: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      last.current = { cmd, args };
      setInfo(await invoke<MountInfo>(cmd, args));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  const raiseLimit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await invoke("mount_raise_file_limit");
      setInfo(null);
      if (last.current) await run(last.current.cmd, last.current.args);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };
  const mountLocal = () => run("mount_start");
  const mountRemote = () =>
    run("mount_remote_start", {
      args: {
        relayUrl: relayUrl.trim(),
        account: account.trim(),
        hostPub: hostPub.trim(),
        hostEid: hostEid.trim() || null,
        hostAddrs: hostAddrs.split(",").map((s) => s.trim()).filter(Boolean),
        arkHex: getAccountKeyHex(),
      },
    });
  const unmount = async () => {
    setBusy(true);
    setErr(null);
    try {
      await invoke("mount_stop");
      setInfo(null);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remoteReady = hostPub.trim().length >= 32 && !!relayUrl.trim();

  return (
    <div className="mount-ctl">
      {info ? (
        <section className="set-sec">
          <div className="set-sec-h">Mounted</div>
          <div className="set-row">
            <span className="sr-main">
              <b>{inFinder}</b>
              <span>{info.mountpoint}</span>
            </span>
            <button className="btn btn-sm" onClick={unmount} disabled={busy}>
              {busy ? "…" : "Unmount"}
            </button>
          </div>
          {info.notice && (
            <div className="set-row">
              <span className="sr-main">
                <span>{info.notice}</span>
              </span>
              <button className="btn btn-sm" onClick={raiseLimit} disabled={busy}>
                {busy ? "…" : "Raise limit (admin)"}
              </button>
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="set-sec">
            <div className="set-sec-h">Local drive</div>
            <div className="set-row">
              <span className="sr-main">
                <b>This host's partition</b>
                <span>{mountBlurb}</span>
              </span>
              <button className="btn btn-primary btn-sm" onClick={mountLocal} disabled={busy}>
                {busy ? "Mounting…" : mountVerb}
              </button>
            </div>
          </section>
          <section className="set-sec">
            <div className="set-sec-h">Remote host</div>
            <div className="mount-form">
              <input placeholder="ws://relay:port" value={relayUrl} onChange={(e) => setRelayUrl(e.target.value)} />
              <input placeholder="account" value={account} onChange={(e) => setAccount(e.target.value)} />
              <input placeholder="host pubkey (hex)" value={hostPub} onChange={(e) => setHostPub(e.target.value)} />
              <input placeholder="iroh EndpointId (optional)" value={hostEid} onChange={(e) => setHostEid(e.target.value)} />
              <input placeholder="iroh addrs ip:port,… (optional)" value={hostAddrs} onChange={(e) => setHostAddrs(e.target.value)} />
              <button className="btn btn-sm" onClick={mountRemote} disabled={busy || !remoteReady}>
                {busy ? "Mounting…" : mountRemoteVerb}
              </button>
            </div>
          </section>
        </>
      )}
      {err && <div className="mount-err">{err}</div>}
    </div>
  );
}
