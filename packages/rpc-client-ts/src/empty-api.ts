// A DriveApi that returns empty/zero data and rejects mutations. Used for the
// "disconnected / reconnect failed" state so the console never shows the MOCK's
// fake data (106 GB / 16 files) as if it were a real host.

import type { DriveApi } from "./types";

export function createEmptyApi(): DriveApi {
  const notConnected = async (): Promise<never> => {
    throw new Error("not connected to a host");
  };
  return {
    getHostStatus: async () => ({
      hostId: "",
      machineName: "—",
      os: "",
      appVersion: "",
      online: false,
      uptimeSecs: 0,
      diskFreeBytes: 0,
      diskTotalBytes: 0,
    }),
    getConnection: async () => ({
      path: "OFFLINE",
      latencyMs: 0,
      upBytesPerSec: 0,
      downBytesPerSec: 0,
      relayBytesUsed: 0,
      relayBytesIncluded: 0,
    }),
    getQuota: async () => ({ usedBytes: 0, quotaBytes: 0, fileCount: 0 }),
    setQuota: async (quotaBytes: number) => ({ usedBytes: 0, quotaBytes, fileCount: 0 }),
    listDir: async (path: string) => ({ path, entries: [] }),
    search: async () => ({ path: "search", entries: [] }),
    listStarred: async () => ({ path: "starred", entries: [] }),
    listRecent: async () => ({ path: "recent", entries: [] }),
    getTransfers: async () => [],
    listDevices: async () => [],
    listShares: async () => [],
    getActivity: async () => [],
    createFolder: notConnected,
    deleteEntry: notConnected,
    createShare: notConnected,
    revokeShare: async () => {},
    approveDevice: async () => {},
    revokeDevice: async () => {},
    move: notConnected,
    star: notConnected,
    trash: notConnected,
    restore: notConnected,
    emptyTrash: notConnected,
    listTrash: async () => ({ path: "trash", entries: [] }),
    uploadFile: notConnected,
    downloadFile: notConnected,
  };
}
