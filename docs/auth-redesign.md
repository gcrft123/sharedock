# Auth redesign — master password over passkeys

**Status:** implemented. Kept as the record of why auth is a master password.

## Why change

Passkeys are the current primary credential (`webauthn.ts` + `PasskeyClient`). For *this*
product they add friction without solving the real problem:

1. **The native app can't do WebAuthn.** WKWebView runs on `tauri://localhost`, so passkey
   ceremonies fail there — every sign-in needs a browser hand-off + deep-link back. Friction
   on *every* device.
2. **Old macOS has no OS passkeys.** They arrived in macOS 13 Ventura. On Mojave/High Sierra
   the only passkey path is a third-party manager (Proton Pass, 1Password) — install it, log
   into it, hope it's compatible. We already hit this: Proton Pass rejecting `localhost`, the
   RP-origin mismatch.
3. **It doesn't provision the ARK.** This is E2EE: the real secret is the 256-bit Account Root
   Key, which must reach every device to decrypt files. Passkey login proves identity to the
   control plane but does nothing about the ARK — which is exactly why the desktop flow *also*
   pastes a token **and** the ARK. Passkeys are a dependency bolted next to the actual hard part.

## The model: one master password that logs in *and* unwraps the ARK

This is the standard zero-knowledge design (Bitwarden, 1Password, Proton, Standard Notes).

- The ARK stays a **random 256-bit key** (unchanged). We never derive it from the password —
  we **wrap** it, so the user can change their password without re-encrypting any files.
- The **master password** derives a key that (a) wraps the ARK and (b) authenticates to the
  control plane, via two independent sub-keys.
- The **recovery key = the raw ARK** (as today) — demoted from "primary credential" to
  "break-glass if you forget your password."
- The control plane stays **zero-knowledge**: it stores a *hash* of an auth key and the
  *ciphertext* wrapped ARK. It never sees the password or the ARK.

Everything happens **in the app directly** — no browser hand-off, no password manager, on any
OS or webview.

## Crypto (reuses what we already have)

All byte-level primitives already exist in `crypto.ts` (`symSeal`/`symOpen` =
XChaCha20-Poly1305, `hkdf`, `randomKey`). Only a password KDF is new.

```
masterKey = Argon2id(password, salt, params)          # memory-hard; @noble/hashes/argon2
                                                       #   (scrypt fallback for old/slow devices)
encKey    = HKDF(masterKey, info = "pc/enc/v1")        # never leaves the device
authKey   = HKDF(masterKey, info = "pc/auth/v1")       # sent to the server as the login proof

wrapped_ark = symSeal(encKey, aad="ark-wrap/v1", ARK)  # stored on the control plane (ciphertext)
authVerifier = SHA-256(authKey)                        # server stores a salted hash of this
```

`encKey` and `authKey` are independent HKDF outputs — a server breach (which yields only
`authVerifier` and `wrapped_ark`) reveals neither the password nor the ARK; an attacker would
have to brute-force the password offline against Argon2id, the usual E2EE cost.

## Flows

- **Sign up** — client generates ARK + `salt`, derives the keys, computes `wrapped_ark` +
  `authVerifier`, `POST /api/auth/register {email, salt, kdfParams, wrapped_ark, authVerifier}`.
  Server creates the user, stores them, returns a session. Client shows the **recovery key**
  (the ARK) to save.
- **Log in (any device, in-app)** — `POST /api/auth/login/params {email}` → `{salt, kdfParams}`;
  client derives keys, `POST /api/auth/login {email, authVerifier}` → server compares its hash,
  returns `{session, wrapped_ark}`; client unwraps the ARK with `encKey` and stores it. Done —
  no browser, no passkey, no hand-off.
- **Add a second device** — either just log in with email+password, or **scan a QR** shown on
  an already-set-up device. The QR carries the ARK sealed to the new device's `agreement_pub`
  (the column already exists) + a short-lived pairing token → zero typing, Signal-style.
- **Change password** — client unwraps ARK with the old `encKey`, re-wraps with the new one,
  uploads the new `salt`/`wrapped_ark`/`authVerifier`. The ARK is unchanged, so **no files are
  re-encrypted**.
