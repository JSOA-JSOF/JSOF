import Link from "next/link";

import { KpiGrid } from "@/components/dashboard/Kpi";
import { ENTITIES } from "@/lib/authz/model";
import { getCurrentPersona, getCurrentSubject } from "@/lib/authz/session";
import { readableEntities } from "@/lib/meetings/access";
import { NOTICE_BASIS_NOTE } from "@/lib/meetings/distribution";
import { secretaryDashboard, splitHeadlineKpis } from "@/lib/meetings/kpis";
import { HORIZON_NOTE } from "@/lib/meetings/workspace";
import { Refused, Shell } from "../Shell";
import styles from "../meetings.module.css";

export const metadata = { title: "Dashboard — Secretary" };

/**
 * The Dashboard tab. Three figures, then everything else behind a disclosure.
 *
 * It used to be seven tiles on the landing screen. A volunteer looking at
 * seven numbers has none, so this cuts to the three that would change what the
 * Secretary does tonight; `HEADLINE_KPI_KEYS` in `kpis.ts` carries the
 * reasoning for each, including why the other four are not here.
 *
 * Each tile is already two numbers, one per book, in fixed order. That is one
 * idea rendered twice rather than two of the three, and a blended total would
 * defeat the control two separate minute books exist to provide.
 *
 * The doing moved to the Overview tab. This tab keeps the figures.
 */
export default async function SecretaryDashboardTab() {
  const persona = await getCurrentPersona();
  const subject = await getCurrentSubject();
  const visible = readableEntities(subject, ENTITIES);

  // One authorized read, guarded per entity inside the library before it
  // touches the repository.
  const dashboard = await secretaryDashboard(subject);
  const { headline, more } = splitHeadlineKpis(dashboard.kpis);

  if (visible.length === 0) {
    return (
      <Shell entity={null} meetingId={null} active="dashboard" persona={persona}>
        <p className={styles.eyebrow}>Secretary &middot; Dashboard</p>
        <h1 className={styles.title}>Whether the record is actually complete</h1>
        <Refused
          reason={`${persona.label} holds no board grant on member data for either entity. Every figure is withheld rather than shown as zero: the two are not the same answer, and a tile reading nought would be a measurement this reader is not entitled to.`}
        />
      </Shell>
    );
  }

  return (
    <Shell entity={null} meetingId={null} active="dashboard" persona={persona}>
      <p className={styles.eyebrow}>Secretary &middot; Dashboard</p>
      <h1 className={styles.title}>Whether the record is actually complete</h1>
      <p className={styles.lede}>
        An incomplete minute book is only ever discovered when somebody needs
        it, which is the worst available moment to find out. These three figures
        measure that one thing. Every one of them is reported per entity and
        never added together.
      </p>
      <p className={styles.rowMeta}>
        As of {dashboard.asOf} &middot; three figures, the rest below
      </p>

      <KpiGrid kpis={headline} />

      <div className={styles.quiet}>
        <strong>Why these three.</strong> A decision closed with no motion
        recorded is the failure this office exists to prevent, and the only one
        here the board cannot go back and fix from memory. Minute books ready
        answers the prior question of whether a book exists at all for an
        evening already held. Filings due is the only figure with an outside
        deadline and a consequence that cannot be cured afterwards, and it is
        where the quarantined calendar entries are named, so nobody mistakes
        them for duties.
      </div>

      {dashboard.minuteEntities.length === 0 && visible.length > 0 && (
        <div className={styles.quiet}>
          This role reads the meeting list and the compliance calendar but not
          the minute book itself, which names who moved, who seconded and who
          recused. The figures that come out of the book are withheld above,
          which is different from zero and different from absent. Custody is a
          separate question again: writing in the book requires the office of
          Secretary for that entity, not merely access to it.
        </div>
      )}

      {visible.length === 1 && (
        <div className={styles.quiet}>
          This role reaches {visible[0]} only. The other entity&rsquo;s figures
          are withheld, not counted as zero. That is the boundary working rather
          than an error.
        </div>
      )}

      <div className={styles.quiet}>
        <strong>What follows from these figures is on the Overview tab.</strong>{" "}
        {dashboard.actions.length === 0 ? (
          <>
            Nothing is outstanding within this role&rsquo;s reach, which is
            either a complete record or a record out of view, and the figures
            above say which.
          </>
        ) : (
          <>
            <Link href="/board/meetings">
              {dashboard.actions.length}{" "}
              {dashboard.actions.length === 1 ? "task is" : "tasks are"} waiting
              there
            </Link>
            , each derived from these same figures and each saying what it
            blocks. A dashboard that only reports is a report.
          </>
        )}
      </div>

      <details className={styles.disclose}>
        <summary>More figures ({more.length})</summary>
        <p className={styles.sectionNote}>
          Worth having, and not worth a headline. Two of them are held at target
          by a refusal in the save path rather than by anybody&rsquo;s
          diligence, one is hygiene inside work the second tile already counts,
          and one is measured against a period this platform invented. The
          provenance line on each says which.
        </p>
        <div style={{ marginTop: 14 }}>
          <KpiGrid kpis={more} />
        </div>
      </details>

      <div className={styles.quiet}>
        <strong>The standard the notice figure is measured against.</strong>{" "}
        {NOTICE_BASIS_NOTE}
      </div>

      <div className={styles.quiet}>
        <strong>The window &ldquo;due&rdquo; means.</strong> {HORIZON_NOTE}
      </div>

      <h2 className={styles.sectionHead}>Minute reference format</h2>
      <p className={styles.sectionNote}>
        Other modules point at minutes by reference, and an inter-entity
        transfer cannot be recorded without one on both sides. The format
        carries the entity in the string, because a bare item number is exactly
        the ambiguity two books exist to prevent.
      </p>
      <pre className={styles.pre}>
        {`JSOA-2026-10-min-4
└──┘ └──┘ └┘     └┘
 │    │    │      └ item number in that meeting's adopted agenda
 │    │    └─────── calendar month, two digits
 │    └──────────── calendar year
 └───────────────── entity

JSOF-2026-10-S2-min-2   second meeting of that entity in the month
JSOA-2026-10            the whole book for that meeting`}
      </pre>
    </Shell>
  );
}
