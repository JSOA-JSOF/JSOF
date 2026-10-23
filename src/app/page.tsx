import { DoorLink } from "./DoorLink";
import styles from "./page.module.css";

/**
 * The split front door.
 *
 * One address, two entities, and the visitor chooses before anything else
 * loads. That is what stops the site losing donors in membership language and
 * members in donor language.
 *
 * At rest both halves are black and carry only the entity's name and what it
 * is for. A photograph appears on the half under the cursor or keyboard focus.
 * The photograph is decoration: everything needed to choose is in the text, so
 * the door works identically with images blocked, on a touch screen with no
 * hover at all, and for a reader who never sees it.
 *
 * OPSEC: nothing on this page identifies a member, and the two photographs
 * must not either. See docs/ARCHITECTURE.md and docs/PRIVACY-AND-PAYMENTS.md.
 */

/** Drop the real files at these paths and they appear. Until then each half
 *  falls back to the gradient underneath, which is the black at-rest state. */
const ASSOCIATION_PHOTO = "/media/door-association.webp";
const FOUNDATION_PHOTO = "/media/door-foundation.webp";

export default function FrontDoor() {
  return (
    <div className={styles.shell}>
      <main className={styles.split}>
        <DoorLink
          href="/jsoa"
          className={`${styles.door} ${styles.assoc}`}
          style={{ "--photo": `url("${ASSOCIATION_PHOTO}")` } as React.CSSProperties}
        >
          <span className={styles.photo} aria-hidden="true" />
          <span className={styles.body}>
            <span className={styles.kicker}>Joint Special Operations</span>
            <h1 className={styles.name}>Association</h1>
            <p className={styles.lede}>
              The membership side. Join, renew, and find out what the
              Association does for the JSOC community and their families.
            </p>
            <span className={styles.meta}>501(c)(19) veterans organization</span>
            <span className={styles.enter}>Membership</span>
          </span>
        </DoorLink>

        <DoorLink
          href="/jsof"
          className={`${styles.door} ${styles.found}`}
          style={{ "--photo": `url("${FOUNDATION_PHOTO}")` } as React.CSSProperties}
        >
          <span className={styles.photo} aria-hidden="true" />
          <span className={styles.body}>
            <span className={styles.kicker}>Joint Special Operations</span>
            <h1 className={styles.name}>Foundation</h1>
            <p className={styles.lede}>
              The giving side. Sponsor an event, fund a scholarship, or make a
              gift. Donations here are tax-deductible.
            </p>
            <span className={styles.meta}>501(c)(3) public charity</span>
            <span className={styles.enter}>Sponsor or donate</span>
          </span>
        </DoorLink>

        {/* Decorative and never over either door's click target. */}
        <div className={styles.crest} aria-hidden="true">
          <Crest />
        </div>
      </main>

      <footer className={styles.foot}>
        <span>Two entities, one volunteer board. PO Box 72758, Fort Bragg, NC 28307.</span>
        <span className={styles.badge}>Demo build &middot; no live member data</span>
      </footer>
    </div>
  );
}

/**
 * The association crest, centred on the seam between the two halves.
 *
 * Decorative: the container is aria-hidden and the choice a visitor has to
 * make is carried entirely by the two headings either side of it.
 */
function Crest() {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/media/crest-v2.webp"
      alt=""
      width={784}
      height={860}
      className={styles.crestImage}
    />
  );
}
