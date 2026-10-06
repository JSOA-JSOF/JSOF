/**
 * Disbursement: the cheque run the Treasurer needs, and what has been mailed.
 *
 * The payee is the SCHOOL. That is not a presentation choice, it is the whole
 * shape of the record: a cheque line carries a school's payable name and
 * postal address, an amount, and an award reference with the student's number
 * at that school on the memo line. It carries no applicant name.
 *
 * Which is why the Treasurer can open it. The Treasurer holds FINANCIAL at
 * WRITE and APPLICANT at NONE on JSOF, and invariant 1 means no one can hold
 * write on both for one entity, so a cheque run that named applicants would be
 * a cheque run nobody could both produce and pay. Taking the name out solves
 * the authorization and the privacy problem with the same edit.
 *
 * Nothing here moves money. There is no payment integration, no provider, no
 * account number and no field that would carry one. The output is a list to
 * print cheques from and a mailed flag to tick.
 *
 * The chair asked for this because mailing cheques to schools is one of the
 * two most time-consuming tasks in her year. What is automated is the list and
 * the tracking. The envelopes are still hers.
 */

import type { Subject } from "../authz/policy";

import { guardChequeRun } from "./guard";
import { nextId, type ScholarshipRepository } from "./repository";
import { formatCents } from "./scoring";
import {
  SCHOLARSHIP_CURRENCY,
  SCHOLARSHIP_ENTITY,
  PROGRAM_LABELS,
  type Cheque,
  type Program,
} from "./types";

export type ChequeRunRow = {
  cheque: Cheque;
  program: Program;
  programLabel: string;
};

export type ChequeRun = {
  cycleId: string;
  /** Which grant the reader came in on. Written to the log as well. */
  readVia: "FINANCIAL" | "APPLICANT";
  queued: ChequeRunRow[];
  mailed: ChequeRunRow[];
  queuedTotalCents: number;
  mailedTotalCents: number;
  totalCents: number;
  /** Schools with more than one cheque, which go in one envelope. */
  consolidations: { payableTo: string; cheques: number; totalCents: number }[];
};

export async function loadChequeRun(
  repo: ScholarshipRepository,
  subject: Subject,
  cycleId?: string,
): Promise<ChequeRun> {
  const readVia = await guardChequeRun(repo, subject, {
    action: "READ_CHEQUE_RUN",
    required: "READ",
  });

  const cycle = cycleId ?? (await repo.currentCycle()).id;
  const cheques = await repo.listCheques(cycle);
  const awards = await repo.listAwards({ cycleId: cycle });
  const programByAward = new Map(awards.map((a) => [a.id, a.program]));

  const rows: ChequeRunRow[] = cheques.map((cheque) => {
    const program = programByAward.get(cheque.awardId) ?? "MERIT";
    return { cheque, program, programLabel: PROGRAM_LABELS[program] };
  });

  const queued = rows.filter((r) => r.cheque.status === "QUEUED");
  const mailed = rows.filter((r) => r.cheque.status === "MAILED");

  const byPayee = new Map<string, { cheques: number; totalCents: number }>();
  for (const row of rows) {
    const current = byPayee.get(row.cheque.payableTo) ?? { cheques: 0, totalCents: 0 };
    current.cheques += 1;
    current.totalCents += row.cheque.amountCents;
    byPayee.set(row.cheque.payableTo, current);
  }

  const queuedTotalCents = queued.reduce((sum, r) => sum + r.cheque.amountCents, 0);
  const mailedTotalCents = mailed.reduce((sum, r) => sum + r.cheque.amountCents, 0);

  return {
    cycleId: cycle,
    readVia,
    queued,
    mailed,
    queuedTotalCents,
    mailedTotalCents,
    totalCents: queuedTotalCents + mailedTotalCents,
    consolidations: [...byPayee.entries()]
      .filter(([, value]) => value.cheques > 1)
      .map(([payableTo, value]) => ({ payableTo, ...value }))
      .sort((a, b) => b.totalCents - a.totalCents),
  };
}

