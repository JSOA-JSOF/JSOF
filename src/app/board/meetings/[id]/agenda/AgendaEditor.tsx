"use client";

import { useActionState, useState } from "react";

import { ROLES, type Role } from "@/lib/authz/model";
import {
  adoptAgendaAction,
  moveAgendaItemAction,
  removeAgendaItemAction,
  saveAgendaItemAction,
  type ActionResult,
} from "@/lib/meetings/actions";
import {
  AGENDA_ITEM_TYPES,
  AGENDA_ITEM_TYPE_LABELS,
  AGENDA_ITEM_TYPE_NOTES,
  type AgendaItem,
  type AgendaItemType,
} from "@/lib/meetings/types";
import styles from "../../meetings.module.css";

function roleLabel(role: Role): string {
  return role
    .split("_")
    .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
    .join(" ")
    .replace(/^Vp /, "VP ");
}

function Result({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <p className={state.ok ? styles.ok : styles.warn}>
      {state.ok ? state.message : state.error}
    </p>
  );
}

function MoveButton({
  meetingId,
  itemId,
  direction,
  disabled,
  label,
}: {
  meetingId: string;
  itemId: string;
  direction: "up" | "down";
  disabled: boolean;
  label: string;
}) {
  const [state, action, pending] = useActionState(moveAgendaItemAction, null);
  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="meetingId" value={meetingId} />
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="direction" value={direction} />
      <button
        type="submit"
        className={styles.buttonTiny}
        disabled={disabled || pending}
        aria-label={label}
        title={state && !state.ok ? state.error : label}
      >
        {direction === "up" ? "Move up" : "Move down"}
      </button>
    </form>
  );
}

function RemoveButton({ meetingId, itemId }: { meetingId: string; itemId: string }) {
  const [state, action, pending] = useActionState(removeAgendaItemAction, null);
  return (
    <>
      <form action={action} className={styles.inlineForm}>
        <input type="hidden" name="meetingId" value={meetingId} />
        <input type="hidden" name="itemId" value={itemId} />
        <button type="submit" className={styles.buttonTiny} disabled={pending}>
          Take off the agenda
        </button>
      </form>
      {state && !state.ok && <p className={styles.warn}>{state.error}</p>}
    </>
  );
}

