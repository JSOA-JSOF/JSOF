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
import { enqueue } from "../comms/queue";
import { LIMITS, consume } from "../ratelimit";
import {
  LOGIN_TOKEN_MINUTES,
  SESSION_COOKIE,
  SESSION_HOURS,
  looksLikeEmail,
  normaliseEmail,
} from "./tokens";
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

/**
 * Where a sign-in link points.
 *
 * Fixed rather than taken from the request, because a Host header is
 * attacker-controlled and a link built from one is how a sign-in email
 * ends up pointing at somebody else's server.
 */
const SIGN_IN_BASE = "https://thejsof.org";

const SAME_ANSWER =
  "If that address has an account, a sign-in link is on its way. It is good for fifteen minutes.";

export type LinkResult = { message: string };

export async function requestLink(
  _previous: LinkResult | null,
  form: FormData,
): Promise<LinkResult> {
  const email = String(form.get("email") ?? "");
  if (!looksLikeEmail(email)) return { message: SAME_ANSWER };

  // Counted before the lookup, and the same answer either way.
  //
  // Limiting after deciding whether the address is known would make
  // the limit itself an oracle: a known address would be throttled
  // and an unknown one would not, which tells a stranger exactly what
  // this handler spends the rest of its body refusing to say. It also
  // stops the form being an unauthenticated way to make this
  // organization send mail to any address somebody types.
  const within = await consume(`signin:${normaliseEmail(email)}`, LIMITS.signInLink);
  if (!within.allowed) {
    await audit({ action: "SIGN_IN_LINK_THROTTLED", detail: "too many requests" });
    return { message: SAME_ANSWER };
  }

  const person = await personByEmail(email);
  if (person && !person.disabled_at) {
    const token = await issueLoginToken(person.id);
    const link = `${SIGN_IN_BASE}/sign-in/link?token=${token}`;

    // Queued, never sent inline. The queue does the same work whether
    // or not a message can be delivered, which is what keeps the
    // response time from answering a question this handler refuses to
    // answer in words.
    //
    // Entity is null: a sign-in link makes no tax claim and speaks in
    // neither organization's voice. Whether platform mail may go out
    // from the Foundation's verified domain is a question for the
    // board; until it answers, ./comms/sender gives it an identity
    // that is neither entity.
    await enqueue({
      stream: "TRANSACTIONAL",
      entity: null,
      kind: "SIGN_IN_LINK",
      toAddress: person.email,
      toName: person.display_name,
      subject: "Your sign-in link",
      bodyText:
        `${person.display_name},\n\n` +
        `Here is your sign-in link. It works once and it expires in ` +
        `${LOGIN_TOKEN_MINUTES} minutes.\n\n${link}\n\n` +
        `If you did not ask for this, you can ignore it. Nothing has ` +
        `changed on your account and nobody has been told you were sent ` +
        `a link.\n`,
    });

    await audit({
      actorId: person.id,
      action: "SIGN_IN_LINK_ISSUED",
      subject: `person:${person.id}`,
      // The link itself is no longer written here. It is in the
      // outbox, which is where a thing that opens a session belongs,
      // and the audit log records that one was issued rather than
      // what it was.
      detail: "queued to the sender's address",
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

  // Ten an hour per session. Six digits with a one-step window is
  // about a million possibilities, which no person walks and a script
  // walks in seconds.
  const within = await consume(`mfa:${live.row.id}`, LIMITS.mfaAttempt);
  if (!within.allowed) {
    await audit({
      actorId: live.row.person_id,
      action: "MFA_THROTTLED",
      subject: `session:${live.row.id}`,
    });
    return { error: "Too many attempts. Wait an hour, or sign in again." };
  }

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
