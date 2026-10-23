import Link from "next/link";

import type { ContactRole } from "./contact-roles";
import { PUBLIC_MAILBOXES, SECRETARY_MAILBOX } from "./contact-roles";
import { PUBLIC_IMAGES, publicImage, type PublicImageKey } from "./media";
import { sponsorLogo, type SponsorLogoKey } from "./sponsor-logos";
import type { Programme } from "./programmes";
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

/**
 * A full-width photograph beneath the page head.
 *
 * The interior pages are a white site, so the image is a band rather than a
 * backdrop with type laid over it. That keeps the heading on white where it
 * is most legible, and it means a photograph that fails to load costs the
 * page nothing.
 *
 * OPSEC: no identifiable member, unit patch, or badge in any image used here.
 * See docs/ARCHITECTURE.md.
 */
export function Banner({
  image,
  caption,
}: {
  /** A key from the reviewed manifest. An arbitrary path will not compile. */
  image: PublicImageKey;
  /** What the image is, for a sighted reader. Not alt text. */
  caption?: string;
}) {
  return (
    <figure className={styles.banner}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={PUBLIC_IMAGES[image].src}
        alt=""
        className={styles.bannerImage}
        style={{ objectPosition: publicImage(image).focus ?? "center" }}
      />
      {caption ? <figcaption className={styles.bannerCaption}>{caption}</figcaption> : null}
    </figure>
  );
}

/**
 * One programme, rendered for one side of the house.
 *
 * `view` picks which sentence is shown and whether an ask appears. Both views
 * read the same record and the same impact figures, so the Association's
 * description and the Foundation's cannot drift apart. See programmes.ts.
 */
