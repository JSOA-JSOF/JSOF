/**
 * The reads and writes the scholarships module needs, and an in-memory
 * implementation backed by seed data.
 *
 * Persistence is deliberately deferred: swapping to Prisma later should be one
 * new file implementing this interface, with no route or service change.
 *
 * Three shapes worth noting:
 *
 *   - There is no delete method for the audit log and none for a selection
 *     record before its retention date. Append-only is enforced by the absence
 *     of a code path.
 *   - There IS a delete path for applicant personal data, and it is the only
 *     one: `purgeApplication`. Retention is a requirement, so it is a method
 *     rather than an intention. It removes the application, the guardian
 *     consent, the score sheets and the verification together, because
 *     deleting the application and leaving the essay behind is not a purge.
 *   - Nothing here authorizes. Authorization happens in the service layer
 *     above so that the decision sits in one place per workflow rather than
 *     inside the data access.
 */

import type { Entity } from "../authz/model";
import {
  type Application,
  type Award,
  type Cheque,
  type Cycle,
  type DisabilityVerification,
  type GuardianConsent,
  type ReviewerRelationship,
  type ScholarshipAuditEntry,
  type School,
  type ScoreSheet,
  type SelectionRecord,
  type ApplicationState,
} from "./types";
import {
  seedApplications,
  seedAwards,
  seedCheques,
  seedCycles,
  seedGuardianConsents,
  seedRelationships,
  seedSchools,
  seedScoreSheets,
  seedSelectionRecords,
  seedVerifications,
} from "./seed";

export type ScholarshipRepository = {
  /* Cycles and schools ------------------------------------------- */
  listCycles(): Promise<Cycle[]>;
  getCycle(id: string): Promise<Cycle | null>;
  currentCycle(): Promise<Cycle>;
  listSchools(): Promise<School[]>;
  getSchool(id: string): Promise<School | null>;

  /* Applications ------------------------------------------------- */
  createDraft(draft: Application): Promise<Application>;
  getApplication(id: string): Promise<Application | null>;
  getApplicationByReference(reference: string): Promise<Application | null>;
  updateApplication(id: string, patch: Partial<Application>): Promise<Application>;
  listApplications(filter?: {
    cycleId?: string;
    states?: ApplicationState[];
  }): Promise<Application[]>;
  countApplicationsByEmail(cycleId: string, email: string): Promise<number>;
  /** Removes the draft outright. Used when an applicant is routed away or refused on age. */
  discardDraft(id: string): Promise<void>;

  /* Guardian consent --------------------------------------------- */
  createGuardianConsent(consent: GuardianConsent): Promise<GuardianConsent>;
  getGuardianConsent(id: string): Promise<GuardianConsent | null>;
  getGuardianConsentForApplication(applicationId: string): Promise<GuardianConsent | null>;

  /* Conflicts ---------------------------------------------------- */
  listRelationships(reviewerPersonId?: string): Promise<ReviewerRelationship[]>;
  getRelationship(
    reviewerPersonId: string,
    applicationId: string,
  ): Promise<ReviewerRelationship | null>;
  declareRelationship(relationship: ReviewerRelationship): Promise<ReviewerRelationship>;

  /* Scoring ------------------------------------------------------ */
  listScoreSheets(applicationId: string): Promise<ScoreSheet[]>;
  /**
   * Every sheet for a set of applications, in one read.
   *
   * Exists so a cycle-wide figure (a reviewer's running average against the
   * committee's) is one call rather than one call per application. A score
   * sheet carries no cycle of its own, so the caller passes the ids.
   */
  listScoreSheetsForApplications(applicationIds: string[]): Promise<ScoreSheet[]>;
  getScoreSheet(applicationId: string, reviewerPersonId: string): Promise<ScoreSheet | null>;
  upsertScoreSheet(sheet: ScoreSheet): Promise<ScoreSheet>;

  /* Disability verification -------------------------------------- */
  getVerification(applicationId: string): Promise<DisabilityVerification | null>;
  recordVerification(record: DisabilityVerification): Promise<DisabilityVerification>;

  /* Awards ------------------------------------------------------- */
  listAwards(filter?: { cycleId?: string; applicationId?: string }): Promise<Award[]>;
  getAward(id: string): Promise<Award | null>;
  createAward(award: Award): Promise<Award>;
  updateAward(id: string, patch: Partial<Award>): Promise<Award>;

  /* Disbursement ------------------------------------------------- */
  listCheques(cycleId?: string): Promise<Cheque[]>;
  getCheque(id: string): Promise<Cheque | null>;
  createCheque(cheque: Cheque): Promise<Cheque>;
  updateCheque(id: string, patch: Partial<Cheque>): Promise<Cheque>;

  /* Retention ---------------------------------------------------- */
  listSelectionRecords(cycleId?: string): Promise<SelectionRecord[]>;
  createSelectionRecord(record: SelectionRecord): Promise<SelectionRecord>;
  /**
   * The one delete path for applicant personal data. Removes the application
   * and everything hanging off it. Returns false when there was nothing there.
   */
  purgeApplication(id: string): Promise<boolean>;
  /** Removes selection records whose five years are up. */
  purgeSelectionRecord(id: string): Promise<boolean>;

  /* Audit log (append-only; no delete exists) -------------------- */
  appendAudit(entry: Omit<ScholarshipAuditEntry, "id">): Promise<ScholarshipAuditEntry>;
  listAudit(limit?: number): Promise<ScholarshipAuditEntry[]>;
};

