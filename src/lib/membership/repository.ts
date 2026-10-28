/**
 * The reads and writes the membership module needs, and an in-memory
 * implementation backed by seed data.
 *
 * Persistence is deliberately deferred: swapping to Prisma later should be one
 * new file implementing this interface, with no route or service change.
 *
 * Two shapes worth noting:
 *
 *   - There is no delete method anywhere, and none for the audit log in
 *     particular. Append-only is enforced by the absence of a code path.
 *   - Nothing here authorizes. Authorization happens in the service layer
 *     above (board.ts, intake.ts, vouch.ts, payment.ts) so the decision sits
 *     in one place per workflow rather than inside the data access.
 */

import type { Entity } from "../authz/model";
import type { MembershipState } from "./state";
import { formatMemberId } from "./state";
import {
  type Application,
  type ApplicationFields,
  type CheckoutHandoff,
  type ChairDecision,
  type IntakeFlag,
  type Member,
  type MembershipAuditEntry,
  type VouchOutcome,
  type VouchRequest,
  MEMBERSHIP_ENTITY,
} from "./types";
import { seedApplications, seedMembers, seedVouchRequests } from "./seed";

export type MembershipRepository = {
  /* Applications ------------------------------------------------- */
  createDraft(fields: Partial<ApplicationFields>): Promise<Application>;
  getApplication(id: string): Promise<Application | null>;
  getApplicationByReference(reference: string): Promise<Application | null>;
  updateDraft(id: string, patch: Partial<ApplicationFields> & { step?: number }): Promise<Application>;
  /** Records the submission. Does not decide the next state; the caller does. */
  markSubmitted(
    id: string,
    input: { state: MembershipState; flags: IntakeFlag[]; vouchExpiresAt: string | null; at: string },
  ): Promise<Application>;
  setApplicationState(id: string, state: MembershipState): Promise<Application>;
  recordChairDecision(id: string, decision: ChairDecision, state: MembershipState): Promise<Application>;
  listApplications(states?: MembershipState[]): Promise<Application[]>;
  countApplicationsByEmail(email: string): Promise<number>;
  /**
   * Give an item to a named reviewer, or take it back with a null reviewer.
   *
   * Overwrites `assigned_to`. That is deliberate and it is not the record: the
   * assignment history lives in the append-only audit log, written by the
   * caller in `board.ts`, because there is exactly one current holder and a
   * queue that joined to a history table for every row would be a join nobody
   * reads.
   */
  assignApplication(
    id: string,
    reviewerPersonId: string | null,
    at: string | null,
  ): Promise<Application>;

  /* Vouch -------------------------------------------------------- */
  createVouchRequest(request: VouchRequest): Promise<VouchRequest>;
  getVouchRequest(token: string): Promise<VouchRequest | null>;
  getVouchRequestForApplication(applicationId: string): Promise<VouchRequest | null>;
  answerVouchRequest(token: string, outcome: VouchOutcome, at: string): Promise<VouchRequest>;
  /** Every request whose window has closed without an answer. */
  listLapsedVouchRequests(now: string): Promise<VouchRequest[]>;

  /* Roster ------------------------------------------------------- */
  listMembers(): Promise<Member[]>;
  getMember(id: string): Promise<Member | null>;
  getMemberByMemberId(memberId: string): Promise<Member | null>;
  /**
   * By roster address. `member.email` is indexed and NOT unique, so this
   * answers "is this address already on the roster" and deliberately does not
   * pretend an address identifies one human: a shared family mailbox is
   * normal in this population. The first match in roster order is returned.
   */
  getMemberByEmail(email: string): Promise<Member | null>;
  /** The roster record belonging to a signed-in person. E28's whole join. */
  getMemberByPersonId(personId: string): Promise<Member | null>;
  createMember(member: Omit<Member, "id" | "memberId"> & { memberId?: string }): Promise<Member>;
  setMemberState(id: string, state: MembershipState, auditedAt?: string): Promise<Member>;
  /**
   * Correct the two contact fields, and nothing else.
   *
   * Narrow on purpose. Name, category, service dates, standing and sponsor are
   * not reachable from here: they are the compliance fields the composition
   * report counts, and a method that could write any column would be the method
   * somebody used to fix a standing without a decision behind it.
   *
   * `personEmail` asks for the identity row to be updated in the same
   * transaction when the member holds an account. Both or neither: a member
   * whose roster address changed and whose sign-in address did not is a member
   * who cannot sign in.
   */
  updateMemberContact(
    id: string,
    patch: { email?: string; phone?: string },
    options?: { alsoPersonEmail?: boolean },
  ): Promise<Member>;
  nextMemberId(year: number): Promise<string>;

  /* Payment handoff --------------------------------------------- */
  createCheckoutHandoff(handoff: CheckoutHandoff): Promise<CheckoutHandoff>;
  getCheckoutHandoff(id: string): Promise<CheckoutHandoff | null>;
  getCheckoutHandoffForApplication(applicationId: string): Promise<CheckoutHandoff | null>;
  markCheckoutCleared(id: string): Promise<CheckoutHandoff>;

  /* Audit log (append-only; no delete exists) -------------------- */
  appendAudit(entry: Omit<MembershipAuditEntry, "id">): Promise<MembershipAuditEntry>;
  listAudit(limit?: number): Promise<MembershipAuditEntry[]>;
};

