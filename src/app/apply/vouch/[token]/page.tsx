import Link from "next/link";

import { membershipRepository } from "@/lib/membership/repository";
import type { VouchOutcome } from "@/lib/membership/types";
import { describeVouchToken, VOUCH_ACTIONS, VOUCH_WINDOW_COPY } from "@/lib/membership/vouch";

import styles from "../../apply.module.css";
import { recordVouch } from "./actions";

export const metadata = {
  title: "A membership application names you as sponsor — JSOA",
  // Nothing behind a token is meant to be found.
  robots: { index: false, follow: false },
};

/**
 * The sponsor vouch page.
 *
 * The token in the path is the whole authentication. There is no sign-in here
 * on purpose: asking a sponsor to remember a password to answer one question
 * is how vouches stop happening, and the mechanism that replaces a DD-214 only
 * works if sponsors actually answer.
 *
 * So two rules hold. The token is 128 bits of randomness, and an unknown token
 * renders exactly what an expired one renders. A page that said "no such
 * request" for a wrong guess and "this has expired" for a right one would be a
 * slow version of the enumeration problem the application form avoids.
 */
export default async function VouchPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;
  const view = await describeVouchToken(membershipRepository(), token);

  return (
    <div className={styles.page} style={{ ["--hue" as string]: "var(--jsoa)" }}>
      <header className={styles.bar}>
        <Link href="/jsoa" className={styles.back}>
          ← Association
        </Link>
        <span className={styles.status}>Sponsor vouch</span>
      </header>

      <main className={styles.body}>
        {done ? (
          <Recorded outcome={done as VouchOutcome} />
        ) : view.kind === "OPEN" ? (
          <Open token={token} applicantName={view.applicantName} hoursLeft={view.hoursLeft} />
        ) : view.kind === "ANSWERED" ? (
          <Answered outcome={view.outcome} />
        ) : view.kind === "CLOSED" ? (
          <Closed />
        ) : (
          <DeadEnd />
        )}
      </main>
    </div>
  );
}

function Open({
  token,
  applicantName,
  hoursLeft,
}: {
  token: string;
  applicantName: string;
  hoursLeft: number;
}) {
  return (
    <>
      <h1 className={styles.title}>Someone has named you as their sponsor</h1>
      <p className={styles.lede}>
        This person has applied for membership and given your member ID. We are not asking you
        to verify their paperwork. We are asking whether you know them and whether you are
        willing to stand behind the application.
      </p>

      <div className={styles.applicant}>
        <p className={styles.window}>The applicant</p>
        <p className={styles.applicantName}>{applicantName}</p>
      </div>

      <p className={styles.window} style={{ marginTop: "14px" }}>
        {hoursLeft} hours left
      </p>
      <p className={styles.stepNote}>{VOUCH_WINDOW_COPY}</p>

      <div className={styles.vouchActions}>
        {VOUCH_ACTIONS.map((action) => (
          <form key={action.outcome} action={recordVouch} className={styles.vouchAction}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="outcome" value={action.outcome} />
            <strong>{action.label}</strong>
            <p>{action.consequence}</p>
            <button
              className={action.outcome === "CONFIRMED" ? styles.primary : styles.secondary}
              type="submit"
            >
              {action.label}
            </button>
          </form>
        ))}
      </div>

      <p className={styles.note}>
        The applicant is never told which of these you chose, or that it was you who was asked.
        Declining is not a judgement you have to explain, and saying you do not know the person
        is a useful answer rather than an unhelpful one.
      </p>
    </>
  );
}

const RECORDED_COPY: Record<VouchOutcome, { title: string; body: string }> = {
  CONFIRMED: {
    title: "Thank you. Your confirmation is recorded",
    body:
      "The applicant gets a link to pay their dues. Nothing further is needed from you, and " +
      "you will not be asked about this application again.",
  },
  DECLINED: {
    title: "Your answer is recorded",
    body:
      "The application goes to the membership chair, who will look at it on its own merits. " +
      "The applicant is not told who was asked or what they said.",
  },
  DO_NOT_KNOW: {
    title: "Your answer is recorded",
    body:
      "The application goes to the membership chair. Saying the name means nothing to you is " +
      "worth knowing, and it is not the same as turning the person down.",
  },
};

function Recorded({ outcome }: { outcome: VouchOutcome }) {
  const copy = RECORDED_COPY[outcome] ?? RECORDED_COPY.DECLINED;
  return (
    <>
      <h1 className={styles.title}>{copy.title}</h1>
      <p className={styles.lede}>{copy.body}</p>
      <div className={styles.actions}>
        <Link className={styles.secondary} href="/jsoa">
          Back to the Association
        </Link>
      </div>
    </>
  );
}

function Answered({ outcome }: { outcome: VouchOutcome }) {
  return (
    <>
      <h1 className={styles.title}>This one is already answered</h1>
      <p className={styles.lede}>
        {outcome === "CONFIRMED"
          ? "You confirmed this application. There is nothing more to do."
          : "You have already answered this request and it has gone to the membership chair."}
      </p>
      <div className={styles.actions}>
        <Link className={styles.secondary} href="/jsoa">
          Back to the Association
        </Link>
      </div>
    </>
  );
}

function Closed() {
  return (
    <>
      <h1 className={styles.title}>This request is closed</h1>
      <p className={styles.lede}>
        The application has moved on since this link was sent, so there is nothing here to
        answer. The membership chair has it.
      </p>
      <div className={styles.actions}>
        <Link className={styles.secondary} href="/jsoa">
          Back to the Association
        </Link>
      </div>
    </>
  );
}

/**
 * The dead end. Rendered identically for an expired request and for a token
 * that matches nothing, which is why it says nothing about which it was.
 */
function DeadEnd() {
  return (
    <>
      <h1 className={styles.title}>This link is no longer open</h1>
      <p className={styles.lede}>
        Vouch links stay open for 72 hours and then close. There is nothing to answer here and
        nothing has gone wrong. If an applicant is waiting on you, the membership chair already
        has their application and you can write to the chair instead.
      </p>
      <p className={styles.note}>
        We cannot reopen a closed link, and we cannot tell you whose it was. Both of those are
        on purpose.
      </p>
      <div className={styles.actions}>
        <Link className={styles.secondary} href="/jsoa">
          Back to the Association
        </Link>
      </div>
    </>
  );
}
