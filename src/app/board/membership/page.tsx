import Link from "next/link";

import { KpiGrid } from "@/components/dashboard/Kpi";
import dash from "@/components/dashboard/dashboard.module.css";
import { AuthzError } from "@/lib/authz/policy";
import {
  loadMembershipDashboard,
  type DashboardAction,
  type MembershipDashboard,
} from "@/lib/membership/kpis";
import { membershipRepository } from "@/lib/membership/repository";

import styles from "./board.module.css";
import { MembershipShell, Refused } from "./shell";
import { currentActor } from "./subject";

export const metadata = {
  title: "Membership — JSOA board",
  robots: { index: false, follow: false },
};

/**
 * The VP Membership dashboard.
 *
 * The roster is the master record that scholarship eligibility, event
 * invitations and the three 501(c)(19) tests all key off, so what this screen
 * reports is whether the roster is true, whether intake is keeping its promise
 * to applicants, and whether the sponsor flow that replaced the chair-invoice-
 * confirm sequence is actually closing. Not how many members there are: that
 * figure only goes up and changes nothing.
 *
 * All policy is in `loadMembershipDashboard`. This file renders what comes
 * back, including the tiles that come back withheld because the viewer holds
 * aggregate on member records and not read — which is the case this module was
 * built around, and the reason the composition tests are computable for
 * someone who may never open the roster.
 */
export default async function MembershipDashboardPage() {
  const { persona, subject } = await currentActor();

  let dashboard: MembershipDashboard | null = null;
  let refusal: string | null = null;
  try {
    dashboard = await loadMembershipDashboard(membershipRepository(), subject);
  } catch (error) {
    if (!(error instanceof AuthzError)) throw error;
    refusal = error.message;
  }

  return (
    <MembershipShell current="overview">
      <div className={dash.heading}>
        <h1 className={dash.title}>Membership</h1>
        {dashboard ? (
          <span className={dash.asOf}>as of {dashboard.asOf.slice(0, 16).replace("T", " ")}Z</span>
        ) : null}
      </div>

      <p className={dash.lede}>
        The roster is the record that scholarship eligibility, event invitations and the three
        exemption tests all key off. These are the figures that say whether it is true and whether
        intake is keeping the four days the acknowledgment promises.
      </p>

      {refusal || !dashboard ? (
        <Refused persona={persona} what="membership figures" detail={refusal ?? undefined} />
      ) : (
        <>
          <KpiGrid kpis={dashboard.kpis} />

          {!dashboard.scope.records && (
            <p className={styles.note}>
              Four figures are withheld. This role holds aggregate on member records, which is
              enough for the three tests above and not for the records behind them. Nothing was
              widened to fill the gap.
            </p>
          )}

          <h2 className={styles.sectionHead}>What follows from that</h2>
          <div className={dash.actions}>
            {dashboard.actions.map((action) => (
              <ActionRow key={action.key} action={action} />
            ))}
          </div>

          <h2 className={styles.sectionHead}>Also on the record</h2>
          <dl className={styles.tier}>
            {dashboard.rows.map((row) => (
              <div key={row.key} className={styles.tierRow}>
                <dt className={styles.tierLabel}>{row.label}</dt>
                <dd className={styles.tierDetail}>{row.detail}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </MembershipShell>
  );
}

/**
 * An action, with its count and a link into the work.
 *
 * An action whose target this role cannot open keeps its row and loses its
 * link. Hiding it would tell the reader the work does not exist, which is a
 * worse answer than telling them it is not theirs.
 */
function ActionRow({ action }: { action: DashboardAction }) {
  const body = (
    <>
      <span className={dash.actionLabel}>{action.label}</span>
      <span className={dash.actionNote}>{action.note}</span>
      <span className={dash.actionCount}>{action.count}</span>
    </>
  );

  const className = `${dash.action} ${action.urgent ? dash.actionUrgent : ""}`;

  if (!action.href) return <div className={className}>{body}</div>;

  return (
    <Link href={action.href} className={className}>
      {body}
    </Link>
  );
}
