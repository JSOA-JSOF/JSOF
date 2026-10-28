import Link from "next/link";

import { RoleTabs } from "@/components/workspace-shell/RoleTabs";
import { AuthzError } from "@/lib/authz/policy";
import {
  canDefineFund,
  listPublicFundOptions,
  readFundAggregates,
  readFundRegister,
} from "@/lib/donations/actions";
import {
  functionTabHref,
  functionTabs,
  WORKSPACE_BASE,
} from "@/lib/donations/workspace";
import { DEV_SWITCHER_PARAM } from "@/lib/donations/devSubject";
import { resolveScreenViewer } from "@/lib/donations/screenSubject";
import { formatCents } from "@/lib/donations/money";
import Denied from "../Denied";
import Notice, { firstOf } from "../Notice";
import { closeFundAction, saveFundAction } from "../actions";
import styles from "../donations.module.css";

/*
 * The two reads this screen makes, as the screen sees them.
 *
 * `readFundRegister` and `readFundAggregates` are async now, so a bare
 * `ReturnType` would be the promise rather than the rows. `Awaited` keeps the
 * type tied to the action instead of restating its shape here, which is what
 * stops this screen and that action drifting apart.
 */
type FundRegister = Awaited<ReturnType<typeof readFundRegister>>;
type FundAggregates = Awaited<ReturnType<typeof readFundAggregates>>;

export const metadata = {
  title: "Funds — board",
  robots: { index: false, follow: false },
};

/**
 * Fund management: restricted versus unrestricted, per entity, with balances
 * and the gifts behind them.
 *
 * Two authorization calls rather than one, and that is the point. A balance is
 * an aggregate and several roles hold AGGREGATE on FINANCIAL; the gifts behind
 * it are row-level and need READ. So the screen tries the register first, and
 * falls back to the aggregate view. A Secretary or an Events Chair sees the
 * totals and does not see who gave what.
 *
 * Nothing on this screen sums the two entities together. There is one entity
 * per view, named in the heading.
 */
