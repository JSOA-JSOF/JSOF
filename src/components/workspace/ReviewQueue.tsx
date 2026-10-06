"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "./workspace.module.css";
import type { QueueApplication, QueueState } from "./types";

/**
 * One application at a time.
 *
 * A list of 150 is a wall; a queue of one is a task. Everything here exists to
 * cut the cost of two moments: restarting after days away, and scoring the
 * fortieth application in a sitting. See docs/WORKSPACE-DESIGN.md.
 */

const SCORES = [1, 2, 3, 4, 5] as const;

/** After this many in one sitting, offer a pause. Once, and never again. */
const PAUSE_SUGGESTED_AFTER = 20;

/** Half a point of drift is enough to be worth telling someone about. */
const DRIFT_THRESHOLD = 0.5;

export function ReviewQueue({
  application,
  state,
  onScore,
}: {
  application: QueueApplication | null;
  state: QueueState;
  onScore?: (id: string, score: number) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [pauseDismissed, setPauseDismissed] = useState(false);

  // A new application clears the previous choice rather than carrying it
  // forward, which would turn a default into an accidental score.
  useEffect(() => {
    setPicked(null);
  }, [application?.id]);

  const commit = useCallback(
    (score: number) => {
      if (!application) return;
      setPicked(score);
      onScore?.(application.id, score);
    },
    [application, onScore],
  );

  // Keyboard scoring. The point is flow: at 150 applications, reaching for a
  // mouse for every one is most of the friction.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const n = Number(event.key);
      if (Number.isInteger(n) && n >= 1 && n <= 5) {
        event.preventDefault();
        commit(n);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit]);

  const drift = useMemo(() => {
    if (state.sessionAverage === null || state.cycleAverage === null) return null;
    const delta = state.sessionAverage - state.cycleAverage;
    return {
      delta,
      notable: Math.abs(delta) >= DRIFT_THRESHOLD,
      direction: delta < 0 ? "harder" : "more generously",
    };
  }, [state.sessionAverage, state.cycleAverage]);

  const showPause = state.thisSession >= PAUSE_SUGGESTED_AFTER && !pauseDismissed;
  const pct = state.total === 0 ? 0 : Math.round((state.reviewed / state.total) * 100);

  if (!application) {
    return (
      <div className={styles.card}>
        <p className={styles.essay}>
          Nothing is waiting for you. Every application in this cycle has been
          scored.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      {/* Resumption. The first thing read after four days away, and the whole
          reason the workspace does not open on a dashboard. */}
      <div className={styles.resume}>
        <span className={styles.resumeLine}>
          Pick up where you left off — application {state.reviewed + 1} of {state.total}
        </span>
        <span className={styles.resumeMeta}>
          {state.total - state.reviewed} left to score
        </span>
      </div>

      <div className={styles.progress}>
        <div className={styles.progressHead}>
          <span>Scored this cycle</span>
          <span className={styles.progressCount}>
            {state.reviewed} / {state.total} · {pct}%
          </span>
        </div>
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-valuenow={state.reviewed}
          aria-valuemin={0}
          aria-valuemax={state.total}
          aria-label="Applications scored this cycle"
        >
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.applicant}>{application.applicantName}</span>
          <span className={styles.position}>
            {state.reviewed + 1} of {state.total}
          </span>
        </div>

        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>School</dt>
            <dd>{application.school}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Programme</dt>
            <dd>{application.programme}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Year</dt>
            <dd>{application.yearOfStudy}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Sponsor</dt>
            <dd>{application.sponsorMemberId}</dd>
          </div>
        </dl>

        <p className={styles.essay}>{application.statement}</p>

        {application.withheld ? (
          <p className={styles.withheld}>
            <span className={styles.withheldTag}>Withheld</span>
            <span>
              {application.withheld.label}. {application.withheld.reason}
            </span>
          </p>
        ) : null}

        <div className={styles.scoreRow}>
          <span className={styles.scoreLabel}>Score</span>
          {SCORES.map((n) => (
            <button
              key={n}
              type="button"
              className={`${styles.score} ${picked === n ? styles.scoreOn : ""}`}
              aria-pressed={picked === n}
              onClick={() => commit(n)}
            >
              {n}
            </button>
          ))}
          <span className={styles.keys}>
            press <kbd>1</kbd>–<kbd>5</kbd>
          </span>
        </div>

        {/* Session meter and drift. Informational, never corrective: the
            system does not adjust her scores, it tells her what they look
            like so she can decide. */}
        <div className={styles.session}>
          <span>
            <span className={styles.sessionFigure}>{state.thisSession}</span> scored
            in this sitting
          </span>
          {drift ? (
            <span className={`${styles.drift} ${drift.notable ? styles.driftFlag : ""}`}>
              {drift.notable ? (
                <>
                  You are scoring {Math.abs(drift.delta).toFixed(1)} {drift.direction}{" "}
                  than your average for this cycle
                </>
              ) : (
                <>Scoring in line with your average for this cycle</>
              )}
            </span>
          ) : null}
        </div>

        {showPause ? (
          <div className={styles.pause}>
            <p style={{ margin: "0 0 8px" }}>
              You have scored {state.thisSession} in this sitting. Consistency
              tends to slip after a long run, and the next twenty will be judged
              against the same scale as the first twenty. This is a good place to
              stop — the queue will open here when you come back.
            </p>
            <button
              type="button"
              className={styles.undo}
              onClick={() => setPauseDismissed(true)}
            >
              Keep going
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
