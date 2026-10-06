/**
 * The VP Membership dashboard: the figures that say whether the roster is
 * doing its job, and the work that follows from them.
 *
 * Why these figures and not a member count. The roster is the master record
 * three other things key off — scholarship eligibility, event invitations, and
 * the 501(c)(19) tests — so what matters about it is not how big it is but
 * whether it is true, whether it is current, and whether the people on it can
 * be reached. A member count only goes up and changes no decision. It is not
 * here.
 *
 * The authorization shape is the interesting part, and it is deliberate.
 *
 *   AGGREGATE buys the three composition tests. They are counts and
 *             percentages and they name nobody, which is exactly why
 *             `loadCompositionReport` was built to need only aggregate.
 *   READ      buys everything behind them: the application queue, the vouch
 *             records, the records that contradict themselves, the roster's
 *             reachability.
 *
 * So a viewer can legitimately see that the 90% war-veteran test is failing
 * and still not be allowed to see which records are short. Those four tiles
 * come back withheld for that viewer — `value: null` with what it would take,
 * never a zero and never a widened grant. The whole point of the split is that
 * the person who needs to know the exemption is at risk is not always the
 * person who may read the roster.
 *
 * Integer arithmetic throughout. Percentages come from `formatPercent`, which
 * works in permille, because 97.5% of 40 is exactly 39 and a float comparison
 * at that boundary is an argument nobody should have with the IRS.
 */

import { type Level } from "../authz/model";
import { authorize, can, type Subject } from "../authz/policy";
import type { Kpi } from "../../components/dashboard/Kpi";
import { buildCompositionReport, formatPercent, formatThreshold } from "./composition";
import type { MembershipRepository } from "./repository";
import { grantsMemberAccess, VOUCH_WINDOW_HOURS } from "./state";
import {
  type Application,
  type CompositionReport,
  type CompositionTest,
  type Member,
  type VouchRequest,
  AUDIT_WINDOW_DAYS,
  MEMBERSHIP_ENTITY,
} from "./types";

/**
 * What the acknowledgment promises the applicant: "you will hear from us
 * within four days" (`INTAKE_MESSAGE` in state.ts). The 72-hour vouch window
 * plus a day for the chair. It is a promise made to a person, so it is the
 * target the oldest-application tile is measured against rather than an
 * internal service level someone invented.
 */
export const PROMISED_OUTCOME_DAYS = 4;

/** Below this many settled vouch requests, the expiry figure is not yet a rate. */
const VOUCH_RATE_MINIMUM = 5;

const DAY_MS = 86_400_000;

/* ------------------------------------------------------------------ *
 * The guard
 *
 * The same shape as `board.ts`: call the shared policy engine with a data
 * class, an entity and a required level, let it throw, and write both the read
 * and the denial to the module's append-only log. `board.ts` keeps its copy
 * module-private, so this is a deliberate duplicate rather than a second
 * mechanism — if the two ever diverge, that is a bug in this file.
 * ------------------------------------------------------------------ */

async function guard(
  repo: MembershipRepository,
  subject: Subject,
  options: { action: string; required: Level; rowLevel: boolean; subjectRef?: string | null },
): Promise<void> {
  const base = {
    at: new Date().toISOString(),
    personId: subject.personId,
    dataClass: "MEMBER_PII" as const,
    entity: MEMBERSHIP_ENTITY,
    rowLevel: options.rowLevel,
    subjectRef: options.subjectRef ?? null,
  };
  try {
    authorize({
      subject,
      dataClass: "MEMBER_PII",
      entity: MEMBERSHIP_ENTITY,
      required: options.required,
      rowLevel: options.rowLevel,
    });
  } catch (error) {
    await repo.appendAudit({ ...base, action: `${options.action}:DENIED` });
    throw error;
  }
  await repo.appendAudit({ ...base, action: options.action });
}

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/**
 * A piece of work the figures imply, with a count and a link into it.
 *
 * `href` is null when the viewer's grant will not open the target. The action
 * still appears, because knowing the work exists is not the same as being able
 * to do it, and a dashboard that hides the queue from the President teaches
 * them the queue is empty.
 */