/* ------------------------------------------------------------------ *
 * In-memory implementation
 * ------------------------------------------------------------------ */

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36).padStart(4, "0")}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * Applicant-facing reference. Random, so nothing about it is derived from what
 * was submitted: a reference that encoded the sponsor's validity would be the
 * leak the identical acknowledgment exists to prevent.
 */
export function newReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export function newVouchToken(): string {
  // 32 hex characters. Unguessable, and it is the whole authentication for the
  // vouch page, so nothing shorter will do.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const EMPTY_FIELDS: ApplicationFields = {
  applicantName: "",
  email: "",
  phone: "",
  membershipCategory: null,
  qualifyingRelationship: null,
  serviceFrom: null,
  serviceTo: null,
  attestedWarVeteran: false,
  isAugmentee: false,
  sponsorMemberId: "",
};

export class InMemoryMembershipRepository implements MembershipRepository {
  private applications: Application[];
  private vouchRequests: VouchRequest[];
  private members: Member[];
  private handoffs: CheckoutHandoff[] = [];
  private audit: MembershipAuditEntry[] = [];

  constructor(options?: { seed?: boolean }) {
    const seeded = options?.seed ?? true;
    this.members = seeded ? seedMembers().map((m) => ({ ...m })) : [];
    this.applications = seeded ? seedApplications().map((a) => ({ ...a })) : [];
    this.vouchRequests = seeded ? seedVouchRequests().map((v) => ({ ...v })) : [];
  }

  private requireApplication(id: string): Application {
    const found = this.applications.find((a) => a.id === id);
    if (!found) throw new Error(`No application ${id}`);
    return found;
  }

  async createDraft(fields: Partial<ApplicationFields>): Promise<Application> {
    const now = new Date().toISOString();
    const application: Application = {
      ...EMPTY_FIELDS,
      ...fields,
      id: nextId("app"),
      entity: MEMBERSHIP_ENTITY,
      state: "DRAFT",
      reference: newReference(),
      createdAt: now,
      submittedAt: null,
      step: 1,
      vouchExpiresAt: null,
      flags: [],
      chairDecision: null,
      convertedMemberId: null,
      assignedTo: null,
      assignedAt: null,
    };
    this.applications.push(application);
    return { ...application };
  }

  async getApplication(id: string): Promise<Application | null> {
    const found = this.applications.find((a) => a.id === id);
    return found ? { ...found } : null;
  }

  async getApplicationByReference(reference: string): Promise<Application | null> {
    const found = this.applications.find((a) => a.reference === reference);
    return found ? { ...found } : null;
  }

  async updateDraft(
    id: string,
    patch: Partial<ApplicationFields> & { step?: number },
  ): Promise<Application> {
    const application = this.requireApplication(id);
    Object.assign(application, patch);
    return { ...application };
  }

  async markSubmitted(
    id: string,
    input: { state: MembershipState; flags: IntakeFlag[]; vouchExpiresAt: string | null; at: string },
  ): Promise<Application> {
    const application = this.requireApplication(id);
    application.state = input.state;
    application.flags = [...input.flags];
    application.vouchExpiresAt = input.vouchExpiresAt;
    application.submittedAt = input.at;
    return { ...application };
  }

  async setApplicationState(id: string, state: MembershipState): Promise<Application> {
    const application = this.requireApplication(id);
    application.state = state;
    return { ...application };
  }

