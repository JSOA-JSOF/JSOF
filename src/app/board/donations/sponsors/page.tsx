import Link from "next/link";

import { RoleTabs } from "@/components/workspace-shell/RoleTabs";
import { AuthzError } from "@/lib/authz/policy";
import {
  functionTabHref,
  functionTabs,
  WORKSPACE_BASE,
} from "@/lib/donations/workspace";
import {
  canApproveRelease,
  canAuthorWording,
  canRecordSponsorship,
  readSponsorAcknowledgments,
  readSponsorRegister,
  type PlacementView,
} from "@/lib/donations/actions";
import { DEV_SWITCHER_PARAM } from "@/lib/donations/devSubject";
import { resolveScreenViewer } from "@/lib/donations/screenSubject";
import { formatCents } from "@/lib/donations/money";
import {
  ACKNOWLEDGMENT_ADVISORY_FLAGGED,
  ADVERTISING_NOTE,
} from "@/lib/donations/sponsorship";
import { PLACEMENT_KINDS, PLACEMENT_LABEL } from "@/lib/donations/types";
import Denied from "../Denied";
import Notice, { firstOf } from "../Notice";
import {
  approveForPublicationAction,
  recordSponsorshipAction,
  saveWordingAction,
  sendForReleaseAction,
} from "../actions";
import styles from "../donations.module.css";

/*
 * The two reads, as the screen sees them. `Awaited` keeps each tied to the
 * action it comes from rather than restating the action's shape here.
 */
type SponsorRegister = Awaited<ReturnType<typeof readSponsorRegister>>;
type SponsorWording = Awaited<ReturnType<typeof readSponsorAcknowledgments>>;

export const metadata = {
  title: "Sponsors — board",
  robots: { index: false, follow: false },
};

/**
 * The sponsor register: per sponsor, per placement.
 *
 * Two views, two data classes, deliberately:
 *
 *   - the money view (payment, benefit valuations, the safe-harbour figure) is
 *     FINANCIAL at row level, so it needs READ;
 *   - the wording view (the approved acknowledgment string) is
 *     PUBLIC_CONTENT, because that is what the string is.
 *
 * That split is why the Fundraising Chair can do the job the role exists for.
 * The Chair holds AGGREGATE on FINANCIAL and WRITE on PUBLIC_CONTENT: they can
 * write and review the wording, and cannot read the payments row by row. A
 * single combined register would have to either lock the Chair out of their own
 * sponsors or hand them the ledger.
 */