function ItemForm({
  meetingId,
  item,
  onDone,
}: {
  meetingId: string;
  item?: AgendaItem;
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState(saveAgendaItemAction, null);
  const [type, setType] = useState<AgendaItemType>(item?.type ?? "DISCUSSION");

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="meetingId" value={meetingId} />
      {item && <input type="hidden" name="itemId" value={item.id} />}

      <div className={styles.field + " " + styles.fieldWide}>
        <label className={styles.label} htmlFor={`title-${item?.id ?? "new"}`}>
          Title
        </label>
        <input
          id={`title-${item?.id ?? "new"}`}
          name="title"
          className={styles.input}
          defaultValue={item?.title ?? ""}
          required
          maxLength={160}
        />
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`type-${item?.id ?? "new"}`}>
            Type
          </label>
          <select
            id={`type-${item?.id ?? "new"}`}
            name="type"
            className={styles.select}
            value={type}
            onChange={(event) => setType(event.target.value as AgendaItemType)}
          >
            {AGENDA_ITEM_TYPES.map((value) => (
              <option key={value} value={value}>
                {AGENDA_ITEM_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`owner-${item?.id ?? "new"}`}>
            Owner role
          </label>
          <select
            id={`owner-${item?.id ?? "new"}`}
            name="ownerRole"
            className={styles.select}
            defaultValue={item?.ownerRole ?? "SECRETARY"}
          >
            {ROLES.filter((r) => r !== "MEMBER" && r !== "DONOR").map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`minutes-${item?.id ?? "new"}`}>
            Estimated minutes
          </label>
          <input
            id={`minutes-${item?.id ?? "new"}`}
            name="estimatedMinutes"
            type="number"
            min={1}
            max={480}
            className={styles.input}
            defaultValue={item?.estimatedMinutes ?? 10}
            required
          />
        </div>
      </div>

      <p className={styles.hint}>{AGENDA_ITEM_TYPE_NOTES[type]}</p>

      <div className={`${styles.field} ${styles.fieldWide}`}>
        <label className={styles.label} htmlFor={`note-${item?.id ?? "new"}`}>
          Context circulated with the agenda
        </label>
        <textarea
          id={`note-${item?.id ?? "new"}`}
          name="note"
          className={styles.textarea}
          defaultValue={item?.note ?? ""}
          maxLength={600}
        />
      </div>

      <div className={`${styles.field} ${styles.fieldWide}`}>
        <label className={styles.label} htmlFor={`keywords-${item?.id ?? "new"}`}>
          Transcript keywords, comma separated
        </label>
        <input
          id={`keywords-${item?.id ?? "new"}`}
          name="keywords"
          className={styles.input}
          defaultValue={(item?.keywords ?? []).join(", ")}
        />
        <p className={styles.hint}>
          The transcript parser matches these as well as the words in the title.
          Add the phrases the board actually says out loud, which are often not
          the ones on the agenda.
        </p>
      </div>

      <div className={styles.buttonRow}>
        <button type="submit" className={styles.button} disabled={pending}>
          {item ? "Save this item" : "Add to the agenda"}
        </button>
        {onDone && (
          <button
            type="button"
            className={`${styles.button} ${styles.buttonQuiet}`}
            onClick={onDone}
          >
            Close
          </button>
        )}
      </div>
      <Result state={state} />
    </form>
  );
}

function AdoptForm({ meetingId, itemCount }: { meetingId: string; itemCount: number }) {
  const [state, action, pending] = useActionState(adoptAgendaAction, null);
  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Adopt the agenda</div>
      <p className={styles.rowNote}>
        Adopting freezes the item numbers to the order shown. From then on the
        minute references for this meeting do not move, because other modules
        point at them. Wording and time estimates can still be corrected; the
        order cannot.
      </p>
      <form action={action}>
        <input type="hidden" name="meetingId" value={meetingId} />
        <div className={styles.buttonRow}>
          <button
            type="submit"
            className={styles.button}
            disabled={pending || itemCount === 0}
          >
            Adopt and freeze the item numbers
          </button>
        </div>
      </form>
      <Result state={state} />
    </div>
  );
}

export function AgendaEditor({
  meetingId,
  items,
  editable,
  frozenReason,
}: {
  meetingId: string;
  items: AgendaItem[];
  editable: boolean;
  frozenReason: string | null;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <>
      {frozenReason && (
        <div className={styles.quiet}>
          <strong>Item numbers are frozen.</strong> {frozenReason}
        </div>
      )}

      <ul className={styles.list}>
        {items.map((item, index) => (
          <li key={item.id}>
            <div className={styles.rowHead}>
              <span className={styles.rowTitle}>
                <span className={styles.mono}>{item.position}. </span>
                {item.title}
              </span>
              <span className={styles.rowFigure}>{item.estimatedMinutes} min</span>
            </div>
            <div className={styles.chipRow}>
              <span className={`${styles.chip} ${styles.chipHue}`}>
                {AGENDA_ITEM_TYPE_LABELS[item.type]}
              </span>
              <span className={styles.chip}>{roleLabel(item.ownerRole)}</span>
              <span className={styles.chip}>item {item.itemNumber}</span>
            </div>
            {item.note && <p className={styles.rowNote}>{item.note}</p>}
            {editable && (
              <div className={styles.buttonRow}>
                <MoveButton
                  meetingId={meetingId}
                  itemId={item.id}
                  direction="up"
                  disabled={index === 0}
                  label="Move this item earlier"
                />
                <MoveButton
                  meetingId={meetingId}
                  itemId={item.id}
                  direction="down"
                  disabled={index === items.length - 1}
                  label="Move this item later"
                />
                <button
                  type="button"
                  className={styles.buttonTiny}
                  onClick={() => setEditing(editing === item.id ? null : item.id)}
                >
                  {editing === item.id ? "Stop editing" : "Edit"}
                </button>
                <RemoveButton meetingId={meetingId} itemId={item.id} />
              </div>
            )}
            {!editable && (
              <div className={styles.buttonRow}>
                <button
                  type="button"
                  className={styles.buttonTiny}
                  onClick={() => setEditing(editing === item.id ? null : item.id)}
                >
                  {editing === item.id ? "Stop editing" : "Correct wording or estimate"}
                </button>
              </div>
            )}
            {editing === item.id && (
              <ItemForm
                meetingId={meetingId}
                item={item}
                onDone={() => setEditing(null)}
              />
            )}
          </li>
        ))}
      </ul>

      {items.length === 0 && (
        <p className={styles.rowNote}>
          Nothing on the agenda yet. Add the first item below.
        </p>
      )}

      {editable ? (
        <div className={styles.panel}>
          <div className={styles.panelTitle}>Add an item</div>
          {adding ? (
            <ItemForm meetingId={meetingId} onDone={() => setAdding(false)} />
          ) : (
            <div className={styles.buttonRow}>
              <button
                type="button"
                className={styles.button}
                onClick={() => setAdding(true)}
              >
                Add an item
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.quiet}>
          New items cannot be added to an adopted agenda, because a new item
          would take a number that either collides with an existing minute
          reference or sits out of order with it. Take new business at the next
          meeting, or call a special meeting, which gets its own session suffix.
        </div>
      )}

      {editable && <AdoptForm meetingId={meetingId} itemCount={items.length} />}
    </>
  );
}
