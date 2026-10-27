import type { Entity } from "@/lib/authz/model";
import { getCurrentSubject } from "@/lib/authz/session";
import { formatCents, TreasuryError } from "@/lib/treasury/money";
import { treasuryRepository, treasurySubject } from "@/lib/treasury/repository";
import { personName } from "@/lib/treasury/seed";
import {
  canRecordTransfer,
  RESTRICTION_STATEMENT_MIN_LENGTH,
  transferRuleStatuses,
  type TransferRule,
} from "@/lib/treasury/transfers";
import type { Transfer } from "@/lib/treasury/types";

import {
  ENTITY_LABELS,
  EntityTag,
  Money,
  TreasuryHeader,
  entityClass,
} from "../_components/chrome";
import styles from "../treasury.module.css";

export const metadata = {
  title: "Inter-entity transfers — Treasury — JSOA / JSOF",
  robots: { index: false, follow: false },
};

/**
 * Inter-entity transfers.
 *
 * This is the one transaction where the same person can end up on both sides,
 * so the form is built as a gate rather than as a set of fields. Every
 * condition is listed, each one says whether it is met, and the unmet ones say
 * which rule and what to do. The record button carries `disabled` whenever any
 * condition is outstanding: the form cannot be submitted into an invalid
 * state, rather than being submitted and then refused.
 *
 * `assertTransferApprovable` in `@/lib/authz/policy` is still the authority —
 * `recordTransfer` calls it before anything is written. The checklist exists
 * because a throwing assertion reports one broken rule at a time, and a person
 * filling in a form needs all of them.
 */

/** Seeded treasurer per entity, so the demo's approvals have real identities. */
const TREASURER_BY_ENTITY: Record<Entity, string> = {
  JSOA: "p-halloran",
  JSOF: "p-okonkwo",
};

const PRESIDENT_ID = "p-mercer";

