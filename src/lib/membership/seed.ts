/**
 * Seed data. Fictional, and clearly so: none of these are the real board.
 *
 * The roster is shaped to make the composition report say something true and
 * uncomfortable rather than to make it show three green ticks:
 *
 *   40 members counted (PROBATIONARY + GOOD_STANDING)
 *     35 past or present armed forces      ->  87.5%  passes the 75% test
 *     39 members, cadets or relatives      ->  97.5%  passes at exactly the line
 *     33 war veterans                      ->  82.5%  FAILS the 90% test
 *
 * The third figure is the point. The 90% war-veteran test is measured against
 * the whole membership, so every cadet, spouse and non-qualifying member
 * counts against it. A roster comfortably exempt under 501(c)(19) can still be
 * a roster where gifts to the Association are not deductible, and the board
 * needs to see that rather than discover it in a letter.
 *
 * Three further member records sit in LAPSED and REVOKED and are excluded from
 * the denominator, which is what makes the 97.5% line land exactly on the
 * threshold rather than a rounding argument.
 */

import { deriveIsWarVeteran } from "./wartime";
import type { MembershipState } from "./state";
import { VOUCH_WINDOW_HOURS } from "./state";
import {
  type Application,
  type Member,
  type MembershipCategory,
  type QualifyingRelationship,
  type VouchRequest,
  MEMBERSHIP_ENTITY,
} from "./types";

const SEED_EPOCH = Date.now();

function daysAgo(days: number): string {
  return new Date(SEED_EPOCH - days * 86_400_000).toISOString();
}

function hoursFromNow(hours: number): string {
  return new Date(SEED_EPOCH + hours * 3_600_000).toISOString();
}

type Row = {
  name: string;
  /** Defaults to VETERAN, which is most of the roster. */
  category?: MembershipCategory;
  relation?: QualifyingRelationship;
  from?: string;
  to?: string;
  /** Only set when it disagrees with the derived value; otherwise derived. */
  attests?: boolean;
  state?: MembershipState;
  /** Days since dues cleared. Drives the 30-day audit cohort. */
  paidDaysAgo?: number;
  audited?: boolean;
};

/* Wartime-service veterans. Dates land inside a statutory wartime period, most
   of them inside the Persian Gulf period, which has never been terminated. */
const WARTIME_VETERANS: Row[] = [
  { name: "Marcus Ivey", from: "1990-06-15", to: "2012-07-31" },
  { name: "Dwayne Halloran", from: "1988-01-04", to: "2009-01-31" },
  { name: "Theodore Grissom", from: "1966-09-12", to: "1988-10-31" },
  { name: "Ramona Kessler", from: "1991-03-18", to: "2014-03-31" },
  { name: "Ellis Thackeray", from: "1998-07-06", to: "2020-08-31" },
  { name: "Porter Vandermeer", from: "2001-10-01", to: "2023-11-30" },
  { name: "Cyrus Abernathy", from: "1969-02-10", to: "1991-03-31" },
  { name: "Lavelle Brantley", from: "1994-05-23", to: "2016-06-30" },
  { name: "Ingrid Sallinen", from: "2003-01-13", to: "2024-02-29" },
  { name: "Hollis Tremaine", from: "1992-08-17", to: "2013-09-30" },
  { name: "Benedict Okoro", from: "1996-11-04", to: "2018-12-31" },
  { name: "Rosalind Fairweather", from: "2005-06-20", to: "2025-07-31" },
  { name: "Augustin Peralta", from: "1971-04-05", to: "1993-05-31" },
  { name: "Delphine Moreau", from: "1999-09-27", to: "2021-10-31" },
  { name: "Sterling Ashcroft", from: "1993-02-08", to: "2015-03-31" },
  { name: "Corwin Blackwood", from: "2000-05-15", to: "2022-06-30" },
  { name: "Imelda Castellanos", from: "1997-03-24", to: "2019-04-30" },
  { name: "Rufus Pendergast", from: "1968-07-19", to: "1990-08-31" },
  { name: "Antonia Vasquez-Reed", from: "2002-08-12", to: "2023-09-30" },
  { name: "Gideon Marchetti", from: "1995-12-02", to: "2017-01-31" },
  { name: "Persephone Walcott", from: "2004-04-26", to: "2024-05-31" },
  { name: "Lucius Farnsworth", from: "1991-10-14", to: "2012-11-30" },
  { name: "Clementine Oyelaran", from: "2006-02-06", to: "2026-03-31" },
  { name: "Barnaby Threlkeld", from: "1990-08-02", to: "2011-09-30" },
  { name: "Seraphina Dunmore", from: "1998-01-19", to: "2019-02-28" },
  { name: "Osgood Rennicke", from: "1967-05-08", to: "1989-06-30" },
  { name: "Mirabel Anastos", from: "2007-07-23", to: "2026-08-31" },
  { name: "Wendell Fitzhugh", from: "1994-09-11", to: "2015-10-31" },
  { name: "Lysandra Kovalenko", from: "2001-03-05", to: "2022-04-30" },
  { name: "Thaddeus Mbeki", from: "1996-06-17", to: "2017-07-31" },
  { name: "Oriana Delacroix", from: "2008-11-10", to: "2026-09-01" },
  { name: "Horace Wimbledon", from: "1992-04-21", to: "2013-05-31" },
  { name: "Calliope Strand", from: "1999-12-08", to: "2021-01-31" },
];

