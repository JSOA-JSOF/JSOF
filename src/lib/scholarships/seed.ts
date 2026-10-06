/**
 * Seed data. Fictional, and clearly so: none of these are real applicants,
 * real schools or the real board.
 *
 * The shape of the cycle is not invented. It is the Scholarships Chair's own
 * account of the last one:
 *
 *   150 applications
 *   119 Merit awards, $500 to $2,500, with one top winner at $5,000
 *    64 Wounded Patriot awards, a flat amount to everyone who qualifies
 *
 * An applicant may hold both, one, or neither, so the two decisions are
 * generated independently and the overlap falls out rather than being set.
 *
 * The score distribution is built from a histogram rather than from a random
 * draw, so that 119 of the 144 scored applications land at or above the Merit
 * floor every time the seed is read. A demo whose headline figure moves
 * between page loads is a demo nobody trusts.
 *
 * Dates are relative to the demo's clock, as the membership seed's are, so the
 * review queue and the cheque run are populated whenever this is run. The real
 * cycle opens in the middle of December 2026.
 */

import { GUARDIAN_CONSENT_STATEMENT_VERSION } from "./minors";
import { decideRouting } from "./routing";
import {
  MERIT_BANDS,
  SCORING_CRITERIA,
  TOP_WINNER,
  WOUNDED_PATRIOT,
  sheetTotal,
} from "./scoring";
import { ELIGIBILITY_RULE } from "./eligibility";
import {
  type Application,
  type ApplicationState,
  type Award,
  type Cheque,
  type CriterionKey,
  type Cycle,
  type DisabilityVerification,
  type GuardianConsent,
  type ReviewerRelationship,
  type School,
  type ScoreSheet,
  type SelectionRecord,
  SCHOLARSHIP_CURRENCY,
  SCHOLARSHIP_ENTITY,
} from "./types";

const SEED_EPOCH = Date.now();

function daysAgo(days: number): string {
  return new Date(SEED_EPOCH - days * 86_400_000).toISOString();
}

