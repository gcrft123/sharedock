/**
 * Transactional email, over the Cloudflare Email Sending binding.
 *
 * The product had no way to reach the person who bought it: no receipt, no way to
 * re-deliver a license after a reinstall, no route for telling anyone a fix exists. On a
 * one-time price you get roughly one contact moment with a customer, so this is the piece
 * that makes a sale recoverable.
 *
 * Two rules hold everywhere in this file:
 *
 *   1. SENDING NEVER THROWS. A receipt that fails to send must not fail the Stripe webhook
 *      that was minting the license, or the registration that was creating the account.
 *      Every send returns a boolean and swallows its own errors.
 *   2. UNCONFIGURED IS A VALID STATE. Without the `EMAIL` binding (local dev, and any
 *      deployment whose domain is not yet onboarded to Email Sending) every send is a
 *      logged no-op. Nothing in the product depends on mail being deliverable.
 *
 * Voice follows the product brief: machine register, plain sentences, no em-dashes, no
 * emoji, no marketing. These are receipts and records, not campaigns.
 */
import type { Env } from "./types";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sender identity. Must be on a domain onboarded to Cloudflare Email Sending. */
function sender(env: Env): { email: string; name: string } {
  return { email: env.EMAIL_FROM ?? "no-reply@sharedock.app", name: "Sharedock" };
}

/**
 * Send one message. Returns whether it actually went out.
 *
 * `false` is unremarkable: it means the binding is absent or the provider rejected the
 * message. Callers log it and carry on; none of them branch on it for correctness.
 */