/* ------------------------------------------------------------------ *
 * Ids and references
 * ------------------------------------------------------------------ */

let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36).padStart(4, "0")}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * Applicant-facing reference. Random, so nothing about it is derived from what
 * was submitted. It is also what survives a purge, which is the other reason
 * it must carry nothing.
 */
export function newReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `SCH-${out.slice(0, 4)}-${out.slice(4)}`;
}

/* ------------------------------------------------------------------ *
 * In-memory implementation
 * ------------------------------------------------------------------ */

export class InMemoryScholarshipRepository implements ScholarshipRepository {
  private cycles: Cycle[];
  private schools: School[];
  private applications: Application[];
  private consents: GuardianConsent[];
  private relationships: ReviewerRelationship[];
  private sheets: ScoreSheet[];
  private verifications: DisabilityVerification[];
  private awards: Award[];
  private cheques: Cheque[];
  private selectionRecords: SelectionRecord[];
  private audit: ScholarshipAuditEntry[] = [];

  constructor(options?: { seed?: boolean }) {
    const seeded = options?.seed ?? true;
    this.cycles = seeded ? seedCycles().map((c) => ({ ...c })) : [];
    this.schools = seeded ? seedSchools().map((s) => ({ ...s })) : [];
    this.applications = seeded ? seedApplications().map((a) => ({ ...a })) : [];
    this.consents = seeded ? seedGuardianConsents().map((g) => ({ ...g })) : [];
    this.relationships = seeded ? seedRelationships().map((r) => ({ ...r })) : [];
    this.sheets = seeded ? seedScoreSheets().map((s) => ({ ...s })) : [];
    this.verifications = seeded ? seedVerifications().map((v) => ({ ...v })) : [];
    this.awards = seeded ? seedAwards().map((a) => ({ ...a })) : [];
    this.cheques = seeded ? seedCheques().map((c) => ({ ...c })) : [];
    this.selectionRecords = seeded ? seedSelectionRecords().map((r) => ({ ...r })) : [];
  }

  async listCycles(): Promise<Cycle[]> {
    return this.cycles.map((c) => ({ ...c }));
  }

  async getCycle(id: string): Promise<Cycle | null> {
    const found = this.cycles.find((c) => c.id === id);
    return found ? { ...found } : null;
  }

  async currentCycle(): Promise<Cycle> {
    const open = this.cycles.find((c) => c.state === "OPEN" || c.state === "PLANNED");
    const fallback = this.cycles[this.cycles.length - 1];
    const chosen = open ?? fallback;
    if (!chosen) throw new Error("No scholarship cycle is configured");
    return { ...chosen };
  }

  async listSchools(): Promise<School[]> {
    return this.schools.map((s) => ({ ...s }));
  }

  async getSchool(id: string): Promise<School | null> {
    const found = this.schools.find((s) => s.id === id);
    return found ? { ...found } : null;
  }

  async createDraft(draft: Application): Promise<Application> {
    this.applications.push({ ...draft });
    return { ...draft };
  }

  async getApplication(id: string): Promise<Application | null> {
    const found = this.applications.find((a) => a.id === id);
    return found ? structuredClone(found) : null;
  }

  async getApplicationByReference(reference: string): Promise<Application | null> {
    const found = this.applications.find((a) => a.reference === reference);
    return found ? structuredClone(found) : null;
  }