export default async function FundsPage({
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
  const mayDefine = canDefineFund(subject, entity);
  const offered = await listPublicFundOptions(entity);

  let register: FundRegister | null = null;
  let aggregates: FundAggregates | null = null;
  let denial: string | null = null;

  try {
    register = await readFundRegister(subject, entity);
  } catch {
    // Row-level read refused. Fall back to the aggregate view, which is a
    // different grant: AGGREGATE means counts and totals with no row identity,
    // and that is exactly what a fund balance is.
    try {
      aggregates = await readFundAggregates(subject, entity);
    } catch (aggregateError) {
      denial =
        aggregateError instanceof AuthzError
          ? aggregateError.message
          : String(aggregateError);
    }
  }

  const balances = register
    ? register.map((row) => row.balance)
    : (aggregates ?? []);
  const restricted = balances.filter((b) => b.restriction === "RESTRICTED");
  const unrestricted = balances.filter((b) => b.restriction === "UNRESTRICTED");
  const restrictedTotal = restricted.reduce((t, b) => t + b.balanceCents, 0);
  const unrestrictedTotal = unrestricted.reduce((t, b) => t + b.balanceCents, 0);

  return (
    <div
      className={styles.page}
      style={{ ["--hue" as string]: hue, ["--hueTint" as string]: hueTint }}
    >
      <header className={styles.bar}>
        <Link href="/" className={styles.back}>
          ← Both entities
        </Link>
        <span className={styles.status}>Board · funds · {entity}</span>
      </header>

      <div className={styles.body}>
        <h1 className={styles.title}>Funds</h1>
        <p className={styles.lede}>
          {entity} funds only. A restricted fund can be spent on one stated
          purpose; an unrestricted fund is the board&rsquo;s to direct. The two
          entities&rsquo; funds are never shown in one total.
        </p>

        {/* The workspace spine, with this module's three function screens
            appended. Funds keeps its own route. */}
        <RoleTabs
          base={WORKSPACE_BASE}
          current={functionTabHref("funds", qs)}
          functionTabs={functionTabs(qs)}
        />


        <Notice done={firstOf(params.done)} refused={firstOf(params.refused)} />

        {denial && (
          <Denied
            roleLabel={roleLabel}
            needs={`at least aggregate access to ${entity} financial records`}
            detail={denial}
          />
        )}

        {/* Opening a fund.
            This is the gap docs/PHASE2-FINDINGS.md puts at the top: against a
            real database there was no fund at all and no way to make one, so
            the donate form offered a donor nothing. It is deliberately not
            fixed by loading seed.ts — that data is realistic and false, and
            loading it would put invented funds on a live donate form. */}
        <h2 className={styles.sectionHead}>Open a fund</h2>
        {mayDefine ? (
          <>
            <p className={styles.sectionNote}>
              A fund&rsquo;s name and purpose are published on the donate form,
              so write them as a donor will read them. A restricted fund can be
              spent only on the purpose stated here.
            </p>
            <form className={styles.form} action={saveFundAction}>
              <input type="hidden" name="entity" value={entity} />
              {as && <input type="hidden" name="as" value={as} />}
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="fund-name">
                    Fund name
                  </label>
                  <input
                    className={styles.input}
                    id="fund-name"
                    name="name"
                    required
                    maxLength={120}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="fund-restriction">
                    Restriction
                  </label>
                  <select
                    className={styles.select}
                    id="fund-restriction"
                    name="restriction"
                    defaultValue="UNRESTRICTED"
                  >
                    <option value="UNRESTRICTED">
                      Unrestricted — the board&rsquo;s to direct
                    </option>
                    <option value="RESTRICTED">
                      Restricted — one stated purpose only
                    </option>
                  </select>
                </div>
                <div className={`${styles.field} ${styles.fieldWide}`}>
                  <label className={styles.label} htmlFor="fund-purpose">
                    Purpose, as the donor reads it
                  </label>
                  <textarea
                    className={styles.textarea}
                    id="fund-purpose"
                    name="purpose"
                    required
                    maxLength={600}
                  />
                  <p className={styles.hint}>
                    Required. A restriction the board cannot state is a
                    restriction it cannot honour.
                  </p>
                </div>
                <div className={styles.checkField}>
                  <input
                    type="checkbox"
                    id="fund-open"
                    name="openToGifts"
                    defaultChecked
                  />
                  <label htmlFor="fund-open">
                    Offer this fund on the public donate form for {entity}
                  </label>
                </div>
              </div>
              <div className={styles.formActions}>
                <button className={styles.submit} type="submit">
                  Open the fund
                </button>
                <span className={styles.hint}>
                  It belongs to {entity}. A fund cannot be moved to the other
                  organization later.
                </span>
              </div>
            </form>
          </>
        ) : (
          <p className={styles.gateNote}>
            {roleLabel} cannot open a fund. A fund needs either write access to{" "}
            {entity} financial records, or write access to {entity} published
            content together with at least aggregate financial access — the
            Treasurer or the Fundraising Chair. No form is shown here, because a
            control that cannot complete its action should not look like one.
          </p>
        )}

        {/* What the donate form is offering right now.
            Built from `listPublicFundOptions`, which is the one read in this
            module with no authorize() call: it returns names, restrictions
            and purposes and no figure at all. So the Fundraising Chair, who
            holds financial access at aggregate and cannot open the register
            below, can still see and close what the public is being offered. */}
        <h2 className={styles.sectionHead}>Offered on the donate form</h2>
        {offered.length === 0 ? (
          <p className={styles.sectionNote}>
            Nothing. A donor opening /donate is offered no {entity} fund at all
            and cannot complete a gift to this organization. Open one above.
          </p>
        ) : (
          <>
            <p className={styles.sectionNote}>
              {offered.length} {offered.length === 1 ? "fund" : "funds"} a donor
              can choose between today.
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Fund</th>
                    <th>Purpose, as published</th>
                    {mayDefine && <th>Close</th>}
                  </tr>
                </thead>
                <tbody>
                  {offered.map((option) => (
                    <tr key={option.id}>
                      <td>
                        {option.name}{" "}
                        <span className={styles.pill}>
                          {option.restriction.toLowerCase()}
                        </span>
                      </td>
                      <td>{option.purpose}</td>
                      {mayDefine && (
                        <td>
                          <form action={closeFundAction}>
                            <input type="hidden" name="entity" value={entity} />
                            <input type="hidden" name="fundId" value={option.id} />
                            {as && <input type="hidden" name="as" value={as} />}
                            <button className={styles.submitQuiet} type="submit">
                              Close to new gifts
                            </button>
                          </form>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.note}>
              Closing a fund stops it being offered. Nothing is deleted: it keeps
              its balance, its gifts and its place in the register, because a
              closed campaign that vanished would take its reporting with it.
            </p>
          </>
        )}

        {balances.length > 0 && (
          <>
            {!register && (
              <div className={styles.flag}>
                <span className={styles.flagHead}>Totals only</span>
                {roleLabel} holds aggregate access to {entity} financial records,
                not row-level read. Balances are shown. The gifts behind them are
                not, and neither is a donor name.
              </div>
            )}

            <h2 className={styles.sectionHead}>Restricted</h2>
            <p className={styles.sectionNote}>
              Held for a stated purpose. A gift to one of these cannot be
              redirected without going back to the donor.
            </p>
            <FundTable
              rows={restricted}
              register={register}
              total={restrictedTotal}
            />

            <h2 className={styles.sectionHead}>Unrestricted</h2>
            <p className={styles.sectionNote}>
              Available for any purpose of the entity, at the board&rsquo;s
              discretion.
            </p>
            <FundTable
              rows={unrestricted}
              register={register}
              total={unrestrictedTotal}
            />

            <p className={styles.note}>
              Balances count cleared gifts only. A gift awaiting payment is not
              money, so it is not in a balance, and there is no state in which
              an unpaid gift shows as a fund balance.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

type Balance = { fundId: string; name: string; balanceCents: number; giftCount: number };

function FundTable({
  rows,
  register,
  total,
}: {
  rows: Balance[];
  register: FundRegister | null;
  total: number;
}) {
  if (rows.length === 0) {
    return <p className={styles.sectionNote}>No funds in this class.</p>;
  }
  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Fund</th>
              <th className={styles.numeric}>Gifts</th>
              <th className={styles.numeric}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.fundId}>
                <td>{row.name}</td>
                <td className={styles.numeric}>{row.giftCount}</td>
                <td className={styles.numeric}>{formatCents(row.balanceCents)}</td>
              </tr>
            ))}
            <tr className={styles.rowTotal}>
              <td>Total</td>
              <td className={styles.numeric} />
              <td className={styles.numeric}>{formatCents(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {register &&
        rows.map((row) => {
          const detail = register.find((r) => r.balance.fundId === row.fundId);
          if (!detail) return null;
          return (
            <details className={styles.details} key={row.fundId}>
              <summary className={styles.summary}>
                {row.name} · {detail.gifts.length}{" "}
                {detail.gifts.length === 1 ? "gift" : "gifts"} behind this balance
              </summary>
              <div className={styles.card}>
                <p className={styles.cardMeta}>{detail.purpose}</p>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Donor</th>
                        <th>Received</th>
                        <th>State</th>
                        <th className={styles.numeric}>To this fund</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.gifts.map((gift) => (
                        <tr key={`${gift.donationId}-${gift.amountCents}`}>
                          <td>{gift.donorDisplayName}</td>
                          <td className="mono">{gift.receivedAt.slice(0, 10)}</td>
                          <td>
                            <span
                              className={`${styles.pill} ${
                                gift.status === "PAID" ? styles.pillHue : styles.pillWarn
                              }`}
                            >
                              {gift.status.toLowerCase().replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className={styles.numeric}>
                            {formatCents(gift.amountCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          );
        })}
    </>
  );
}