function daysAhead(days: number): string {
  return new Date(SEED_EPOCH + days * 86_400_000).toISOString();
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Deterministic pseudo-randomness. A seeded linear congruential generator, so
 * the same seed always produces the same cycle and a test can assert a figure.
 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/* ------------------------------------------------------------------ *
 * Cycles
 * ------------------------------------------------------------------ */

export const CURRENT_CYCLE_ID = "cycle-current";
export const PRIOR_CYCLE_ID = "cycle-prior";

export function seedCycles(): Cycle[] {
  return [
    {
      id: PRIOR_CYCLE_ID,
      entity: SCHOLARSHIP_ENTITY,
      label: "Previous cycle",
      state: "CLOSED",
      opensAt: daysAgo(760),
      closesAt: daysAgo(700),
      decisionsBy: daysAgo(610),
      closedAt: daysAgo(600),
    },
    {
      id: CURRENT_CYCLE_ID,
      entity: SCHOLARSHIP_ENTITY,
      label: "Current cycle",
      state: "OPEN",
      opensAt: daysAgo(90),
      closesAt: daysAhead(40),
      decisionsBy: daysAhead(130),
      closedAt: null,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Schools. The cheque payee, so each one carries a payable name and a
 * postal address. Fictional institutions in a spread of states.
 * ------------------------------------------------------------------ */

type SchoolRow = {
  name: string;
  payableTo?: string;
  lines: string[];
  city: string;
  state: string;
  zip: string;
  office?: string;
};

const SCHOOL_ROWS: SchoolRow[] = [
  { name: "Carrington State University", lines: ["Office of the Bursar", "1 Carrington Green"], city: "Marlowe", state: "VA", zip: "23011", office: "Student Financial Services" },
  { name: "Thornbury College", lines: ["Bursar's Office", "44 Elm Row"], city: "Thornbury", state: "PA", zip: "17042" },
  { name: "Lakehurst Technical Institute", lines: ["Finance Office", "2200 Industry Way"], city: "Lakehurst", state: "OH", zip: "44101" },
  { name: "Pinedale A&M", lines: ["Scholarship Processing", "700 Agriculture Drive"], city: "Pinedale", state: "TX", zip: "75201", office: "Scholarship Processing" },
  { name: "Mount Avery University", lines: ["Student Accounts", "9 Chapel Hill Road"], city: "Avery", state: "TN", zip: "37010" },
  { name: "Brightwater College", lines: ["Bursar", "18 Harbour Street"], city: "Brightwater", state: "ME", zip: "04101" },
  { name: "Saltmarsh State College", lines: ["Cashier's Office", "310 Marsh Lane"], city: "Saltmarsh", state: "SC", zip: "29401" },
  { name: "Gideon Valley University", lines: ["Office of Student Finance", "1500 Valley Parkway"], city: "Gideon", state: "CO", zip: "80201" },
  { name: "Redmond Polytechnic", lines: ["Accounts Receivable", "88 Foundry Street"], city: "Redmond", state: "WA", zip: "98052" },
  { name: "Ashgrove Community College", lines: ["Business Office", "412 Ashgrove Road"], city: "Ashgrove", state: "GA", zip: "30301" },
  { name: "Kelter Institute of Technology", lines: ["Bursar's Office", "2 Innovation Square"], city: "Kelter", state: "MA", zip: "02101" },
  { name: "Orielle University", lines: ["Student Financial Services", "600 Orielle Avenue"], city: "Orielle", state: "IL", zip: "60601" },
  { name: "Falkirk State University", lines: ["Cashier", "25 Falkirk Common"], city: "Falkirk", state: "MI", zip: "48201" },
  { name: "Harrowgate College of Nursing", lines: ["Finance", "77 Infirmary Road"], city: "Harrowgate", state: "MD", zip: "21201", office: "Nursing Programme Office" },
  { name: "Juniper Ridge University", lines: ["Bursar", "4040 Ridge Road"], city: "Juniper", state: "AZ", zip: "85001" },
  { name: "Vandercourt College", lines: ["Student Accounts", "12 Court Street"], city: "Vandercourt", state: "NY", zip: "12201" },
  { name: "Stonebridge Trade School", lines: ["Accounts", "501 Bridge Street"], city: "Stonebridge", state: "KY", zip: "40201" },
  { name: "Wexford State University", lines: ["Bursar's Office", "1 University Plaza"], city: "Wexford", state: "FL", zip: "32301" },
  { name: "Lanterne University", lines: ["Office of Student Finance", "350 Lanterne Way"], city: "Lanterne", state: "LA", zip: "70112" },
  { name: "Cobbleton College", lines: ["Business Office", "15 Cobble Lane"], city: "Cobbleton", state: "MO", zip: "63101" },
  { name: "Northcape Maritime Academy", lines: ["Comptroller", "1 Pier Road"], city: "Northcape", state: "CA", zip: "94101" },
  { name: "Elderton University", lines: ["Student Accounts", "900 Elderton Boulevard"], city: "Elderton", state: "IN", zip: "46201" },
  { name: "Pemberly State College", lines: ["Bursar", "66 Pemberly Street"], city: "Pemberly", state: "NC", zip: "27601" },
  { name: "Highmoor Institute", lines: ["Finance Office", "3 Highmoor Terrace"], city: "Highmoor", state: "OR", zip: "97201" },
];

export function seedSchools(): School[] {
  return SCHOOL_ROWS.map((row, index) => ({
    id: `school-${String(index + 1).padStart(3, "0")}`,
    name: row.name,
    payableTo: row.payableTo ?? row.name,
    addressLines: row.lines,
    city: row.city,
    state: row.state,
    postalCode: row.zip,
    office: row.office ?? null,
  }));
}

/* ------------------------------------------------------------------ *
 * Applicant names. Fictional, built by pairing two pools so that 150
 * distinct names come out without 150 lines of table.
 * ------------------------------------------------------------------ */

const GIVEN_NAMES = [
  "Amara", "Bennett", "Cerise", "Darnell", "Eavan", "Ferris", "Giselle", "Hollis",
  "Imani", "Jarrah", "Kesia", "Lennox", "Marisol", "Niamh", "Osric", "Priya",
  "Quillon", "Rosalie", "Soren", "Tamsin", "Ulric", "Verity", "Wendell", "Xiomara",
  "Yannick", "Zelda", "Adaline", "Barnaby", "Clemence", "Dashiell",
];

const SURNAMES = [
  "Alderidge", "Bellweather", "Castellane", "Drummond", "Esperanza", "Fairholme",
  "Granville", "Hartigan", "Ingersoll", "Jessup", "Kilbride", "Lanterman",
  "Montrose", "Novakovic", "Oyelowo", "Pennington", "Quigley", "Ravensworth",
  "Stallworth", "Tindall", "Undersby", "Vallancourt", "Westbrook", "Yarborough",
  "Zabrowski", "Ashcombe", "Brightmore", "Calloway", "Delacourte", "Ellsworth",
];

function nameFor(index: number): string {
  const given = GIVEN_NAMES[index % GIVEN_NAMES.length];
  const surname = SURNAMES[(index * 7 + Math.floor(index / GIVEN_NAMES.length)) % SURNAMES.length];
  return `${given} ${surname}`;
}

function emailFor(name: string, index: number): string {
  const slug = name.toLowerCase().replace(/[^a-z]+/g, ".");
  return `${slug}.${index}@example.org`;
}

function phoneFor(index: number): string {
  // 555 exchange, so nothing here can ring a real person.
  return `(910) 555-${String(2000 + index).slice(-4)}`;
}

/* ------------------------------------------------------------------ *
 * The score histogram.
 *
 * Counts first, scores second. 144 scored applications, of which exactly 119
 * reach the Merit floor of 50.
 * ------------------------------------------------------------------ */

const SCORE_HISTOGRAM: { from: number; to: number; count: number }[] = [
  { from: 28, to: 49, count: 25 },
  { from: 50, to: 59, count: 30 },
  { from: 60, to: 69, count: 32 },
  { from: 70, to: 79, count: 28 },
  { from: 80, to: 89, count: 20 },
  { from: 90, to: 98, count: 9 },
];

export const SEEDED_APPLICATION_COUNT = 150;
export const SEEDED_WITHDRAWN_COUNT = 6;
export const SEEDED_MERIT_AWARD_COUNT = 119;
export const SEEDED_WOUNDED_PATRIOT_AWARD_COUNT = 64;

function committeeAverages(): number[] {
  const random = rng(20_261_215);
  const out: number[] = [];
  for (const bucket of SCORE_HISTOGRAM) {
    for (let i = 0; i < bucket.count; i += 1) {
      const span = bucket.to - bucket.from;
      out.push(bucket.from + Math.round(random() * span));
    }
  }
  // Interleave so the queue is not sorted by quality.
  const shuffled = [...out];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/* ------------------------------------------------------------------ *
 * The four scorers, plus the chair.
 *
 * `dev:scholarship-reviewer` is the persona in the role switcher, so it is one
 * of the four and deliberately has not scored everything: the review queue
 * needs to have something in it when the demo opens.
 * ------------------------------------------------------------------ */

export const REVIEWER_PERSON_IDS = [
  "dev:scholarship-reviewer",
  "committee:reviewer-two",
  "committee:reviewer-three",
  "committee:reviewer-four",
] as const;

export const CHAIR_PERSON_ID = "dev:scholarships";

/** Board members whose dependents applied. Drives the recusal path. */
const BOARD_MEMBER_APPLICATIONS: Record<number, string> = {
  11: "dev:treasurer-jsof",
  74: "dev:secretary",
};

/** Applications the signed-in reviewer has declared a relationship to. */
const CONFLICTED_INDEXES = [3, 48, 102];

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

type Generated = {
  applications: Application[];
  consents: GuardianConsent[];
  sheets: ScoreSheet[];
  verifications: DisabilityVerification[];
  awards: Award[];
  cheques: Cheque[];
  relationships: ReviewerRelationship[];
  selectionRecords: SelectionRecord[];
};

const ESSAY_OPENINGS = [
  "The year my father came home I learned how to read a room before I read a book.",
  "I want to be the person who knows what to do when the power goes out.",
  "Nobody in my family has finished a degree, and I have the paperwork to prove I intend to.",
  "I started working at fifteen because the alternative was watching my mother do both jobs.",
  "What I know about service I learned at a kitchen table, not in a classroom.",
  "I am applying because the cost of the first year is the only part I cannot cover.",
];

const ACTIVITY_POOL = [
  "Volunteer fire company, two years",
  "Hospital auxiliary, weekends",
  "Robotics team, lead builder",
  "Junior ROTC, platoon sergeant",
  "Youth coaching, under-12 football",
  "Food bank, Saturday shift",
  "School newspaper, editor",
  "Church youth group, organizer",
  "Shift supervisor, retail",
  "Peer tutoring, mathematics",
];

const RECOMMENDERS = [
  "Head of mathematics",
  "Shift manager",
  "Volunteer fire chief",
  "Senior year counsellor",
  "Scout leader",
  "Workshop instructor",
];

const SERVICE_RELATIONSHIPS = [
  "Father, retired after twenty-two years",
  "Mother, medically retired",
  "Stepfather, still serving",
  "Guardian, retired after eighteen years",
  "Father, medically retired",
];

const LEVELS = ["HIGH_SCHOOL_SENIOR", "UNDERGRADUATE", "GRADUATE", "VOCATIONAL"] as const;

function generate(): Generated {
  const random = rng(7_761_119);
  const schools = seedSchools();
  const averages = committeeAverages();

  const applications: Application[] = [];
  const consents: GuardianConsent[] = [];
  const sheets: ScoreSheet[] = [];
  const verifications: DisabilityVerification[] = [];
  const awards: Award[] = [];
  const cheques: Cheque[] = [];
  const relationships: ReviewerRelationship[] = [];

  // Which applicants applied for Wounded Patriot, and which of those the chair
  // has verified. 78 applied; 64 verified, 6 not, 8 still waiting on her. Drawn
  // from the scored applications only, so a withdrawn application is not also
  // sitting in her verification queue.
  const scoredCount = SEEDED_APPLICATION_COUNT - SEEDED_WITHDRAWN_COUNT;
  const woundedPatriotIndexes = new Set<number>();
  for (let i = 0; i < scoredCount; i += 1) {
    if ((i * 13) % scoredCount < 78) woundedPatriotIndexes.add(i);
  }
  const woundedPatriotList = [...woundedPatriotIndexes].sort((a, b) => a - b);
  const verifiedSet = new Set(woundedPatriotList.slice(0, 64));
  const refusedSet = new Set(woundedPatriotList.slice(64, 70));
  // The remaining eight are the chair's verification queue.

  // The withdrawn applications sit at the end of the list so the scored
  // averages line up one-for-one with the scored applications.
  let averageCursor = 0;

  for (let i = 0; i < SEEDED_APPLICATION_COUNT; i += 1) {
    const name = nameFor(i);
    const withdrawn = i >= SEEDED_APPLICATION_COUNT - SEEDED_WITHDRAWN_COUNT;
    const school = schools[i % schools.length];
    const level = LEVELS[i % LEVELS.length];
    const minor = level === "HIGH_SCHOOL_SENIOR" && i % 8 === 0;
    const appliedForWoundedPatriot = woundedPatriotIndexes.has(i);
    const submittedDaysAgo = 80 - Math.floor((i / SEEDED_APPLICATION_COUNT) * 50);
    const id = `sch-app-${String(i + 1).padStart(3, "0")}`;

    const birthYear = minor ? 2009 : 1996 + (i % 12);
    const dateOfBirth = `${birthYear}-${String((i % 12) + 1).padStart(2, "0")}-${String(
      (i % 27) + 1,
    ).padStart(2, "0")}`;

    // Nobody seeded here is a North Carolina resident at a North Carolina
    // school: that applicant is routed to the Patriot Foundation at the front
    // of the form and never becomes a record.
    const routing = decideRouting(
      {
        ncResident: false,
        attendingNcSchool: school.state === "NC",
        applyingForWoundedPatriot: appliedForWoundedPatriot,
      },
      new Date(SEED_EPOCH - submittedDaysAgo * 86_400_000),
    );

    const average = withdrawn ? null : averages[averageCursor++];
    const state: ApplicationState = withdrawn ? "WITHDRAWN" : "SCORED";

    const boardMemberPersonId = BOARD_MEMBER_APPLICATIONS[i] ?? null;

    const application: Application = {
      id,
      entity: SCHOLARSHIP_ENTITY,
      cycleId: CURRENT_CYCLE_ID,
      reference: `SCH-${String(1000 + i)}-${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(
        65 + ((i * 3) % 26),
      )}`,
      state,
      createdAt: daysAgo(submittedDaysAgo + 2),
      submittedAt: daysAgo(submittedDaysAgo),
      step: 7,
      routing,
      applicant: {
        fullName: name,
        email: emailFor(name, i),
        phone: phoneFor(i),
        dateOfBirth,
        residenceState: school.state === "NC" ? "VA" : school.state,
      },
      enrolment: {
        schoolId: school.id,
        level,
        accreditedInstitution: true,
        academicYear: "2027-2028",
        expectedCompletion: `${2028 + (i % 3)}-05-15`,
        studentNumber: `S${String(100_000 + i * 37).slice(0, 6)}`,
      },
      sponsor: {
        sponsorMemberId: `JSOA-20${String(11 + (i % 14)).padStart(2, "0")}-${String(
          (i % 30) + 1,
        ).padStart(4, "0")}`,
        checkedAt: daysAgo(submittedDaysAgo),
        rosterMemberId: i % 23 === 5 ? null : `seed-mbr-${String((i % 40) + 1).padStart(3, "0")}`,
        onRoster: i % 23 !== 5,
        inGoodStanding: i % 23 !== 5 && i % 31 !== 7,
        sponsorName: i % 23 === 5 ? null : `Sponsor ${((i % 40) + 1).toString()}`,
        sponsorEmail: i % 23 === 5 ? null : `sponsor.${(i % 40) + 1}@example.org`,
      },
      merit: {
        gpaHundredths: 250 + ((average ?? 60) % 150),
        transcriptSummary: `Transcript on file, ${level.toLowerCase().replace(/_/g, " ")}.`,
        essay: ESSAY_OPENINGS[i % ESSAY_OPENINGS.length],
        activities: [
          ACTIVITY_POOL[i % ACTIVITY_POOL.length],
          ACTIVITY_POOL[(i * 3 + 1) % ACTIVITY_POOL.length],
        ],
        recommendationFrom: RECOMMENDERS[i % RECOMMENDERS.length],
      },
      woundedPatriot: appliedForWoundedPatriot
        ? {
            serviceMemberRelationship:
              SERVICE_RELATIONSHIPS[i % SERVICE_RELATIONSHIPS.length],
            disabilityEvidence: {
              narrative:
                "Account of a service-connected injury and what it has meant " +
                "for the household, in the applicant's own words.",
              claimedServiceConnection: "Service-connected, as stated by the applicant",
              verificationContact: `Sponsoring member, JSOA-20${String(11 + (i % 14)).padStart(2, "0")}`,
            },
          }
        : null,
      guardianConsentId: null,
      eligibilityOutcome: "UNDETERMINED",
      eligibilityRuleVersion: ELIGIBILITY_RULE.version,
      flags: [
        ...(minor ? (["APPLICANT_IS_A_MINOR"] as const) : []),
        "ELIGIBILITY_NEEDS_DETERMINATION" as const,
        ...(i % 23 === 5 ? (["SPONSOR_NOT_ON_ROSTER"] as const) : []),
        ...(i % 23 !== 5 && i % 31 === 7 ? (["SPONSOR_NOT_IN_GOOD_STANDING"] as const) : []),
        ...(boardMemberPersonId ? (["BOARD_MEMBER_DEPENDENT"] as const) : []),
      ],
      boardMemberPersonId,
      withdrawnAt: withdrawn ? daysAgo(submittedDaysAgo - 5) : null,
      decidedAt: null,
    };

    if (minor) {
      const consentId = `sch-consent-${String(i + 1).padStart(3, "0")}`;
      application.guardianConsentId = consentId;
      consents.push({
        id: consentId,
        entity: SCHOLARSHIP_ENTITY,
        applicationId: id,
        guardianName: `${SURNAMES[(i * 5) % SURNAMES.length]} household, guardian`,
        guardianEmail: `guardian.${i}@example.org`,
        guardianPhone: phoneFor(500 + i),
        relationship: i % 3 === 0 ? "PARENT" : i % 3 === 1 ? "LEGAL_GUARDIAN" : "STEP_PARENT",
        statementVersion: GUARDIAN_CONSENT_STATEMENT_VERSION,
        consentedAt: daysAgo(submittedDaysAgo + 1),
      });
    }

    applications.push(application);

    /* Score sheets ------------------------------------------------- */
    if (average !== null) {
      // The signed-in reviewer has not scored every application, so the demo's
      // review queue is not empty when it opens. They also have not scored the
      // three they declared a relationship to, because they cannot open them.
      const reviewerOneSkips = i % 5 === 0 || CONFLICTED_INDEXES.includes(i);
      const scorers = REVIEWER_PERSON_IDS.filter(
        (personId) => !(personId === REVIEWER_PERSON_IDS[0] && reviewerOneSkips),
      );

      // Individual sheets sit a few points either side of the committee
      // average, and the drifts sum to zero, so the average is exactly the
      // figure the histogram asked for. A headline count that moved with the
      // rounding would be a headline count nobody could check.
      const drifts = driftsSummingToZero(scorers.length, random);

      scorers.forEach((reviewerPersonId, r) => {
        const target = Math.max(0, Math.min(100, average + drifts[r]));
        const points = distributePoints(target, random);
        sheets.push({
          id: `sch-score-${id}-${r}`,
          entity: SCHOLARSHIP_ENTITY,
          applicationId: id,
          reviewerPersonId,
          points,
          total: sheetTotal(points),
          comment:
            target >= 80
              ? "Strong across the board. Would fund."
              : target >= 55
                ? "Solid application, nothing exceptional."
                : "Thin on the written sections.",
          scoredAt: daysAgo(Math.max(1, submittedDaysAgo - 20 - r)),
        });
      });
    }

    /* Disability verification ------------------------------------- */
    if (appliedForWoundedPatriot && (verifiedSet.has(i) || refusedSet.has(i))) {
      verifications.push({
        id: `sch-verif-${String(i + 1).padStart(3, "0")}`,
        entity: SCHOLARSHIP_ENTITY,
        applicationId: id,
        outcome: verifiedSet.has(i) ? "VERIFIED" : "NOT_VERIFIED",
        verifiedByPersonId: CHAIR_PERSON_ID,
        verifiedAt: daysAgo(Math.max(1, submittedDaysAgo - 30)),
        method: i % 2 === 0 ? "SPOKE_TO_SPONSORING_MEMBER" : "SPOKE_TO_VERIFICATION_CONTACT",
        note: verifiedSet.has(i)
          ? "Spoke to the contact named on the application. Satisfied."
          : "Could not establish a service connection on the account given.",
      });
    }

    /* Conflicts ---------------------------------------------------- */
    if (CONFLICTED_INDEXES.includes(i)) {
      relationships.push({
        id: `sch-rel-${String(i + 1).padStart(3, "0")}`,
        entity: SCHOLARSHIP_ENTITY,
        reviewerPersonId: REVIEWER_PERSON_IDS[0],
        applicationId: id,
        kind: i === 3 ? "AUNT_OR_UNCLE" : i === 48 ? "SAME_HOUSEHOLD" : "TEACHER_OR_COACH",
        declaredAt: daysAgo(85),
        declaredByPersonId: REVIEWER_PERSON_IDS[0],
        note: "Declared at the start of the cycle.",
      });
    }
  }

  /* Awards ---------------------------------------------------------- */
  let meritAwarded = 0;
  let topWinnerGiven = false;

  for (let i = 0; i < applications.length; i += 1) {
    const application = applications[i];
    if (application.state === "WITHDRAWN") continue;
    const applicationSheets = sheets.filter((s) => s.applicationId === application.id);
    if (applicationSheets.length === 0) continue;
    const average = Math.round(
      applicationSheets.reduce((sum, s) => sum + s.total, 0) / applicationSheets.length,
    );

    const band = MERIT_BANDS.find((b) => average >= b.minScore) ?? null;
    const proposedAt = daysAgo(18);
    const underBoardReview = application.boardMemberPersonId !== null;

    if (band && meritAwarded < SEEDED_MERIT_AWARD_COUNT) {
      meritAwarded += 1;
      const top = !topWinnerGiven && average >= TOP_WINNER.eligibleFromScore;
      if (top) topWinnerGiven = true;
      awards.push({
        id: `sch-award-m-${String(i + 1).padStart(3, "0")}`,
        entity: SCHOLARSHIP_ENTITY,
        cycleId: CURRENT_CYCLE_ID,
        applicationId: application.id,
        program: "MERIT",
        amountCents: top ? TOP_WINNER.amountCents : band.amountCents,
        currency: SCHOLARSHIP_CURRENCY,
        status: underBoardReview ? "BOARD_REVIEW" : i % 4 === 0 ? "APPROVED" : "NOTIFIED",
        basis: top
          ? `Committee average ${average}. Designated top winner by the chair.`
          : `Committee average ${average}, band ${band.label}.`,
        proposedAt,
        decidedByPersonId: underBoardReview ? null : CHAIR_PERSON_ID,
        decidedAt: underBoardReview ? null : daysAgo(16),
        boardReview: underBoardReview
          ? {
              reason: "BOARD_MEMBER_DEPENDENT",
              recusedPersonId: application.boardMemberPersonId!,
              requestedAt: proposedAt,
              requestedByPersonId: CHAIR_PERSON_ID,
              minuteRef: null,
              decidedAt: null,
              outcome: null,
              approverPersonIds: [],
            }
          : null,
        notifiedAt: underBoardReview || i % 4 === 0 ? null : daysAgo(14),
      });
    }

    const verification = verifications.find((v) => v.applicationId === application.id);
    if (verification?.outcome === "VERIFIED") {
      awards.push({
        id: `sch-award-w-${String(i + 1).padStart(3, "0")}`,
        entity: SCHOLARSHIP_ENTITY,
        cycleId: CURRENT_CYCLE_ID,
        applicationId: application.id,
        program: "WOUNDED_PATRIOT",
        amountCents: WOUNDED_PATRIOT.amountCents,
        currency: SCHOLARSHIP_CURRENCY,
        status: underBoardReview ? "BOARD_REVIEW" : i % 5 === 0 ? "APPROVED" : "NOTIFIED",
        basis: "Flat award. Service connection verified by the chair.",
        proposedAt,
        decidedByPersonId: underBoardReview ? null : CHAIR_PERSON_ID,
        decidedAt: underBoardReview ? null : daysAgo(16),
        boardReview: underBoardReview
          ? {
              reason: "BOARD_MEMBER_DEPENDENT",
              recusedPersonId: application.boardMemberPersonId!,
              requestedAt: proposedAt,
              requestedByPersonId: CHAIR_PERSON_ID,
              minuteRef: null,
              decidedAt: null,
              outcome: null,
              approverPersonIds: [],
            }
          : null,
        notifiedAt: underBoardReview || i % 5 === 0 ? null : daysAgo(14),
      });
    }
  }

  // Applications with an award are AWARDED; the rest of the scored ones are not.
  const awardedApplicationIds = new Set(awards.map((a) => a.applicationId));
  for (const application of applications) {
    if (application.state === "WITHDRAWN" || application.state === "IN_REVIEW") continue;
    application.state = awardedApplicationIds.has(application.id) ? "AWARDED" : "NOT_AWARDED";
    application.decidedAt = daysAgo(16);
  }

  /* Cheques --------------------------------------------------------- */
  const schoolsById = new Map(schools.map((s) => [s.id, s]));
  let chequeIndex = 0;
  for (const award of awards) {
    if (award.status !== "NOTIFIED" && award.status !== "APPROVED") continue;
    const application = applications.find((a) => a.id === award.applicationId);
    if (!application?.enrolment) continue;
    const school = schoolsById.get(application.enrolment.schoolId);
    if (!school) continue;
    chequeIndex += 1;
    const mailed = chequeIndex % 4 === 0;
    cheques.push({
      id: `sch-cheque-${String(chequeIndex).padStart(3, "0")}`,
      entity: SCHOLARSHIP_ENTITY,
      cycleId: CURRENT_CYCLE_ID,
      awardId: award.id,
      payeeSchoolId: school.id,
      payableTo: school.payableTo,
      addressLines: school.addressLines,
      city: school.city,
      state: school.state,
      postalCode: school.postalCode,
      office: school.office,
      amountCents: award.amountCents,
      currency: SCHOLARSHIP_CURRENCY,
      memoReference: `${application.reference} / student ${application.enrolment.studentNumber}`,
      status: mailed ? "MAILED" : "QUEUED",
      mailedAt: mailed ? daysAgo(9) : null,
      mailedByPersonId: mailed ? CHAIR_PERSON_ID : null,
      note: null,
    });
  }

  /* The closed prior cycle, for retention ---------------------------- */
  const priorApplications: Application[] = [];
  const selectionRecords: SelectionRecord[] = [];
  for (let i = 0; i < 12; i += 1) {
    const name = nameFor(200 + i);
    const school = schools[(i + 5) % schools.length];
    const awarded = i < 4;
    const id = `sch-prior-${String(i + 1).padStart(3, "0")}`;
    const decidedAt = daysAgo(620);
    priorApplications.push({
      id,
      entity: SCHOLARSHIP_ENTITY,
      cycleId: PRIOR_CYCLE_ID,
      reference: `SCH-09${String(i).padStart(2, "0")}-PR`,
      state: awarded ? "AWARDED" : "NOT_AWARDED",
      createdAt: daysAgo(740),
      submittedAt: daysAgo(738),
      step: 7,
      routing: decideRouting(
        { ncResident: false, attendingNcSchool: false, applyingForWoundedPatriot: false },
        new Date(SEED_EPOCH - 738 * 86_400_000),
      ),
      applicant: {
        fullName: name,
        email: emailFor(name, 200 + i),
        phone: phoneFor(700 + i),
        dateOfBirth: `1999-0${(i % 9) + 1}-1${i % 10}`,
        residenceState: school.state === "NC" ? "VA" : school.state,
      },
      enrolment: {
        schoolId: school.id,
        level: "UNDERGRADUATE",
        accreditedInstitution: true,
        academicYear: "2025-2026",
        expectedCompletion: "2027-05-15",
        studentNumber: `S${String(900_000 + i)}`,
      },
      sponsor: {
        sponsorMemberId: `JSOA-2014-${String(i + 1).padStart(4, "0")}`,
        checkedAt: daysAgo(738),
        rosterMemberId: `seed-mbr-${String((i % 40) + 1).padStart(3, "0")}`,
        onRoster: true,
        inGoodStanding: true,
        sponsorName: `Sponsor ${i + 1}`,
        sponsorEmail: `sponsor.${i + 1}@example.org`,
      },
      merit: {
        gpaHundredths: 300 + i * 5,
        transcriptSummary: "Transcript on file.",
        essay: ESSAY_OPENINGS[i % ESSAY_OPENINGS.length],
        activities: [ACTIVITY_POOL[i % ACTIVITY_POOL.length]],
        recommendationFrom: RECOMMENDERS[i % RECOMMENDERS.length],
      },
      woundedPatriot: null,
      guardianConsentId: null,
      eligibilityOutcome: "UNDETERMINED",
      eligibilityRuleVersion: ELIGIBILITY_RULE.version,
      flags: ["ELIGIBILITY_NEEDS_DETERMINATION"],
      boardMemberPersonId: null,
      withdrawnAt: null,
      decidedAt,
    });

    if (awarded) {
      selectionRecords.push({
        id: `sch-selrec-${String(i + 1).padStart(3, "0")}`,
        entity: SCHOLARSHIP_ENTITY,
        cycleId: PRIOR_CYCLE_ID,
        applicationRef: `SCH-09${String(i).padStart(2, "0")}-PR`,
        outcome: "AWARDED",
        totalScore: 80 + i,
        scoresRecorded: 4,
        awards: [{ program: "MERIT", amountCents: 150_000 }],
        eligibilityRuleVersion: ELIGIBILITY_RULE.version,
        decidedAt,
        retainUntil: dateOnly(daysAgo(620 - 1826)),
      });
    }
  }

  return {
    applications: [...applications, ...priorApplications],
    consents,
    sheets,
    verifications,
    awards,
    cheques,
    relationships,
    selectionRecords,
  };
}

/**
 * Drifts for one committee's sheets that add up to zero, so the mean of the
 * sheets is exactly the figure asked for.
 */
function driftsSummingToZero(count: number, random: () => number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < count; i += 2) {
    const magnitude = 1 + Math.floor(random() * 5);
    out.push(magnitude, -magnitude);
  }
  if (out.length < count) out.push(0);
  return out;
}

/**
 * Split a target total across the five criteria in proportion to their
 * maximums, exactly. Proportional floors first, then the remainder handed out
 * one point at a time to whatever still has headroom, so the sheet totals the
 * target and no rounding is left over.
 */
function distributePoints(target: number, random: () => number): Record<CriterionKey, number> {
  const points = {} as Record<CriterionKey, number>;
  let allocated = 0;
  for (const criterion of SCORING_CRITERIA) {
    const share = Math.floor((target * criterion.maxPoints) / 100);
    points[criterion.key] = share;
    allocated += share;
  }
  let remainder = target - allocated;
  while (remainder > 0) {
    for (const criterion of SCORING_CRITERIA) {
      if (remainder > 0 && points[criterion.key] < criterion.maxPoints) {
        points[criterion.key] += 1;
        remainder -= 1;
      }
    }
  }
  while (remainder < 0) {
    for (const criterion of SCORING_CRITERIA) {
      if (remainder < 0 && points[criterion.key] > 0) {
        points[criterion.key] -= 1;
        remainder += 1;
      }
    }
  }
  // One point moved between two criteria, so two sheets with the same total do
  // not read as identical. The total is unchanged.
  if (random() > 0.5 && points.ESSAY > 0 && points.ACADEMIC_RECORD < 30) {
    points.ESSAY -= 1;
    points.ACADEMIC_RECORD += 1;
  }
  return points;
}

/* ------------------------------------------------------------------ *
 * The seed is generated once per process and handed out as copies.
 * ------------------------------------------------------------------ */

let cached: Generated | null = null;
function generated(): Generated {
  cached ??= generate();
  return cached;
}

export function seedApplications(): Application[] {
  return generated().applications.map((a) => structuredClone(a));
}

export function seedGuardianConsents(): GuardianConsent[] {
  return generated().consents.map((c) => ({ ...c }));
}

export function seedScoreSheets(): ScoreSheet[] {
  return generated().sheets.map((s) => structuredClone(s));
}

export function seedVerifications(): DisabilityVerification[] {
  return generated().verifications.map((v) => ({ ...v }));
}

export function seedAwards(): Award[] {
  return generated().awards.map((a) => structuredClone(a));
}

export function seedCheques(): Cheque[] {
  return generated().cheques.map((c) => structuredClone(c));
}

export function seedRelationships(): ReviewerRelationship[] {
  return generated().relationships.map((r) => ({ ...r }));
}

export function seedSelectionRecords(): SelectionRecord[] {
  return generated().selectionRecords.map((r) => structuredClone(r));
}

/** A conflicted pair, so a test and the demo can both reach the block. */
export function seedConflictedPair(): { reviewerPersonId: string; applicationId: string } {
  const relationship = generated().relationships[0];
  return {
    reviewerPersonId: relationship.reviewerPersonId,
    applicationId: relationship.applicationId,
  };
}