export type DashboardAction = {
  key: string;
  label: string;
  note: string;
  count: string;
  href: string | null;
  urgent: boolean;
};

/** A second-tier figure: real, but not one of the seven. */
export type DashboardRow = {
  key: string;
  label: string;
  detail: string;
};

export type MembershipDashboard = {
  asOf: string;
  kpis: Kpi[];
  actions: DashboardAction[];
  rows: DashboardRow[];
  /** What the viewer's grant allowed. Surfaced so the page can say so. */
  scope: {
    /** Always true: the read throws otherwise. */
    aggregate: true;
    /** READ on member records. False means four tiles came back withheld. */
    records: boolean;
    /** WRITE on member records. False means the actions are read-only. */
    decide: boolean;
  };
};

/* ------------------------------------------------------------------ *
 * The read
 * ------------------------------------------------------------------ */

/**
 * One authorized read for the whole dashboard.
 *
 * One rather than seven, so the audit log records one dashboard view instead
 * of a row of near-identical entries, and so every tile on the screen is
 * computed from the same snapshot at the same instant. Returns the tiles, the
 * actions under them and the second tier, because those three are the same
 * measurement rendered three ways and computing them separately is how they
 * come to disagree.
 *
 * Nothing here mutates. The queue screens sweep expired vouch windows when
 * they load, which is a write; a dashboard that moved applications between
 * states as a side effect of being looked at would make the figures depend on
 * who opened what first. Applications whose window has closed but which no
 * sweep has picked up yet are counted as the chair's, which is where the
 * state machine will put them.
 */
export async function loadMembershipDashboard(
  repo: MembershipRepository,
  subject: Subject,
  now: Date = new Date(),
): Promise<MembershipDashboard> {
  // Aggregate is the floor. A role with no member data at all is refused here
  // and the refusal is logged, same as every other read in this module.
  await guard(repo, subject, {
    action: "READ_MEMBERSHIP_DASHBOARD",
    required: "AGGREGATE",
    rowLevel: false,
    subjectRef: "aggregate",
  });

  const records = can({
    subject,
    dataClass: "MEMBER_PII",
    entity: MEMBERSHIP_ENTITY,
    required: "READ",
  });
  const decide = can({
    subject,
    dataClass: "MEMBER_PII",
    entity: MEMBERSHIP_ENTITY,
    required: "WRITE",
  });

  const members = await repo.listMembers();
  const report = buildCompositionReport(members, now);
  const failing = report.tests.filter((test) => !test.passes).length;

  // The war-veteran test leads. The report orders the three by statute, which
  // is right for a compliance document; a dashboard leads with the one that is
  // failing and with the one whose denominator is the whole membership, so the
  // most consequential figure is not the third thing read.
  const kpis: Kpi[] = [...report.tests]
    .sort((a, b) => TEST_ORDER.indexOf(a.key) - TEST_ORDER.indexOf(b.key))
    .map((test) => compositionKpi(test));

  if (!records) {
    kpis.push(...withheldKpis());
    return {
      asOf: report.asOf,
      kpis,
      actions: actionsFor({ records, decide, failing }),
      rows: aggregateRows(report, members.length),
      scope: { aggregate: true, records, decide },
    };
  }

  // Row-level now, and logged as row-level: the figures below are derived from
  // individual applications and individual roster records, and for this
  // organization who looked at those matters more than who edited them.
  await guard(repo, subject, {
    action: "READ_MEMBERSHIP_DASHBOARD_RECORDS",
    required: "READ",
    rowLevel: true,
  });

  const applications = await repo.listApplications();
  const requests = await vouchRequestsFor(repo, applications);

  const intake = summariseIntake(applications, now);
  const vouch = summariseVouch(requests, now);
  const roster = summariseRoster(members, now);

  kpis.push(
    oldestUndecidedKpi(intake),
    vouchExpiryKpi(vouch),
    recordDefectKpi(roster, report),
    contactabilityKpi(roster),
  );

  return {
    asOf: report.asOf,
    kpis,
    actions: actionsFor({ records, decide, failing, intake, vouch, roster }),
    rows: [...recordRows(intake, vouch, roster), ...aggregateRows(report, members.length)],
    scope: { aggregate: true, records, decide },
  };
}

