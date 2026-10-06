import Link from "next/link";

import { ELIGIBILITY_RULE } from "@/lib/scholarships/eligibility";
import {
  outstandingFor,
  sponsorShapeHint,
  stepKeyAt,
  stepsFor,
  type FieldErrors,
} from "@/lib/scholarships/intake";
import { GUARDIAN_CONSENT_STATEMENT } from "@/lib/scholarships/minors";
import { ROUTING_QUESTIONS } from "@/lib/scholarships/routing";
import { scholarshipRepository } from "@/lib/scholarships/repository";
import { SCORING_CRITERIA } from "@/lib/scholarships/scoring";
import {
  ENROLMENT_LEVELS,
  ENROLMENT_LEVEL_LABELS,
  GUARDIAN_RELATIONSHIPS,
  GUARDIAN_RELATIONSHIP_LABELS,
  type Application,
  type School,
} from "@/lib/scholarships/types";

import styles from "./scholarship.module.css";
import { answerRouting, goBack, saveStep, submitDraft } from "./actions";
import { readDraftId } from "./draft";

export const metadata = {
  title: "Apply for a scholarship — JSOF",
  description:
    "The Joint Special Operations Foundation's Merit and Wounded Patriot scholarships.",
};

function Err({ message }: { message?: string }) {
  if (!message) return null;
  return <span className={styles.error}>{message}</span>;
}