/** Dollars in, whole cents out. No float reaches the domain. */
function dollarsToCents(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[$,\s]/g, "");
  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return 0;
  const whole = match[1] ? Number.parseInt(match[1], 10) : 0;
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return whole * 100 + Number.parseInt(fraction || "0", 10);
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function checked(value: string | string[] | undefined): boolean {
  return one(value) === "on";
}

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const subject = treasurySubject(await getCurrentSubject());
  const repo = await treasuryRepository();
  const asOf = await repo.asOfDate();
  const period = await repo.period();

  let recorded: Transfer[] = [];
  let listRefusal: string | null = null;
  try {
    recorded = await repo.transfers(subject);
  } catch (error) {
    if (error instanceof TreasuryError) listRefusal = error.message;
    else throw error;
  }

  /* --- The draft, rebuilt from the query on every render --- */

  const direction = one(query.direction) === "JSOF_TO_JSOA" ? "JSOF_TO_JSOA" : "JSOA_TO_JSOF";
  const fromEntity: Entity = direction === "JSOA_TO_JSOF" ? "JSOA" : "JSOF";
  const toEntity: Entity = direction === "JSOA_TO_JSOF" ? "JSOF" : "JSOA";

  const amountRaw = one(query.amount) ?? "";
  const minuteFrom = one(query.minuteFrom) ?? "";
  const minuteTo = one(query.minuteTo) ?? "";
  const restriction = one(query.restriction) ?? "";
  const purpose = one(query.purpose) ?? "";
  const approveFrom = checked(query.approveFrom);
  const approveTo = checked(query.approveTo);
  const presidentReceiving = checked(query.presidentReceiving);
  const touched = Object.keys(query).some((key) => key !== "action");

  const approvals: Transfer["approvals"] = [];
  if (approveFrom) {
    approvals.push({
      approverId: TREASURER_BY_ENTITY[fromEntity],
      entity: fromEntity,
      approvedOn: asOf,
    });
  }
  if (presidentReceiving) {
    approvals.push({ approverId: PRESIDENT_ID, entity: toEntity, approvedOn: asOf });
  } else if (approveTo) {
    approvals.push({
      approverId: TREASURER_BY_ENTITY[toEntity],
      entity: toEntity,
      approvedOn: asOf,
    });
  }

  const draft: Transfer = {
    id: "tr-draft",
    createdById: subject.personId,
    entity: fromEntity,
    fromEntity,
    toEntity,
    amountCents: dollarsToCents(amountRaw),
    fromFundId: null,
    toFundId: null,
    approvals,
    minuteRefFrom: minuteFrom.trim() || null,
    minuteRefTo: minuteTo.trim() || null,
    restrictionStatement: restriction,
    purpose,
    status: "DRAFT",
  };

  const rules = transferRuleStatuses(draft);
  const ready = canRecordTransfer(draft);
  const unmetCount = rules.filter((r) => !r.met).length;
  const submitted = one(query.action) === "record";

  return (
    <div>
      <TreasuryHeader
        current="/board/treasury/transfers"
        title="Inter-entity transfers"
        period={period.label}
        lede={
          "Money crossing between a 501(c)(19) and a 501(c)(3) is its own " +
          "transaction type. It cannot be recorded without a treasurer's approval " +
          "on each side, a minute reference in each entity's own book, and a " +
          "written statement of what the receiving entity may spend it on."
        }
      />

      <section className={styles.panelPlain} aria-labelledby="recusal">
        <h2 id="recusal" className={styles.panelTitle}>
          The President is recused on the receiving side
        </h2>
        <p className={styles.findingText}>
          {personName(PRESIDENT_ID)} is President of both entities, which means the
          President is the one officer who could approve both ends of a transfer
          alone. So the receiving approval has to come from the receiving
          entity&rsquo;s Treasurer, and a President&rsquo;s approval on that side is
          refused by name below rather than quietly ignored. The President may
          still approve the sending side.
        </p>
        <dl className={styles.kv} style={{ marginTop: 14 }}>
          <dt>Sending side</dt>
          <dd>
            <EntityTag entity={fromEntity} /> approval from{" "}
            <strong>{personName(TREASURER_BY_ENTITY[fromEntity])}</strong>, Treasurer
            of {ENTITY_LABELS[fromEntity].long}. The President may also approve here.
          </dd>
          <dt>Receiving side</dt>
          <dd>
            <EntityTag entity={toEntity} /> approval from{" "}
            <strong>{personName(TREASURER_BY_ENTITY[toEntity])}</strong>, Treasurer of{" "}
            {ENTITY_LABELS[toEntity].long}.{" "}
            <span className={styles.chipWarn + " " + styles.chip}>
              President recused
            </span>
          </dd>
        </dl>
      </section>

      <h2 className={styles.sectionHead}>Raise a transfer</h2>

      {submitted && ready ? (
        <p className={`${entityClass(toEntity)} ${styles.confirm}`} role="status">
          Every condition is met, so this transfer can be recorded:{" "}
          <strong>{formatCents(draft.amountCents)} USD</strong> from{" "}
          {ENTITY_LABELS[fromEntity].short} to {ENTITY_LABELS[toEntity].short}, minuted
          at {draft.minuteRefFrom} and {draft.minuteRefTo}. Persistence is deferred in
          this build, so nothing has been written to either ledger yet.
        </p>
      ) : null}

      {touched && !ready ? (
        <p className={styles.refusal} role="status">
          {unmetCount === 1
            ? "One condition is outstanding, so the transfer cannot be recorded:"
            : `${unmetCount} conditions are outstanding, so the transfer cannot be recorded:`}{" "}
          {rules
            .filter((r) => !r.met)
            .map((r) => r.requirement)
            .join(" ")}
        </p>
      ) : null}

      <form method="get" className={styles.panelPlain}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Direction</span>
          <select className={styles.select} name="direction" defaultValue={direction}>
            <option value="JSOA_TO_JSOF">
              JSOA, the Association, pays JSOF, the Foundation
            </option>
            <option value="JSOF_TO_JSOA">
              JSOF, the Foundation, pays JSOA, the Association
            </option>
          </select>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Amount, US dollars</span>
          <input
            className={`${styles.input} ${styles.inputNum}`}
            name="amount"
            inputMode="decimal"
            defaultValue={amountRaw}
            placeholder="0.00"
          />
          <span className={styles.fieldHint}>
            Held as whole cents. Two decimal places, no rounding.
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Purpose</span>
          <input
            className={styles.input}
            name="purpose"
            defaultValue={purpose}
            placeholder="Cost share for the shared platform build"
          />
        </label>

        <fieldset
          style={{ border: "none", padding: 0, margin: "0 0 14px" }}
          aria-describedby="approvals-hint"
        >
          <legend className={styles.fieldLabel}>Approvals, one per entity</legend>
          <div className={styles.checkRow}>
            <input type="checkbox" name="approveFrom" id="approveFrom" defaultChecked={approveFrom} />
            <label className={styles.checkLabel} htmlFor="approveFrom">
              {personName(TREASURER_BY_ENTITY[fromEntity])}, Treasurer of{" "}
              {ENTITY_LABELS[fromEntity].short}, approves the money leaving
            </label>
          </div>
          <div className={styles.checkRow}>
            <input type="checkbox" name="approveTo" id="approveTo" defaultChecked={approveTo} />
            <label className={styles.checkLabel} htmlFor="approveTo">
              {personName(TREASURER_BY_ENTITY[toEntity])}, Treasurer of{" "}
              {ENTITY_LABELS[toEntity].short}, approves the money arriving
            </label>
          </div>
          <div className={styles.checkRow}>
            <input
              type="checkbox"
              name="presidentReceiving"
              id="presidentReceiving"
              defaultChecked={presidentReceiving}
            />
            <label className={styles.checkLabel} htmlFor="presidentReceiving">
              Record the President&rsquo;s approval on the receiving side instead
              <span className={styles.checkNote}>
                Tick this to see the recusal refuse it by name. It replaces the
                receiving Treasurer&rsquo;s approval rather than adding to it.
              </span>
            </label>
          </div>
          <span id="approvals-hint" className={styles.fieldHint}>
            You are signed in as {personName(subject.personId) || subject.personId}. An
            approval from you on a transfer you raised is refused as self-approval.
          </span>
        </fieldset>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            Minute reference, {ENTITY_LABELS[fromEntity].short} book
          </span>
          <input
            className={styles.input}
            name="minuteFrom"
            defaultValue={minuteFrom}
            placeholder={`${fromEntity}-2026-10-min-4`}
          />
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            Minute reference, {ENTITY_LABELS[toEntity].short} book
          </span>
          <input
            className={styles.input}
            name="minuteTo"
            defaultValue={minuteTo}
            placeholder={`${toEntity}-2026-10-min-2`}
          />
          <span className={styles.fieldHint}>
            The two minute books stay separate, so one reference covering both is not
            enough.
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Restriction statement</span>
          <textarea
            className={styles.textarea}
            name="restriction"
            defaultValue={restriction}
            placeholder="Applied to the Foundation's share of shared operating cost only. Not available to the scholarship fund or the endowment."
          />
          <span className={styles.fieldHint}>
            What the receiving entity may and may not spend this on, in writing. At
            least {RESTRICTION_STATEMENT_MIN_LENGTH} characters, so &ldquo;n/a&rdquo;
            cannot pass.
          </span>
        </label>

        <div className={styles.actions}>
          <button
            className={`${styles.button} ${styles.buttonQuiet}`}
            type="submit"
            name="action"
            value="check"
          >
            Check against the rules
          </button>
          <button
            className={`${entityClass(toEntity)} ${styles.button}`}
            type="submit"
            name="action"
            value="record"
            disabled={!ready}
          >
            Record the transfer
          </button>
          {!ready ? (
            <span className={styles.quiet}>
              Disabled until every condition below is met.
            </span>
          ) : null}
        </div>
      </form>

      <h2 className={styles.sectionHead}>
        Conditions{" "}
        <span className={styles.quiet}>
          ({rules.length - unmetCount} of {rules.length} met)
        </span>
      </h2>
      <RuleList rules={rules} />

      <h2 className={styles.sectionHead}>Transfers on the books</h2>

      {listRefusal ? (
        <p className={styles.refusal} role="status">
          {listRefusal}
        </p>
      ) : null}

      <div className={styles.stack}>
        {recorded.map((transfer) => {
          const transferRules = transferRuleStatuses(transfer);
          const outstanding = transferRules.filter((r) => !r.met);
          return (
            <section
              key={transfer.id}
              className={`${entityClass(transfer.fromEntity)} ${styles.panel}`}
              aria-labelledby={`tx-${transfer.id}`}
            >
              <div className={styles.panelHead}>
                <div>
                  <span className={styles.eyebrow}>{transfer.id}</span>
                  <h3 id={`tx-${transfer.id}`} className={styles.panelTitle}>
                    <EntityTag entity={transfer.fromEntity} />
                    <span className={styles.quiet}> to </span>
                    <EntityTag entity={transfer.toEntity} />{" "}
                    <Money amountCents={transfer.amountCents} showCurrency />
                  </h3>
                </div>
                <span
                  className={`${styles.chip} ${
                    outstanding.length > 0 ? styles.chipWarn : styles.chipHue
                  }`}
                >
                  {outstanding.length > 0
                    ? `${outstanding.length} outstanding`
                    : "All conditions met"}
                </span>
              </div>

              <dl className={styles.kv}>
                <dt>Purpose</dt>
                <dd>{transfer.purpose}</dd>
                <dt>Raised by</dt>
                <dd>{personName(transfer.createdById)}</dd>
                <dt>Approvals</dt>
                <dd>
                  {transfer.approvals.length === 0 ? (
                    <span className={styles.quiet}>None recorded</span>
                  ) : (
                    transfer.approvals
                      .map(
                        (a) => `${personName(a.approverId)} on ${a.entity}, ${a.approvedOn}`,
                      )
                      .join("; ")
                  )}
                </dd>
                <dt>Minutes</dt>
                <dd>
                  {ENTITY_LABELS[transfer.fromEntity].short}:{" "}
                  {transfer.minuteRefFrom ?? (
                    <span className={styles.chipWarn + " " + styles.chip}>missing</span>
                  )}
                  {" · "}
                  {ENTITY_LABELS[transfer.toEntity].short}:{" "}
                  {transfer.minuteRefTo ?? (
                    <span className={styles.chipWarn + " " + styles.chip}>missing</span>
                  )}
                </dd>
                <dt>Restriction</dt>
                <dd>{transfer.restrictionStatement}</dd>
              </dl>

              {outstanding.length > 0 ? (
                <>
                  <p className={styles.mitigation} style={{ marginTop: 16 }}>
                    <span className={styles.mitigationLabel}>Outstanding</span>
                    This transfer cannot be recorded yet.
                  </p>
                  <RuleList rules={outstanding} />
                </>
              ) : null}
            </section>
          );
        })}
      </div>

      <p className={styles.note}>
        Figures in this build are fictional demo data. Persistence is deferred, so
        nothing on this screen writes to a ledger.
      </p>
    </div>
  );
}

function RuleList({ rules }: { rules: TransferRule[] }) {
  return (
    <ul className={styles.rules}>
      {rules.map((rule) => (
        <li key={rule.id} className={styles.rule}>
          <span
            className={`${styles.ruleState} ${
              rule.met ? styles.ruleStateMet : styles.ruleStateUnmet
            }`}
          >
            {rule.met ? "Met" : "Not met"}
          </span>
          <span className={styles.ruleRequirement}>{rule.requirement}</span>
          {!rule.met ? <p className={styles.ruleWhy}>{rule.unmetMessage}</p> : null}
          <span className={styles.ruleSource}>
            {rule.source === "policy.ts"
              ? "Enforced by the permission engine"
              : "Enforced by the treasury module"}
          </span>
        </li>
      ))}
    </ul>
  );
}