  async recordChairDecision(
    id: string,
    decision: ChairDecision,
    state: MembershipState,
  ): Promise<Application> {
    const application = this.requireApplication(id);
    application.chairDecision = decision;
    application.state = state;
    return { ...application };
  }

  async listApplications(states?: MembershipState[]): Promise<Application[]> {
    const rows = states
      ? this.applications.filter((a) => states.includes(a.state))
      : [...this.applications];
    return rows
      .map((a) => ({ ...a }))
      .sort((a, b) => (a.submittedAt ?? a.createdAt).localeCompare(b.submittedAt ?? b.createdAt));
  }

  async assignApplication(
    id: string,
    reviewerPersonId: string | null,
    at: string | null,
  ): Promise<Application> {
    const application = this.requireApplication(id);
    application.assignedTo = reviewerPersonId;
    application.assignedAt = reviewerPersonId ? at : null;
    return { ...application };
  }

  async countApplicationsByEmail(email: string): Promise<number> {
    const needle = email.trim().toLowerCase();
    if (!needle) return 0;
    return this.applications.filter(
      (a) => a.email.trim().toLowerCase() === needle && a.state !== "DRAFT",
    ).length;
  }

  async createVouchRequest(request: VouchRequest): Promise<VouchRequest> {
    this.vouchRequests.push({ ...request });
    return { ...request };
  }

  async getVouchRequest(token: string): Promise<VouchRequest | null> {
    const found = this.vouchRequests.find((v) => v.token === token);
    return found ? { ...found } : null;
  }

  async getVouchRequestForApplication(applicationId: string): Promise<VouchRequest | null> {
    const found = this.vouchRequests.find((v) => v.applicationId === applicationId);
    return found ? { ...found } : null;
  }

  async answerVouchRequest(token: string, outcome: VouchOutcome, at: string): Promise<VouchRequest> {
    const found = this.vouchRequests.find((v) => v.token === token);
    if (!found) throw new Error("No vouch request for that token");
    found.outcome = outcome;
    found.answeredAt = at;
    return { ...found };
  }

  async listLapsedVouchRequests(now: string): Promise<VouchRequest[]> {
    return this.vouchRequests
      .filter((v) => v.answeredAt === null && v.expiresAt <= now)
      .map((v) => ({ ...v }));
  }

  async listMembers(): Promise<Member[]> {
    return this.members.map((m) => ({ ...m }));
  }

  async getMember(id: string): Promise<Member | null> {
    const found = this.members.find((m) => m.id === id);
    return found ? { ...found } : null;
  }

  async getMemberByMemberId(memberId: string): Promise<Member | null> {
    const needle = memberId.trim().toUpperCase();
    const found = this.members.find((m) => m.memberId === needle);
    return found ? { ...found } : null;
  }

  async getMemberByEmail(email: string): Promise<Member | null> {
    const needle = email.trim().toLowerCase();
    if (!needle) return null;
    const found = this.members.find((m) => m.email.trim().toLowerCase() === needle);
    return found ? { ...found } : null;
  }

  async getMemberByPersonId(personId: string): Promise<Member | null> {
    if (!personId) return null;
    const found = this.members.find((m) => m.personId === personId);
    return found ? { ...found } : null;
  }

  async nextMemberId(year: number): Promise<string> {
    const prefix = `JSOA-${year}-`;
    const used = this.members
      .filter((m) => m.memberId.startsWith(prefix))
      .map((m) => Number(m.memberId.slice(prefix.length)))
      .filter((n) => Number.isFinite(n));
    const sequence = (used.length ? Math.max(...used) : 0) + 1;
    return formatMemberId(year, sequence);
  }

  async createMember(
    member: Omit<Member, "id" | "memberId"> & { memberId?: string },
  ): Promise<Member> {
    const year = Number(member.joinedAt.slice(0, 4));
    const record: Member = {
      ...member,
      id: nextId("mbr"),
      memberId: member.memberId ?? (await this.nextMemberId(year)),
    };
    this.members.push(record);
    if (record.applicationId) {
      const application = this.applications.find((a) => a.id === record.applicationId);
      if (application) application.convertedMemberId = record.id;
    }
    return { ...record };
  }

  async setMemberState(id: string, state: MembershipState, auditedAt?: string): Promise<Member> {
    const found = this.members.find((m) => m.id === id);
    if (!found) throw new Error(`No member ${id}`);
    found.state = state;
    if (auditedAt) found.lastAuditedAt = auditedAt;
    if (found.applicationId) {
      const application = this.applications.find((a) => a.id === found.applicationId);
      if (application) application.state = state;
    }
    return { ...found };
  }