- **Forgot password** — enter the **recovery key** (raw ARK) → set a new password → re-wrap.
  There is no server-side reset (inherent to zero-knowledge).

## Data-model changes (D1 — new `0007_password_auth.sql`)

```sql
ALTER TABLE users ADD COLUMN kdf_salt     BLOB;   -- per-account, public
ALTER TABLE users ADD COLUMN kdf_params   TEXT;   -- json: {algo, mem, iters, parallelism}
ALTER TABLE users ADD COLUMN auth_verifier BLOB;  -- server-side salted hash of the client authKey
ALTER TABLE users ADD COLUMN wrapped_ark  BLOB;   -- ciphertext ARK (server never unwraps)
```
`credentials` + `challenges` (WebAuthn) become unused — keep them for an *optional* modern-device
passkey later, or drop in a follow-up migration.

## Code changes

**Control plane** — new `src/password.ts` (register / login/params / login / change), wired in
`worker.ts` under `/api/auth/*`. Reuse `signSession` (`tokens.ts`) and Web Crypto for the
server-side hash. `webauthn.ts` is retired (or feature-flagged for optional passkeys). `RP_ID`/
`RP_ORIGIN` config goes away.

**rpc-client-ts** — new `src/password.ts` (`PasswordClient.register/login/changePassword`).
`crypto.ts` gains `deriveMasterKey(password, salt, params)`, `splitKeys(masterKey)`,
`wrapArk`/`unwrapArk` (thin wrappers over `symSeal`/`symOpen`). `auth.ts` (`PasskeyClient`) is
removed. `config.ts`/`session.ts` unchanged — after login we `setAccountKeyHex(unwrapped ARK)`.

**UI (onboarding)** — `SignIn.tsx` becomes an email + password form (with confirm + a strength
meter on signup) that runs **entirely in-app**. `RecoveryKey.tsx` keeps showing the ARK, reframed
as the password-recovery backup, and gains a "forgot password → enter recovery key" path.
`machine.tsx` swaps `PasskeyClient` → `PasswordClient`. The desktop **token-paste fallback**
(`AddDevices`/import) is deleted — the app just logs in.

## What this fixes — and what it doesn't

Fixes, entirely: the WKWebView passkey gap, the browser hand-off, `RP_ID`/`RP_ORIGIN` config,
the Proton-Pass/localhost failures, the old-OS "no native passkey" problem, and the desktop
token-paste fallback. Auth becomes one in-app screen everywhere.

**Does not fix:** the old-macOS **webview** still can't run the app, because the E2EE *transport*
crypto (`@noble/curves` ed25519/x25519) needs `BigInt` (Safari 14+). Auth is byte/hash-based
(no BigInt), but the device identity + sealed-box path isn't. So password auth is the right model
regardless, but Mojave/High Sierra GUI support remains a separate track (native-crypto-over-IPC or
a BigInt-free curve lib — see `not-yet-built.md`).

## Trade-offs

- A **weak master password weakens the encryption** (offline brute-force against `wrapped_ark`).
  Mitigate with a strength meter, Argon2id cost, and framing the recovery key as the true root.
- **No server-side reset** — the recovery key is the only way back. Standard for zero-knowledge;
  make the recovery-key save step prominent.
- **KDF cost on old/slow Macs** — tune Argon2id memory down (or use scrypt) so a 2014 Intel Mac
  isn't unusably slow; benchmark before shipping params.
- **User enumeration** — `login/params` returning a salt per email reveals which emails exist.
  Acceptable for MVP, or return a deterministic decoy salt for unknown emails.

## Effort & phasing

1. **Server** — `password.ts` + migration + worker wiring + tests. ~½ day.
2. **Client crypto + `PasswordClient`** — KDF + key-split + wrap/unwrap + adapter. ~½ day.
3. **Onboarding UI** — password sign-in/up screen, recovery-key reframe, forgot-password. ~½ day.
4. **Delete** passkey server/client/RP config; update `two-device-test.md` + `not-yet-built.md`.
5. *(optional, later)* QR device-linking; optional passkey on modern devices.

Since the product is **pre-launch (no real users)**, this is a clean cutover — no data migration;
existing test accounts are just recreated.
