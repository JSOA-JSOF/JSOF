"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  audit,
  beginEnrolment,
  confirmEnrolment,
  consumeLoginToken,
  credentialFor,
  issueLoginToken,
  markMfaPassed,
  personByEmail,
  revokeSession,
  startSession,
} from "./store";
import { SESSION_COOKIE, SESSION_HOURS, looksLikeEmail } from "./tokens";
import { newTotpSecret, verifyTotp } from "./totp";
import { getLiveSession } from "../authz/session";

/**
 * Sign in, in three steps: prove the mailbox, then prove the device.
 *
 * The thing that shapes every answer here is that the roster is the
 * sensitive asset. Who is a member of this association is precisely
 * what should not be learnable from the outside, so no response on this
 * path may differ based on whether an address is known. Every outcome
 * of `requestLink` is the same sentence, and it does the same work
 * either way.
 */

const SAME_ANSWER =
  "If that address has an account, a sign-in link is on its way. It is good for fifteen minutes.";

export type LinkResult = { message: string };

export async function requestLink(
  _previous: LinkResult | null,
  form: FormData,
): Promise<LinkResult> {
  const email = String(form.get("email") ?? "");
  if (!looksLikeEmail(email)) return { message: SAME_ANSWER };

  const person = await personByEmail(email);
  if (person && !person.disabled_at) {
    const token = await issueLoginToken(person.id);
    // TODO(E46): hand to the mail queue. Until Communications lands the
    // link is written to the audit log, where an administrator with
    // database access can read it. That is not a backdoor: it needs the
    // same access that could mint a session directly.
    await audit({
      actorId: person.id,
      action: "SIGN_IN_LINK_ISSUED",
      subject: `person:${person.id}`,
      detail: `/sign-in/link?token=${token}`,
    });
  } else {
    await audit({
      action: "SIGN_IN_LINK_REFUSED",
      detail: "unknown or disabled address",
    });
  }

  return { message: SAME_ANSWER };
}

/**
 * Spend the link and start a session.
 *
 * The session begins without the second factor satisfied, so it can
 * reach the enrolment and challenge screens and nothing else.
 */
export async function signInWithToken(token: string): Promise<"ok" | "bad"> {
  const personId = await consumeLoginToken(token);
  if (!personId) {
    await audit({ action: "SIGN_IN_FAILED", detail: "bad or spent link" });
    return "bad";
  }

  const sessionToken = await startSession(personId);
  (await cookies()).set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  await audit({
    actorId: personId,
    action: "SIGN_IN",
    detail: "email link accepted, second factor outstanding",
  });
  return "ok";
}

export type MfaResult = { error?: string; secret?: string };

/** Start enrolment and hand back the secret to show once. */
export async function startEnrolment(): Promise<MfaResult> {
  const live = await getLiveSession();
  if (!live) return { error: "Not signed in." };
  const existing = await credentialFor(live.row.person_id);
  if (existing?.confirmed_at) return { error: "Already enrolled." };

  const secret = newTotpSecret();
  await beginEnrolment(live.row.person_id, secret);
  return { secret };
}

/**
 * Present a code.
 *
 * One path for enrolment and for the standing challenge, because they
 * are the same check: the only difference is whether the credential was
 * already confirmed, and confirming it is idempotent.
 */
export async function submitCode(
  _previous: MfaResult | null,
  form: FormData,
): Promise<MfaResult> {
  const live = await getLiveSession();
  if (!live) return { error: "Not signed in." };

  const credential = await credentialFor(live.row.person_id);
  if (!credential) return { error: "No authenticator is set up yet." };

  const code = String(form.get("code") ?? "");
  if (!(await verifyTotp(credential.totp_secret, code))) {
    await audit({
      actorId: live.row.person_id,
      action: "MFA_FAILED",
      subject: `session:${live.row.id}`,
    });
    return { error: "That code was not accepted." };
  }

  if (!credential.confirmed_at) await confirmEnrolment(live.row.person_id);
  await markMfaPassed(live.row.id);
  await audit({
    actorId: live.row.person_id,
    action: "MFA_PASSED",
    subject: `session:${live.row.id}`,
  });
  redirect("/board");
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const live = await getLiveSession();
    await revokeSession(token);
    if (live) {
      await audit({ actorId: live.row.person_id, action: "SIGN_OUT" });
    }
  }
  store.delete(SESSION_COOKIE);
  redirect("/sign-in");
}