export default async function SponsorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const asParam = params[DEV_SWITCHER_PARAM];
  const { subject, entity, roleLabel, qs } = await resolveScreenViewer(asParam);
  const hue = entity === "JSOA" ? "var(--jsoa)" : "var(--jsof)";
  const hueTint = entity === "JSOA" ? "var(--jsoa-tint)" : "var(--jsof-tint)";
  const as = Array.isArray(asParam) ? asParam[0] : asParam;

  /*
   * Three different standings, and the screen asks about each one separately
   * rather than collapsing them into "can this person edit sponsors".
   *
   *   - recording the payment is FINANCIAL WRITE: the Treasurer;
   *   - writing the wording is PUBLIC_CONTENT WRITE: the Fundraising Chair;
   *   - approving it for publication is PUBLIC_CONTENT READ plus
   *     APPROVE_RELEASE: the President, VP Operations, the Memorial Chair.
   *
   * No role in the table holds all three, which is the gate working rather
   * than a gap. Each form renders only for the office that can submit it.
   */
  const mayRecord = canRecordSponsorship(subject, entity);
  const gate = {
    entity,
    as,
    mayAuthor: canAuthorWording(subject, entity),
    mayApprove: canApproveRelease(subject, entity),
    personId: subject.personId,
  };

  let register: SponsorRegister | null = null;
  let wordingOnly: SponsorWording | null = null;
  let denial: string | null = null;

  try {
    register = await readSponsorRegister(subject, entity);
  } catch (financialError) {
    try {
      wordingOnly = await readSponsorAcknowledgments(subject, entity);
    } catch {
      denial =
        financialError instanceof AuthzError
          ? financialError.message
          : String(financialError);
    }
  }

  return (
    <div
      className={styles.page}
      style={{ ["--hue" as string]: hue, ["--hueTint" as string]: hueTint }}
    >
      <header className={styles.bar}>
        <Link href="/" className={styles.back}>
          ← Both entities
        </Link>
        <span className={styles.status}>Board · sponsors · {entity}</span>
      </header>

      <div className={styles.body}>
        <h1 className={styles.title}>Sponsors</h1>
        <p className={styles.lede}>
          {entity} sponsorships, one row per placement. Each placement carries
          the exact wording that may be published, what the sponsor receives in
          return, and where it appears.
        </p>

        {/* The workspace spine, with this module's three function screens
            appended. Sponsors keeps its own route. */}
        <RoleTabs
          base={WORKSPACE_BASE}
          current={functionTabHref("sponsors", qs)}
          functionTabs={functionTabs(qs)}
        />


        <Notice done={firstOf(params.done)} refused={firstOf(params.refused)} />

        {denial && (
          <Denied
            roleLabel={roleLabel}
            needs={`read access to ${entity} financial records, or at least read access to public content`}
            detail={denial}
          />
        )}

        {/* Recording a sponsorship.
            There was no way to create one, so against a real database this
            register was empty with no code path able to change it. The
            payment amount is what makes this a financial write and therefore
            the Treasurer's: the Fundraising Chair negotiates the sponsorship
            and does not record the cash. */}
        <h2 className={styles.sectionHead}>Record a sponsorship</h2>
        {mayRecord ? (
          <form className={styles.form} action={recordSponsorshipAction}>
            <input type="hidden" name="entity" value={entity} />
            {as && <input type="hidden" name="as" value={as} />}
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sponsor-name">
                  Sponsor
                </label>
                <input
                  className={styles.input}
                  id="sponsor-name"
                  name="sponsorName"
                  required
                  maxLength={160}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sponsor-event">
                  Event
                </label>
                <input
                  className={styles.input}
                  id="sponsor-event"
                  name="eventName"
                  required
                  maxLength={160}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sponsor-tier">
                  Tier
                </label>
                <input
                  className={styles.input}
                  id="sponsor-tier"
                  name="tier"
                  required
                  maxLength={80}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sponsor-payment">
                  Payment
                </label>
                <input
                  className={`${styles.input} ${styles.inputMoney}`}
                  id="sponsor-payment"
                  name="payment"
                  inputMode="decimal"
                  placeholder="2500.00"
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sponsor-received">
                  Date received
                </label>
                <input
                  className={styles.input}
                  id="sponsor-received"
                  name="receivedAt"
                  type="date"
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sponsor-exclusivity">
                  Exclusivity
                </label>
                <select
                  className={styles.select}
                  id="sponsor-exclusivity"
                  name="exclusivity"
                  defaultValue="NONE"
                >
                  <option value="NONE">None</option>
                  <option value="EXCLUSIVE_SPONSOR">Exclusive sponsor</option>
                </select>
                <p className={styles.hint}>
                  Exclusive sponsor is acceptable. Exclusive provider is
                  advertising and is not a value this register accepts.
                </p>
              </div>
            </div>
            <div className={styles.formActions}>
              <button className={styles.submit} type="submit">
                Record the sponsorship
              </button>
            </div>
            <p className={styles.hint} style={{ marginTop: "10px" }}>
              There is no field here for a fee tied to attendance or
              impressions, and there cannot be one: a contingent payment is not
              a qualified sponsorship payment at all. If this fee is priced per
              head or per impression, it is advertising income and does not
              belong in this register.
            </p>
          </form>
        ) : (
          <p className={styles.gateNote}>
            {roleLabel} cannot record a sponsorship. A sponsorship record is a
            payment amount, so it needs write access to {entity} financial
            records — the Treasurer. The Fundraising Chair holds financial
            access at aggregate on purpose: the office that negotiates the
            sponsorship is not the office that records the money.
          </p>
        )}

        {wordingOnly && (
          <>
            <div className={styles.flag}>
              <span className={styles.flagHead}>Wording only</span>
              {roleLabel} holds write access to public content but not row-level
              read on {entity} financial records. The approved wording is shown.
              Payments, benefit valuations and the safe-harbour figure are not.
            </div>

            {wordingOnly.map((row) => (
              <div className={styles.card} key={row.sponsorshipId}>
                <div className={styles.cardHead}>
                  <span className={styles.cardTitle}>{row.sponsorName}</span>
                  <span className={styles.cardMeta}>
                    {row.placements.length}{" "}
                    {row.placements.length === 1 ? "placement" : "placements"}
                  </span>
                </div>
                {row.placements.map((view) => (
                  <PlacementBlock
                    key={view.placement.id}
                    view={view}
                    showMoney={false}
                    sponsorshipId={row.sponsorshipId}
                    gate={gate}
                  />
                ))}
                <NewPlacementForm sponsorshipId={row.sponsorshipId} gate={gate} />
              </div>
            ))}
          </>
        )}

        {register && (
          <>
            <h2 className={styles.sectionHead}>Register</h2>
            <p className={styles.sectionNote}>
              The 2% safe harbour is all or nothing. If the benefits are worth
              more than 2% of the payment, the whole benefit value is carved
              out, not just the part above the line.
            </p>

            {register.map((row) => (
              <div className={styles.card} key={row.sponsorshipId}>
                <div className={styles.cardHead}>
                  <span className={styles.cardTitle}>{row.sponsorName}</span>
                  <span className={styles.figure}>{row.paymentFormatted}</span>
                </div>
                <p className={styles.cardMeta}>
                  {row.eventName} · {row.tier} ·{" "}
                  <span className="mono">{row.sponsorshipId}</span>
                  {row.exclusivity === "EXCLUSIVE_SPONSOR" && (
                    <>
                      {" "}
                      <span className={styles.pill}>exclusive sponsor</span>
                    </>
                  )}
                </p>

                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Safe harbour</th>
                        <th className={styles.numeric}>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Payment</td>
                        <td className={styles.numeric}>
                          {formatCents(row.assessment.paymentCents)}
                        </td>
                      </tr>
                      <tr>
                        <td>Benefit value, all placements</td>
                        <td className={styles.numeric}>
                          {formatCents(row.assessment.totalBenefitFairMarketValueCents)}
                        </td>
                      </tr>
                      <tr>
                        <td>2% ceiling</td>
                        <td className={styles.numeric}>
                          {formatCents(row.assessment.thresholdCents)}
                        </td>
                      </tr>
                      <tr>
                        <td>Carved out</td>
                        <td className={styles.numeric}>
                          {formatCents(row.assessment.carvedOutCents)}
                        </td>
                      </tr>
                      <tr className={styles.rowTotal}>
                        <td>Qualified sponsorship portion</td>
                        <td className={styles.numeric}>
                          {formatCents(row.assessment.qualifiedSponsorshipPortionCents)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {row.assessment.withinSafeHarbour ? (
                  <p className={styles.clear}>{row.assessment.explanation}</p>
                ) : (
                  <div className={styles.flag}>
                    <span className={styles.flagHead}>
                      Above 2% · entire benefit value carved out
                    </span>
                    {row.assessment.explanation}
                  </div>
                )}

                {row.categories.advertisingCents > 0 && (
                  <div className={styles.flag}>
                    <span className={styles.flagHead}>
                      Advertising ·{" "}
                      {row.categories.advertisingPlacements.join(", ")}
                    </span>
                    {formatCents(row.categories.advertisingCents)} of the benefit
                    value on this sponsorship sits in advertising placements
                    rather than acknowledgments. {ADVERTISING_NOTE}
                  </div>
                )}

                {row.placements.map((view) => (
                  <PlacementBlock
                    key={view.placement.id}
                    view={view}
                    showMoney
                    sponsorshipId={row.sponsorshipId}
                    gate={gate}
                  />
                ))}
                <NewPlacementForm sponsorshipId={row.sponsorshipId} gate={gate} />
              </div>
            ))}

            <p className={styles.note}>
              A sponsorship fee tied to attendance or impressions is not a
              qualified sponsorship payment at all, so the record has no field
              that can hold one. Exclusive sponsor is recorded; exclusive
              provider is not a value this register accepts.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What this viewer may do to a placement, carried down rather than
 * recomputed, so one page cannot answer the question two ways.
 */
type Gate = {
  entity: string;
  as?: string;
  mayAuthor: boolean;
  mayApprove: boolean;
  personId: string;
};

/**
 * The wording editor and the release gate for one placement.
 *
 * Two deliberate refusals in this block.
 *
 * The approve button is hidden from the person who wrote the wording, with
 * the reason stated. `assertReleasable` refuses it anyway — the invariant is
 * enforced in the policy layer and not here — but a button that exists only
 * to produce a refusal teaches the reader that the gate is an obstacle rather
 * than telling them what the gate is for.
 *
 * Nothing on this screen offers to generate, suggest or clean up an
 * acknowledgment. The string is what the board approved. One adjective turns
 * an acknowledgment into advertising and converts the whole payment, so the
 * only way wording changes is somebody typing it, and typing it sends it back
 * through the gate.
 */
function PlacementControls({
  view,
  sponsorshipId,
  gate,
}: {
  view: PlacementView;
  sponsorshipId: string;
  gate: Gate;
}) {
  const { placement, review } = view;
  const wroteIt = placement.authoredById === gate.personId;

  return (
    <>
      {gate.mayAuthor && (
        <details className={styles.details}>
          <summary className={styles.summary}>Edit the wording</summary>
          <form className={styles.form} action={saveWordingAction}>
            <input type="hidden" name="entity" value={gate.entity} />
            <input type="hidden" name="sponsorshipId" value={sponsorshipId} />
            <input type="hidden" name="placementId" value={placement.id} />
            {gate.as && <input type="hidden" name="as" value={gate.as} />}
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`kind-${placement.id}`}>
                  Where it appears
                </label>
                <select
                  className={styles.select}
                  id={`kind-${placement.id}`}
                  name="kind"
                  defaultValue={placement.kind}
                >
                  {PLACEMENT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {PLACEMENT_LABEL[kind]}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`value-${placement.id}`}>
                  Fair market value to the sponsor
                </label>
                <input
                  className={`${styles.input} ${styles.inputMoney}`}
                  id={`value-${placement.id}`}
                  name="benefitValue"
                  inputMode="decimal"
                  defaultValue={(placement.benefitFairMarketValueCents / 100).toFixed(2)}
                />
              </div>
              <div className={`${styles.field} ${styles.fieldWide}`}>
                <label className={styles.label} htmlFor={`wording-${placement.id}`}>
                  The exact wording that may be published
                </label>
                <textarea
                  className={styles.textarea}
                  id={`wording-${placement.id}`}
                  name="wording"
                  defaultValue={placement.approvedAcknowledgmentString}
                  maxLength={600}
                  required
                />
                <p className={styles.hint}>
                  Identity only: name, address, telephone, logo, a neutral
                  product line. No adjective about the sponsor, no price, no
                  offer, no instruction to buy.
                </p>
              </div>
              <div className={`${styles.field} ${styles.fieldWide}`}>
                <label className={styles.label} htmlFor={`notes-${placement.id}`}>
                  Notes, not published
                </label>
                <input
                  className={styles.input}
                  id={`notes-${placement.id}`}
                  name="notes"
                  defaultValue={placement.notes}
                  maxLength={300}
                />
              </div>
            </div>
            <div className={styles.formActions}>
              <button className={styles.submit} type="submit">
                Save the wording
              </button>
              <span className={styles.hint}>
                Changing the words returns this to awaiting release and clears
                the approval, because the approval was of different words.
              </span>
            </div>
          </form>
        </details>
      )}

      <div className={styles.gateRow}>
        {gate.mayAuthor && placement.publicationState === "DRAFT" && (
          <form action={sendForReleaseAction}>
            <input type="hidden" name="entity" value={gate.entity} />
            <input type="hidden" name="sponsorshipId" value={sponsorshipId} />
            <input type="hidden" name="placementId" value={placement.id} />
            {gate.as && <input type="hidden" name="as" value={gate.as} />}
            <button className={styles.submitQuiet} type="submit">
              Send for release
            </button>
          </form>
        )}

        {placement.publicationState === "AWAITING_RELEASE" &&
          gate.mayApprove &&
          !wroteIt && (
            <form action={approveForPublicationAction}>
              <input type="hidden" name="entity" value={gate.entity} />
              <input type="hidden" name="sponsorshipId" value={sponsorshipId} />
              <input type="hidden" name="placementId" value={placement.id} />
              {gate.as && <input type="hidden" name="as" value={gate.as} />}
              <button className={styles.submit} type="submit">
                Approve for publication
              </button>
            </form>
          )}
      </div>

      {placement.publicationState === "AWAITING_RELEASE" &&
        gate.mayApprove &&
        wroteIt && (
          <p className={styles.gateNote}>
            You wrote this wording, so you cannot also approve it. The release
            gate is a second pair of eyes and one person is not two. Ask the
            President, VP Operations or the Memorial Chair to read it.
          </p>
        )}

      {placement.publicationState === "AWAITING_RELEASE" && !gate.mayApprove && (
        <p className={styles.gateNote}>
          Waiting for a second reader who holds release approval. This role does
          not, so no approve control is shown here.
        </p>
      )}

      {placement.publicationState === "APPROVED" && !review.clean && (
        <p className={styles.gateNote}>
          Approved, so this publishes as written — including the phrases flagged
          above. A message mixing advertising with acknowledgment is advertising
          in its entirety, so this placement may be taxable advertising rather
          than qualified sponsorship.
        </p>
      )}
    </>
  );
}

/** Adding a placement to a sponsorship that has none, or another one. */
function NewPlacementForm({
  sponsorshipId,
  gate,
}: {
  sponsorshipId: string;
  gate: Gate;
}) {
  if (!gate.mayAuthor) return null;
  return (
    <details className={styles.details}>
      <summary className={styles.summary}>Add a placement</summary>
      <form className={styles.form} action={saveWordingAction}>
        <input type="hidden" name="entity" value={gate.entity} />
        <input type="hidden" name="sponsorshipId" value={sponsorshipId} />
        {gate.as && <input type="hidden" name="as" value={gate.as} />}
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`new-kind-${sponsorshipId}`}>
              Where it appears
            </label>
            <select
              className={styles.select}
              id={`new-kind-${sponsorshipId}`}
              name="kind"
              defaultValue="WEBSITE_FOOTER"
            >
              {PLACEMENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {PLACEMENT_LABEL[kind]}
                </option>
              ))}
            </select>
            <p className={styles.hint}>
              A programme or newsletter advert is advertising, not an
              acknowledgment, and is taxed separately.
            </p>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`new-value-${sponsorshipId}`}>
              Fair market value to the sponsor
            </label>
            <input
              className={`${styles.input} ${styles.inputMoney}`}
              id={`new-value-${sponsorshipId}`}
              name="benefitValue"
              inputMode="decimal"
              defaultValue="0.00"
            />
          </div>
          <div className={`${styles.field} ${styles.fieldWide}`}>
            <label className={styles.label} htmlFor={`new-wording-${sponsorshipId}`}>
              The exact wording that may be published
            </label>
            <textarea
              className={styles.textarea}
              id={`new-wording-${sponsorshipId}`}
              name="wording"
              maxLength={600}
              required
            />
          </div>
        </div>
        <div className={styles.formActions}>
          <button className={styles.submit} type="submit">
            Save as a draft
          </button>
          <span className={styles.hint}>
            It starts in draft. Nothing publishes until a second reader approves
            it.
          </span>
        </div>
      </form>
    </details>
  );
}