/* ------------------------------------------------------------------ *
 * The three composition tests
 * ------------------------------------------------------------------ */

/**
 * How many records the test needs, in integers. `ceil(threshold * n / 1000)`,
 * so 90% of 40 is 36 and 97.5% of 40 is 39 exactly.
 */
export function requiredNumerator(thresholdPermille: number, denominator: number): number {
  return Math.ceil((thresholdPermille * denominator) / 1000);
}

/**
 * A test's tile.
 *
 * Status comes from the margin, not from pass or fail alone. A test that
 * passes with nothing to spare is a `watch`: the 97.5% test sitting exactly on
 * the line means one more non-qualifying member ends the exemption, and
 * calling that "good" would be true and useless.
 */
function compositionKpi(test: CompositionTest): Kpi {
  const required = requiredNumerator(test.thresholdPermille, test.denominator);
  const slack = test.numerator - required;

  return {
    key: `composition-${test.key.toLowerCase().replace(/_/g, "-")}`,
    label: COMPOSITION_LABELS[test.key],
    // The fraction leads and the percentage follows it. A bare 82.5% hides the
    // denominator, and for the 90% test the denominator is the whole argument.
    value: `${test.numerator} of ${test.denominator} (${formatPercent(test.numerator, test.denominator)})`,
    target: `${required} of ${test.denominator} (${formatThreshold(test.thresholdPermille)})`,
    status: slack < 0 ? "problem" : slack === 0 ? "watch" : "good",
    from: `${COMPOSITION_PROVENANCE[test.key]} ${marginSentence(slack)}`,
  };
}

/** Dashboard order: the failing one and the broadest denominator first. */
const TEST_ORDER: CompositionTest["key"][] = [
  "WAR_VETERANS",
  "ARMED_FORCES",
  "MEMBERS_CADETS_RELATIVES",
];

/**
 * Shorter than the report's own labels, because a tile has one line for a
 * label and the report is one click away for the full wording.
 */
const COMPOSITION_LABELS: Record<CompositionTest["key"], string> = {
  WAR_VETERANS: "War veterans, against total membership",
  ARMED_FORCES: "Past or present armed forces",
  MEMBERS_CADETS_RELATIVES: "Members, cadets or qualifying relatives",
};

const COMPOSITION_PROVENANCE: Record<CompositionTest["key"], string> = {
  WAR_VETERANS:
    "Counted members, war-veteran status derived from attested service dates rather " +
    "than from the applicant's checkbox. Measured against total membership, so every " +
    "cadet, spouse and non-qualifying member counts against it. Governs whether a gift " +
    "to the Association is deductible to the giver.",
  ARMED_FORCES:
    "Counted members by declared category. Peacetime service counts here and not " +
    "toward the 90% test. Governs the exemption itself.",
  MEMBERS_CADETS_RELATIVES:
    "Counted members by declared category. The other side of the same line: a " +
    "non-qualifying class above 2.5% of the roster ends the exemption.",
};

function marginSentence(slack: number): string {
  if (slack < 0) {
    const short = Math.abs(slack);
    return short === 1 ? "One record short of the line." : `${short} records short of the line.`;
  }
  if (slack === 0) return "Exactly on the line, with nothing to spare.";
  return slack === 1 ? "One record of margin." : `${slack} records of margin.`;
}

/* ------------------------------------------------------------------ *
 * Withheld: aggregate is enough for the tests, not for the records
 * ------------------------------------------------------------------ */

const WITHHELD_NEEDS =
  "READ on member records for the Association. This role holds aggregate, which " +
  "is enough for the three tests above and not for the records behind them.";

function withheld(key: string, label: string, from: string): Kpi {
  return { key, label, value: null, status: "unmeasured", from, needs: WITHHELD_NEEDS };
}