function Rail({ draft, current }: { draft: Application | null; current: number }) {
  return (
    <ol className={styles.rail}>
      {stepsFor(draft).map((item) => (
        <li
          key={item.key}
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

export default async function ScholarshipApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; err?: string }>;
}) {
  const query = await searchParams;
  const repo = scholarshipRepository();
  const draftId = await readDraftId();
  const draft = draftId ? await repo.getApplication(draftId) : null;
  const schools = await repo.listSchools();

  const steps = stepsFor(draft);
  const requested = Number(query.step ?? 1);
  // Nothing past step one is reachable without a draft, and a draft only
  // exists once the routing questions have sent the applicant here.
  const step = draft ? Math.min(Math.max(requested || 1, 1), steps.length) : 1;
  const key = stepKeyAt(draft, step);

  const all: FieldErrors = draft ? await outstandingFor(repo, draft) : {};
  const failed = new Set((query.err ?? "").split(",").filter(Boolean));
  const errors: FieldErrors = {};
  for (const name of Object.keys(all)) {
    if (failed.has(name)) errors[name] = all[name];
  }
  if (failed.has("guardianConsent")) {
    errors.guardianConsent =
      "A parent or guardian has to consent before the application can be submitted.";
  }
  const routingIncomplete = failed.has("routing");

  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <Link href="/jsof/scholarships" className={styles.back}>
          Back to the scholarships page
        </Link>
        <span className={styles.status}>Scholarship application</span>
      </header>

      <main className={styles.body}>
        <h1 className={styles.title}>Apply for a scholarship</h1>
        <p className={styles.lede}>
          The Foundation awards a Merit Scholarship on a scored application, and
          a Wounded Patriot Scholarship that recognizes a service-connected
          wound or disability. You may apply for one or both.
        </p>

        <div className={styles.placeholder}>
          <span className={styles.placeholderMark}>{ELIGIBILITY_RULE.marker}</span>
          <strong>{ELIGIBILITY_RULE.heading}</strong>
          {ELIGIBILITY_RULE.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          <p>{ELIGIBILITY_RULE.guidance}</p>
        </div>

        <Rail draft={draft} current={step} />

        {key === "routing" && <StepRouting incomplete={routingIncomplete} />}
        {key === "applicant" && draft && <StepApplicant draft={draft} errors={errors} />}
        {key === "enrolment" && draft && (
          <StepEnrolment draft={draft} errors={errors} schools={schools} step={step} />
        )}
        {key === "sponsor" && draft && <StepSponsor draft={draft} errors={errors} step={step} />}
        {key === "merit" && draft && <StepMerit draft={draft} errors={errors} step={step} />}
        {key === "wounded-patriot" && draft && (
          <StepWoundedPatriot draft={draft} errors={errors} step={step} />
        )}
        {key === "guardian" && draft && <StepGuardian errors={errors} step={step} />}
        {key === "review" && draft && (
          <StepReview draft={draft} outstanding={all} schools={schools} step={step} />
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Step 1: routing, before anything is collected
 * ------------------------------------------------------------------ */

function StepRouting({ incomplete }: { incomplete: boolean }) {
  return (
    <form action={answerRouting} className={styles.form}>
      <h2 className={styles.stepTitle}>Where you apply</h2>
      <p className={styles.stepNote}>
        Three questions first, before anything else. North Carolina residents
        attending North Carolina schools apply directly to the Patriot
        Foundation, and we would rather tell you that now than after you have
        filled this in. Nothing is saved until these are answered.
      </p>

      {ROUTING_QUESTIONS.map((item) => (
        <fieldset key={item.key} className={styles.question}>
          <legend className={styles.questionText}>{item.question}</legend>
          <span className={styles.hint}>{item.hint}</span>
          <div className={styles.yesNo}>
            <label>
              <input type="radio" name={item.key} value="yes" required />
              Yes
            </label>
            <label>
              <input type="radio" name={item.key} value="no" required />
              No
            </label>
          </div>
        </fieldset>
      ))}

      {incomplete && (
        <Err message="Answer all three questions so we can tell you where to apply." />
      )}

      <div className={styles.actions}>
        <button className={styles.primary} type="submit">
          Continue
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Step 2: the applicant
 * ------------------------------------------------------------------ */

function StepApplicant({ draft, errors }: { draft: Application; errors: FieldErrors }) {
  return (
    <form action={saveStep} className={styles.form}>
      <input type="hidden" name="key" value="applicant" />
      <input type="hidden" name="step" value="2" />
      <h2 className={styles.stepTitle}>About you</h2>
      <p className={styles.stepNote}>
        We ask for your date of birth before anything else. If you are under 13
        we do not collect anything at all and this form stops. If you are under
        18, a parent or guardian has to consent in their own name, as a separate
        step.
      </p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="fullName">
          Full name
        </label>
        <input
          className={`${styles.input} ${errors.fullName ? styles.inputError : ""}`}
          id="fullName"
          name="fullName"
          defaultValue={draft.applicant.fullName}
          autoComplete="name"
          required
        />
        <Err message={errors.fullName} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="dateOfBirth">
          Date of birth
        </label>
        <input
          className={`${styles.input} ${errors.dateOfBirth ? styles.inputError : ""}`}
          id="dateOfBirth"
          name="dateOfBirth"
          type="date"
          defaultValue={draft.applicant.dateOfBirth}
          required
        />
        <Err message={errors.dateOfBirth} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="email">
          Email
        </label>
        <span className={styles.hint}>
          The decision goes here, and a copy goes to your sponsoring member.
        </span>
        <input
          className={`${styles.input} ${errors.email ? styles.inputError : ""}`}
          id="email"
          name="email"
          type="email"
          defaultValue={draft.applicant.email}
          autoComplete="email"
          required
        />
        <Err message={errors.email} />
      </div>

      <div className={styles.pair}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="phone">
            Phone
          </label>
          <input
            className={`${styles.input} ${errors.phone ? styles.inputError : ""}`}
            id="phone"
            name="phone"
            type="tel"
            defaultValue={draft.applicant.phone}
            autoComplete="tel"
            required
          />
          <Err message={errors.phone} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="residenceState">
            State you live in
          </label>
          <input
            className={`${styles.input} ${styles.mono} ${errors.residenceState ? styles.inputError : ""}`}
            id="residenceState"
            name="residenceState"
            maxLength={2}
            defaultValue={draft.applicant.residenceState}
            placeholder="VA"
            required
          />
          <Err message={errors.residenceState} />
        </div>
      </div>

      <div className={styles.caution}>
        <strong>We do not want your Social Security number or your family&rsquo;s paperwork</strong>
        There is no field on this form for a national identifier, no upload for a
        DD-214 or any other discharge document, and nowhere on this platform to
        attach one. Service is attested, and the Scholarships Chair verifies a
        Wounded Patriot claim by speaking to a person.
      </div>

      <div className={styles.actions}>
        <button className={styles.primary} type="submit">
          Continue
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Step 3: enrolment
 * ------------------------------------------------------------------ */

function StepEnrolment({
  draft,
  errors,
  schools,
  step,
}: {
  draft: Application;
  errors: FieldErrors;
  schools: School[];
  step: number;
}) {
  return (
    <form action={saveStep} className={styles.form}>
      <input type="hidden" name="key" value="enrolment" />
      <input type="hidden" name="step" value={step} />
      <h2 className={styles.stepTitle}>Where you will study</h2>
      <p className={styles.stepNote}>
        The cheque is made out to your school and posted to their bursar, not to
        you, so we need the school and your student number there.
      </p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="schoolId">
          School
        </label>
        <select
          className={`${styles.select} ${errors.schoolId ? styles.inputError : ""}`}
          id="schoolId"
          name="schoolId"
          defaultValue={draft.enrolment?.schoolId ?? ""}
          required
        >
          <option value="">Choose your school</option>
          {schools.map((school) => (
            <option key={school.id} value={school.id}>
              {school.name}, {school.city} {school.state}
            </option>
          ))}
        </select>
        <span className={styles.hint}>
          If your school is not listed, write to the Scholarships Chair and it
          will be added before the cycle closes.
        </span>
        <Err message={errors.schoolId} />
      </div>

      <div className={styles.field}>
        <span className={styles.label}>What you will be studying</span>
        <ul className={styles.choices}>
          {ENROLMENT_LEVELS.map((level) => (
            <li key={level}>
              <label className={styles.choice}>
                <input
                  type="radio"
                  name="level"
                  value={level}
                  defaultChecked={draft.enrolment?.level === level}
                  required
                />
                <span className={styles.choiceLabel}>{ENROLMENT_LEVEL_LABELS[level]}</span>
              </label>
            </li>
          ))}
        </ul>
        <Err message={errors.level} />
      </div>

      <div className={styles.pair}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="academicYear">
            Academic year
          </label>
          <input
            className={`${styles.input} ${styles.mono} ${errors.academicYear ? styles.inputError : ""}`}
            id="academicYear"
            name="academicYear"
            placeholder="2027-2028"
            defaultValue={draft.enrolment?.academicYear ?? ""}
            required
          />
          <Err message={errors.academicYear} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="expectedCompletion">
            Expected completion
          </label>
          <input
            className={styles.input}
            id="expectedCompletion"
            name="expectedCompletion"
            type="date"
            defaultValue={draft.enrolment?.expectedCompletion ?? ""}
          />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="studentNumber">
          Your student number
        </label>
        <span className={styles.hint}>
          The number the school knows you by, so the bursar can apply the award
          to your account.
        </span>
        <input
          className={`${styles.input} ${styles.mono} ${errors.studentNumber ? styles.inputError : ""}`}
          id="studentNumber"
          name="studentNumber"
          defaultValue={draft.enrolment?.studentNumber ?? ""}
          required
        />
        <Err message={errors.studentNumber} />
      </div>

      <div className={styles.field}>
        <label className={styles.choice}>
          <input
            type="checkbox"
            name="accreditedInstitution"
            defaultChecked={draft.enrolment?.accreditedInstitution ?? true}
          />
          <span className={styles.choiceLabel}>
            This is an accredited institution
            <span className={styles.choiceNote}>Your own statement. We do not contact the school to check.</span>
          </span>
        </label>
      </div>

      <div className={styles.actions}>
        <button className={styles.primary} type="submit">
          Continue
        </button>
        <button className={styles.secondary} type="submit" formAction={goBack}>
          Back
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Step 4: the sponsoring member
 * ------------------------------------------------------------------ */

function StepSponsor({
  draft,
  errors,
  step,
}: {
  draft: Application;
  errors: FieldErrors;
  step: number;
}) {
  const hint = sponsorShapeHint(draft.sponsor?.sponsorMemberId ?? "");
  return (
    <form action={saveStep} className={styles.form}>
      <input type="hidden" name="key" value="sponsor" />
      <input type="hidden" name="step" value={step} />
      <h2 className={styles.stepTitle}>Your sponsoring member</h2>
      <p className={styles.stepNote}>
        An Association member sponsors your application. We check their standing
        on the roster when you submit, and we copy them on every message we send
        you, because a decision that reaches nobody is no use to you.
      </p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sponsorMemberId">
          Sponsor&rsquo;s member ID
        </label>
        <span className={styles.hint}>
          Ask your sponsor for it. It looks like JSOA-2026-0142. We will not tell
          you whether the ID matches anyone, and this page cannot be used to find
          out.
        </span>
        <input
          className={`${styles.input} ${styles.mono} ${errors.sponsorMemberId ? styles.inputError : ""}`}
          id="sponsorMemberId"
          name="sponsorMemberId"
          defaultValue={draft.sponsor?.sponsorMemberId ?? ""}
          placeholder="JSOA-2026-0142"
          spellCheck={false}
          autoComplete="off"
          required
        />
        <Err message={errors.sponsorMemberId} />
        {hint && <span className={styles.hint}>{hint}</span>}
      </div>

      <div className={styles.actions}>
        <button className={styles.primary} type="submit">
          Continue
        </button>
        <button className={styles.secondary} type="submit" formAction={goBack}>
          Back
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Step 5: the Merit section
 * ------------------------------------------------------------------ */

function StepMerit({
  draft,
  errors,
  step,
}: {
  draft: Application;
  errors: FieldErrors;
  step: number;
}) {
  return (
    <form action={saveStep} className={styles.form}>
      <input type="hidden" name="key" value="merit" />
      <input type="hidden" name="step" value={step} />
      <h2 className={styles.stepTitle}>Merit Scholarship</h2>
      <p className={styles.stepNote}>
        Four readers other than the Scholarships Chair score every application
        against the criteria below. Nobody related to you may open your file.
      </p>

      <ul className={styles.choices}>
        {SCORING_CRITERIA.map((criterion) => (
          <li key={criterion.key} className={styles.choice}>
            <span className={styles.choiceLabel}>
              {criterion.label} ({criterion.maxPoints} points)
              <span className={styles.choiceNote}>{criterion.published}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className={styles.pair}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="gpa">
            Grade average
          </label>
          <input
            className={`${styles.input} ${styles.mono} ${errors.gpaHundredths ? styles.inputError : ""}`}
            id="gpa"
            name="gpa"
            inputMode="decimal"
            placeholder="3.40"
            defaultValue={draft.merit ? (draft.merit.gpaHundredths / 100).toFixed(2) : ""}
            required
          />
          <Err message={errors.gpaHundredths} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="recommendationFrom">
            Recommendation from
          </label>
          <input
            className={`${styles.input} ${errors.recommendationFrom ? styles.inputError : ""}`}
            id="recommendationFrom"
            name="recommendationFrom"
            defaultValue={draft.merit?.recommendationFrom ?? ""}
            required
          />
          <Err message={errors.recommendationFrom} />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="transcriptSummary">
          Your transcript, in short
        </label>
        <textarea
          className={styles.textarea}
          id="transcriptSummary"
          name="transcriptSummary"
          defaultValue={draft.merit?.transcriptSummary ?? ""}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="essay">
          Essay
        </label>
        <span className={styles.hint}>
          Why you are applying, and what the year ahead looks like. Length is not
          scored.
        </span>
        <textarea
          className={`${styles.textarea} ${errors.essay ? styles.inputError : ""}`}
          id="essay"
          name="essay"
          defaultValue={draft.merit?.essay ?? ""}
          required
        />
        <Err message={errors.essay} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="activities">
          Service, work and activities
        </label>
        <span className={styles.hint}>One a line.</span>
        <textarea
          className={styles.textarea}
          id="activities"
          name="activities"
          defaultValue={(draft.merit?.activities ?? []).join("\n")}
        />
      </div>

      <div className={styles.actions}>
        <button className={styles.primary} type="submit">
          Continue
        </button>
        <button className={styles.secondary} type="submit" formAction={goBack}>
          Back
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Step 6: the Wounded Patriot section
 * ------------------------------------------------------------------ */

function StepWoundedPatriot({
  draft,
  errors,
  step,
}: {
  draft: Application;
  errors: FieldErrors;
  step: number;
}) {
  return (
    <form action={saveStep} className={styles.form}>
      <input type="hidden" name="key" value="wounded-patriot" />
      <input type="hidden" name="step" value={step} />
      <h2 className={styles.stepTitle}>Wounded Patriot Scholarship</h2>
      <p className={styles.stepNote}>
        This section is read by the Scholarships Chair and by nobody else. The
        readers who score your Merit application do not see it. She confirms it
        by speaking to a person, so tell us who she should speak to.
      </p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="serviceMemberRelationship">
          Who served, and what they are to you
        </label>
        <input
          className={`${styles.input} ${errors.serviceMemberRelationship ? styles.inputError : ""}`}
          id="serviceMemberRelationship"
          name="serviceMemberRelationship"
          defaultValue={draft.woundedPatriot?.serviceMemberRelationship ?? ""}
          required
        />
        <Err message={errors.serviceMemberRelationship} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="narrative">
          In your own words
        </label>
        <span className={styles.hint}>
          What happened and what it has meant for your household. Do not send us
          medical records or discharge paperwork; there is nowhere here to put
          them and we do not want them.
        </span>
        <textarea
          className={`${styles.textarea} ${errors.narrative ? styles.inputError : ""}`}
          id="narrative"
          name="narrative"
          defaultValue={draft.woundedPatriot?.disabilityEvidence.narrative ?? ""}
          required
        />
        <Err message={errors.narrative} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="claimedServiceConnection">
          The connection to service
        </label>
        <input
          className={styles.input}
          id="claimedServiceConnection"
          name="claimedServiceConnection"
          defaultValue={draft.woundedPatriot?.disabilityEvidence.claimedServiceConnection ?? ""}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="verificationContact">
          Someone the chair can speak to
        </label>
        <span className={styles.hint}>
          A name and how to reach them. Your sponsoring member is usually the
          right answer.
        </span>
        <input
          className={`${styles.input} ${errors.verificationContact ? styles.inputError : ""}`}
          id="verificationContact"
          name="verificationContact"
          defaultValue={draft.woundedPatriot?.disabilityEvidence.verificationContact ?? ""}
          required
        />
        <Err message={errors.verificationContact} />
      </div>

      <div className={styles.actions}>
        <button className={styles.primary} type="submit">
          Continue
        </button>
        <button className={styles.secondary} type="submit" formAction={goBack}>
          Back
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Guardian consent. Its own step, in the guardian's own name.
 * ------------------------------------------------------------------ */

function StepGuardian({ errors, step }: { errors: FieldErrors; step: number }) {
  return (
    <form action={saveStep} className={styles.form}>
      <input type="hidden" name="key" value="guardian" />
      <input type="hidden" name="step" value={step} />
      <h2 className={styles.stepTitle}>{GUARDIAN_CONSENT_STATEMENT.heading}</h2>
      <p className={styles.stepNote}>{GUARDIAN_CONSENT_STATEMENT.note}</p>

      <div className={styles.consent}>
        <h3>What you are agreeing to</h3>
        {GUARDIAN_CONSENT_STATEMENT.body.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <p className={styles.affirmation}>{GUARDIAN_CONSENT_STATEMENT.affirmation}</p>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="guardianName">
          Guardian&rsquo;s full name
        </label>
        <input
          className={`${styles.input} ${errors.guardianName ? styles.inputError : ""}`}
          id="guardianName"
          name="guardianName"
          required
        />
        <Err message={errors.guardianName} />
      </div>

      <div className={styles.pair}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="guardianEmail">
            Guardian&rsquo;s email
          </label>
          <span className={styles.hint}>Their own address, not the applicant&rsquo;s.</span>
          <input
            className={`${styles.input} ${errors.guardianEmail ? styles.inputError : ""}`}
            id="guardianEmail"
            name="guardianEmail"
            type="email"
            required
          />
          <Err message={errors.guardianEmail} />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="guardianPhone">
            Guardian&rsquo;s phone
          </label>
          <input
            className={`${styles.input} ${errors.guardianPhone ? styles.inputError : ""}`}
            id="guardianPhone"
            name="guardianPhone"
            type="tel"
            required
          />
          <Err message={errors.guardianPhone} />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="relationship">
          Relationship to the applicant
        </label>
        <select
          className={`${styles.select} ${errors.relationship ? styles.inputError : ""}`}
          id="relationship"
          name="relationship"
          defaultValue=""
          required
        >
          <option value="">Choose one</option>
          {GUARDIAN_RELATIONSHIPS.map((value) => (
            <option key={value} value={value}>
              {GUARDIAN_RELATIONSHIP_LABELS[value]}
            </option>
          ))}
        </select>
        <Err message={errors.relationship} />
      </div>

      <div className={styles.field}>
        <label className={styles.choice}>
          <input type="checkbox" name="affirmed" required />
          <span className={styles.choiceLabel}>
            I agree to the statement above
            <span className={styles.choiceNote}>
              Recorded with your name, your email and the date, against version{" "}
              {GUARDIAN_CONSENT_STATEMENT.version} of the statement.
            </span>
          </span>
        </label>
        <Err message={errors.affirmed} />
      </div>

      <div className={styles.actions}>
        <button className={styles.primary} type="submit">
          Record the consent
        </button>
        <button className={styles.secondary} type="submit" formAction={goBack}>
          Back
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Review and submit
 * ------------------------------------------------------------------ */

function StepReview({
  draft,
  outstanding,
  schools,
  step,
}: {
  draft: Application;
  outstanding: FieldErrors;
  schools: School[];
  step: number;
}) {
  const incomplete = Object.keys(outstanding).filter((k) => outstanding[k]);
  const school = schools.find((s) => s.id === draft.enrolment?.schoolId);
  const rows: { label: string; value: string }[] = [
    { label: "Name", value: draft.applicant.fullName || "not given" },
    { label: "Email", value: draft.applicant.email || "not given" },
    { label: "Date of birth", value: draft.applicant.dateOfBirth || "not given" },
    { label: "School", value: school?.name ?? "not chosen" },
    {
      label: "Student number",
      value: draft.enrolment?.studentNumber || "not given",
    },
    {
      label: "Sponsoring member",
      value: draft.sponsor?.sponsorMemberId || "not given",
    },
    { label: "Merit Scholarship", value: draft.merit ? "applying" : "not applying" },
    {
      label: "Wounded Patriot",
      value: draft.woundedPatriot ? "applying" : "not applying",
    },
    {
      label: "Guardian consent",
      value: draft.guardianConsentId ? "recorded" : "not required",
    },
  ];

  return (
    <div className={styles.form}>
      <h2 className={styles.stepTitle}>Check and submit</h2>
      <p className={styles.stepNote}>
        Check what you have written. You can go back and change any of it.
      </p>

      <dl className={styles.review}>
        {rows.map((row) => (
          <div className={styles.reviewRow} key={row.label}>
            <dt className={styles.reviewLabel}>{row.label}</dt>
            <dd className={styles.reviewValue}>{row.value}</dd>
          </div>
        ))}
      </dl>

      {incomplete.length > 0 && (
        <div className={styles.caution}>
          <strong>Something is still missing</strong>
          {incomplete.map((k) => (
            <span key={k}>
              {outstanding[k]}
              <br />
            </span>
          ))}
        </div>
      )}

      <p className={styles.note}>
        When you submit, we check your sponsoring member&rsquo;s standing on the
        roster. You will get the same acknowledgment either way, and this page
        will not tell you what we found. The Scholarships Chair writes to you,
        and to your sponsor, with the decision.
      </p>

      <form action={submitDraft} className={styles.actions}>
        <button className={styles.primary} type="submit" disabled={incomplete.length > 0}>
          Submit the application
        </button>
      </form>

      <form action={goBack} className={styles.actions}>
        <input type="hidden" name="step" value={step} />
        <button className={styles.secondary} type="submit">
          Back
        </button>
      </form>
    </div>
  );
}
