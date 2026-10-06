"use client";

import { useActionState, useState } from "react";

import type { Entity } from "@/lib/authz/model";
import { saveMinuteAction } from "@/lib/meetings/actions";
import { DRAFT_MARKER } from "@/lib/meetings/transcript";
import {
  MOTION_OUTCOMES,
  RECUSAL_BASES,
  RECUSAL_BASIS_LABELS,
  type AgendaItem,
  type Attendee,
  type MinuteEntry,
} from "@/lib/meetings/types";
import styles from "../../meetings.module.css";

type RecusalDraft = {
  key: string;
  personId: string;
  displayName: string;
  basis: string;
  reason: string;
  withdrew: boolean;
};

function seedRecusals(entry: MinuteEntry | undefined): RecusalDraft[] {
  return (entry?.recusals ?? []).map((r, index) => ({
    key: `${r.personId}-${index}`,
    personId: r.personId,
    displayName: r.displayName,
    basis: r.basis,
    reason: r.reason,
    withdrew: r.withdrewFromRoom,
  }));
}

export function MinuteEditor({
  meetingId,
  entity,
  item,
  entry,
  attendees,
}: {
  meetingId: string;
  entity: Entity;
  item: AgendaItem;
  entry: MinuteEntry | undefined;
  attendees: Attendee[];
}) {
  const [state, action, pending] = useActionState(saveMinuteAction, null);
  const [recusals, setRecusals] = useState<RecusalDraft[]>(() => seedRecusals(entry));
  const [hasMotion, setHasMotion] = useState(Boolean(entry?.motion));
  const [tallyGiven, setTallyGiven] = useState(Boolean(entry?.motion?.tally));
  const [omitEntity, setOmitEntity] = useState(false);
  const [moverId, setMoverId] = useState(entry?.motion?.movedByPersonId ?? "");
  const [seconderId, setSeconderId] = useState(entry?.motion?.secondedByPersonId ?? "");

  const nameOf = (personId: string) =>
    attendees.find((a) => a.personId === personId)?.displayName ?? "";

  const addRecusal = () =>
    setRecusals((current) => [
      ...current,
      {
        key: `new-${current.length}-${Date.now()}`,
        personId: "",
        displayName: "",
        basis: "OTHER",
        reason: "",
        withdrew: false,
      },
    ]);

  const update = (key: string, patch: Partial<RecusalDraft>) =>
    setRecusals((current) =>
      current.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );

  const drop = (key: string) =>
    setRecusals((current) => current.filter((r) => r.key !== key));

  const stillMarked =
    (entry?.discussion.includes(DRAFT_MARKER) ?? false) ||
    (entry?.motion?.text.includes(DRAFT_MARKER) ?? false) ||
    (entry?.recusals ?? []).some((r) => r.reason.includes(DRAFT_MARKER));

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="meetingId" value={meetingId} />
      <input type="hidden" name="agendaItemId" value={item.id} />
      {entry && <input type="hidden" name="minuteId" value={entry.id} />}
      {!omitEntity && <input type="hidden" name="entity" value={entity} />}
      {omitEntity && <input type="hidden" name="entity" value="" />}

      {stillMarked && (
        <div className={styles.warn}>
          <div className={styles.warnHead}>
            This section still carries the parser&apos;s draft marker.
          </div>
          <p className={styles.rowNote}>
            Every {DRAFT_MARKER} below is text a parser produced and nobody has
            read. Rewrite it in your own words, then save. Leaving the marker in
            keeps the section flagged as unreviewed in the register.
          </p>
        </div>
      )}

      <div className={`${styles.field} ${styles.fieldWide}`}>
        <label className={styles.label} htmlFor={`discussion-${item.id}`}>
          What was discussed
        </label>
        <textarea
          id={`discussion-${item.id}`}
          name="discussion"
          className={styles.textarea}
          defaultValue={entry?.discussion ?? ""}
        />
      </div>

      <div className={styles.checkRow}>
        <input
          id={`hasMotion-${item.id}`}
          type="checkbox"
          checked={hasMotion}
          onChange={(event) => setHasMotion(event.target.checked)}
        />
        <label htmlFor={`hasMotion-${item.id}`}>
          A motion was moved under this item.
          {item.type === "DECISION" &&
            " This is a decision item, so closing it with no motion leaves the minute incomplete."}
        </label>
      </div>

      {hasMotion && (
        <>
          <div className={`${styles.field} ${styles.fieldWide}`}>
            <label className={styles.label} htmlFor={`motionText-${item.id}`}>
              The motion, as moved
            </label>
            <textarea
              id={`motionText-${item.id}`}
              name="motionText"
              className={styles.textarea}
              defaultValue={entry?.motion?.text ?? ""}
            />
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`moved-${item.id}`}>
                Moved by
              </label>
              <select
                id={`moved-${item.id}`}
                name="movedByPersonId"
                className={styles.select}
                value={moverId}
                onChange={(event) => setMoverId(event.target.value)}
              >
                <option value="">Not recorded</option>
                {attendees.map((a) => (
                  <option key={a.personId} value={a.personId}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`seconded-${item.id}`}>
                Seconded by
              </label>
              <select
                id={`seconded-${item.id}`}
                name="secondedByPersonId"
                className={styles.select}
                value={seconderId}
                onChange={(event) => setSeconderId(event.target.value)}
              >
                <option value="">Not recorded</option>
                {attendees.map((a) => (
                  <option key={a.personId} value={a.personId}>
                    {a.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`outcome-${item.id}`}>
                Outcome
              </label>
              <select
                id={`outcome-${item.id}`}
                name="outcome"
                className={styles.select}
                defaultValue={entry?.motion?.outcome ?? "CARRIED"}
              >
                {MOTION_OUTCOMES.map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {outcome.charAt(0) + outcome.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Names are posted alongside the ids so the minute reads correctly
              without a second lookup at render time. */}
          <input
            type="hidden"
            name="movedByName"
            value={nameOf(moverId) || entry?.motion?.movedByName || ""}
          />
          <input
            type="hidden"
            name="secondedByName"
            value={nameOf(seconderId) || entry?.motion?.secondedByName || ""}
          />

          <div className={styles.checkRow}>
            <input
              id={`tally-${item.id}`}
              type="checkbox"
              name="tallyGiven"
              checked={tallyGiven}
              onChange={(event) => setTallyGiven(event.target.checked)}
            />
            <label htmlFor={`tally-${item.id}`}>
              The vote was counted. Leave this off if the vote was taken by voice
              and no count exists; the minute is then flagged rather than filled
              in with a guess.
            </label>
          </div>

          {tallyGiven && (
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`for-${item.id}`}>
                  For
                </label>
                <input
                  id={`for-${item.id}`}
                  name="voteFor"
                  type="number"
                  min={0}
                  className={styles.input}
                  defaultValue={entry?.motion?.tally?.for ?? 0}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`against-${item.id}`}>
                  Against
                </label>
                <input
                  id={`against-${item.id}`}
                  name="voteAgainst"
                  type="number"
                  min={0}
                  className={styles.input}
                  defaultValue={entry?.motion?.tally?.against ?? 0}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`abstain-${item.id}`}>
                  Abstaining
                </label>
                <input
                  id={`abstain-${item.id}`}
                  name="voteAbstain"
                  type="number"
                  min={0}
                  className={styles.input}
                  defaultValue={entry?.motion?.tally?.abstain ?? 0}
                />
              </div>
            </div>
          )}
        </>
      )}

      <h4 className={styles.label} style={{ marginTop: 20 }}>
        Recusals
      </h4>
      <p className={styles.hint}>
        A recusal is part of the record, not a note in the margin. The
        scholarship conflict rule and the inter-entity transfer rule both depend
        on being able to prove years later that a conflicted member took no part,
        so the reason is required and a recusal without one will not save.
      </p>

      {recusals.map((recusal) => (
        <div key={recusal.key} className={styles.recusal}>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`rp-${recusal.key}`}>
                Who recused
              </label>
              <select
                id={`rp-${recusal.key}`}
                name="recusalPersonId"
                className={styles.select}
                value={recusal.personId}
                onChange={(event) => {
                  const personId = event.target.value;
                  const found = attendees.find((a) => a.personId === personId);
                  update(recusal.key, {
                    personId,
                    displayName: found?.displayName ?? recusal.displayName,
                  });
                }}
              >
                <option value="">Choose a person</option>
                {attendees.map((a) => (
                  <option key={a.personId} value={a.personId}>
                    {a.displayName}
                  </option>
                ))}
                {recusal.personId.startsWith("unmatched:") && (
                  <option value={recusal.personId}>
                    {recusal.displayName} (not on the attendee list)
                  </option>
                )}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`rb-${recusal.key}`}>
                Basis
              </label>
              <select
                id={`rb-${recusal.key}`}
                name="recusalBasis"
                className={styles.select}
                value={recusal.basis}
                onChange={(event) => update(recusal.key, { basis: event.target.value })}
              >
                {RECUSAL_BASES.map((basis) => (
                  <option key={basis} value={basis}>
                    {RECUSAL_BASIS_LABELS[basis]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <input type="hidden" name="recusalDisplayName" value={recusal.displayName} />
          <input
            type="hidden"
            name="recusalWithdrew"
            value={recusal.withdrew ? "yes" : "no"}
          />

          <div className={`${styles.field} ${styles.fieldWide}`}>
            <label className={styles.label} htmlFor={`rr-${recusal.key}`}>
              Reason, required
            </label>
            <textarea
              id={`rr-${recusal.key}`}
              name="recusalReason"
              className={styles.textarea}
              value={recusal.reason}
              onChange={(event) => update(recusal.key, { reason: event.target.value })}
            />
          </div>

          <div className={styles.checkRow}>
            <input
              id={`rw-${recusal.key}`}
              type="checkbox"
              checked={recusal.withdrew}
              onChange={(event) => update(recusal.key, { withdrew: event.target.checked })}
            />
            <label htmlFor={`rw-${recusal.key}`}>
              Left the room or the call for this item, rather than staying and
              abstaining.
            </label>
          </div>

          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.buttonTiny}
              onClick={() => drop(recusal.key)}
            >
              Remove this recusal
            </button>
          </div>
        </div>
      ))}

      <div className={styles.buttonRow}>
        <button type="button" className={styles.buttonTiny} onClick={addRecusal}>
          Record a recusal
        </button>
      </div>

      <div className={styles.checkRow}>
        <input
          id={`closed-${item.id}`}
          type="checkbox"
          name="closed"
          defaultChecked={entry?.closed ?? false}
        />
        <label htmlFor={`closed-${item.id}`}>
          The board has finished with this item.
        </label>
      </div>

      <details className={styles.disclose}>
        <summary>Demonstrate the entity refusal</summary>
        <div className={styles.checkRow}>
          <input
            id={`omit-${item.id}`}
            type="checkbox"
            checked={omitEntity}
            onChange={(event) => setOmitEntity(event.target.checked)}
          />
          <label htmlFor={`omit-${item.id}`}>
            Save this minute without naming its entity. The save will be refused.
            This control exists so the refusal can be seen in the product rather
            than only in a test.
          </label>
        </div>
      </details>

      <div className={styles.buttonRow}>
        <button type="submit" className={styles.button} disabled={pending}>
          Save this minute
        </button>
      </div>

      {state && (
        <p className={state.ok ? styles.ok : styles.warn}>
          {state.ok ? state.message : state.error}
        </p>
      )}
    </form>
  );
}
