import Link from "next/link";

import {
  APPLY_STEPS,
  reviewSummary,
  sponsorShapeHint,
  validateAll,
  type FieldErrors,
} from "@/lib/membership/intake";
import { membershipRepository } from "@/lib/membership/repository";
import {
  CATEGORY_LABELS,
  MEMBERSHIP_CATEGORIES,
  QUALIFYING_RELATIONSHIPS,
  RELATIONSHIP_LABELS,
  type Application,
} from "@/lib/membership/types";
import { describeWartimeService } from "@/lib/membership/wartime";

import styles from "./apply.module.css";
import { goBack, saveStep, submitDraft } from "./actions";
import { readDraftId } from "./draft";

export const metadata = {
  title: "Apply for membership · JSOA",
  description:
    "Membership in the Joint Special Operations Association is by sponsorship from a current member.",
};

const STEP_NOTES: Record<number, string> = {
  1: "The membership chair uses these to reach you. Nothing on this form becomes public.",
  2: "Your service is attested here, not documented. We do not accept a DD-214 or any other discharge paperwork, and there is nowhere on this platform to upload one.",
  3: "A current member has to stand behind your application. If your sponsor does not answer within three days, the membership chair picks it up instead.",
  4: "Check what you have written. You can go back and change any of it.",
};

/** Field names only. The values the applicant typed never reach the URL. */
function errorsFromQuery(raw: string | undefined, draft: Application | null): FieldErrors {
  if (!raw || !draft) return {};
  const failed = new Set(raw.split(","));
  const all = validateAll(draft);
  const shown: FieldErrors = {};
  for (const key of Object.keys(all) as (keyof FieldErrors)[]) {
    if (failed.has(key)) shown[key] = all[key];
  }
  return shown;
}

function Rail({ current }: { current: number }) {
  return (
    <ol className={styles.rail}>
      {APPLY_STEPS.map((item) => (
        <li
          key={item.step}
          className={[
            styles.railItem,
            item.step < current ? styles.railDone : "",
            item.step === current ? styles.railHere : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-current={item.step === current ? "step" : undefined}
        >
          <span className={styles.railNumber}>Step {item.step}</span>
          {item.title}
        </li>
      ))}
    </ol>
  );
}

function Error({ message }: { message?: string }) {
  if (!message) return null;
  return <span className={styles.error}>{message}</span>;
}

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; err?: string }>;
}) {
  const query = await searchParams;
  const repo = membershipRepository();
  const draftId = await readDraftId();
  const draft = draftId ? await repo.getApplication(draftId) : null;

  const requested = Number(query.step ?? 1);
  // Cannot skip ahead: without a draft there is nothing to show past step one.
  const step = draft ? Math.min(Math.max(requested || 1, 1), 4) : 1;
  const errors = errorsFromQuery(query.err, draft);

  return (
    <div className={styles.page} style={{ ["--hue" as string]: "var(--jsoa)" }}>
      <header className={styles.bar}>
        <Link href="/jsoa" className={styles.back}>
          ← Association
        </Link>
        <span className={styles.status}>Membership application</span>
      </header>

      <main className={styles.body}>
        <h1 className={styles.title}>Apply for membership</h1>
        <p className={styles.lede}>
          Membership is by sponsorship from a current member. You give us your
          service dates and your sponsor&rsquo;s member ID, your sponsor confirms
          it, and dues are due after that and not before.
        </p>

        <Rail current={step} />

        {step === 1 && <StepContact draft={draft} errors={errors} />}
        {step === 2 && draft && <StepService draft={draft} errors={errors} />}
        {step === 3 && draft && <StepSponsor draft={draft} errors={errors} />}
        {step === 4 && draft && <StepReview draft={draft} />}
      </main>
    </div>
  );
}