  /**
   * The in-memory store has no `person` table, so `alsoPersonEmail` has
   * nothing to write and is accepted and ignored. The D1 implementation does
   * both tables in one batch, and that is the one that matters: a service that
   * passes the flag here and relies on it is a service that only works against
   * the database, which is exactly the divergence `tests/d1.test.ts` exists to
   * catch. `correctMemberContact` therefore refuses an email change for a
   * linked member when there is no identity store to keep in step.
   */
  async updateMemberContact(
    id: string,
    patch: { email?: string; phone?: string },
  ): Promise<Member> {
    const found = this.members.find((m) => m.id === id);
    if (!found) throw new Error(`No member ${id}`);
    if (patch.email !== undefined) found.email = patch.email.trim();
    if (patch.phone !== undefined) found.phone = patch.phone.trim();
    return { ...found };
  }

  async createCheckoutHandoff(handoff: CheckoutHandoff): Promise<CheckoutHandoff> {
    this.handoffs.push({ ...handoff });
    return { ...handoff };
  }

  async getCheckoutHandoff(id: string): Promise<CheckoutHandoff | null> {
    const found = this.handoffs.find((h) => h.id === id);
    return found ? { ...found } : null;
  }

  async getCheckoutHandoffForApplication(applicationId: string): Promise<CheckoutHandoff | null> {
    const found = [...this.handoffs]
      .reverse()
      .find((h) => h.applicationId === applicationId);
    return found ? { ...found } : null;
  }

  async markCheckoutCleared(id: string): Promise<CheckoutHandoff> {
    const found = this.handoffs.find((h) => h.id === id);
    if (!found) throw new Error(`No checkout handoff ${id}`);
    found.status = "CLEARED";
    return { ...found };
  }

  async appendAudit(entry: Omit<MembershipAuditEntry, "id">): Promise<MembershipAuditEntry> {
    const record: MembershipAuditEntry = { ...entry, id: nextId("aud") };
    this.audit.push(record);
    return { ...record };
  }

  async listAudit(limit = 200): Promise<MembershipAuditEntry[]> {
    return this.audit.slice(-limit).reverse().map((e) => ({ ...e }));
  }
}

/* ------------------------------------------------------------------ *
 * Choosing an implementation
 *
 * D1 when there is a binding, in memory when there is not. The second case is
 * normal rather than a failure: `next dev` with no Worker behind it has no
 * binding, and the test suite has no Worker at all.
 *
 * Why this is resolved lazily, through a dynamic import, when a one-line
 * `import { database } from "../db"` would read better.
 *
 * `src/lib/db` begins with `import "server-only"`, which does not resolve
 * outside the Next build. This file is on the import graph of every module
 * test, so a static import of the D1 repository takes the whole suite down at
 * collection time with "Cannot find package 'server-only'" — before a single
 * assertion runs. The import therefore happens inside the call, where a failure
 * to resolve means "there is no server runtime here", which is exactly the case
 * in which the in-memory roster is the right answer anyway.
 *
 * A correction to the paragraph above, which was true when it was written and
 * is now only half true: `vitest.config.ts` aliases `server-only` to a no-op,
 * so a static import of a server-only module no longer kills the suite, and
 * `notify.ts`, `board.ts` and `account.ts` all import one statically. The
 * dynamic import here is kept for the OTHER reason, which still holds and is
 * the load-bearing one: the binding has to be re-checked on every call, so the
 * decision cannot be made at module load whatever the import style.
 *
 * The consequence is that the accessor cannot know which implementation it has
 * until the first method is called, so it returns a delegate: each method
 * resolves and forwards. Every method on this interface already returns a
 * Promise, which is what makes that possible without changing a signature.
 * ------------------------------------------------------------------ */

const REPO_KEY = "__jsoa_membership_repo__";

type RepoGlobal = typeof globalThis & { [REPO_KEY]?: MembershipRepository };

/**
 * The in-memory fallback, held on globalThis so a dev-server hot reload does
 * not silently reset the roster mid-demo.
 */
function inMemoryRepository(): MembershipRepository {
  const store = globalThis as RepoGlobal;
  store[REPO_KEY] ??= new InMemoryMembershipRepository();
  return store[REPO_KEY];
}

