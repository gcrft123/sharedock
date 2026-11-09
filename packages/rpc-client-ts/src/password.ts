// Master-password auth client for the control plane's /api/auth/* endpoints.
//
// Zero-knowledge: the control plane only ever sees a *hash* of the login auth key
// and the *ciphertext* wrapped ARK — never the password, never the ARK. All key
// derivation and ARK (un)wrapping happen here, on the device. Works everywhere
// (any browser, and the Tauri webview) — no WebAuthn, no password manager.

import {
  deriveMasterKey,
  splitKeys,
  wrapArk,
  randomKey,
  newRecoveryKey,
  splitRecoveryKey,
  wrapArkForRecovery,
  unwrapArkForRecovery,
  unwrapKeyring,
  toB64,
  fromB64,
  toHex,
  fromHex,
  DEFAULT_KDF,
  type KdfParams,
} from "./crypto";

export interface AuthResult {
  account: string;
  token: string;
  /** The raw ARK as hex — set locally (`setAccountKeyHex`) so files decrypt. */
  arkHex: string;
  /**
   * The account-key KEYRING as hex, newest first. Usually one key; more while a rotation is
   * in flight, when some files are still wrapped under the previous key. Callers should
   * store the whole ring (`setKeyringHex`), not just `arkHex`, or a device that signs in
   * mid-rotation finds half the drive unreadable.
   */
  keyringHex: string[];
  /**
   * The recovery key as hex, present ONLY when one was just minted (registration, or the
   * upgrade of an account created before recovery existed). Show it once and never store
   * it: this is the whole secret, and the server holds nothing that can reproduce it.
   */
  recoveryKeyHex?: string;
  /** False when the account predates recovery keys and has not been upgraded yet. */
  hasRecovery?: boolean;
}

