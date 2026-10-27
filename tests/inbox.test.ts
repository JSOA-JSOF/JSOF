import { describe, expect, it } from "vitest";

import { ROLES } from "../src/lib/authz/model";
import { ROUTING_RULES, allMatches, routeByRules } from "../src/lib/inbox/routing";

/**
 * Routing tests are written as the messages people actually send, not as
 * keyword probes. A rule that only passes when the test uses the same
 * word the rule does has not been tested.
 */

describe("the inbox places a message with a rule", () => {
  const cases: { why: string; subject: string | null; body: string; role: string }[] = [
    {
      why: "a mother asking about her son's name, mentioning money",
      subject: "My son",
      body:
        "My son was killed in 2011 and I was told there may be a way to have " +
        "his name added to the memorial. I can send a cheque if that is what " +
        "is needed.",
      role: "MEMORIAL_CHAIR",
    },
    {
      why: "a family in trouble, never using the words family support",
      subject: null,
      body:
        "I am a widow and we are behind on rent this month. Somebody at the " +
        "ball said the association sometimes helps.",
      role: "FAMILY_SUPPORT_CHAIR",
    },
    {
      why: "a parent on a scholarship, without naming a programme",
      subject: "Question about applying",
      body: "My daughter is applying to college next year. Is she eligible to apply?",
      role: "SCHOLARSHIPS_CHAIR",
    },
    {
      why: "somebody wanting to join",
      subject: "Joining",
      body: "I retired in 2019 and would like to join the association. What are the dues?",
      role: "VP_MEMBERSHIP",
    },
    {
      why: "a store problem",
      subject: "Wrong size",
      body: "The polo I received is a large and I ordered a 2XL. Can I return it?",
      role: "STORE_CHAIR",
    },
    {
      why: "a company offering money",
      subject: "Sponsorship",
      body: "Our company would like to sponsor next year at the gold level. Who do I speak to?",
      role: "FUNDRAISING_CHAIR",
    },
    {
      why: "a donor who needs the EIN",
      subject: "Matching gift",
      body: "My employer will match my donation but the portal is asking for your EIN.",
      role: "TREASURER",
    },
    {
      why: "an attendee asking about the tournament",
      subject: "Golf",
      body: "Is there still room in the tournament? I can bring a foursome.",
      role: "EVENTS_CHAIR",
    },
    {
      why: "a broken site",
      subject: null,
      body: "The donate page keeps giving me an error message when I press continue.",
      role: "WEBMASTER",
    },
    {
      why: "a reporter",
      subject: "Story",
      body: "I am a reporter with the Fayetteville Observer working on a piece about the memorial.",
      role: "COMMUNICATIONS_CHAIR",
    },
  ];

  for (const example of cases) {
    it(example.why, () => {
      expect(routeByRules(example.subject, example.body).role).toBe(example.role);
    });
  }
});

describe("the inbox is careful about what it does not know", () => {
  it("leaves a message it cannot place unplaced rather than guessing", () => {
    const decision = routeByRules("Hello", "Can someone call me back please. Thanks, Bill");
    expect(decision.role).toBe("UNPLACED");
    expect(decision.entity).toBeNull();
  });

  it("puts bereavement ahead of money when a message is about both", () => {
    // The reporter case above and this one are the two that would be
    // routed wrongly by a naive most-keywords-wins approach.
    const decision = routeByRules(
      "Donation",
      "I would like to make a donation in memory of a fallen teammate and get a receipt.",
    );
    expect(decision.role).toBe("MEMORIAL_CHAIR");
  });

  it("puts a family in trouble ahead of the store", () => {
    const decision = routeByRules(
      null,
      "We are struggling since my husband passed and I had to return the coin I ordered.",
    );
    expect(decision.role).toBe("FAMILY_SUPPORT_CHAIR");
  });

  it("surfaces every rule that matched, so a mixed message is visible", () => {
    const matches = allMatches(
      "Paver and refund",
      "I want a paver for the memorial, and also a refund on my order.",
    );
    expect(matches.length).toBeGreaterThan(1);
    expect(matches[0]).toContain("memorial");
  });

  it("gives a reason for every decision, including the refusal", () => {
    expect(routeByRules(null, "nothing in here at all").basis).toBe("no rule matched");
    expect(routeByRules(null, "about my dues").basis.length).toBeGreaterThan(5);
  });
});

describe("the rule table itself", () => {
  it("names only roles that exist", () => {
    const known = new Set<string>(ROLES);
    for (const rule of ROUTING_RULES) {
      expect(known.has(rule.role), `${rule.name}: unknown role ${rule.role}`).toBe(true);
    }
  });

  it("gives every rule a name a board member could read in a queue", () => {
    for (const rule of ROUTING_RULES) {
      expect(rule.name.length, `${rule.role} rule has no usable name`).toBeGreaterThan(8);
      expect(rule.name).toBe(rule.name.toLowerCase());
      expect(rule.patterns.length).toBeGreaterThan(0);
    }
  });

  it("has no two rules with the same name, so basis identifies one rule", () => {
    const names = ROUTING_RULES.map((rule) => rule.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
