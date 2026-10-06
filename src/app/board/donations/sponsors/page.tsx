import Link from "next/link";

import { RoleTabs } from "@/components/workspace-shell/RoleTabs";
import { AuthzError } from "@/lib/authz/policy";
import {
  functionTabHref,
  functionTabs,
  WORKSPACE_BASE,
} from "@/lib/donations/workspace";
import {
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
import Denied from "../Denied";
import styles from "../donations.module.css";

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

  let register: ReturnType<typeof readSponsorRegister> | null = null;
  let wordingOnly: ReturnType<typeof readSponsorAcknowledgments> | null = null;
  let denial: string | null = null;

  try {
    register = readSponsorRegister(subject, entity);
  } catch (financialError) {
    try {
      wordingOnly = readSponsorAcknowledgments(subject, entity);
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


        {denial && (
          <Denied
            roleLabel={roleLabel}
            needs={`read access to ${entity} financial records, or at least read access to public content`}
            detail={denial}
          />
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
                  <PlacementBlock key={view.placement.id} view={view} showMoney={false} />
                ))}
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
                  <PlacementBlock key={view.placement.id} view={view} showMoney />
                ))}
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

function PlacementBlock({
  view,
  showMoney,
}: {
  view: PlacementView;
  showMoney: boolean;
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
    </div>
  );
}