/* ------------------------------------------------------------------ *
 * Building the run
 * ------------------------------------------------------------------ */

/**
 * Queue a cheque for every approved or notified award that has not got one.
 *
 * Idempotent: running it twice does not double-pay, because a cheque already
 * exists for the award.
 */
export async function buildChequeRun(
  repo: ScholarshipRepository,
  subject: Subject,
  cycleId?: string,
): Promise<Cheque[]> {
  await guardChequeRun(repo, subject, { action: "BUILD_CHEQUE_RUN", required: "WRITE" });

  const cycle = cycleId ?? (await repo.currentCycle()).id;
  const existing = new Set((await repo.listCheques(cycle)).map((c) => c.awardId));
  const awards = await repo.listAwards({ cycleId: cycle });
  const created: Cheque[] = [];

  for (const award of awards) {
    if (existing.has(award.id)) continue;
    if (award.status !== "APPROVED" && award.status !== "NOTIFIED") continue;
    const application = await repo.getApplication(award.applicationId);
    if (!application?.enrolment) continue;
    const school = await repo.getSchool(application.enrolment.schoolId);
    if (!school) continue;

    created.push(
      await repo.createCheque({
        id: nextId("schchq"),
        entity: SCHOLARSHIP_ENTITY,
        cycleId: cycle,
        awardId: award.id,
        payeeSchoolId: school.id,
        payableTo: school.payableTo,
        addressLines: [...school.addressLines],
        city: school.city,
        state: school.state,
        postalCode: school.postalCode,
        office: school.office,
        amountCents: award.amountCents,
        currency: SCHOLARSHIP_CURRENCY,
        memoReference: `${application.reference} / student ${application.enrolment.studentNumber}`,
        status: "QUEUED",
        mailedAt: null,
        mailedByPersonId: null,
        note: null,
      }),
    );
  }

  return created;
}

export async function markChequeMailed(
  repo: ScholarshipRepository,
  subject: Subject,
  chequeId: string,
  note?: string,
  now: Date = new Date(),
): Promise<Cheque> {
  await guardChequeRun(repo, subject, { action: "MARK_CHEQUE_MAILED", required: "WRITE" });
  const cheque = await repo.getCheque(chequeId);
  if (!cheque) throw new Error(`No cheque ${chequeId}`);
  if (cheque.status === "MAILED") return cheque;
  return repo.updateCheque(chequeId, {
    status: "MAILED",
    mailedAt: now.toISOString(),
    mailedByPersonId: subject.personId,
    note: note?.trim() || null,
  });
}

/* ------------------------------------------------------------------ *
 * The export
 * ------------------------------------------------------------------ */

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CHEQUE_RUN_COLUMNS = [
  "cheque_id",
  "status",
  "payable_to",
  "address_1",
  "address_2",
  "city",
  "state",
  "postal_code",
  "attention",
  "amount_usd",
  "program",
  "memo",
  "mailed_at",
] as const;

/**
 * The cheque run as CSV, for the Treasurer.
 *
 * Amounts are rendered from integer cents to a two-decimal string; no float
 * arithmetic happens anywhere on the way. No applicant name is in this file.
 */
export async function chequeRunCsv(
  repo: ScholarshipRepository,
  subject: Subject,
  cycleId?: string,
): Promise<string> {
  const run = await loadChequeRun(repo, subject, cycleId);
  const rows = [...run.queued, ...run.mailed];
  const lines = [CHEQUE_RUN_COLUMNS.join(",")];
  for (const row of rows) {
    const c = row.cheque;
    lines.push(
      [
        c.id,
        c.status,
        c.payableTo,
        c.addressLines[0] ?? "",
        c.addressLines[1] ?? "",
        c.city,
        c.state,
        c.postalCode,
        c.office ?? "",
        `${Math.floor(c.amountCents / 100)}.${String(c.amountCents % 100).padStart(2, "0")}`,
        row.programLabel,
        c.memoReference,
        c.mailedAt ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export { formatCents };