export async function send(env: Env, mail: Mail): Promise<boolean> {
  if (!env.EMAIL) {
    console.log(`[email] not configured; would have sent "${mail.subject}" to ${mail.to}`);
    return false;
  }
  try {
    await env.EMAIL.send({
      to: mail.to,
      from: sender(env),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return true;
  } catch (e) {
    // Deliberately swallowed: see rule 1 above.
    console.log(`[email] send failed for "${mail.subject}" to ${mail.to}: ${String(e)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Templates
//
// Plain text is the real message; the HTML is the same words with enough structure to be
// readable. Both are always sent: some clients show only text, and a text part improves
// spam scoring.
// ---------------------------------------------------------------------------

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/*
 * Why this file carries literal colors instead of design tokens.
 *
 * Mail clients are not browsers: CSS custom properties are unsupported across the major
 * ones, `<style>` blocks are stripped or rewritten, and webfonts do not load. Everything
 * has to be an inline literal, so the tokens cannot come along.
 *
 * What CAN come along is the palette itself, so these are the design system's own values
 * rather than generic greys: EDGE is `--edge`, MUTED is `--muted`, EMBER is `--o-ember`,
 * and the mono stack is `--mono` minus the webfont that will never arrive. The two light
 * surfaces are genuine additions: Halfsteel is dark-first and has no light ground, and a
 * dark email is a bad bet when client dark-mode handling is this inconsistent.
 */
const EDGE = "#1B1916"; // --edge, warm near-black: body text on a light ground
const MUTED = "#80796F"; // --muted
const EMBER = "#C7370B"; // --o-ember, the one accent
const RULE = "#E4DFD7"; // light-ground hairline, warm to match the palette
const WELL = "#F6F3EE"; // light-ground inset for the license key
const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";

/** Wrap body lines in a minimal shell. Email clients are not browsers. */
function shell(title: string, blocks: string[]): string {
  return [
    `<div style="font-family:${MONO};font-size:14px;line-height:1.6;color:${EDGE};max-width:560px">`,
    `<p style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${MUTED};margin:0 0 18px">Sharedock</p>`,
    `<h1 style="font-size:19px;line-height:1.3;margin:0 0 18px;font-weight:600">${esc(title)}</h1>`,
    ...blocks,
    `<p style="font-size:12px;color:${MUTED};border-top:1px solid ${RULE};padding-top:14px;margin-top:26px">`,
    `You are receiving this because you have a Sharedock account. This is a service message, not marketing.`,
    `</p>`,
    `</div>`,
  ].join("");
}

const p = (s: string): string => `<p style="margin:0 0 14px">${esc(s)}</p>`;
const pre = (s: string): string =>
  `<p style="margin:0 0 14px"><code style="display:block;word-break:break-all;background:${WELL};border:1px solid ${RULE};padding:10px;font-size:12px">${esc(s)}</code></p>`;
const link = (href: string, label: string): string =>
  `<p style="margin:0 0 14px"><a href="${esc(href)}" style="color:${EMBER}">${esc(label)}</a></p>`;

/** Confirm the address is real, so a receipt has somewhere to land later. */
export function verifyEmail(url: string): Omit<Mail, "to"> {
  const text = [
    "Confirm your email address",
    "",
    "This address was used to create a Sharedock account. Confirming it is what lets us send",
    "you your license and, if you ever reinstall, send it again.",
    "",
    url,
    "",
    "The link is good for 24 hours. If you did not create an account, ignore this message:",
    "nothing happens until the link is opened.",
  ].join("\n");
  return {
    subject: "Confirm your Sharedock email address",
    text,
    html: shell("Confirm your email address.", [
      p("This address was used to create a Sharedock account. Confirming it is what lets us send you your license and, if you ever reinstall, send it again."),
      link(url, "Confirm this address"),
      p("The link is good for 24 hours. If you did not create an account, ignore this message: nothing happens until the link is opened."),
    ]),
  };
}

/**
 * The receipt. This is the single most important message the product sends: it is the
 * customer's proof of purchase AND their copy of a perpetual license they may need years
 * from now, on hardware that does not exist yet.
 */
export function receipt(o: {
  tierName: string;
  hostSeats: number;
  license: string;
  paymentRef: string;
}): Omit<Mail, "to"> {
  const seats = `${o.hostSeats} host${o.hostSeats === 1 ? "" : "s"}`;
  const text = [
    `Your Sharedock license`,
    "",
    `Tier:        ${o.tierName}`,
    `Covers:      ${seats}`,
    `Reference:   ${o.paymentRef}`,
    `Term:        perpetual. Paid once, no renewal.`,
    "",
    "Your license key is below. Keep this email: the key is what a host verifies offline,",
    "so it works with no account and no network, and it does not expire.",
    "",
    o.license,
    "",
    "You do not normally need to enter it by hand. Sign in on a machine and Sharedock",
    "collects it for you. This copy is for the day that is not possible.",
  ].join("\n");
  return {
    subject: `Your Sharedock license (${o.tierName})`,
    text,
    html: shell("Your Sharedock license.", [
      p(`${o.tierName}. Covers ${seats}. Paid once, perpetual, no renewal.`),
      p(`Payment reference: ${o.paymentRef}`),
      p("Your license key is below. Keep this email: the key is what a host verifies offline, so it works with no account and no network, and it does not expire."),
      pre(o.license),
      p("You do not normally need to enter it by hand. Sign in on a machine and Sharedock collects it for you. This copy is for the day that is not possible."),
    ]),
  };
}

/** The same license, sent again on request. */
export function licenseCopy(o: { tierName: string; hostSeats: number; license: string }): Omit<Mail, "to"> {
  const seats = `${o.hostSeats} host${o.hostSeats === 1 ? "" : "s"}`;
  const text = [
    "Your Sharedock license, again",
    "",
    `Tier:    ${o.tierName}`,
    `Covers:  ${seats}`,
    "",
    o.license,
    "",
    "You asked for another copy. Nothing about your license changed, and no previous copy",
    "stopped working.",
  ].join("\n");
  return {
    subject: `Your Sharedock license (${o.tierName})`,
    text,
    html: shell("Your license, again.", [
      p(`${o.tierName}. Covers ${seats}.`),
      pre(o.license),
      p("You asked for another copy. Nothing about your license changed, and no previous copy stopped working."),
    ]),
  };
}
