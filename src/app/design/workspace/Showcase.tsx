"use client";

import { useState } from "react";

import { AwardBands } from "@/components/workspace/AwardBands";
import { ReviewQueue } from "@/components/workspace/ReviewQueue";
import { SendGate } from "@/components/workspace/SendGate";
import styles from "@/components/workspace/workspace.module.css";
import type {
  AwardBand,
  AwardException,
  CycleSummary,
  NotificationPreview,
  QueueApplication,
  QueueState,
} from "@/components/workspace/types";

/**
 * Standalone showcase of the Scholarships Chair's workspace, so the experience
 * can be reviewed before the scholarships module lands and these components are
 * wired to its real queries.
 *
 * All names, schools and figures are fictional. The counts mirror the real
 * cycle (150 applications, 119 merit awards) so the screens show the density
 * the chair actually faces rather than a tidy demo of six rows.
 */

const APPLICATION: QueueApplication = {
  id: "app-048",
  applicantName: "Marisol Trevino",
  school: "North Carolina State University",
  programme: "Mechanical Engineering",
  yearOfStudy: "Sophomore",
  sponsorMemberId: "JSOA-2019-0143",
  statement:
    "I want to design prosthetics. My father came home in 2014 and spent two " +
    "years learning to walk again on a socket that never fitted properly, and " +
    "I watched him take it off at the end of every day. The clinic told us " +
    "that was normal. I do not think it should be normal. My second-year " +
    "project is a pressure-mapping liner that logs where a socket is loading " +
    "wrong, so a prosthetist can see six weeks of data instead of asking " +
    "someone to describe the pain.",
  withheld: {
    label: "Disability documentation is not shown to scorers",
    reason:
      "It decides the Wounded Patriot award, which the Scholarships Chair " +
      "verifies separately. Your score is for merit only.",
  },
};

const QUEUE: QueueState = {
  reviewed: 47,
  total: 150,
  thisSession: 21,
  sessionAverage: 2.9,
  cycleAverage: 3.5,
};

const BANDS: AwardBand[] = [
  { key: "b5", label: "Top", from: 4.6, to: 5.0, defaultAmountCents: 500_000, count: 3 },
  { key: "b4", label: "High", from: 4.0, to: 4.5, defaultAmountCents: 250_000, count: 18 },
  { key: "b3", label: "Strong", from: 3.4, to: 3.9, defaultAmountCents: 150_000, count: 41 },
  { key: "b2", label: "Good", from: 2.8, to: 3.3, defaultAmountCents: 100_000, count: 37 },
  { key: "b1", label: "Qualifying", from: 2.0, to: 2.7, defaultAmountCents: 50_000, count: 20 },
];

const EXCEPTIONS: AwardException[] = [
  {
    id: "e1",
    applicantName: "Dylan Okafor",
    kind: "BOARD_DEPENDENT",
    note:
      "Dependent of a serving board member. Goes to the full board with that " +
      "member recused, and you cannot approve it here.",
  },
  {
    id: "e2",
    applicantName: "Priya Raghunathan",
    kind: "BAND_BOUNDARY",
    note:
      "Scored 3.95, one hundredth below the High band. The difference is " +
      "$1,000, so it should be a decision rather than a rounding rule.",
  },
  {
    id: "e3",
    applicantName: "Caleb Mwangi",
    kind: "BAND_BOUNDARY",
    note: "Scored 4.0 exactly, on the boundary. Same $1,000 question.",
  },
];

const PREVIEW: NotificationPreview = {
  applicantName: "Marisol Trevino",
  applicantEmail: "m.trevino@example.edu",
  sponsorName: "Sponsoring member, JSOA-2019-0143",
  sponsorEmail: "sponsor@example.org",
  subject: "Your JSOF Merit Scholarship award",
  bodyTemplate:
    "Marisol — the Joint Special Operations Foundation has awarded you a Merit " +
    "Scholarship of {{award}} for the coming academic year. Payment goes " +
    "directly to North Carolina State University against your student account; " +
    "you do not need to do anything to claim it. Your sponsoring member is " +
    "copied here so they know it has been settled.",
  awardAmountCents: 150_000,
};

const SUMMARY: CycleSummary = {
  studentsNotified: 119,
  totalAwardedCents: 17_150_000,
  schoolsPaid: 64,
  cycleLabel: "The 2027 Merit cycle",
};

const TABS = [
  { key: "review", label: "Review a queue of 150" },
  { key: "awards", label: "Set the awards" },
  { key: "send", label: "Send 119 notifications" },
] as const;

export function Showcase() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("review");

  return (
    <div>
      <div className={styles.tabs} role="tablist">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`${styles.tab} ${tab === item.key ? styles.tabOn : ""}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "review" ? (
        <ReviewQueue application={APPLICATION} state={QUEUE} />
      ) : null}

      {tab === "awards" ? (
        <AwardBands bands={BANDS} exceptions={EXCEPTIONS} budgetCents={18_000_000} />
      ) : null}

      {tab === "send" ? (
        <SendGate preview={PREVIEW} queued={119} summary={SUMMARY} />
      ) : null}
    </div>
  );
}