/** Carries the HTTP status so onboarding can branch (e.g. 404 → offer to create). */
export class AuthError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class PasswordClient {
  private base: string;
  constructor(baseUrl: string) {
    this.base = baseUrl.replace(/\/+$/, "");
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* non-JSON */
    }
    if (!res.ok) throw new AuthError((json.error as string) || `${path} → ${res.status}`, res.status);
    return json as T;
  }

  /**
   * Create an account: generate a random ARK, wrap it under the password, and upload
   * only the ciphertext + an auth key (server stores its hash). Returns the session
   * and the raw ARK hex (show it on the recovery-key screen, and `setAccountKeyHex`).
   */
  async register(email: string, password: string): Promise<AuthResult> {
    const ark = randomKey();
    const salt = randomKey(); // 32-byte per-account KDF salt
    const params: KdfParams = DEFAULT_KDF;
    const master = deriveMasterKey(password, salt, params);
    const { encKey, authKey } = splitKeys(master);
    const wrapped = wrapArk(encKey, ark);
    const res = await this.post<{ account: string; token: string }>("/api/auth/register", {
      email,
      kdf: { salt: toB64(salt), algo: params.algo, N: params.N, r: params.r, p: params.p },
      wrapped_ark: toB64(wrapped),
      auth_key: toB64(authKey),
    });
    // Mint the recovery key immediately, while the ARK is in hand. Best-effort: an account
    // that exists without a recovery blob is recoverable later (see `ensureRecovery`),
    // whereas failing registration over it would lose the account entirely.
    let recoveryKeyHex: string | undefined;
    try {
      recoveryKeyHex = await this.putRecovery(res.token, ark);
    } catch {
      /* upgraded on next sign-in */
    }
    return {
      account: res.account,
      token: res.token,
      arkHex: toHex(ark),
      keyringHex: [toHex(ark)],
      recoveryKeyHex,
      hasRecovery: !!recoveryKeyHex,
    };
  }

  /**
   * Mint a recovery key, wrap the ARK under it, and store the blob. Returns the key as
   * hex, to be shown once.
   */
  private async putRecovery(sessionToken: string, ark: Uint8Array): Promise<string> {
    const rk = newRecoveryKey();
    const { encKey, authKey } = splitRecoveryKey(rk);
    const res = await fetch(`${this.base}/api/auth/recovery`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({
        recovery_wrapped_ark: toB64(wrapArkForRecovery(encKey, ark)),
        recovery_auth: toB64(authKey),
      }),
    });
    if (!res.ok) throw new AuthError(`recovery setup failed (${res.status})`, res.status);
    return toHex(rk);
  }

  /**
   * Give an account created before recovery keys existed one now, using the ARK the caller
   * already holds from a successful sign-in. Returns the new key to show once, or null if
   * it could not be stored.
   */
  async ensureRecovery(sessionToken: string, arkHex: string): Promise<string | null> {
    try {
      return await this.putRecovery(sessionToken, fromHex(arkHex));
    } catch {
      return null;
    }
  }

  /**
   * The auth key for an existing account, derived from its password.
   *
   * Used where the server must re-check the password without a full sign-in: deleting an
   * account. Fetches the account's public KDF parameters, derives locally, and returns only
   * the proof half. The password itself never leaves this function.
   */
  async authKeyFor(email: string, password: string): Promise<string> {
    const kp = await this.post<{ salt: string; algo: KdfParams["algo"]; N: number; r: number; p: number }>(
      "/api/auth/login/params",
      { email },
    );
    const master = deriveMasterKey(password, fromB64(kp.salt), { algo: kp.algo, N: kp.N, r: kp.r, p: kp.p });
    return toB64(splitKeys(master).authKey);
  }

  /**
   * Recover an account with the recovery key: unwrap the ARK with it, re-wrap under a NEW
   * password, and install that. The ARK is unchanged, so nothing already stored has to be
   * re-encrypted, and the recovery key stays valid afterwards.
   */
  async recover(email: string, recoveryKeyHex: string, newPassword: string): Promise<AuthResult> {
    const rk = fromHex(recoveryKeyHex);
    if (rk.length !== 32) throw new AuthError("That recovery key is not the right length.", 400);
    const { encKey: recEnc, authKey: recAuth } = splitRecoveryKey(rk);

    const begun = await this.post<{ wrapped_ark: string }>("/api/auth/recover/begin", {
      email,
      recovery_auth: toB64(recAuth),
    });

    let ark: Uint8Array;
    try {
      ark = unwrapArkForRecovery(recEnc, fromB64(begun.wrapped_ark));
    } catch {
      // The server accepted the proof but the blob will not open: treat it as a bad key
      // rather than leaking that the two halves disagree.
      throw new AuthError("That recovery key did not unlock this account.", 401);
    }

    const salt = randomKey();
    const params: KdfParams = DEFAULT_KDF;
    const master = deriveMasterKey(newPassword, salt, params);
    const { encKey, authKey } = splitKeys(master);
    const res = await this.post<{ account: string; token: string }>("/api/auth/recover/finish", {
      email,
      recovery_auth: toB64(recAuth),
      kdf: { salt: toB64(salt), algo: params.algo, N: params.N, r: params.r, p: params.p },
      wrapped_ark: toB64(wrapArk(encKey, ark)),
      auth_key: toB64(authKey),
    });
    return { account: res.account, token: res.token, arkHex: toHex(ark), keyringHex: [toHex(ark)], hasRecovery: true };
  }

  /**
   * Sign in: fetch the account's KDF params, derive the keys, prove the auth key,
   * and unwrap the ARK the server returns. Throws AuthError(404) if no account.
   */
  async login(email: string, password: string): Promise<AuthResult> {
    const kp = await this.post<{ salt: string; algo: KdfParams["algo"]; N: number; r: number; p: number }>(
      "/api/auth/login/params",
      { email },
    );
    const master = deriveMasterKey(password, fromB64(kp.salt), { algo: kp.algo, N: kp.N, r: kp.r, p: kp.p });
    const { encKey, authKey } = splitKeys(master);
    const res = await this.post<{ account: string; token: string; wrapped_ark: string; has_recovery?: boolean }>(
      "/api/auth/login",
      { email, auth_key: toB64(authKey) },
    );
    // Accepts both shapes: a bare key from before rotation existed, and a keyring after.
    const ring = unwrapKeyring(encKey, fromB64(res.wrapped_ark));
    return {
      account: res.account,
      token: res.token,
      arkHex: toHex(ring[0]),
      keyringHex: ring.map((k) => toHex(k)),
      hasRecovery: !!res.has_recovery,
    };
  }
}

export function createPasswordClient(baseUrl: string): PasswordClient {
  return new PasswordClient(baseUrl);
}