/* Peacetime-only service: still armed forces, so the 75% test counts them; no
   wartime period touches their dates, so the 90% test does not. This one also
   ticked the war-veteran box, which is a record to correct, not a number to
   adjust. */
const PEACETIME_VETERANS: Row[] = [
  { name: "Franklin Underhill", from: "1978-06-01", to: "1984-05-31", attests: true },
];

/* A veteran record with no service dates at all. Counts toward 75% on its
   declared category, cannot count toward 90%, and shows on the report as a
   record to fix. */
const INCOMPLETE_VETERANS: Row[] = [
  { name: "Bernadette Quiller", attests: true },
];

const OTHER_CATEGORIES: Row[] = [
  { name: "Silas Rutherford", category: "CADET" },
  { name: "Juno Whitlock", category: "CADET" },
  { name: "Adaeze Okonjo", category: "QUALIFYING_RELATIVE", relation: "SPOUSE" },
  { name: "Emrys Llewellyn", category: "QUALIFYING_RELATIVE", relation: "LINEAL_DESCENDANT" },
  { name: "Godfrey Ashworth", category: "NON_QUALIFYING" },
];

/* Excluded from the denominator: no longer holding member access. */
const OFF_ROSTER: Row[] = [
  { name: "Percival Hightower", from: "1993-01-11", to: "2014-02-28", state: "LAPSED" },
  { name: "Winifred Oduya", from: "2000-07-04", to: "2021-08-31", state: "LAPSED" },
  { name: "Cassius Rearden", from: "1997-05-16", to: "2018-06-30", state: "REVOKED" },
];

/**
 * Four of the counted members sit in PROBATIONARY. Two of them cleared dues
 * more than thirty days ago and so fall into the audit cohort; two are inside
 * the window. Probationary and good standing grant identical access, so this
 * is bookkeeping, not a tier.
 */
const PROBATIONARY_ASSIGNMENTS: Record<string, { paidDaysAgo: number; audited?: boolean }> = {
  "Clementine Oyelaran": { paidDaysAgo: 41 },
  "Mirabel Anastos": { paidDaysAgo: 34 },
  "Oriana Delacroix": { paidDaysAgo: 12 },
  "Persephone Walcott": { paidDaysAgo: 3 },
};

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.|\.$/g, "");
}

function phoneFor(index: number): string {
  // 555 exchange, so nothing here can ring a real person.
  return `(910) 555-${String(1000 + index).slice(-4)}`;
}