function StepContact({
  draft,
  errors,
}: {
  draft: Application | null;
  errors: FieldErrors;
}) {
  return (
    <form action={saveStep} className={styles.form}>
      <input type="hidden" name="step" value="1" />
      <h2 className={styles.stepTitle}>How to reach you</h2>
      <p className={styles.stepNote}>{STEP_NOTES[1]}</p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="applicantName">
          Full name
        </label>
        <span className={styles.hint}>As you would like it to appear on the roster.</span>
        <input
          className={`${styles.input} ${errors.applicantName ? styles.inputError : ""}`}
          id="applicantName"
          name="applicantName"
          defaultValue={draft?.applicantName ?? ""}
          autoComplete="name"
          required
        />
        <Error message={errors.applicantName} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="email">
          Email
        </label>
        <span className={styles.hint}>
          The decision goes here, and so does the payment link if your sponsor confirms.
        </span>
        <input
          className={`${styles.input} ${errors.email ? styles.inputError : ""}`}
          id="email"
          name="email"
          type="email"
          defaultValue={draft?.email ?? ""}
          autoComplete="email"
          required
        />
        <Error message={errors.email} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="phone">
          Phone
        </label>
        <span className={styles.hint}>Ten digits, including the area code.</span>
        <input
          className={`${styles.input} ${errors.phone ? styles.inputError : ""}`}
          id="phone"
          name="phone"
          type="tel"
          defaultValue={draft?.phone ?? ""}
          autoComplete="tel"
          required
        />
        <Error message={errors.phone} />
      </div>

      <div className={styles.actions}>
        <button className={styles.primary} type="submit">
          Continue to eligibility
        </button>
      </div>
    </form>
  );
}

function StepService({ draft, errors }: { draft: Application; errors: FieldErrors }) {
  return (
    <form action={saveStep} className={styles.form}>
      <input type="hidden" name="step" value="2" />
      <h2 className={styles.stepTitle}>Eligibility</h2>
      <p className={styles.stepNote}>{STEP_NOTES[2]}</p>

      <div className={styles.field}>
        <span className={styles.label}>Which describes you</span>
        <ul className={styles.choices}>
          {MEMBERSHIP_CATEGORIES.map((value) => (
            <li key={value}>
              <label className={styles.choice}>
                <input
                  type="radio"
                  name="membershipCategory"
                  value={value}
                  defaultChecked={draft.membershipCategory === value}
                  required
                />
                <span className={styles.choiceLabel}>{CATEGORY_LABELS[value]}</span>
              </label>
            </li>
          ))}
        </ul>
        <Error message={errors.membershipCategory} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="qualifyingRelationship">
          If you are a relative, how are you related
        </label>
        <span className={styles.hint}>
          Leave this alone if you served yourself. It only applies to the relative category.
        </span>
        <select
          className={`${styles.select} ${errors.qualifyingRelationship ? styles.inputError : ""}`}
          id="qualifyingRelationship"
          name="qualifyingRelationship"
          defaultValue={draft.qualifyingRelationship ?? ""}
        >
          <option value="">Not applicable</option>
          {QUALIFYING_RELATIONSHIPS.map((value) => (
            <option key={value} value={value}>
              {RELATIONSHIP_LABELS[value]}
            </option>
          ))}
        </select>
        <Error message={errors.qualifyingRelationship} />
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Service dates</span>
        <span className={styles.hint}>
          If you served, when you began and when you left. An approximate date is fine, and
          leaving the end date blank means you are still serving.
        </span>
        <div className={styles.dates}>
          <div>
            <label className={styles.hint} htmlFor="serviceFrom">
              From
            </label>
            <input
              className={`${styles.input} ${errors.serviceFrom ? styles.inputError : ""}`}
              id="serviceFrom"
              name="serviceFrom"
              type="date"
              defaultValue={draft.serviceFrom ?? ""}
            />
          </div>
          <div>
            <label className={styles.hint} htmlFor="serviceTo">
              To
            </label>
            <input
              className={`${styles.input} ${errors.serviceTo ? styles.inputError : ""}`}
              id="serviceTo"
              name="serviceTo"
              type="date"
              defaultValue={draft.serviceTo ?? ""}
            />
          </div>
        </div>
        <Error message={errors.serviceFrom} />
        <Error message={errors.serviceTo} />
      </div>

      <div className={styles.field}>
        <label className={styles.choice}>
          <input
            type="checkbox"
            name="attestedWarVeteran"
            defaultChecked={draft.attestedWarVeteran}
          />
          <span className={styles.choiceLabel}>
            I served during a wartime period
            <span className={styles.choiceNote}>
              Your own statement. We check it against the dates above and the chair looks at
              anything that does not line up. Service from 2 August 1990 onward is wartime
              service, because Congress has never ended that period.
            </span>
          </span>
        </label>
        {draft.serviceFrom && (
          <span className={styles.hint}>
            Your dates match: {describeWartimeService(draft.serviceFrom, draft.serviceTo)}
          </span>
        )}
      </div>

      <div className={styles.caution}>
        <strong>We do not want your discharge paperwork</strong>
        Separation documents issued before about 2015 carry your full Social Security number.
        There is no upload on this form and no field for one anywhere on this platform. Your
        sponsor&rsquo;s confirmation is what stands in for a document.
      </div>

      <div className={styles.actions}>
        <button className={styles.primary} type="submit">
          Continue to your sponsor
        </button>
        <button className={styles.secondary} type="submit" formAction={goBack}>
          Back
        </button>
      </div>
    </form>
  );
}

