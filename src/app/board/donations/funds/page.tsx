import Link from "next/link";

import { RoleTabs } from "@/components/workspace-shell/RoleTabs";
import { AuthzError } from "@/lib/authz/policy";
import { readFundAggregates, readFundRegister } from "@/lib/donations/actions";
import {
  functionTabHref,
  functionTabs,
  WORKSPACE_BASE,
} from "@/lib/donations/workspace";
import { DEV_SWITCHER_PARAM } from "@/lib/donations/devSubject";
import { resolveScreenViewer } from "@/lib/donations/screenSubject";
import { formatCents } from "@/lib/donations/money";
import Denied from "../Denied";
import styles from "../donations.module.css";

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

  let register: ReturnType<typeof readFundRegister> | null = null;
  let aggregates: ReturnType<typeof readFundAggregates> | null = null;
  let denial: string | null = null;

  try {
    register = readFundRegister(subject, entity);
  } catch {
    // Row-level read refused. Fall back to the aggregate view, which is a
    // different grant: AGGREGATE means counts and totals with no row identity,
    // and that is exactly what a fund balance is.
    try {
      aggregates = readFundAggregates(subject, entity);
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


        {denial && (
          <Denied
            roleLabel={roleLabel}
            needs={`at least aggregate access to ${entity} financial records`}
            detail={denial}
          />
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
  register: ReturnType<typeof readFundRegister> | null;
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