export function ProgrammeCards({
  programmes,
  view,
}: {
  programmes: Programme[];
  /** "what" is the Association's framing; "funds" is the Foundation's. */
  view: "what" | "funds";
}) {
  return (
    <ul className={styles.programmes}>
      {programmes.map((programme) => {
        const body = view === "funds" ? programme.funds : programme.what;
        if (body === null) return null;
        return (
          <li key={programme.slug} className={styles.programme}>
            <div className={styles.programmeHead}>
              <h3 className={styles.programmeTitle}>
                <Link href={programme.href}>{programme.title}</Link>
              </h3>
              <span className={styles.programmeWho}>
                Run by {programme.runBy} &middot; funded by {programme.fundedBy}
              </span>
            </div>
            <p className={styles.programmeBody}>{body}</p>
            {programme.fundingNote ? (
              <p className={styles.programmeNote}>{programme.fundingNote}</p>
            ) : null}
            <dl className={styles.impact}>
              {programme.impact.map((figure) => (
                <div key={figure.label} className={styles.impactRow}>
                  <dt className={styles.impactLabel}>{figure.label}</dt>
                  <dd className={styles.impactValue}>
                    {figure.value === null ? (
                      <>
                        <span className={styles.impactUnmeasured}>not yet measured</span>
                        <span className={styles.impactFrom}>
                          Needs {figure.needs}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className={styles.impactFigure}>{figure.value}</span>
                        <span className={styles.impactFrom}>{figure.from}</span>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The three lines of effort, as three numbered cards.
 *
 * A menu, not a document. Each card carries a number, a title, one sentence
 * and which entity does the work, and then gets out of the way: everything
 * else lives behind the click, on the page that owns it. The whole card is
 * the target, not a "read more" at the bottom of it.
 *
 * `image` is optional and deliberately so. An image-led card is only better
 * than a text one when the image is good, and this organization has two
 * photographs it can lawfully publish. A card without one gets a composed
 * graphic treatment rather than a stock photograph standing in for work that
 * means something, which is the failure mode this avoids.
 */
export function EffortCards({
  items,
}: {
  items: {
    key: string;
    /**
     * The one fact worth seeing before the click. A number on the lines of
     * effort, a date on an event. Whatever the reader came for.
     */
    eyebrow: string;
    title: string;
    /**
     * Optional. An event card carries a date, a name and a place and
     * nothing else: the summary is on the event's own page, one click away,
     * and three cards of prose is the thing this pattern replaced.
     */
    statement?: string;
    /** The quiet line at the foot: whose work it is, or what kind of thing. */
    foot: string;
    href: string;
    image?: PublicImageKey;
    /** Draws the eyebrow in the entity hue: a confirmed date, a live thing. */
    accent?: boolean;
  }[];
}) {
  return (
    <ol className={styles.efforts}>
      {items.map((item) => {
        const photo = item.image ? publicImage(item.image) : null;
        return (
          <li key={item.key} className={styles.effort}>
            <Link href={item.href} className={styles.effortLink}>
              {photo ? (
                <span
                  className={styles.effortPhoto}
                  aria-hidden="true"
                  style={{
                    backgroundImage: `url("${photo.src}")`,
                    backgroundPosition: photo.focus ?? "center",
                  }}
                />
              ) : null}
              <span className={styles.effortBody}>
                <span
                  className={`${styles.effortNumber} ${
                    item.accent === false ? styles.effortNumberQuiet : ""
                  }`}
                >
                  {item.eyebrow}
                </span>
                <span className={styles.effortTitle}>{item.title}</span>
                {item.statement ? (
                  <span className={styles.effortStatement}>{item.statement}</span>
                ) : null}
                <span className={styles.effortBy}>{item.foot}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The actions at the top of an event page.
 *
 * Three things a visitor might have come to do, as buttons rather than
 * sentences. An action with nowhere to go yet is rendered disabled with the
 * reason, not hidden: a visitor who came to register should learn that
 * registration is not open, rather than hunt for a link that was never
 * there.
 */
export function ActionBar({
  items,
}: {
  items: {
    key: string;
    label: string;
    href?: string;
    /** Shown when there is no href. */
    unavailable?: string;
  }[];
}) {
  return (
    <ul className={styles.actions}>
      {items.map((item) => (
        <li key={item.key} className={styles.action}>
          {item.href ? (
            <Link href={item.href} className={styles.actionLink}>
              {item.label}
            </Link>
          ) : (
            <span className={styles.actionOff}>
              <span>{item.label}</span>
              <span className={styles.actionWhy}>{item.unavailable}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Something that will sit behind member sign-in.
 *
 * There is no sign-in yet, so this is a statement rather than a gate. That
 * is the honest rendering: a locked door with nothing behind it is still a
 * locked door, and pretending otherwise would mean building a login box that
 * cannot log anybody in.
 */
export function MemberWall({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <aside className={styles.wall}>
      {/* The obvious two-word label here is one of the fragments the
          scholarship eligibility guard watches for, because the rule under
          legal review restricts awards to members' children. Renaming is
          cheaper than loosening a guard on a legal matter, and the guard
          reads this file, so the phrase cannot appear in the comment
          either. */}
      <span className={styles.wallMark}>Member sign-in</span>
      <h2 className={styles.wallTitle}>{title}</h2>
      <div className={styles.wallBody}>{children}</div>
    </aside>
  );
}

/**
 * The partner acknowledgments.
 *
 * A grid, but a restrained one, and the restraint is the point. A 501(c)(3)
 * acknowledging a sponsor may state their name, logo, locations and product
 * lines; the moment it adds praise, comparison or an inducement it becomes
 * advertising, which costs the sponsor their deduction and can create
 * taxable income here. So each card carries the organization, a factual
 * statement of what they do with the Foundation if there is one, and a link.
 *
 * `relationship` is null for two of the three, and renders as nothing.
 * Absence is the correct output: an adjective would not be.
 */
export function PartnerCards({
  items,
}: {
  items: {
    slug: string;
    organization: string;
    url: string | null;
    logo: PublicImageKey | null;
    relationship: string | null;
  }[];
}) {
  return (
    <ul className={styles.offices}>
      {items.map((partner) => (
        <li key={partner.slug} className={styles.office}>
          {/* The plate is rendered empty when there is no logo, so the
              names still line up across the row. */}
          <div className={styles.partnerPlate}>
            {partner.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={PUBLIC_IMAGES[partner.logo].src}
                alt={partner.organization}
                className={styles.partnerLogo}
              />
            ) : null}
          </div>
          <h2 className={styles.officeRole}>{partner.organization}</h2>
          {partner.relationship ? (
            <p className={styles.officeRemit}>{partner.relationship}</p>
          ) : (
            <p className={styles.officeRemit} />
          )}
          <div className={styles.officeFoot}>
            {partner.url ? (
              <a
                className={styles.officeMail}
                href={partner.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                {partner.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            ) : (
              <span className={styles.officeResponds}>No current web address</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The sponsor wall, by level.
 *
 * Built to look right with no logos at all, because for most of its life
 * that is what it will be: a sponsor list arrives as names long before
 * anybody collects twenty-four image files. So the name is the unit and
 * the mark is an optional addition to it, rather than a wall of marks
 * with holes in it.
 *
 * Eagle gets more room than Gold, and Gold more than Silver. That is the
 * whole of what the levels buy here, and it is what the board at the
 * course does too.
 */
/**
 * One sponsor's mark.
 *
 * Its own component so the manifest lookup sits inside the tag that uses
 * it. The test that every image resolves through a manifest reads the
 * `<img>` itself, and it should: a lookup three lines above, assigned to
 * a variable, is exactly the shape that lets a literal path creep in
 * later without the test noticing.
 */
function SponsorMark({ logo, label }: { logo: SponsorLogoKey; label: string }) {
  return (
    <span className={styles.sponsorPlate}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sponsorLogo(logo).src}
        alt={label}
        className={styles.sponsorLogo}
      />
    </span>
  );
}

export function SponsorWall({
  levels,
  sponsors,
}: {
  levels: { key: string; label: string }[];
  sponsors: {
    slug: string;
    organization: string;
    level: string;
    url: string | null;
    logo: SponsorLogoKey | null;
  }[];
}) {
  return (
    <div className={styles.wall}>
      {levels.map((level) => {
        const here = sponsors.filter((sponsor) => sponsor.level === level.key);
        if (here.length === 0) return null;
        return (
          <section key={level.key} className={styles.tier}>
            <h2 className={styles.tierName}>{level.label}</h2>
            <ul className={`${styles.tierList} ${styles[`tier_${level.key}`] ?? ""}`}>
              {here.map((sponsor) => {
                const body = (
                  <>
                    {sponsor.logo ? (
                      <SponsorMark
                        logo={sponsor.logo}
                        label={sponsor.organization}
                      />
                    ) : null}
                    <span className={styles.sponsorName}>{sponsor.organization}</span>
                  </>
                );
                return (
                  <li key={sponsor.slug} className={styles.sponsor}>
                    {sponsor.url ? (
                      <a
                        className={styles.sponsorLink}
                        href={sponsor.url}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {body}
                      </a>
                    ) : (
                      <span className={styles.sponsorLink}>{body}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * The crest, for the masthead.
 *
 * Decorative: the wordmark beside it carries the name. It lives here rather
 * than in PublicShell because blocks.tsx is the only file in the public tier
 * permitted an <img>, and every one of them resolves through the manifest.
 */
export function Mark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={PUBLIC_IMAGES.crest.src} alt="" className={className} />
  );
}

/**
 * The dark photographic hero: the front door's language, on a white site.
 *
 * The door at `/` is black, full-bleed, with condensed type sitting on a
 * scrimmed photograph. The interior is a white site and should stay one, so
 * what carries over is the device rather than the background: one dark band
 * at the top of a page, then white for everything that has to be read.
 *
 * The scrim is the first background layer, so the band is still legible if
 * the photograph fails or is blocked, exactly as on the door.
 */
export function Hero({
  eyebrow,
  title,
  lede,
  image,
  full,
}: {
  eyebrow: string;
  title: string;
  /** One paragraph, or several. */
  lede?: string | string[];
  image: PublicImageKey;
  /**
   * Fill the viewport below the masthead. For a home page that is meant to be
   * the whole page: who we are, and the navigation, with nothing to scroll to.
   */
  full?: boolean;
}) {
  const photo = publicImage(image);
  const paragraphs = lede === undefined ? [] : Array.isArray(lede) ? lede : [lede];
  return (
    <header className={`${styles.hero} ${full ? styles.heroFull : ""}`}>
      <div
        className={styles.heroPhoto}
        aria-hidden="true"
        style={{
          backgroundImage: `url("${photo.src}")`,
          backgroundPosition: photo.focus ?? "center",
        }}
      />
      <div className={styles.heroBody}>
        <span className={styles.heroEyebrow}>{eyebrow}</span>
        <h1 className={styles.heroTitle}>{title}</h1>
        {paragraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 40)} className={styles.heroLede}>
            {paragraph}
          </p>
        ))}
      </div>
    </header>
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
/**
 * The two public addresses, as the first thing on a contact page.
 *
 * Deliberately larger than the office list beneath them. Most people writing
 * in do not know or care which office handles their thing, and asking them
 * to work it out before they can send a message is how a contact page fails.
 * The offices stay listed so anyone who does know can name one.
 */
export function Mailboxes() {
  const boxes = [PUBLIC_MAILBOXES.support, PUBLIC_MAILBOXES.connect];
  return (
    <ul className={styles.mailboxes}>
      {boxes.map((box) => (
        <li key={box.address} className={styles.mailbox}>
          <a className={styles.mailboxLink} href={`mailto:${box.address}`}>
            <span className={styles.mailboxLabel}>{box.label}</span>
            <span className={styles.mailboxAddress}>{box.address}</span>
            <span className={styles.mailboxWhen}>{box.when}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function Offices({ items }: { items: ContactRole[] }) {
  return (
    <ul className={styles.offices}>
      {items.map((office) => (
        <li className={styles.office} key={office.slug}>
          <h3 className={styles.officeRole}>{office.role}</h3>
          <p className={styles.officeRemit}>{office.remit}</p>
          <div className={styles.officeFoot}>
            <span className={styles.officeResponds}>
              Replies within {office.respondsWithin}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