function PlacementBlock({
  view,
  showMoney,
  sponsorshipId,
  gate,
}: {
  view: PlacementView;
  showMoney: boolean;
  sponsorshipId?: string;
  gate?: Gate;
}) {
  const { placement, label, category, review } = view;
  return (
    <div className={styles.details}>
      <p className={styles.cardMeta} style={{ marginTop: "14px" }}>
        <span className={`${styles.pill} ${styles.pillHue}`}>{label}</span>{" "}
        <span
          className={`${styles.pill} ${
            category === "ADVERTISING" ? styles.pillWarn : ""
          }`}
        >
          {category.toLowerCase()}
        </span>{" "}
        <span className={styles.pill}>
          {placement.publicationState.toLowerCase().replace(/_/g, " ")}
        </span>
        {showMoney && (
          <>
            {" "}
            <span className={styles.pill}>
              benefit {formatCents(placement.benefitFairMarketValueCents)}
            </span>
          </>
        )}
      </p>

      <p className={styles.quote}>{placement.approvedAcknowledgmentString}</p>

      {review.clean ? (
        <p className={styles.clear}>{review.advisory}</p>
      ) : (
        <div className={styles.flag}>
          <span className={styles.flagHead}>
            {review.findings.length}{" "}
            {review.findings.length === 1 ? "warning" : "warnings"} · not a block
          </span>
          {ACKNOWLEDGMENT_ADVISORY_FLAGGED}
          <ul className={styles.findingList}>
            {review.findings.map((finding, index) => (
              <li key={`${finding.category}-${finding.index}-${index}`}>
                <span className={styles.findingTerm}>
                  &ldquo;{finding.match}&rdquo;
                </span>
                <span className={styles.findingCategory}>{finding.category}</span>
                <br />
                {finding.explanation}
              </li>
            ))}
          </ul>
        </div>
      )}

      {placement.notes && <p className={styles.cardMeta}>{placement.notes}</p>}

      {gate && sponsorshipId && (
        <PlacementControls view={view} sponsorshipId={sponsorshipId} gate={gate} />
      )}
    </div>
  );
}