function StepSponsor({ draft, errors }: { draft: Application; errors: FieldErrors }) {
  const hint = sponsorShapeHint(draft.sponsorMemberId);
  return (
    <form action={saveStep} className={styles.form}>
      <input type="hidden" name="step" value="3" />
      <h2 className={styles.stepTitle}>Your sponsor</h2>
      <p className={styles.stepNote}>{STEP_NOTES[3]}</p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sponsorMemberId">
          Sponsor&rsquo;s member ID
        </label>
        <span className={styles.hint}>
          Ask your sponsor for it. It looks like JSOA-2026-0142. We will not tell you whether
          the ID matches anyone, and this page cannot be used to find out.
        </span>
        <input
          className={`${styles.input} ${styles.mono} ${errors.sponsorMemberId ? styles.inputError : ""}`}
          id="sponsorMemberId"
          name="sponsorMemberId"
          defaultValue={draft.sponsorMemberId}
          placeholder="JSOA-2026-0142"
          spellCheck={false}
          autoComplete="off"
          required
        />
        <Error message={errors.sponsorMemberId} />
        {hint && <span className={styles.hint}>{hint}</span>}
      </div>

      <div className={styles.field}>
        <label className={styles.choice}>
          <input type="checkbox" name="isAugmentee" defaultChecked={draft.isAugmentee} />
          <span className={styles.choiceLabel}>
            I served as an augmentee
            <span className={styles.choiceNote}>
              Attached to the enterprise rather than assigned to a unit within it. These are
              decided one at a time by the membership chair, so your application goes straight
              to them.
            </span>
          </span>
        </label>
      </div>

      <div className={styles.actions}>
        <button className={styles.primary} type="submit">
          Continue to review
        </button>
        <button className={styles.secondary} type="submit" formAction={goBack}>
          Back
        </button>
      </div>
    </form>
  );
}

function StepReview({ draft }: { draft: Application }) {
  const outstanding = validateAll(draft);
  const incomplete = Object.keys(outstanding).length > 0;

  return (
    <div className={styles.form}>
      <h2 className={styles.stepTitle}>Check and submit</h2>
      <p className={styles.stepNote}>{STEP_NOTES[4]}</p>

      <dl className={styles.review}>
        {reviewSummary(draft).map((row) => (
          <div className={styles.reviewRow} key={row.label}>
            <dt className={styles.reviewLabel}>{row.label}</dt>
            <dd className={styles.reviewValue}>{row.value}</dd>
          </div>
        ))}
      </dl>

      {incomplete && (
        <div className={styles.caution}>
          <strong>Something is still missing</strong>
          Go back and finish{" "}
          {Object.values(outstanding)
            .map((message) => message?.replace(/\.$/, ""))
            .join(". ")}
          .
        </div>
      )}

      <p className={styles.note}>
        Dues are $200 a year and are not a charitable contribution. Nothing is charged now.
        If your sponsor confirms, you get a payment link. If they do not, or if the three days
        run out, the membership chair looks at your application instead. Either way you hear
        from us within four days.
      </p>

      <form action={submitDraft} className={styles.actions}>
        <button className={styles.primary} type="submit" disabled={incomplete}>
          Submit the application
        </button>
      </form>

      <form action={goBack} className={styles.actions}>
        <input type="hidden" name="step" value="4" />
        <button className={styles.secondary} type="submit">
          Back
        </button>
      </form>
    </div>
  );
}