  async updateApplication(id: string, patch: Partial<Application>): Promise<Application> {
    const found = this.applications.find((a) => a.id === id);
    if (!found) throw new Error(`No application ${id}`);
    Object.assign(found, patch);
    return structuredClone(found);
  }

  async listApplications(filter?: {
    cycleId?: string;
    states?: ApplicationState[];
  }): Promise<Application[]> {
    return this.applications
      .filter((a) => (filter?.cycleId ? a.cycleId === filter.cycleId : true))
      .filter((a) => (filter?.states ? filter.states.includes(a.state) : true))
      .map((a) => structuredClone(a))
      .sort((a, b) => (a.submittedAt ?? a.createdAt).localeCompare(b.submittedAt ?? b.createdAt));
  }

  async countApplicationsByEmail(cycleId: string, email: string): Promise<number> {
    const needle = email.trim().toLowerCase();
    if (!needle) return 0;
    return this.applications.filter(
      (a) =>
        a.cycleId === cycleId &&
        a.state !== "DRAFT" &&
        a.applicant.email.trim().toLowerCase() === needle,
    ).length;
  }

  async discardDraft(id: string): Promise<void> {
    const index = this.applications.findIndex((a) => a.id === id);
    if (index >= 0) this.applications.splice(index, 1);
  }

  async createGuardianConsent(consent: GuardianConsent): Promise<GuardianConsent> {
    this.consents.push({ ...consent });
    return { ...consent };
  }

  async getGuardianConsent(id: string): Promise<GuardianConsent | null> {
    const found = this.consents.find((c) => c.id === id);
    return found ? { ...found } : null;
  }

  async getGuardianConsentForApplication(applicationId: string): Promise<GuardianConsent | null> {
    const found = this.consents.find((c) => c.applicationId === applicationId);
    return found ? { ...found } : null;
  }

  async listRelationships(reviewerPersonId?: string): Promise<ReviewerRelationship[]> {
    return this.relationships
      .filter((r) => (reviewerPersonId ? r.reviewerPersonId === reviewerPersonId : true))
      .map((r) => ({ ...r }));
  }

  async getRelationship(
    reviewerPersonId: string,
    applicationId: string,
  ): Promise<ReviewerRelationship | null> {
    const found = this.relationships.find(
      (r) => r.reviewerPersonId === reviewerPersonId && r.applicationId === applicationId,
    );
    return found ? { ...found } : null;
  }

  async declareRelationship(relationship: ReviewerRelationship): Promise<ReviewerRelationship> {
    this.relationships.push({ ...relationship });
    return { ...relationship };
  }

  async listScoreSheets(applicationId: string): Promise<ScoreSheet[]> {
    return this.sheets
      .filter((s) => s.applicationId === applicationId)
      .map((s) => structuredClone(s));
  }

  async listScoreSheetsForApplications(applicationIds: string[]): Promise<ScoreSheet[]> {
    const wanted = new Set(applicationIds);
    return this.sheets
      .filter((s) => wanted.has(s.applicationId))
      .map((s) => structuredClone(s));
  }

  async getScoreSheet(
    applicationId: string,
    reviewerPersonId: string,
  ): Promise<ScoreSheet | null> {
    const found = this.sheets.find(
      (s) => s.applicationId === applicationId && s.reviewerPersonId === reviewerPersonId,
    );
    return found ? structuredClone(found) : null;
  }

  async upsertScoreSheet(sheet: ScoreSheet): Promise<ScoreSheet> {
    const index = this.sheets.findIndex(
      (s) =>
        s.applicationId === sheet.applicationId && s.reviewerPersonId === sheet.reviewerPersonId,
    );
    if (index >= 0) this.sheets[index] = structuredClone(sheet);
    else this.sheets.push(structuredClone(sheet));
    return structuredClone(sheet);
  }

  async getVerification(applicationId: string): Promise<DisabilityVerification | null> {
    const found = this.verifications.find((v) => v.applicationId === applicationId);
    return found ? { ...found } : null;
  }

  async recordVerification(record: DisabilityVerification): Promise<DisabilityVerification> {
    const index = this.verifications.findIndex((v) => v.applicationId === record.applicationId);
    if (index >= 0) this.verifications[index] = { ...record };
    else this.verifications.push({ ...record });
    return { ...record };
  }

