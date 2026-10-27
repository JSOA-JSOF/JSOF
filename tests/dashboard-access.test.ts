/**
 * Every role dashboard refuses a role that holds nothing.
 *
 * Six agents built six dashboards, each scoped to two files, which meant none
 * of them could write the wrong-role test the module brief requires. That was
 * a scoping mistake on the integration side, not theirs — all six flagged it.
 * This closes it in one place.
 *
 * It also asserts the rule the dashboards are actually built on, which is
 * easier to break than a refusal: a figure a reader may not see is WITHHELD,
 * never zero. Zero is a measurement and a reader acting on a false zero is the
 * failure these screens exist to prevent. A tile that is withheld or not yet
 * measurable carries `value: null`; it never carries "0".
 */

import { describe, expect, it } from "vitest";

import { AuthzError } from "../src/lib/authz/policy";
import { personaById, subjectFor } from "../src/lib/authz/personas";
import type { Subject } from "../src/lib/authz/policy";
import type { Kpi } from "../src/components/dashboard/Kpi";

import { loadScholarshipsDashboard } from "../src/lib/scholarships/kpis";
import { newScholarshipRepository } from "../src/lib/scholarships/repository";
import { loadMembershipDashboard } from "../src/lib/membership/kpis";
import { newMembershipRepository } from "../src/lib/membership/repository";
import { treasuryKpis } from "../src/lib/treasury/kpis";
import { secretaryDashboard } from "../src/lib/meetings/kpis";
import { readDonationsDashboard } from "../src/lib/donations/kpis";
import { storeKpis } from "../src/lib/store/kpis";

function actor(id: string): Subject {
  return subjectFor(personaById(id));
}

/** Holds no grant anywhere. Every dashboard must refuse or withhold entirely. */
const NOBODY = () => actor("member");

/** Every grant the President holds, but the second factor was not completed. */
const NO_MFA = () => actor("president-no-mfa");

type DashboardCase = {
  name: string;
  /** Resolves the tiles, or throws if the whole read is refused. */
  read: (subject: Subject) => Promise<Kpi[]> | Kpi[];
  /** The role this dashboard is for, used to prove it is not refusing everyone. */
  owner: string;
};

const DASHBOARDS: DashboardCase[] = [
  {
    name: "scholarships",
    owner: "scholarships",
    read: async (subject) => {
      const dashboard = await loadScholarshipsDashboard(
        newScholarshipRepository({ seed: true }),
        subject,
      );
      return [...dashboard.thisCycle, ...dashboard.sinceInception];
    },
  },
  {
    name: "membership",
    owner: "vp-membership",
    read: async (subject) =>
      (await loadMembershipDashboard(newMembershipRepository({ seed: true }), subject)).kpis,
  },
  {
    name: "treasury",
    owner: "treasurer-jsoa",
    read: (subject) => treasuryKpis(subject),
  },
  {
    name: "meetings",
    owner: "secretary",
    read: async (subject) => (await secretaryDashboard(subject)).kpis,
  },
  {
    name: "donations",
    owner: "treasurer-jsof",
    read: async (subject) => (await readDonationsDashboard(subject, "JSOF")).kpis,
  },
  {
    name: "store",
    owner: "store-chair",
    read: (subject) => storeKpis(subject),
  },
];

/**
 * Refused outright, or every figure withheld. Both are correct answers; what
 * is never correct is a figure.
 */
async function assertTellsNothing(read: DashboardCase["read"], subject: Subject) {
  let kpis: Kpi[];
  try {
    kpis = await read(subject);
  } catch (error) {
    expect(error).toBeInstanceOf(AuthzError);
    return;
  }
  // Not refused, so no tile may carry a figure. The assertion is "no number",
  // not "exactly null": what matters is that a reader without scope is never
  // shown a quantity they could act on.
  for (const kpi of kpis) {
    expect(kpi.value ?? "", `${kpi.key} leaked a figure`).not.toMatch(/\d/);
  }
}

describe("role dashboards refuse a role that holds nothing", () => {
  for (const dashboard of DASHBOARDS) {
    it(`${dashboard.name} tells a member nothing`, async () => {
      await assertTellsNothing(dashboard.read, NOBODY());
    });

    it(`${dashboard.name} tells an unauthenticated second factor nothing`, async () => {
      // Every grant the President holds, defeated by the MFA gate alone.
      await assertTellsNothing(dashboard.read, NO_MFA());
    });

    it(`${dashboard.name} does show its own role something`, async () => {
      // The other half of the assertion. A dashboard that refuses everyone
      // passes the tests above and is useless, which is the failure mode of
      // writing only the negative case.
      const kpis = await dashboard.read(actor(dashboard.owner));
      expect(kpis.length, `${dashboard.name} returned no tiles`).toBeGreaterThan(0);
      expect(
        kpis.some((kpi) => kpi.value !== null),
        `${dashboard.name} withheld everything from its own role`,
      ).toBe(true);
    });
  }
});

describe("a withheld figure is never a zero", () => {
  it("no tile on any dashboard reports a bare zero to a role that cannot see it", async () => {
    // The specific confusion this guards against: a reader cannot tell whether
    // "0 outstanding" means nothing is outstanding or that they may not know.
    for (const dashboard of DASHBOARDS) {
      let kpis: Kpi[] = [];
      try {
        kpis = await dashboard.read(NOBODY());
      } catch {
        continue; // Refused outright, which tells them nothing. Fine.
      }
      for (const kpi of kpis) {
        expect(kpi.value ?? "", `${dashboard.name}/${kpi.key}`).not.toMatch(/\d/);
      }
    }
  });

  it("every tile that cannot be measured says what it needs", async () => {
    // Rule 1 of the dashboard brief. A null value with no explanation is just
    // a blank tile, which reads as broken rather than as honest.
    for (const dashboard of DASHBOARDS) {
      const kpis = await dashboard.read(actor(dashboard.owner));
      for (const kpi of kpis.filter((k) => k.value === null)) {
        expect(
          (kpi.needs ?? "").length + (kpi.from ?? "").length,
          `${dashboard.name}/${kpi.key} is blank with no explanation`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("every tile carries its provenance", async () => {
    for (const dashboard of DASHBOARDS) {
      const kpis = await dashboard.read(actor(dashboard.owner));
      for (const kpi of kpis) {
        expect(kpi.from, `${dashboard.name}/${kpi.key} has no from line`).toBeTruthy();
      }
    }
  });
});