function withheldKpis(): Kpi[] {
  return [
    withheld(
      "oldest-undecided",
      "Oldest application with no outcome yet",
      "Would be computed from submission dates on applications still awaiting a sponsor or the chair.",
    ),
    withheld(
      "vouch-expiry",
      "Vouch windows that closed with no answer",
      "Would be computed from the sponsor vouch records behind each application.",
    ),
    withheld(
      "record-defects",
      "Roster records that fail their own audit",
      "The composition report counts these in aggregate; naming how many records carry a finding is a roster read.",
    ),
    withheld(
      "contactable",
      "Members reachable at a confirmed address",
      "Would be computed from the email address on each roster record.",
    ),
  ];
}

/* ------------------------------------------------------------------ *
 * Intake: how long an applicant has been waiting
 * ------------------------------------------------------------------ */

type IntakeSummary = {
  undecided: number;
  withSponsor: number;
  withChair: number;
  oldestDays: number | null;
  decidedDays: number[];
};

/** Whether this application's 72-hour vouch window has already closed. */
function windowClosed(application: Application, now: Date): boolean {
  if (!application.vouchExpiresAt) return false;
  return new Date(application.vouchExpiresAt).getTime() <= now.getTime();
}

function ageDays(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS));
}

function summariseIntake(applications: Application[], now: Date): IntakeSummary {
  const undecided = applications.filter(
    (a) => a.state === "AWAITING_VOUCH" || a.state === "CHAIR_QUEUE",
  );

  // An application whose window has closed is the chair's, whether or not a
  // sweep has moved it yet. Counting it as "waiting on a sponsor" would say
  // the sponsor still might answer, and the state machine says they cannot.
  const withSponsor = undecided.filter(
    (a) => a.state === "AWAITING_VOUCH" && !windowClosed(a, now),
  ).length;

  const ages = undecided.map((a) => ageDays(a.submittedAt ?? a.createdAt, now));

  const decidedDays = applications
    .filter((a) => a.chairDecision !== null && a.submittedAt !== null)
    .map((a) =>
      Math.max(
        0,
        Math.floor(
          (new Date(a.chairDecision!.at).getTime() - new Date(a.submittedAt!).getTime()) / DAY_MS,
        ),
      ),
    );

  return {
    undecided: undecided.length,
    withSponsor,
    withChair: undecided.length - withSponsor,
    oldestDays: ages.length ? Math.max(...ages) : null,
    decidedDays,
  };
}

function oldestUndecidedKpi(intake: IntakeSummary): Kpi {
  if (intake.oldestDays === null) {
    return {
      key: "oldest-undecided",
      label: "Oldest application with no outcome yet",
      value: "None waiting",
      target: `${PROMISED_OUTCOME_DAYS} days`,
      status: "good",
      from:
        "No application is sitting without an outcome. The acknowledgment promises " +
        `one within ${PROMISED_OUTCOME_DAYS} days.`,
    };
  }

  const days = intake.oldestDays;
  return {
    key: "oldest-undecided",
    label: "Oldest application with no outcome yet",
    value: days === 1 ? "1 day" : `${days} days`,
    target: `${PROMISED_OUTCOME_DAYS} days`,
    status:
      days > PROMISED_OUTCOME_DAYS ? "problem" : days === PROMISED_OUTCOME_DAYS ? "watch" : "good",
    from:
      `${plural(intake.undecided, "application has", "applications have")} had no outcome yet: ` +
      `${intake.withSponsor} waiting on a sponsor inside the window, ${intake.withChair} on the ` +
      `chair. Measured from submission, against the ${PROMISED_OUTCOME_DAYS} days the ` +
      "acknowledgment promises the applicant.",
  };
}

/* ------------------------------------------------------------------ *
 * Vouch: the health of the sponsor flow
 * ------------------------------------------------------------------ */

type VouchSummary = {
  total: number;
  confirmed: number;
  declined: number;
  doNotKnow: number;
  expired: number;
  open: number;
  settled: number;
  undeliverable: number;
};

/**
 * Every vouch request on file, reached through its application.
 *
 * The repository exposes a request per application rather than a list of all
 * requests, and a request is written for every submission whether or not there
 * was an address to send it to, so walking the applications reaches all of
 * them. Reading it this way rather than widening the repository interface
 * keeps the dashboard out of a shape other modules share.
 */
