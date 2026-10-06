import { ENTITY_LABEL } from "@/lib/donations/kpis";
import { DEV_SWITCHER_PARAM } from "@/lib/donations/devSubject";
import { resolveScreenViewer } from "@/lib/donations/screenSubject";
import {
  entitiesInScope,
  fundraisingPlanning,
  FUNDRAISING_PLANNING_ITEMS,
} from "@/lib/donations/workspace";
import Chrome from "../Chrome";
import styles from "../donations.module.css";

export const metadata = {
  title: "Fundraising planning — board",
  robots: { index: false, follow: false },
};

const TYPE_LABEL: Record<string, string> = {
  DECISION: "decision",
  DISCUSSION: "discussion",
  INFORMATION: "information",
};

/**
 * Planning: what this role wants on the next board agenda.
 *
 * The one tab on the spine a role authors rather than derives. Each item is a
 * decision the Fundraising Chair cannot take alone, with the type, an estimate
 * and the reason it needs the board, and these flow into the Secretary's
 * agenda builder rather than being retyped there.
 *
 * All three items here are the same shape of problem: the role is being asked
 * to make a judgment the board has never written down. There is no published
 * sponsor ladder, so every sponsor conversation starts from nothing. There is
 * no gift-acceptance policy, so declining a sponsor is one volunteer's
 * judgment against a donor who was never told the rule. And there is no rule
 * about which entity a corporate gift goes to, so the entity choice falls to
 * whoever answers the email.
 *
 * Items are filtered to entities the viewer holds, which is why the Treasurer
 * of the Foundation does not see the Association item and the Chair, who holds
 * both, sees all three.
 */
export default async function FundraisingPlanningPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { subject, entity, roleLabel, qs } = await resolveScreenViewer(
    params[DEV_SWITCHER_PARAM],
  );

  const items = fundraisingPlanning(subject);
  const scope = entitiesInScope(subject);
  const totalMinutes = items.reduce((total, item) => total + item.estimateMinutes, 0);
  const hidden = FUNDRAISING_PLANNING_ITEMS.length - items.length;

  return (
    <Chrome
      entity={entity}
      roleLabel={roleLabel}
      current="planning"
      qs={qs}
      statusWord="planning"
      title="For the next meeting"
      lede={
        <>
          What fundraising wants in front of the board, with the type, an
          estimate and why it needs the board rather than the role. These flow
          into the Secretary&rsquo;s agenda builder; nobody retypes them there.
        </>
      }
    >
      <p className={styles.sectionNote}>
        {items.length} {items.length === 1 ? "item" : "items"}, {totalMinutes} minutes
        of agenda, filed by the Fundraising Chair across{" "}
        {scope.length === 0 ? "no entity" : scope.map((e) => ENTITY_LABEL[e]).join(" and ")}.
        {hidden > 0
          ? ` ${hidden} further ${hidden === 1 ? "item is" : "items are"} filed ` +
            `against an entity this role holds no assignment on and ${
              hidden === 1 ? "is" : "are"
            } not shown.`
          : ""}
      </p>

      {items.length === 0 ? (
        <p className={styles.sectionNote}>
          Nothing is filed for an entity this role holds.
        </p>
      ) : (
        items.map((item) => (
          <article key={item.id} className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>{item.title}</h2>
              <span className={styles.cardMeta}>
                <span className={`${styles.pill} ${styles.pillHue}`}>
                  {TYPE_LABEL[item.type] ?? item.type.toLowerCase()}
                </span>{" "}
                <span className={styles.pill}>{ENTITY_LABEL[item.entity]}</span>{" "}
                <span className={styles.figure}>{item.estimateMinutes} min</span>
              </span>
            </div>
            <p className={styles.lede}>{item.reason}</p>
            <p className={styles.sectionNote}>
              {item.acceptedForMeetingId
                ? `On the agenda for ${item.acceptedForMeetingId}.`
                : "Not yet taken onto an agenda by the Secretary."}
            </p>
          </article>
        ))
      )}

      <p className={styles.note}>
        An estimate here is a claim on a volunteer evening, so it is stated in
        minutes and summed above rather than left for the Secretary to guess.
        The sponsor ladder is also a line of effort in the org register, which
        is where its owner and its contributors live.
      </p>
    </Chrome>
  );
}
