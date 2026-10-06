/**
 * What a refused request looks like. The role is named, what it would have
 * needed is named, and nothing about the data behind the wall is leaked — not
 * a count, not a total, not "there are 4 gifts you cannot see".
 */

import styles from "./donations.module.css";

export default function Denied({
  roleLabel,
  needs,
  detail,
}: {
  roleLabel: string;
  needs: string;
  detail?: string;
}) {
  return (
    <div className={styles.denied}>
      <span className={styles.deniedHead}>Refused</span>
      <p className={styles.deniedBody}>
        {roleLabel} cannot open this. It needs {needs}. Switch to a role that
        holds it, or ask the officer who does.
      </p>
      {detail && <p className={styles.deniedDetail}>{detail}</p>}
    </div>
  );
}