async function vouchRequestsFor(
  repo: MembershipRepository,
  applications: Application[],
): Promise<VouchRequest[]> {
  const found = await Promise.all(
    applications.map((application) => repo.getVouchRequestForApplication(application.id)),
  );
  return found.filter((request): request is VouchRequest => request !== null);
}

function summariseVouch(requests: VouchRequest[], now: Date): VouchSummary {
  const answered = requests.filter((r) => r.answeredAt !== null);
  const unanswered = requests.filter((r) => r.answeredAt === null);
  const expired = unanswered.filter(
    (r) => new Date(r.expiresAt).getTime() <= now.getTime(),
  ).length;

  const confirmed = answered.filter((r) => r.outcome === "CONFIRMED").length;
  const declined = answered.filter((r) => r.outcome === "DECLINED").length;
  const doNotKnow = answered.filter((r) => r.outcome === "DO_NOT_KNOW").length;

  return {
    total: requests.length,
    confirmed,
    declined,
    doNotKnow,
    expired,
    open: unanswered.length - expired,
    settled: confirmed + declined + doNotKnow + expired,
    undeliverable: requests.filter((r) => !r.deliverable).length,
  };
}

/**
 * The expiry rate, which is the health of the sponsor flow.
 *
 * A window that closes unanswered is not a neutral outcome: it is an applicant
 * who waited three days for nothing and a case that lands on the chair, which
 * is the manual step the vouch exists to remove. Reported as a fraction of
 * settled requests, because a request still inside its window has not yet
 * failed and putting it in the denominator would flatter the figure.
 */
function vouchExpiryKpi(vouch: VouchSummary): Kpi {
  if (vouch.total === 0) {
    return {
      key: "vouch-expiry",
      label: "Vouch windows that closed with no answer",
      value: null,
      status: "unmeasured",
      from: "No sponsor vouch request has been written yet.",
      needs: "at least one submitted application with a sponsor request",
    };
  }

  if (vouch.settled === 0) {
    return {
      key: "vouch-expiry",
      label: "Vouch windows that closed with no answer",
      value: null,
      status: "unmeasured",
      from: `${vouch.total} sponsor requests on file, all still inside the ${VOUCH_WINDOW_HOURS}-hour window.`,
      needs: "a vouch request to have been answered or to have run out of time",
    };
  }

  const thin = vouch.settled < VOUCH_RATE_MINIMUM;
  const status: Kpi["status"] =
    vouch.expired === 0 ? "good" : thin ? "watch" : vouch.expired * 3 > vouch.settled ? "problem" : "watch";

  return {
    key: "vouch-expiry",
    label: "Vouch windows that closed with no answer",
    value: `${vouch.expired} of ${vouch.settled} settled`,
    target: `0 of ${vouch.settled}`,
    status,
    from:
      `${vouch.total} sponsor requests on file: ${vouch.confirmed} confirmed, ` +
      `${vouch.declined} declined, ${vouch.doNotKnow} did not know the applicant, ` +
      `${vouch.expired} ran out of time, ${vouch.open} still inside the ${VOUCH_WINDOW_HOURS}-hour window.` +
      (thin ? ` ${vouch.settled} settled request${vouch.settled === 1 ? "" : "s"} is too few to read as a rate.` : ""),
  };
}

/* ------------------------------------------------------------------ *
 * Roster: records that contradict themselves, and reachability
 * ------------------------------------------------------------------ */

type RosterSummary = {
  counted: number;
  defective: number;
  withEmail: number;
  probationary: number;
  auditDue: number;
};

/**
 * A record that fails its own audit: not a member who is non-qualifying, which
 * is a true fact about a person, but a record that contradicts itself and so
 * cannot be counted honestly toward anything.
 *
 * The non-qualifying class is deliberately NOT a defect here. It is already
 * the subject of the 97.5% tile, and folding it in would turn "records to fix"
 * into a number nobody can act on.
 */
