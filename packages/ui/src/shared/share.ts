// The single sharing client for the app (create/list/revoke share links). Shares the
// control-plane origin + session with the CpClient; the redeem side uses `redeemShare`.

import { createShareClient, loadSession, type ShareClient } from "@app/rpc-client";
import { CONTROL_URL } from "./cp";

let singleton: ShareClient | null = null;

export function share(): ShareClient {
  if (!singleton) {
    singleton = createShareClient({
      baseUrl: CONTROL_URL,
      session: () => loadSession()?.token ?? null,
    });
  }
  return singleton;
}
