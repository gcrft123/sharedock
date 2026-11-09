// Public entry for @app/rpc-client.
//
//   - getApi()        -> the in-memory mock (default; no host needed)
//   - connectRealApi()-> a live E2EE relay connection to a real host
// Both satisfy the same `DriveApi`, so the UI is identical either way.

export * from "./types";
export { createMockApi } from "./mock";
export { createEmptyApi } from "./empty-api";
export { connectRealApi, RealDriveApi } from "./real-api";
export type { DriveTransport } from "./transport";
export { transfers } from "./transfers";
export {
  loadConfig,
  saveConfig,
  clearConfig,
  loadOrCreateIdentity,
  clientDeviceIdHex,
  getAccountKeyHex,
  setAccountKeyHex,
  getKeyringHex,
  setKeyringHex,
} from "./config";
export type { HostConnConfig } from "./config";
export { createCpClient, CpClient, CpError, isUnauthorized } from "./cp";
export { loadSession, saveSession, clearSession, refreshSessionIfNeeded } from "./session";
export type { Session } from "./session";
export { PasswordClient, createPasswordClient, AuthError } from "./password";
export type { AuthResult } from "./password";
export { BillingClient, createBillingClient, loadLicense } from "./billing";
export type { BillingClientOptions, CheckoutResult, License } from "./billing";
export { ShareClient, createShareClient, redeemShare, MAX_SHARE_BYTES } from "./share";
export type { ShareClientOptions, ShareInfo, CreatedShare } from "./share";
export type {
  AccountStatus,
  CpClientOptions,
  HostClaim,
  DeviceInfo,
  DiscoveredHost,
  Topology,
  Mode,
  Strategy,
  CapacityMode,
} from "./cp";

import type { DriveApi } from "./types";
import { createMockApi } from "./mock";

let singleton: DriveApi | null = null;

export function getApi(): DriveApi {
  if (!singleton) singleton = createMockApi();
  return singleton;
}

export { rotateAccountKey, type RotateProgress, type RotateResult } from "./rotate";