function recordIsDefective(member: Member): boolean {
  if (member.membershipCategory === "VETERAN" && !member.serviceFrom) return true;
  if (member.membershipCategory === "QUALIFYING_RELATIVE" && !member.qualifyingRelationship) {
    return true;
  }
  return member.attestedWarVeteran !== member.isWarVeteran;
}

function summariseRoster(members: Member[], now: Date): RosterSummary {
  const counted = members.filter(
    (m) => m.entity === MEMBERSHIP_ENTITY && grantsMemberAccess(m.state),
  );
  const probationary = counted.filter((m) => m.state === "PROBATIONARY");

  return {
    counted: counted.length,
    defective: counted.filter(recordIsDefective).length,
    withEmail: counted.filter((m) => m.email.trim() !== "").length,
    probationary: probationary.length,
    auditDue: probationary.filter(
      (m) => m.paymentClearedAt !== null && ageDays(m.paymentClearedAt, now) >= AUDIT_WINDOW_DAYS,
    ).length,
  };
}

function recordDefectKpi(roster: RosterSummary, report: CompositionReport): Kpi {
  return {
    key: "record-defects",
    label: "Roster records that fail their own audit",
    value: `${roster.defective} of ${roster.counted}`,
    target: `0 of ${roster.counted}`,
    status: roster.defective === 0 ? "good" : "watch",
    from:
      "Counted members whose record contradicts itself: " +
      `${plural(report.attestationMismatches, "record", "records")} where the attested ` +
      "war-veteran status disagrees with the attested service dates, " +
      `${plural(report.missingServiceDates, "veteran record", "veteran records")} with no dates ` +
      "at all. A record is counted once however many findings it carries, so this figure can be " +
      "below the sum of those two.",
  };
}

/**
 * Reachability, which is a dependency and not a vanity number.
 *
 * The sponsor vouch is the whole verification mechanism in this module: there
 * is no document and no national identifier anywhere in it. A sponsor who
 * cannot be reached is an application that waits out its window and lands on
 * the chair, which is the manual step the design removes. So whether the
 * roster can be reached is the precondition for the flow working at all.
 *
 * It is not computable. The record carries an address and nothing that says
 * the address was ever confirmed, and a count of addresses present is a
 * different figure wearing this one's label.
 */
function contactabilityKpi(roster: RosterSummary): Kpi {
  return {
    key: "contactable",
    label: "Members reachable at a confirmed address",
    value: null,
    status: "unmeasured",
    from:
      `${roster.withEmail} of ${roster.counted} counted records carry an email address, and no ` +
      "field on the record says any of them was ever confirmed deliverable. The sponsor vouch " +
      "is this module's only verification mechanism, so an address that bounces is a sponsor " +
      "who cannot be asked.",
    needs: "a confirmed-at timestamp on the member's address, which the roster record does not carry",
  };
}

/* ------------------------------------------------------------------ *
 * Then say what to do
 * ------------------------------------------------------------------ */

const WITHHELD_COUNT = "withheld";
const WITHHELD_NOTE =
  "Withheld. This role holds aggregate on member records, so the figure above is readable " +
  "and the records behind it are not.";
const READ_ONLY_NOTE =
  "Read-only for this role. Deciding needs write on member records, which the roster's owner holds.";

