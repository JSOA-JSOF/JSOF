import Link from "next/link";

import type { ContactRole } from "./contact-roles";
import { SECRETARY_MAILBOX } from "./contact-roles";
import styles from "./blocks.module.css";

/**
 * Shared content blocks for the public tier.
 *
 * Every public page is built from these, so the heading order is the same on
 * all of them: one `h1` per page from `PageHead`, `h2` per section, `h3`
 * beneath. That is what makes the pages navigable by a screen reader and
 * legible to a search engine at the same time, and it is why sections take
 * their heading as a prop instead of each page writing its own tags.
 */

export function PageHead({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
}) {
  return (
    <div className={styles.head}>
      <span className={styles.eyebrow}>{eyebrow}</span>
      <h1 className={styles.title}>{title}</h1>
      {lede ? <p className={styles.lede}>{lede}</p> : null}
    </div>
  );
}

export function Section({
  title,
  id,
  wide,
  children,
}: {
  title: string;
  id?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`${styles.section} ${wide ? styles.sectionWide : ""}`}
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
    >
      <h2 className={styles.sectionTitle} id={id ? `${id}-title` : undefined}>
        {title}
      </h2>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

export function SubHead({ children }: { children: React.ReactNode }) {
  return <h3 className={styles.subTitle}>{children}</h3>;
}

export function Paragraphs({ items }: { items: readonly string[] }) {
  return (
    <>
      {items.map((text) => (
        <p key={text}>{text}</p>
      ))}
    </>
  );
}

export function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className={styles.bullets}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export type Fact = { label: string; value: React.ReactNode };

export function Facts({ rows }: { rows: Fact[] }) {
  return (
    <dl className={styles.facts}>
      {rows.map((row) => (
        <div className={styles.factRow} key={row.label}>
          <dt className={styles.factLabel}>{row.label}</dt>
          <dd className={styles.factValue}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Callout({
  title,
  marker,
  tone = "entity",
  children,
}: {
  title: string;
  /** Short uppercase flag, for a gap the reader should see is deliberate. */
  marker?: string;
  tone?: "entity" | "warn";
  children: React.ReactNode;
}) {
  return (
    <aside
      className={`${styles.callout} ${tone === "warn" ? styles.calloutWarn : ""}`}
    >
      {marker ? <span className={styles.calloutMarker}>{marker}</span> : null}
      {/* h2, not h3: every callout sits at page level beside a Section, so an
          h3 here would skip a level in the outline. */}
      <h2 className={styles.calloutTitle}>{title}</h2>
      {children}
    </aside>
  );
}

export type CardItem = {
  key: string;
  kind?: string;
  title: string;
  href?: string;
  body: string;
  foot?: string;
  more?: string;
};

export function Cards({ items, columns }: { items: CardItem[]; columns: 2 | 3 }) {
  return (
    <ul
      className={`${styles.cards} ${
        columns === 3 ? styles.cardsThree : styles.cardsTwo
      }`}
    >
      {items.map((item) => (
        <li className={styles.card} key={item.key}>
          {item.kind ? <span className={styles.cardKind}>{item.kind}</span> : null}
          <h3 className={styles.cardTitle}>
            {item.href ? <Link href={item.href}>{item.title}</Link> : item.title}
          </h3>
          <p className={styles.cardBody}>{item.body}</p>
          {item.foot ? <span className={styles.cardFoot}>{item.foot}</span> : null}
          {item.href && item.more ? (
            <Link href={item.href} className={styles.cardMore}>
              {item.more}
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * A link to a route another module owns, with the reason a reader would follow
 * it. The public tier links out rather than reimplementing registration,
 * checkout or an application form.
 */
export function OutboundLinks({
  items,
}: {
  items: { href: string; label: string; note: string }[];
}) {
  return (
    <ul className={styles.outbound}>
      {items.map((item) => (
        <li key={item.href + item.label}>
          {item.href.startsWith("http") ? (
            <a
              className={styles.outboundLink}
              href={item.href}
              rel="noopener noreferrer"
            >
              {item.label}
            </a>
          ) : (
            <Link className={styles.outboundLink} href={item.href}>
              {item.label}
            </Link>
          )}
          <span className={styles.outboundNote}>{item.note}</span>
        </li>
      ))}
    </ul>
  );
}

export function Steps({
  items,
}: {
  items: { lead: string; detail: string }[];
}) {
  return (
    <ol className={styles.steps}>
      {items.map((item) => (
        <li key={item.lead}>
          <span className={styles.stepLead}>{item.lead}</span> {item.detail}
        </li>
      ))}
    </ol>
  );
}

/**
 * The contact directory row. Renders the office, its remit, the mailbox and
 * the response time. There is no field here for a person, because the type
 * does not have one.
 *
 * Where a mailbox is not yet routed the row sends the reader to the Secretary
 * instead of printing an address that bounces.
 */
export function Offices({ items }: { items: ContactRole[] }) {
  return (
    <ul className={styles.offices}>
      {items.map((office) => (
        <li className={styles.office} key={office.slug}>
          <div>
            <span className={styles.officeRole}>{office.role}</span>
            <div className={styles.officeMeta}>
              {office.mailboxLive ? (
                <a className={styles.officeMail} href={`mailto:${office.mailbox}`}>
                  {office.mailbox}
                </a>
              ) : (
                <span className={styles.officePending}>
                  Write to{" "}
                  <a
                    className={styles.officeMail}
                    href={`mailto:${SECRETARY_MAILBOX}`}
                  >
                    {SECRETARY_MAILBOX}
                  </a>{" "}
                  and ask for this office.
                </span>
              )}
            </div>
            <div className={styles.officeMeta}>
              <span className={styles.officeResponds}>
                Replies within {office.respondsWithin}
              </span>
            </div>
          </div>
          <p className={styles.officeRemit}>{office.remit}</p>
        </li>
      ))}
    </ul>
  );
}
