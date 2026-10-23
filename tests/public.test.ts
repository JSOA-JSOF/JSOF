/**
 * The public tier's control tests.
 *
 * The public tier is the one surface with no authentication in front of it, so
 * these tests are written as prohibitions rather than as coverage. Two of them
 * are the reason the file exists:
 *
 *   1. No member-identifying field from any shared type reaches public content.
 *   2. The scholarship eligibility statement is a marked placeholder, and the
 *      rule currently under legal review appears nowhere.
 *
 * The rest hold the smaller commitments: no personal names, no consumer
 * mailboxes, no third-party tags, no stale years on event pages, and no
 * adjective in a sponsor acknowledgment.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { DATA_CLASSES, ROLES, type DataClass } from "../src/lib/authz/model";
import * as membershipState from "../src/lib/membership/state";

import { PUBLIC_IMAGES, publicImage } from "../src/app/(public)/media";
import { PROGRAMMES } from "../src/app/(public)/programmes";
import { ENTITY_PROFILES, JSOA_PROFILE, JSOF_PROFILE } from "../src/app/(public)/entities";
import {
  CONTACTS_BY_ENTITY,
  JSOA_CONTACTS,
  JSOF_CONTACTS,
  type ContactRole,
} from "../src/app/(public)/contact-roles";
import { EVENTS, eventBySlug } from "../src/app/(public)/events";
import { LINES_OF_EFFORT } from "../src/app/(public)/mission";
import { PARTNERS } from "../src/app/(public)/partners";
import {
  APPLICATION_WINDOW,
  ELIGIBILITY_PLACEHOLDER,
  SCHOLARSHIP_PROGRAMS,
} from "../src/app/(public)/scholarships";
import {
  CONSUMER_MAIL_HOST_PATTERN,
  FORBIDDEN_SPONSOR_LANGUAGE,
  FORBIDDEN_THIRD_PARTY_HOSTS,
  MEMBER_ID_PATTERN,
  MEMBER_IDENTIFYING_FIELDS,
  RANK_TOKEN_PATTERN,
} from "../src/app/(public)/public-safety";

/* ------------------------------------------------------------------ *
 * Fixtures: the public tier's own source, and its content as data.
 * ------------------------------------------------------------------ */

const REPO_ROOT = join(import.meta.dirname, "..");

/** The three path trees this module owns. See docs/MODULE-BRIEF.md. */
const PUBLIC_TIER_DIRS = [
  join(REPO_ROOT, "src/app/(public)"),
  join(REPO_ROOT, "src/app/jsoa"),
  join(REPO_ROOT, "src/app/jsof"),
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

type SourceFile = { path: string; text: string };

const PUBLIC_SOURCES: SourceFile[] = PUBLIC_TIER_DIRS.flatMap(walk)
  .filter((path) => /\.(tsx?|css)$/.test(path))
  .map((path) => ({
    path: relative(REPO_ROOT, path),
    text: readFileSync(path, "utf8"),
  }));

/** Only the files that render, for checks about rendered output. */
const RENDERED_SOURCES = PUBLIC_SOURCES.filter((file) => file.path.endsWith(".tsx"));

/**
 * Every public content module's exported data, as one object to walk. These
 * are the records that become public pages.
 */
const PUBLIC_CONTENT = {
  entityProfiles: ENTITY_PROFILES,
  contacts: CONTACTS_BY_ENTITY,
  events: EVENTS,
  linesOfEffort: LINES_OF_EFFORT,
  partners: PARTNERS,
  scholarshipPrograms: SCHOLARSHIP_PROGRAMS,
  applicationWindow: APPLICATION_WINDOW,
  eligibility: ELIGIBILITY_PLACEHOLDER,
};

type Visit = { keyPath: string; key: string; value: unknown };

function visitAll(node: unknown, keyPath = "$"): Visit[] {
  const out: Visit[] = [];
  if (Array.isArray(node)) {
    node.forEach((item, index) => out.push(...visitAll(item, `${keyPath}[${index}]`)));
    return out;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const path = `${keyPath}.${key}`;
      out.push({ keyPath: path, key, value });
      out.push(...visitAll(value, path));
    }
  }
  return out;
}

const ALL_VISITS = visitAll(PUBLIC_CONTENT);
const ALL_STRINGS = ALL_VISITS.filter(
  (visit): visit is Visit & { value: string } => typeof visit.value === "string",
);

/**
 * The board members published by name on the live site, and the two consumer
 * mailboxes they are published at. Held here and nowhere in `src/`, so a test
 * can assert their absence without the repository being the thing that
 * republishes them.
 */
const NAMES_ON_THE_LIVE_SITE = [
  "Josh Burton",
  "Roland Deuschle",
  "Chris Craven",
  "Mike Copenhaver",
  "Kristie Holden",
  "Tony De La Vega",
  "Andrea Bowers",
  "Helen Brumgard",
  "Deanna Rosario",
];