function actionsFor(input: {
  records: boolean;
  decide: boolean;
  failing: number;
  intake?: IntakeSummary;
  vouch?: VouchSummary;
  roster?: RosterSummary;
}): DashboardAction[] {
  const { records, decide, failing, intake, vouch, roster } = input;
  const count = (n: number | undefined, suffix: string): string =>
    n === undefined ? WITHHELD_COUNT : `${n} ${suffix}`;

  /**
   * The note on an action that touches records. Three answers, in order of how
   * much the viewer may do: cannot open it at all, can read it but not decide
   * in it, or owns it.
   */
  const note = (own: string): string =>
    !records ? WITHHELD_NOTE : decide ? own : READ_ONLY_NOTE;

  return [
    {
      key: "composition",
      label: failing > 0 ? "Take the failing test to the board" : "Read the composition report",
      note:
        failing > 0
          ? "A failing 90% test is not a filing correction. It is fixed by who joins, so it is a " +
            "board decision about recruitment, not a data cleanup."
          : "Three tests with the counts behind each, and what failing each one costs.",
      count: `${failing} of 3 failing`,
      href: "/board/membership/composition",
      urgent: failing > 0,
    },
    {
      key: "exceptions",
      label: "Decide the chair exceptions",
      note: note(
        "Declined vouches, sponsors who did not recognise the name, augmentee cases, and " +
          "windows that closed unanswered.",
      ),
      count: count(intake?.withChair, "waiting"),
      href: records ? "/board/membership/exceptions" : null,
      urgent: (intake?.withChair ?? 0) > 0,
    },
    {
      key: "audit",
      label: `Record the ${AUDIT_WINDOW_DAYS}-day record audits that are due`,
      note: note(
        "A pass, or a finding that is recorded and held. There is no revoke button until the " +
          "bylaws say what revocation means.",
      ),
      count:
        roster === undefined
          ? WITHHELD_COUNT
          : `${roster.auditDue} of ${roster.probationary} in the cohort`,
      href: records ? "/board/membership/audit" : null,
      urgent: (roster?.auditDue ?? 0) > 0,
    },
    {
      key: "roster",
      label: "Correct the records that fail their own audit",
      note: note(
        "Each one is a record the 90% test cannot count honestly. Fixing the record does not " +
          "move the test unless the dates say it should.",
      ),
      count: count(roster?.defective, roster?.defective === 1 ? "record" : "records"),
      href: records ? "/board/membership/roster" : null,
      urgent: (roster?.defective ?? 0) > 0,
    },
    {
      key: "queue",
      label: "Check the applications still waiting on a sponsor",
      note: note(
        "No money has been asked for and none can be. If the window closes these come to the " +
          "chair instead, so a sponsor who needs a nudge is cheaper to chase now.",
      ),
      count: count(intake?.withSponsor, "open"),
      href: records ? "/board/membership/queue" : null,
      urgent: (vouch?.open ?? 0) > 0,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Second tier
 * ------------------------------------------------------------------ */

/** Integer median. Says it is a median wherever it is rendered. */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function recordRows(
  intake: IntakeSummary,
  vouch: VouchSummary,
  roster: RosterSummary,
): DashboardRow[] {
  const median = medianOf(intake.decidedDays);
  const n = intake.decidedDays.length;

  return [
    {
      key: "median-decision",
      label: "Median days to a decision",
      detail:
        median === null
          ? "Not measured. No application has a recorded chair decision yet."
          : n < 3
            ? `${median} days, over ${n} recorded chair decision${n === 1 ? "" : "s"}. ` +
              "Too few observations to call a median useful; it becomes a figure worth a tile " +
              "once the queue has run for a cycle."
            : `${median} days, median over ${n} recorded chair decisions, measured from submission.`,
    },
    {
      key: "undeliverable",
      label: "Vouch requests with no address to send to",
      detail:
        `${vouch.undeliverable} of ${vouch.total}. A request is written for every submission ` +
        "whether or not the sponsor ID matched a roster record, so that the intake cannot be " +
        "read for whether a sponsor is real. An undeliverable request waits out its window and " +
        "goes to the chair.",
    },
    {
      key: "cohort",
      label: `Probationary cohort, ${AUDIT_WINDOW_DAYS}-day audit`,
      detail:
        `${roster.probationary} members, ${roster.auditDue} of them past the window. ` +
        "Probationary and good standing grant identical access, so this is bookkeeping on the " +
        "record and not a tier the member experiences.",
    },
  ];
}

function aggregateRows(report: CompositionReport, onFile: number): DashboardRow[] {
  return [
    {
      key: "excluded",
      label: "Records held off the composition denominator",
      detail:
        `${report.excludedRecords} of ${onFile} member records on file are lapsed, revoked or ` +
        "still in intake, and do not hold member access. Counting them would flatter the two " +
        "exemption tests with veterans who have left.",
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Copy helpers
 * ------------------------------------------------------------------ */

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