/**
 * The binding is checked on every call rather than cached.
 *
 * A render during `next build` runs outside a request context and so sees no
 * binding. Caching that answer would pin the deployed Worker to seed data for
 * the life of the isolate, and the symptom — a roster that is right in
 * development and stale in production — is a long way from the cause.
 *
 * The module import itself is cached by the module system, so the cost after
 * the first call is an already-resolved promise.
 */
async function resolveRepository(): Promise<MembershipRepository> {
  try {
    const { d1MembershipRepositoryIfBound } = await import("./repository.d1");
    const d1 = d1MembershipRepositoryIfBound();
    if (d1) return d1;
  } catch {
    // No server runtime: a test, or a context where `server-only` does not
    // resolve. In-memory is the answer, not an error.
  }
  return inMemoryRepository();
}

/**
 * One delegate, not one per call: the accessor used to return a stable object
 * and some caller may yet rely on that. It holds no state of its own — every
 * method resolves afresh — so sharing it is free.
 */
const DELEGATE: MembershipRepository = {
  createDraft: async (fields) => (await resolveRepository()).createDraft(fields),
  getApplication: async (id) => (await resolveRepository()).getApplication(id),
  getApplicationByReference: async (reference) =>
    (await resolveRepository()).getApplicationByReference(reference),
  updateDraft: async (id, patch) => (await resolveRepository()).updateDraft(id, patch),
  markSubmitted: async (id, input) => (await resolveRepository()).markSubmitted(id, input),
  setApplicationState: async (id, state) =>
    (await resolveRepository()).setApplicationState(id, state),
  recordChairDecision: async (id, decision, state) =>
    (await resolveRepository()).recordChairDecision(id, decision, state),
  listApplications: async (states) => (await resolveRepository()).listApplications(states),
  countApplicationsByEmail: async (email) =>
    (await resolveRepository()).countApplicationsByEmail(email),
  assignApplication: async (id, reviewerPersonId, at) =>
    (await resolveRepository()).assignApplication(id, reviewerPersonId, at),

  createVouchRequest: async (request) =>
    (await resolveRepository()).createVouchRequest(request),
  getVouchRequest: async (token) => (await resolveRepository()).getVouchRequest(token),
  getVouchRequestForApplication: async (applicationId) =>
    (await resolveRepository()).getVouchRequestForApplication(applicationId),
  answerVouchRequest: async (token, outcome, at) =>
    (await resolveRepository()).answerVouchRequest(token, outcome, at),
  listLapsedVouchRequests: async (at) =>
    (await resolveRepository()).listLapsedVouchRequests(at),

  listMembers: async () => (await resolveRepository()).listMembers(),
  getMember: async (id) => (await resolveRepository()).getMember(id),
  getMemberByMemberId: async (memberId) =>
    (await resolveRepository()).getMemberByMemberId(memberId),
  getMemberByEmail: async (email) => (await resolveRepository()).getMemberByEmail(email),
  getMemberByPersonId: async (personId) =>
    (await resolveRepository()).getMemberByPersonId(personId),
  createMember: async (member) => (await resolveRepository()).createMember(member),
  setMemberState: async (id, state, auditedAt) =>
    (await resolveRepository()).setMemberState(id, state, auditedAt),
  updateMemberContact: async (id, patch, options) =>
    (await resolveRepository()).updateMemberContact(id, patch, options),
  nextMemberId: async (year) => (await resolveRepository()).nextMemberId(year),

  createCheckoutHandoff: async (handoff) =>
    (await resolveRepository()).createCheckoutHandoff(handoff),
  getCheckoutHandoff: async (id) => (await resolveRepository()).getCheckoutHandoff(id),
  getCheckoutHandoffForApplication: async (applicationId) =>
    (await resolveRepository()).getCheckoutHandoffForApplication(applicationId),
  markCheckoutCleared: async (id) => (await resolveRepository()).markCheckoutCleared(id),

  appendAudit: async (entry) => (await resolveRepository()).appendAudit(entry),
  listAudit: async (limit) => (await resolveRepository()).listAudit(limit),
};

export function membershipRepository(): MembershipRepository {
  return DELEGATE;
}

export function newMembershipRepository(options?: { seed?: boolean }): MembershipRepository {
  return new InMemoryMembershipRepository(options);
}

export function newMembershipEntityRef(): Entity {
  return MEMBERSHIP_ENTITY;
}