export function seedMembers(): Member[] {
  const rows: Row[] = [
    ...WARTIME_VETERANS,
    ...PEACETIME_VETERANS,
    ...INCOMPLETE_VETERANS,
    ...OTHER_CATEGORIES,
    ...OFF_ROSTER,
  ];

  const sequenceByYear = new Map<number, number>();
  const members: Member[] = [];

  rows.forEach((row, index) => {
    const category: MembershipCategory = row.category ?? "VETERAN";
    const from = row.from ?? null;
    const to = row.to ?? null;
    const isWarVeteran = deriveIsWarVeteran(from, to);

    const probation = PROBATIONARY_ASSIGNMENTS[row.name];
    const state: MembershipState = row.state ?? (probation ? "PROBATIONARY" : "GOOD_STANDING");

    // Long-standing members joined across a spread of years; the probationary
    // cohort joined when their dues cleared.
    const joinedAt = probation
      ? daysAgo(probation.paidDaysAgo)
      : daysAgo(400 + index * 57);
    const year = Number(joinedAt.slice(0, 4));
    const sequence = (sequenceByYear.get(year) ?? 0) + 1;
    sequenceByYear.set(year, sequence);

    members.push({
      id: `seed-mbr-${String(index + 1).padStart(3, "0")}`,
      entity: MEMBERSHIP_ENTITY,
      memberId: `JSOA-${year}-${String(sequence).padStart(4, "0")}`,
      // No seeded member holds an account. That is the real roster's state
      // too: these records predate the platform, so their accounts are an
      // invitation somebody has to send rather than something the seed can
      // assert. A member created through `clearDues` gets one.
      personId: null,
      displayName: row.name,
      email: `${slug(row.name)}@example.org`,
      phone: phoneFor(index),
      membershipCategory: category,
      qualifyingRelationship: row.relation ?? null,
      serviceFrom: from,
      serviceTo: to,
      isWarVeteran,
      attestedWarVeteran: row.attests ?? isWarVeteran,
      state,
      sponsorMemberId: index === 0 ? null : `JSOA-${year}-0001`,
      joinedAt,
      paymentClearedAt: joinedAt,
      lastAuditedAt: state === "GOOD_STANDING" ? daysAgo(360 + index) : null,
      applicationId: null,
    });
  });

  return members;
}

/**
 * A known-good sponsor ID for the demo, so the vouch flow can be walked
 * end to end without reading the roster first. The intake never confirms it.
 */
export function seedSponsorMemberId(): string {
  return seedMembers()[0].memberId;
}

/* ------------------------------------------------------------------ *
 * In-flight applications, so the board queues are not empty.
 * ------------------------------------------------------------------ */

/** Placeholder in the table below, swapped for a live roster ID at build time. */
const REAL_SPONSOR = "JSOA-2024-0001";

type AppRow = {
  id: string;
  name: string;
  state: MembershipState;
  submittedDaysAgo: number;
  category: MembershipCategory;
  relation?: QualifyingRelationship;
  from?: string;
  to?: string;
  augmentee?: boolean;
  sponsor: string;
  flags?: Application["flags"];
  vouchInHours?: number;
  vouchExpiredDaysAgo?: number;
};

const APPLICATION_ROWS: AppRow[] = [
  {
    id: "seed-app-001",
    name: "Nathaniel Braddock",
    state: "AWAITING_VOUCH",
    submittedDaysAgo: 1,
    category: "VETERAN",
    from: "2004-02-16",
    to: "2025-03-31",
    sponsor: "JSOA-2024-0001",
    vouchInHours: 48,
  },
  {
    id: "seed-app-002",
    name: "Yolanda Prescott",
    state: "AWAITING_VOUCH",
    submittedDaysAgo: 2,
    category: "QUALIFYING_RELATIVE",
    relation: "SPOUSE",
    sponsor: "JSOA-2024-0001",
    vouchInHours: 20,
  },
  {
    id: "seed-app-003",
    name: "Ignatius Pemberton",
    state: "CHAIR_QUEUE",
    submittedDaysAgo: 5,
    category: "VETERAN",
    from: "1995-08-08",
    to: "2016-09-30",
    augmentee: true,
    sponsor: "JSOA-2024-0001",
    flags: ["AUGMENTEE"],
  },
  {
    id: "seed-app-004",
    name: "Marguerite Ashby",
    // The window has already closed on this one. It is left in AWAITING_VOUCH
    // so the queue's sweep has something real to move, which is the path an
    // application with an unreachable sponsor takes.
    state: "AWAITING_VOUCH",
    submittedDaysAgo: 6,
    category: "VETERAN",
    from: "1999-04-12",
    to: "2020-05-31",
    sponsor: "JSOA-2011-0004",
    flags: ["SPONSOR_NOT_ON_ROSTER"],
    vouchExpiredDaysAgo: 3,
  },
  {
    id: "seed-app-005",
    name: "Desmond Fairbairn",
    state: "CHAIR_QUEUE",
    submittedDaysAgo: 8,
    category: "NON_QUALIFYING",
    sponsor: "JSOA-2024-0001",
    flags: ["NON_QUALIFYING_CATEGORY", "DUPLICATE_EMAIL"],
  },
  {
    id: "seed-app-006",
    name: "Beatrix Lunderman",
    state: "AWAITING_PAYMENT",
    submittedDaysAgo: 4,
    category: "VETERAN",
    from: "2006-01-09",
    to: "2026-02-28",
    sponsor: "JSOA-2024-0001",
  },
  {
    id: "seed-app-007",
    name: "Orrin Kaczmarek",
    state: "DECLINED",
    submittedDaysAgo: 22,
    category: "NON_QUALIFYING",
    sponsor: "JSOA-2024-0001",
  },
];

