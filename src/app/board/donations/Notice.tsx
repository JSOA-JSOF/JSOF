import styles from "./donations.module.css";

/**
 * What came back from a form.
 *
 * Two states and no third. Either something was recorded, in which case the
 * reader is told exactly what and what follows from it, or it was refused, in
 * which case the reader is told what was refused and what to do. There is no
 * "something went wrong": a refusal a board member cannot act on is a refusal
 * they will try to route around.
 *
 * Both strings come from the server action's redirect, so a reload shows the
 * same sentence rather than re-running the write.
 */
export default function Notice({
  done,
  refused,
}: {
  done?: string;
  refused?: string;
}) {
  if (!done && !refused) return null;
  return (
    <div className={`${styles.notice} ${refused ? styles.noticeRefused : ""}`}>
      <span className={styles.noticeHead}>
        {refused ? "Refused · nothing was changed" : "Recorded"}
      </span>
      {refused ?? done}
    </div>
  );
}

/** `?done=` / `?refused=` off a search-params bag, as a single string. */
export function firstOf(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.length > 0 ? first : undefined;
}