  async listAwards(filter?: { cycleId?: string; applicationId?: string }): Promise<Award[]> {
    return this.awards
      .filter((a) => (filter?.cycleId ? a.cycleId === filter.cycleId : true))
      .filter((a) => (filter?.applicationId ? a.applicationId === filter.applicationId : true))
      .map((a) => structuredClone(a));
  }

  async getAward(id: string): Promise<Award | null> {
    const found = this.awards.find((a) => a.id === id);
    return found ? structuredClone(found) : null;
  }

  async createAward(award: Award): Promise<Award> {
    this.awards.push(structuredClone(award));
    return structuredClone(award);
  }

  async updateAward(id: string, patch: Partial<Award>): Promise<Award> {
    const found = this.awards.find((a) => a.id === id);
    if (!found) throw new Error(`No award ${id}`);
    Object.assign(found, patch);
    return structuredClone(found);
  }

  async listCheques(cycleId?: string): Promise<Cheque[]> {
    return this.cheques
      .filter((c) => (cycleId ? c.cycleId === cycleId : true))
      .map((c) => structuredClone(c));
  }

  async getCheque(id: string): Promise<Cheque | null> {
    const found = this.cheques.find((c) => c.id === id);
    return found ? structuredClone(found) : null;
  }

  async createCheque(cheque: Cheque): Promise<Cheque> {
    this.cheques.push(structuredClone(cheque));
    return structuredClone(cheque);
  }

  async updateCheque(id: string, patch: Partial<Cheque>): Promise<Cheque> {
    const found = this.cheques.find((c) => c.id === id);
    if (!found) throw new Error(`No cheque ${id}`);
    Object.assign(found, patch);
    return structuredClone(found);
  }

  async listSelectionRecords(cycleId?: string): Promise<SelectionRecord[]> {
    return this.selectionRecords
      .filter((r) => (cycleId ? r.cycleId === cycleId : true))
      .map((r) => structuredClone(r));
  }

  async createSelectionRecord(record: SelectionRecord): Promise<SelectionRecord> {
    this.selectionRecords.push(structuredClone(record));
    return structuredClone(record);
  }

  /**
   * The purge.
   *
   * Removes the application and every record hanging off it that carries the
   * applicant's own words or details: the guardian consent with the guardian's
   * contact details, the score sheets with the reviewers' comments about them,
   * and the disability verification. The selection record is written by the
   * caller before this runs and is what remains.
   */
  async purgeApplication(id: string): Promise<boolean> {
    const index = this.applications.findIndex((a) => a.id === id);
    if (index < 0) return false;
    this.applications.splice(index, 1);
    this.consents = this.consents.filter((c) => c.applicationId !== id);
    this.sheets = this.sheets.filter((s) => s.applicationId !== id);
    this.verifications = this.verifications.filter((v) => v.applicationId !== id);
    this.relationships = this.relationships.filter((r) => r.applicationId !== id);
    return true;
  }

  async purgeSelectionRecord(id: string): Promise<boolean> {
    const index = this.selectionRecords.findIndex((r) => r.id === id);
    if (index < 0) return false;
    this.selectionRecords.splice(index, 1);
    return true;
  }

  async appendAudit(entry: Omit<ScholarshipAuditEntry, "id">): Promise<ScholarshipAuditEntry> {
    const record: ScholarshipAuditEntry = { ...entry, id: nextId("saud") };
    this.audit.push(record);
    return { ...record };
  }

  async listAudit(limit = 200): Promise<ScholarshipAuditEntry[]> {
    return this.audit.slice(-limit).reverse().map((e) => ({ ...e }));
  }
}

/* ------------------------------------------------------------------ *
 * Process-wide instance for the demo.
 *
 * Held on globalThis so a dev-server hot reload does not reset a cycle
 * mid-demo. A request-scoped Prisma client replaces this wholesale.
 * ------------------------------------------------------------------ */

const REPO_KEY = "__jsof_scholarships_repo__";
type RepoGlobal = typeof globalThis & { [REPO_KEY]?: ScholarshipRepository };

export function scholarshipRepository(): ScholarshipRepository {
  const store = globalThis as RepoGlobal;
  store[REPO_KEY] ??= new InMemoryScholarshipRepository();
  return store[REPO_KEY];
}

export function newScholarshipRepository(options?: { seed?: boolean }): ScholarshipRepository {
  return new InMemoryScholarshipRepository(options);
}

export function scholarshipEntity(): Entity {
  return "JSOF";
}