const CONSUMER_MAILBOXES_ON_THE_LIVE_SITE = [
  "pavers.thejsoa@gmail.com",
  "info.thejsoa@gmail.com",
];

/**
 * The eligibility rule under legal review. It is a private-benefit risk
 * (docs/ARCHITECTURE.md: dues collected from members, scholarships paid to
 * members' children), so it must not appear in the public tier in any casing.
 * This is the only place in the repository that holds the phrase, and it holds
 * it in order to assert its absence.
 */
const RULE_UNDER_REVIEW = "dependent child of a current jsoa member";
const RULE_FRAGMENTS_UNDER_REVIEW = [
  "dependent child of a current",
  "dependent child of a jsoa member",
  "child of a current jsoa member",
  "must be a member",
  "members only" /* as a scholarship condition */,
];

/* ------------------------------------------------------------------ *
 * Requirement 1: no member-identifying field reaches public content.
 * ------------------------------------------------------------------ */

describe("the public tier carries no member-identifying field", () => {
  it("declares none of the member-identifying field names, at any depth", () => {
    const forbidden = new Set<string>(
      MEMBER_IDENTIFYING_FIELDS.map((field) => field.toLowerCase()),
    );
    const offenders = ALL_VISITS.filter((visit) => forbidden.has(visit.key.toLowerCase()));
    expect(offenders.map((visit) => visit.keyPath)).toEqual([]);
  });

  it("covers every member-identifying field on the shared membership types", () => {
    // The guard is only worth having if it names the fields the shared types
    // actually carry. `MembershipEvent` is the widest shared shape that names
    // a member, so every identifying key it introduces must be on the list.
    const declared = new Set<string>(
      MEMBER_IDENTIFYING_FIELDS.map((field) => field.toLowerCase()),
    );
    for (const key of ["sponsorMemberId", "memberId"]) {
      expect(declared.has(key.toLowerCase())).toBe(true);
    }
    // And the compliance fields from the member record in ARCHITECTURE.md.
    for (const key of [
      "membershipCategory",
      "serviceDatesFrom",
      "serviceDatesTo",
      "isWarVeteran",
      "qualifyingRelationship",
    ]) {
      expect(declared.has(key.toLowerCase())).toBe(true);
    }
  });

  it("carries no member ID, in content or in any rendered file", () => {
    for (const visit of ALL_STRINGS) {
      expect(MEMBER_ID_PATTERN.test(visit.value), visit.keyPath).toBe(false);
    }
    for (const file of PUBLIC_SOURCES) {
      expect(MEMBER_ID_PATTERN.test(file.text), file.path).toBe(false);
    }
  });

  it("carries no rank or rank abbreviation", () => {
    for (const visit of ALL_STRINGS) {
      expect(RANK_TOKEN_PATTERN.test(visit.value), `${visit.keyPath}: ${visit.value}`).toBe(
        false,
      );
    }
  });

  it("names not one person from the live site's board directory", () => {
    for (const file of PUBLIC_SOURCES) {
      for (const personName of NAMES_ON_THE_LIVE_SITE) {
        expect(file.text.includes(personName), `${file.path} names ${personName}`).toBe(false);
      }
    }
  });

  it("renders an image only through the reviewed manifest", () => {
    // This rule used to be "no image at all", which was the simplest way to
    // guarantee no member's face reaches a public page. The board now wants
    // photography, so the guarantee moved rather than went away: the only
    // component that may render an <img> is Banner, and Banner resolves its
    // source from src/app/(public)/media.ts, where every entry carries an
    // OPSEC review. A page cannot name a path of its own.
    // Two components may render an <img>: the shared blocks, and the opening
    // sequence, which puts the crest over the film. Both resolve from the
    // manifest, which is what the next test checks. A page still may not.
    const MAY_RENDER_IMAGES = ["blocks.tsx", "Intro.tsx"];
    for (const file of RENDERED_SOURCES) {
      if (MAY_RENDER_IMAGES.some((name) => file.path.endsWith(name))) continue;
      expect(/<img\b/.test(file.text), file.path).toBe(false);
      expect(/backgroundImage/.test(file.text), file.path).toBe(false);
    }
    // next/image is still barred everywhere: it would pull in the optimizer
    // and a second way to put a picture on a public page.
    for (const file of RENDERED_SOURCES) {
      expect(/next\/image/.test(file.text), file.path).toBe(false);
    }
  });

  it("holds every public impact figure to the dashboard's rules", () => {
    // docs/DASHBOARD-BRIEF.md governs the board tiles. The same three rules
    // apply in public, where the stakes are higher because a donor cannot
    // check: an unmeasured figure says so rather than showing zero, every
    // figure states its provenance, and nothing is a bare number.
    for (const programme of PROGRAMMES) {
      for (const figure of programme.impact) {
        expect(figure.from.length, `${programme.slug}/${figure.label} has no provenance`)
          .toBeGreaterThan(12);
        expect(figure.from, `${programme.slug}/${figure.label} says "live data"`)
          .not.toMatch(/^live data$/i);

        if (figure.value === null) {
          expect(
            (figure.needs ?? "").length,
            `${programme.slug}/${figure.label} is unmeasured and does not say what it needs`,
          ).toBeGreaterThan(8);
        } else {
          // Never a confident zero standing in for "we have not counted".
          expect(figure.value.trim(), `${programme.slug}/${figure.label} is a bare zero`)
            .not.toBe("0");
        }
      }
    }
  });

  it("never solicits a gift for something the Foundation may not fund", () => {
    // The private benefit rule, enforced rather than remembered. A programme
    // the Association funds is a member benefit, so it carries no ask: its
    // "funds" sentence must be null, which is what stops ProgrammeCards
    // rendering it on the Foundation side at all.
    for (const programme of PROGRAMMES) {
      if (programme.fundedBy === "JSOA") {
        expect(
          programme.funds,
          `${programme.slug} is Association-funded but offers a gift framing`,
        ).toBeNull();
      } else {
        expect(
          programme.funds,
          `${programme.slug} is Foundation-funded but has nothing to tell a donor`,
        ).toBeTruthy();
      }
    }
  });

  it("explains any programme the Association runs and the Foundation funds", () => {
    // The split cases are the ones a reader will query, so they may not pass
    // without a stated reason.
    for (const programme of PROGRAMMES) {
      if (programme.runBy !== programme.fundedBy) {
        expect(
          (programme.fundingNote ?? "").length,
          `${programme.slug} splits run and funding with no explanation`,
        ).toBeGreaterThan(40);
      }
    }
  });

  it("gives every public image a dated OPSEC review", () => {
    const manifest = PUBLIC_SOURCES.find((file) => file.path.endsWith("media.ts"));
    expect(manifest, "src/app/(public)/media.ts is missing").toBeTruthy();

    const keys = Object.keys(PUBLIC_IMAGES) as (keyof typeof PUBLIC_IMAGES)[];
    expect(keys.length, "the manifest is empty").toBeGreaterThan(0);

    for (const key of keys) {
      const entry = PUBLIC_IMAGES[key];
      expect(/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewed), `${key} has no review date`).toBe(
        true,
      );
      expect(entry.note.length, `${key} has no review note`).toBeGreaterThan(20);
      expect(entry.src.startsWith("/media/"), `${key} is not a local asset`).toBe(true);
      // The rule the whole manifest exists for. A recognisable face is
      // permitted only when the person is not real; an actual member or
      // member's family on a public page needs signed releases and a board
      // decision, which is not something a manifest entry can stand in for.
      expect(entry.depicts, `${key} depicts real identifiable members`).not.toBe("MEMBERS");
    }
  });

  it("renders no image Banner cannot account for", () => {
    // Every <img> in the one component allowed to have one must take its src
    // from the manifest rather than from a literal.
    const sources = RENDERED_SOURCES.filter(
      (file) => file.path.endsWith("blocks.tsx") || file.path.endsWith("Intro.tsx"),
    );
    expect(sources.length, "the files allowed to render images are missing").toBe(2);
    let total = 0;
    for (const file of sources) {
      const imgTags = file.text.match(/<img\b[\s\S]*?\/>/g) ?? [];
      for (const tag of imgTags) {
        expect(tag, `${file.path}: an img does not resolve through the manifest`).toMatch(
          /PUBLIC_IMAGES[.[]/,
        );
        total += 1;
      }
    }
    expect(total, "no img element found at all").toBeGreaterThan(0);
  });

  it("publishes offices, and the contact type has no field for a person", () => {
    const allowed = new Set([
      "slug",
      "role",
      "entity",
      "remit",
      "mailbox",
      "mailboxLive",
      "respondsWithin",
    ]);
    const contacts: ContactRole[] = [...JSOA_CONTACTS, ...JSOF_CONTACTS];
    expect(contacts.length).toBeGreaterThan(0);
    for (const contact of contacts) {
      expect(Object.keys(contact).sort()).toEqual([...allowed].sort());
    }
  });

  it("publishes no consumer mailbox, and replaces the two on the live site", () => {
    for (const visit of ALL_STRINGS) {
      expect(
        CONSUMER_MAIL_HOST_PATTERN.test(visit.value),
        `${visit.keyPath}: ${visit.value}`,
      ).toBe(false);
    }
    for (const file of PUBLIC_SOURCES) {
      for (const mailbox of CONSUMER_MAILBOXES_ON_THE_LIVE_SITE) {
        expect(file.text.includes(mailbox), file.path).toBe(false);
      }
    }
    // The two offices that were published at a personal mailbox now exist as
    // offices on the organization's own domain.
    for (const slug of ["memorial-chair", "webmaster"]) {
      const office = JSOF_CONTACTS.find((contact) => contact.slug === slug);
      expect(office, slug).toBeDefined();
      expect(office!.mailbox.endsWith("@thejsoa.org")).toBe(true);
    }
  });

  it("names no unit or command designation", () => {
    // JSOC and the JSOA/JSOF are the organizations themselves and are public.
    // A subordinate unit designation is not, and neither is an assignment.
    const unitPatterns = [
      /\b\d+(st|nd|rd|th)\s+(Special|Ranger|Airborne|Group|Battalion|Squadron|Regiment)/i,
      /\bDelta Force\b/i,
      /\bSEAL Team\b/i,
      /\bDEVGRU\b/i,
      /\bTask Force\s+\w+/i,
    ];
    for (const file of PUBLIC_SOURCES) {
      for (const pattern of unitPatterns) {
        expect(pattern.test(file.text), `${file.path}: ${pattern}`).toBe(false);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Requirement 2: the eligibility placeholder, not the rule.
 * ------------------------------------------------------------------ */

describe("scholarship eligibility is a marked placeholder awaiting counsel", () => {
  it("does not state the rule under review, anywhere in the public tier", () => {
    for (const file of PUBLIC_SOURCES) {
      const lowered = file.text.toLowerCase();
      expect(lowered.includes(RULE_UNDER_REVIEW), file.path).toBe(false);
      for (const fragment of RULE_FRAGMENTS_UNDER_REVIEW) {
        expect(lowered.includes(fragment), `${file.path}: "${fragment}"`).toBe(false);
      }
    }
  });

  it("does not state the rule in any public content string either", () => {
    for (const visit of ALL_STRINGS) {
      expect(visit.value.toLowerCase().includes(RULE_UNDER_REVIEW), visit.keyPath).toBe(false);
    }
  });

  it("carries a placeholder that says it is awaiting counsel", () => {
    expect(ELIGIBILITY_PLACEHOLDER.status).toBe("AWAITING_COUNSEL");
    expect(ELIGIBILITY_PLACEHOLDER.marker.toLowerCase()).toContain("counsel");
    expect(ELIGIBILITY_PLACEHOLDER.heading.toLowerCase()).toContain("eligibility");
    expect(ELIGIBILITY_PLACEHOLDER.body.join(" ").toLowerCase()).toContain("legal review");
    // It tells the reader what to do with the gap rather than leaving them there.
    expect(ELIGIBILITY_PLACEHOLDER.guidance.toLowerCase()).toContain("scholarships chair");
  });

  it("gives every programme the same single placeholder, not its own wording", () => {
    expect(SCHOLARSHIP_PROGRAMS.length).toBe(3);
    for (const program of SCHOLARSHIP_PROGRAMS) {
      expect(program.eligibility, program.slug).toBe(ELIGIBILITY_PLACEHOLDER);
    }
  });

  it("publishes no eligibility criterion of its own", () => {
    // A criterion published beside the placeholder would be the rule leaking
    // out one bullet at a time. Nothing in a programme record may read as a
    // condition on who may apply.
    const criterionLike = [
      "must be",
      "you qualify",
      "qualifies if",
      "eligible if",
      "only if",
      "applicants must",
      "requirement:",
      "purple heart",
      "disability rating",
      "high school senior",
      "full-time student",
    ];
    const programStrings = visitAll(SCHOLARSHIP_PROGRAMS)
      .filter((visit): visit is Visit & { value: string } => typeof visit.value === "string")
      .filter((visit) => !visit.keyPath.includes("eligibility"));
    for (const visit of programStrings) {
      for (const phrase of criterionLike) {
        expect(
          visit.value.toLowerCase().includes(phrase),
          `${visit.keyPath} reads as a criterion: "${phrase}"`,
        ).toBe(false);
      }
    }
  });

  it("shows the placeholder on the rendered scholarships page", () => {
    const page = PUBLIC_SOURCES.find(
      (file) => file.path === "src/app/jsof/scholarships/page.tsx",
    );
    expect(page).toBeDefined();
    expect(page!.text).toContain("ELIGIBILITY_PLACEHOLDER.heading");
    expect(page!.text).toContain("ELIGIBILITY_PLACEHOLDER.marker");
    expect(page!.text).toContain("ELIGIBILITY_PLACEHOLDER.body");
  });

  it("states an application window without a year in it", () => {
    expect(APPLICATION_WINDOW.state).toBe("ANNUAL_CYCLE_DATES_TO_BE_CONFIRMED");
    const windowText = Object.values(APPLICATION_WINDOW).join(" ");
    expect(/\b(19|20)\d{2}\b/.test(windowText)).toBe(false);
    expect(APPLICATION_WINDOW.confirmedBy).toBe("Scholarships Chair");
  });
});

/* ------------------------------------------------------------------ *
 * The public tier reads no privileged data class.
 *
 * The analogue of a wrong-role test for a tier with no roles: the pages must
 * not be able to reach anything that would need authorization in the first
 * place. A public page that imports the policy module is a public page that
 * someone intended to gate.
 * ------------------------------------------------------------------ */

describe("the public tier touches only PUBLIC_CONTENT", () => {
  it("imports no authorization policy and no membership state", () => {
    for (const file of PUBLIC_SOURCES) {
      expect(file.text.includes("lib/authz/policy"), file.path).toBe(false);
      expect(file.text.includes("lib/membership/state"), file.path).toBe(false);
      expect(file.text.includes("authorize("), file.path).toBe(false);
    }
  });

  it("imports nothing from another module's lib", () => {
    for (const file of PUBLIC_SOURCES) {
      for (const owned of ["membership", "meetings", "treasury", "donations", "store"]) {
        expect(file.text.includes(`@/lib/${owned}`), `${file.path}: @/lib/${owned}`).toBe(false);
      }
    }
  });

  it("names no privileged data class in public content", () => {
    const privileged: DataClass[] = DATA_CLASSES.filter(
      (dataClass) => dataClass !== "PUBLIC_CONTENT",
    );
    for (const visit of ALL_STRINGS) {
      for (const dataClass of privileged) {
        expect(visit.value.includes(dataClass), `${visit.keyPath}: ${dataClass}`).toBe(false);
      }
    }
  });

  it("does not leak the role enum as a public directory", () => {
    // The offices are written for a reader. If the contact list were generated
    // from the authz ROLES enum it would publish the board's role structure,
    // including offices that exist only to hold permissions.
    const publishedRoles = [...JSOA_CONTACTS, ...JSOF_CONTACTS].map(
      (contact) => contact.role,
    );
    for (const role of ROLES) {
      expect(publishedRoles).not.toContain(role);
    }
    // FINANCE_REVIEW_OFFICER exists for independence and has no public remit.
    for (const contact of [...JSOA_CONTACTS, ...JSOF_CONTACTS]) {
      expect(contact.role.toLowerCase()).not.toContain("finance review");
    }
  });

  it("takes no payment and asks for no personal data", () => {
    for (const file of RENDERED_SOURCES) {
      expect(/<form\b/.test(file.text), `${file.path} renders a form`).toBe(false);
      expect(/<input\b/.test(file.text), `${file.path} renders an input`).toBe(false);
      expect(/stripe/i.test(file.text), `${file.path} references Stripe`).toBe(false);
    }
    // The membership intake must stay the only route that accepts a sponsor
    // ID, so that the public tier cannot be used to test whether a person is
    // a member. The state machine's own guarantee is asserted in
    // tests/invariants.test.ts; here we assert the public tier never calls it.
    expect(typeof membershipState.acknowledge).toBe("function");
    for (const file of PUBLIC_SOURCES) {
      expect(file.text.includes("acknowledge("), file.path).toBe(false);
      expect(file.text.includes("isWellFormedMemberId"), file.path).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * No third-party tags, scripts or fonts.
 * ------------------------------------------------------------------ */

describe("the public tier ships no third-party tag", () => {
  it("references no analytics, pixel, CDN or font host", () => {
    // public-safety.ts is the blocklist itself, so it names them by design.
    const scanned = PUBLIC_SOURCES.filter(
      (file) => file.path !== "src/app/(public)/public-safety.ts",
    );
    expect(scanned.length).toBe(PUBLIC_SOURCES.length - 1);
    for (const file of scanned) {
      for (const host of FORBIDDEN_THIRD_PARTY_HOSTS) {
        expect(file.text.includes(host), `${file.path}: ${host}`).toBe(false);
      }
    }
  });

  it("loads no script element and no external stylesheet", () => {
    for (const file of RENDERED_SOURCES) {
      expect(/<script\b/.test(file.text), file.path).toBe(false);
      expect(/next\/script/.test(file.text), file.path).toBe(false);
      expect(/dangerouslySetInnerHTML/.test(file.text), file.path).toBe(false);
    }
    for (const file of PUBLIC_SOURCES.filter((source) => source.path.endsWith(".css"))) {
      expect(/@import/.test(file.text), file.path).toBe(false);
      expect(/url\(https?:/.test(file.text), file.path).toBe(false);
    }
  });

  it("introduces no colour literal outside the pinned palette", () => {
    // The public tier is a white site and stays one whatever the reader's
    // operating system is set to, so public-shell.module.css defines a light
    // palette rather than following the dual-theme tokens in globals.css.
    // That one block is the only place in the tier allowed a colour literal;
    // everywhere else still goes through the tokens, so a component cannot
    // quietly introduce a colour the palette does not know about.
    const PALETTE_FILE = "public-shell.module.css";
    for (const file of PUBLIC_SOURCES.filter((f) => !f.path.endsWith(PALETTE_FILE))) {
      expect(/#[0-9a-fA-F]{3,8}\b/.test(file.text), `${file.path} has a hex colour`).toBe(
        false,
      );
      expect(/\brgba?\(/.test(file.text), `${file.path} has an rgb() colour`).toBe(false);
      expect(/\bhsla?\(/.test(file.text), `${file.path} has an hsl() colour`).toBe(false);
    }
  });

  it("sends an outbound link with rel=noopener", () => {
    for (const file of RENDERED_SOURCES) {
      const externalAnchors = file.text.match(/href=\{?["']https?:[^"'}]+["']\}?/g) ?? [];
      if (externalAnchors.length === 0) continue;
      expect(file.text.includes("noopener"), file.path).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Events: a date state, never a stale year.
 * ------------------------------------------------------------------ */

describe("event pages state that dates are unconfirmed rather than showing a stale year", () => {
  it("has the three recurring events at their own URLs", () => {
    expect(EVENTS.map((event) => event.slug)).toEqual([
      "ball",
      "golf-tournament",
      "triathlon",
    ]);
    for (const event of EVENTS) {
      expect(eventBySlug(event.slug)).toBe(event);
    }
    expect(eventBySlug("copy-of-2022-jsoa-golf-tournament")).toBeUndefined();
  });

  it("either confirms a date that has not passed, or says it is unconfirmed", () => {
    // This used to require every event to be TO_BE_CONFIRMED, which was right
    // while no date was settled. The rule it was really enforcing is "never
    // publish a stale date", not "never publish a date", and the Events Chair
    // has now confirmed one. So a confirmed date is allowed and is held to a
    // stricter standard instead: it must carry a venue and it must not be in
    // the past.
    //
    // That is the exact failure the live site has today, publishing a
    // scholarship deadline of 2/15/26 and a 2025 ball page as current, so the
    // replacement rule catches more than the original did.
    const today = new Date().toISOString().slice(0, 10);
    for (const event of EVENTS) {
      if (event.dates.state === "TO_BE_CONFIRMED") {
        expect(event.dates.confirmedBy).toBe("Events Chair");
        expect(event.dates.typicalTiming.length).toBeGreaterThan(0);
      } else {
        expect(/^\d{4}-\d{2}-\d{2}$/.test(event.dates.startsAt), event.slug).toBe(true);
        expect(event.dates.venue.length, event.slug).toBeGreaterThan(0);
        expect(
          event.dates.startsAt >= today,
          `${event.slug} publishes a date that has already passed: ${event.dates.startsAt}`,
        ).toBe(true);
      }
    }
  });

  it("carries no four-digit year in any event content", () => {
    const eventStrings = visitAll(EVENTS).filter(
      (visit): visit is Visit & { value: string } => typeof visit.value === "string",
    );
    for (const visit of eventStrings) {
      // `startsAt` is exempt: it is a machine-readable ISO date, not prose,
      // and the rule above already proves it has not gone stale. The ban
      // stands everywhere else, because a year written into a sentence is
      // exactly what nobody comes back to update.
      if (visit.keyPath.endsWith("dates.startsAt")) continue;
      expect(
        /\b(19|20)\d{2}\b/.test(visit.value),
        `${visit.keyPath}: ${visit.value}`,
      ).toBe(false);
    }
  });

  it("links registration and sponsorship out rather than building them", () => {
    for (const event of EVENTS) {
      // Registration may be null: ticketing is not built, and an honest
      // absence beats a link that cannot take a registration. When it does
      // exist it must still belong to the owning module rather than to this
      // one, which is what the /jsoa check enforces.
      if (event.registration !== null) {
        expect(event.registration.ownedBy, event.slug).not.toBe(undefined);
        expect(event.registration.href.startsWith("/")).toBe(true);
        expect(event.registration.href.startsWith("/jsoa"), event.slug).toBe(false);
      }
      expect(event.sponsorship.ownedBy, event.slug).toBe("foundation");
      expect(event.sponsorship.href.startsWith("/")).toBe(true);
      expect(event.sponsorship.href.startsWith("/jsof"), event.slug).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Sponsorship: acknowledgment, never advertising.
 * ------------------------------------------------------------------ */

describe("partner entries are acknowledgment only", () => {
  it("lists the three existing partners and no more", () => {
    expect(PARTNERS.map((partner) => partner.organization)).toEqual([
      "Patriot Foundation",
      "Patriot Military Family Foundation",
      "Force Network",
    ]);
  });

  it("carries no adjective, comparison, endorsement or call to action", () => {
    const partnerStrings = visitAll(PARTNERS).filter(
      (visit): visit is Visit & { value: string } => typeof visit.value === "string",
    );
    for (const visit of partnerStrings) {
      const lowered = visit.value.toLowerCase();
      for (const phrase of FORBIDDEN_SPONSOR_LANGUAGE) {
        expect(
          lowered.includes(phrase),
          `${visit.keyPath} contains "${phrase}": ${visit.value}`,
        ).toBe(false);
      }
    }
  });

  it("carries an approved acknowledgment string per partner, and nothing extra", () => {
    for (const partner of PARTNERS) {
      expect(Object.keys(partner).sort()).toEqual(
        ["acknowledgment", "logo", "organization", "relationship", "slug", "url"].sort(),
      );
      // The acknowledgment is the name. Anything more is copy nobody approved.
      expect(partner.acknowledgment).toBe(partner.organization);
      // Null is allowed, a dead link is not: anything published is https.
      if (partner.url !== null) {
        expect(partner.url.startsWith("https://")).toBe(true);
      }
    }
  });

  it("records whose mark each partner logo is before showing it", () => {
    for (const partner of PARTNERS) {
      if (partner.logo === null) continue;
      const entry = publicImage(partner.logo);
      const rights = entry.rights;
      expect(rights, `${partner.slug}: a logo with no rights record`).toBeTruthy();
      if (!rights) continue;
      // The mark belongs to them, not to us, and the record has to say so.
      expect(rights.owner).toBe(partner.organization);
      expect(rights.source.length).toBeGreaterThan(10);
    }
  });

  it("states a relationship only where there is a fact to state", () => {
    const withRelationship = PARTNERS.filter((partner) => partner.relationship !== null);
    expect(withRelationship.map((partner) => partner.slug)).toEqual(["patriot-foundation"]);
    expect(withRelationship[0].relationship).toContain("Administers");
  });
});

/* ------------------------------------------------------------------ *
 * Findability, and the shape of the tier.
 * ------------------------------------------------------------------ */

describe("every public page is findable", () => {
  const PAGES = PUBLIC_SOURCES.filter((file) => file.path.endsWith("page.tsx"));

  it("found the pages it expects to check", () => {
    const routes = PAGES.map((file) =>
      file.path.replace(/^src\/app/, "").replace(/\/page\.tsx$/, ""),
    ).sort();
    expect(routes).toEqual(
      [
        "/jsoa",
        "/jsoa/contact",
        "/jsoa/events",
        "/jsoa/events/[event]",
        "/jsoa/family-support",
        "/jsoa/membership",
        "/jsoa/mission",
        "/jsoa/scholarships",
        "/jsof",
        "/jsof/contact",
        "/jsof/events",
        "/jsof/memorial",
        "/jsof/mission",
        "/jsof/partners",
        "/jsof/scholarships",
        "/jsof/scholarships/[programme]",
        "/jsof/why-the-foundation",
      ].sort(),
    );
  });

  it("gives each page a title and a meta description", () => {
    for (const page of PAGES) {
      const hasStaticMetadata = /export const metadata: Metadata/.test(page.text);
      const hasGeneratedMetadata = /export async function generateMetadata/.test(page.text);
      expect(hasStaticMetadata || hasGeneratedMetadata, page.path).toBe(true);
      expect(/title:/.test(page.text), `${page.path} has no title`).toBe(true);
      expect(/description:/.test(page.text), `${page.path} has no description`).toBe(true);
    }
  });

  it("declares a canonical URL per topic", () => {
    for (const page of PAGES) {
      expect(/alternates: \{ canonical:/.test(page.text), page.path).toBe(true);
    }
  });

  it("gives each page exactly one h1, through a shared component", () => {
    // Two components render an h1: PageHead on a plain page, and Hero on the
    // pages that open with the dark photographic band. The rule is unchanged,
    // one h1 per page from shared code, so a page must use exactly one of
    // them and may still never write the tag itself.
    for (const page of PAGES) {
      expect(/<h1\b/.test(page.text), `${page.path} writes its own h1`).toBe(false);
      const heads = page.text.match(/<(PageHead|Hero)\b/g) ?? [];
      expect(heads.length, `${page.path} h1 source count`).toBe(1);
    }
  });

  it("writes no heading tag directly, so the outline cannot skip a level", () => {
    // Headings come from PageHead (h1), Section and Callout (h2), and SubHead
    // and Cards (h3). A page that writes its own tag is a page that can put an
    // h3 above the first h2, which is how a screen-reader outline breaks.
    for (const page of PAGES) {
      // h1 and h2 are the shared blocks' to emit. A page never writes one.
      expect(/<h1\b/.test(page.text), `${page.path} writes an h1`).toBe(false);
      expect(/<h2\b/.test(page.text), `${page.path} writes an h2`).toBe(false);
      // An h3 is allowed, but only below a Section that has already opened an
      // h2 above it.
      const firstH3 = page.text.indexOf("<h3");
      if (firstH3 !== -1) {
        const firstSection = page.text.indexOf("<Section");
        expect(firstSection, `${page.path} has an h3 with no Section`).not.toBe(-1);
        expect(firstSection, `${page.path} has an h3 above its first Section`).toBeLessThan(
          firstH3,
        );
      }
    }
    const blocks = PUBLIC_SOURCES.find((file) => file.path === "src/app/(public)/blocks.tsx");
    expect(blocks).toBeDefined();
    expect(blocks!.text).toContain("<h1 className={styles.title}>");
    expect(blocks!.text).toContain("<h2 className={styles.sectionTitle}");
    expect(blocks!.text).toContain("<h2 className={styles.calloutTitle}>");
  });

  it("generates a static path for every event", () => {
    const eventPage = PUBLIC_SOURCES.find(
      (file) => file.path === "src/app/jsoa/events/[event]/page.tsx",
    );
    expect(eventPage).toBeDefined();
    expect(eventPage!.text).toContain("generateStaticParams");
    expect(eventPage!.text).toContain("generateMetadata");
  });

  it("uses the shared shell on every page, so header, nav and footer match", () => {
    for (const page of PAGES) {
      expect(page.text.includes("<PublicShell"), page.path).toBe(true);
    }
  });

  it("does not create a route inside the (public) group", () => {
    // `(public)` holds the shell and the content. A page or layout there would
    // collide with the read-only front door at src/app/page.tsx.
    const inGroup = PUBLIC_SOURCES.filter((file) => file.path.includes("src/app/(public)/"));
    expect(inGroup.length).toBeGreaterThan(0);
    for (const file of inGroup) {
      expect(/\/(page|layout|route|template)\.tsx?$/.test(file.path), file.path).toBe(false);
    }
  });

  it("leaves the front door alone", () => {
    const frontDoor = readFileSync(join(REPO_ROOT, "src/app/page.tsx"), "utf8");
    expect(frontDoor).toContain("The split front door");
    expect(frontDoor).toContain('href="/jsoa"');
    expect(frontDoor).toContain('href="/jsof"');
  });
});

describe("the two entity tiers are structurally identical and hue-separated", () => {
  it("gives each entity a nav, a home and a crossover to the other", () => {
    for (const profile of [JSOA_PROFILE, JSOF_PROFILE]) {
      expect(profile.nav.length).toBeGreaterThanOrEqual(5);
      expect(profile.home).toBe(`/${profile.shortName.toLowerCase()}`);
      expect(profile.crossover.href).not.toBe(profile.home);
      expect(profile.crossover.because.length).toBeGreaterThan(0);
    }
    expect(JSOA_PROFILE.crossover.href).toBe(JSOF_PROFILE.home);
    expect(JSOF_PROFILE.crossover.href).toBe(JSOA_PROFILE.home);
  });

  it("separates the entities by hue class, not by a colour value", () => {
    expect(JSOA_PROFILE.hueClass).toBe("jsoaHue");
    expect(JSOF_PROFILE.hueClass).toBe("jsofHue");
    const shell = PUBLIC_SOURCES.find(
      (file) => file.path === "src/app/(public)/public-shell.module.css",
    );
    expect(shell).toBeDefined();
    expect(shell!.text).toContain("--hue: var(--jsoa)");
    expect(shell!.text).toContain("--hue: var(--jsof)");
  });

  it("keeps each entity's nav inside its own tier, except where it links out", () => {
    const otherModuleRoutes = ["/apply", "/store", "/donate"];
    for (const profile of [JSOA_PROFILE, JSOF_PROFILE]) {
      for (const item of profile.nav) {
        if (otherModuleRoutes.includes(item.href)) {
          expect(item.ownedBy, item.href).toBeDefined();
        } else {
          expect(item.href.startsWith(profile.home), item.href).toBe(true);
          expect(item.ownedBy).toBeUndefined();
        }
      }
    }
  });

  it("gives every office a remit and a response time", () => {
    for (const entity of ["JSOA", "JSOF"] as const) {
      const contacts = CONTACTS_BY_ENTITY[entity];
      expect(contacts.length).toBeGreaterThan(0);
      for (const contact of contacts) {
        expect(contact.entity, contact.slug).toBe(entity);
        expect(contact.remit.length, contact.slug).toBeGreaterThan(20);
        expect(contact.respondsWithin, contact.slug).toMatch(/business days?$/);
        expect(contact.mailbox, contact.slug).toContain("@");
      }
    }
  });

  it("gives family support a named owning office and a stated response time", () => {
    const owner = CONTACTS_BY_ENTITY.JSOA.find(
      (contact) => contact.slug === "family-support-chair",
    );
    expect(owner).toBeDefined();
    expect(owner!.role).toBe("Family Support Chair");
    expect(owner!.respondsWithin).toBe("two business days");
    const page = PUBLIC_SOURCES.find(
      (file) => file.path === "src/app/jsoa/family-support/page.tsx",
    );
    expect(page).toBeDefined();
    expect(page!.text).toContain("contactBySlug");
  });

  it("assigns every line of effort to exactly one entity", () => {
    expect(LINES_OF_EFFORT.length).toBe(3);
    for (const line of LINES_OF_EFFORT) {
      expect(ENTITY_PROFILES[line.carriedBy]).toBeDefined();
      expect(line.href.startsWith(ENTITY_PROFILES[line.carriedBy].home)).toBe(true);
    }
    // Two charitable, one membership. Summing them into one figure is the thing
    // ARCHITECTURE.md forbids, so they are never presented as a single total.
    expect(LINES_OF_EFFORT.filter((line) => line.carriedBy === "JSOF").length).toBe(2);
    expect(LINES_OF_EFFORT.filter((line) => line.carriedBy === "JSOA").length).toBe(1);
  });
});
