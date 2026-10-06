import Link from "next/link";
import styles from "./page.module.css";

/**
 * The split front door.
 *
 * One address, two entities. The visitor chooses before anything else loads,
 * which is what stops the site losing donors in membership language and
 * members in donor language.
 *
 * Nothing on this page identifies a member. See docs/ARCHITECTURE.md.
 */

const ASSOCIATION_PATHS = [
  { label: "Apply for membership", who: "by sponsorship" },
  { label: "Events", who: "ball, golf, triathlon" },
  { label: "Store", who: "public catalogue" },
  { label: "Member sign-in", who: "current members" },
];

const FOUNDATION_PATHS = [
  { label: "Make a donation", who: "split across funds" },
  { label: "Scholarships", who: "eligibility and dates" },
  { label: "Sponsor an event", who: "companies" },
  { label: "Memorial pavers", who: "honour the fallen" },
];

export default function FrontDoor() {
  return (
    <div className={styles.shell}>
      <header className={styles.masthead}>
        <span className={styles.wordmark}>JSOA &nbsp;/&nbsp; JSOF</span>
        <span className={styles.effort}>
          <span>Memorialize the fallen</span>
          <span>Scholarships for JSOC families</span>
          <span>Support JSOC family events</span>
        </span>
      </header>

      <main className={styles.split}>
        <Link href="/jsoa" className={`${styles.door} ${styles.assoc}`}>
          <span className={styles.status}>Association &middot; 501(c)(19)</span>
          <h1 className={styles.name}>Joint Special Operations Association</h1>
          <p className={styles.purpose}>
            Membership, events, and support for the JSOC community and their
            families.
          </p>
          <ul className={styles.paths}>
            {ASSOCIATION_PATHS.map((path) => (
              <li key={path.label}>
                <span>{path.label}</span>
                <span className={styles.who}>{path.who}</span>
              </li>
            ))}
          </ul>
          <span className={styles.enter}>Enter the Association</span>
        </Link>

        <Link href="/jsof" className={`${styles.door} ${styles.found}`}>
          <span className={styles.status}>Foundation &middot; 501(c)(3)</span>
          <h1 className={styles.name}>Joint Special Operations Foundation</h1>
          <p className={styles.purpose}>
            Scholarships and charitable giving. Gifts here are tax-deductible
            and can be directed to a specific fund.
          </p>
          <ul className={styles.paths}>
            {FOUNDATION_PATHS.map((path) => (
              <li key={path.label}>
                <span>{path.label}</span>
                <span className={styles.who}>{path.who}</span>
              </li>
            ))}
          </ul>
          <span className={styles.enter}>Enter the Foundation</span>
        </Link>
      </main>

      <footer className={styles.foot}>
        <span>
          Two entities, one volunteer board. PO Box 72758, Fort Bragg, NC 28307.
        </span>
        <span className={styles.badge}>Demo build &middot; no live member data</span>
      </footer>
    </div>
  );
}