export function seedApplications(): Application[] {
  // The demo applications name a sponsor who is really on the roster, except
  // the one that deliberately does not: an application whose sponsor ID
  // matches nobody has to sit in AWAITING_VOUCH like every other, and be
  // picked up by the sweep, or the intake would be routing on sponsor
  // validity after all.
  const realSponsor = seedSponsorMemberId();
  return APPLICATION_ROWS.map((row, index) => {
    const from = row.from ?? null;
    const to = row.to ?? null;
    return {
      id: row.id,
      entity: MEMBERSHIP_ENTITY,
      state: row.state,
      reference: `SEED-${String(index + 1).padStart(4, "0")}`,
      createdAt: daysAgo(row.submittedDaysAgo),
      submittedAt: daysAgo(row.submittedDaysAgo),
      step: 4,
      vouchExpiresAt:
        row.vouchInHours !== undefined
          ? hoursFromNow(row.vouchInHours)
          : row.vouchExpiredDaysAgo !== undefined
            ? daysAgo(row.vouchExpiredDaysAgo)
            : null,
      flags: row.flags ?? [],
      chairDecision:
        row.state === "DECLINED"
          ? {
              at: daysAgo(row.submittedDaysAgo - 4),
              chairPersonId: "dev-vp-membership",
              outcome: "DENIED" as const,
              reason: "No qualifying category and no sponsor able to vouch.",
            }
          : null,
      convertedMemberId: null,
      // Nothing is seeded as assigned, which is the state the office is
      // actually in: assignment did not exist, so every item in the chair
      // queue is unheld. The queue flags the ones that have been unheld
      // longest, and the seed is what makes that visible on first load.
      assignedTo: null,
      assignedAt: null,
      applicantName: row.name,
      email: `${slug(row.name)}@example.org`,
      phone: phoneFor(200 + index),
      membershipCategory: row.category,
      qualifyingRelationship: row.relation ?? null,
      serviceFrom: from,
      serviceTo: to,
      attestedWarVeteran: deriveIsWarVeteran(from, to),
      isAugmentee: row.augmentee ?? false,
      sponsorMemberId: row.sponsor === REAL_SPONSOR ? realSponsor : row.sponsor,
    };
  });
}

/**
 * One open request inside the window and one already past it. The lapsed one is
 * there so the board queue's sweep has something to move to the chair, which is
 * how an application with an unreachable sponsor gets picked up: it waits out
 * the window like every other, rather than being routed differently at intake.
 */
export function seedVouchRequests(): VouchRequest[] {
  const realSponsor = seedSponsorMemberId();
  return [
    {
      token: "0f2c7a1b9d4e6f8012345678abcdef01",
      applicationId: "seed-app-001",
      sponsorMemberId: realSponsor,
      createdAt: daysAgo(1),
      expiresAt: hoursFromNow(VOUCH_WINDOW_HOURS - 24),
      answeredAt: null,
      outcome: null,
      deliverable: true,
    },
    {
      token: "1a3b5c7d9e0f24681357924680acebdf",
      applicationId: "seed-app-002",
      sponsorMemberId: realSponsor,
      createdAt: daysAgo(2),
      expiresAt: hoursFromNow(20),
      answeredAt: null,
      outcome: null,
      deliverable: true,
    },
    {
      token: "2b4d6f8a0c1e35792468013579bdface",
      applicationId: "seed-app-004",
      sponsorMemberId: "JSOA-2011-0004",
      createdAt: daysAgo(6),
      expiresAt: daysAgo(3),
      answeredAt: null,
      outcome: null,
      deliverable: false,
    },
  ];
}
