import { OutsideColumns } from "@/components/workspace-shell/RoleTabs";
import { ENTITIES } from "@/lib/authz/model";
import { getCurrentPersona, getCurrentSubject } from "@/lib/authz/session";
import { readableEntities } from "@/lib/meetings/access";
import {
  PUBLIC_RECORD_NOTES,
  SECRETARY_OWNED_PAGES,
  secretaryPlanning,
  secretaryPublicRecord,
} from "@/lib/meetings/workspace";
import { Shell } from "../Shell";
import styles from "../meetings.module.css";

export const metadata = { title: "Outside view — Secretary" };

/**
 * The Outside view tab.
 *
 * This office has almost no external surface, and that is correct rather than
 * missing. Its output is the minute book, which names who moved, who seconded
 * and who recused: the one record in this platform that is internal on
 * purpose. So the first answer on this screen is a stated zero — no public
 * page is this office's, nothing of its is stale, nothing of its is queued for
 * release — carried by `noExternalSurface` on the shared surface type, because
 * an empty screen implies breakage and a sentence explaining it does not.
 *
 * The second answer is the one a stated zero could be mistaken for: that
 * nothing of this office ever leaves the building. Untrue. The 990s and the
 * exemption determination letters are open to public inspection on request,
 * and official notice of a meeting goes out under this office's hand. Neither
 * is a page, so they are shown as their own surface, in the same two columns —
 * public, and member or donor — because blurring those two audiences into one
 * "outside" is how the OPSEC problems start.
 */
export default async function SecretaryOutsideTab() {
  const persona = await getCurrentPersona();
  const subject = await getCurrentSubject();
  const visible = readableEntities(subject, ENTITIES);

  // Guarded inside the library. Used only to point the notice row at the real
  // send screen rather than at a tab.
  const nextMeeting = secretaryPlanning(subject).meetings[0]?.meeting;
  const publicRecord = secretaryPublicRecord(
    nextMeeting ? `/board/meetings/${nextMeeting.id}/distribute` : "/board/meetings",
  );

  return (
    <Shell entity={null} meetingId={null} active="outside" persona={persona}>
      <p className={styles.eyebrow}>Secretary &middot; Outside view</p>
      <h1 className={styles.title}>What the world sees of the minute book</h1>
      <p className={styles.lede}>
        Nothing, and that is the design rather than a gap. This is the one
        function in the organization whose product is deliberately internal, so
        this tab&rsquo;s job is to say so in a sentence and then be precise
        about the narrow things that are genuinely public.
      </p>

      {visible.length === 0 ? (
        <div className={styles.quiet}>
          {persona.label} holds no board grant on either entity, and almost
          nothing on this tab is withheld as a result, because almost nothing on
          it is board-tier: that this office owns no public page is a statement
          about the design, and the documents named below are open to public
          inspection by anyone who asks. The one board-tier thing here is the
          link to the notice about to go out, which points at the tab index for
          this reader rather than at a meeting.
        </div>
      ) : null}

      <h2 className={styles.sectionHead}>Public pages this office owns</h2>
      <p className={styles.sectionNote}>
        The part of this tab that is a stated zero rather than an empty list.
      </p>
      <div style={{ marginTop: 14 }}>
        <OutsideColumns surface={SECRETARY_OWNED_PAGES} />
      </div>

      <div className={styles.quiet}>
        <strong>Nothing of this office&rsquo;s is ever in the release queue.</strong>{" "}
        The second-approver gate exists and matters, and this office does not
        appear at it, because it publishes nothing. A minute reaching a public
        page would not be transparency: it would be a named roll call, with who
        recused and why, on the open web.
      </div>

      <h2 className={styles.sectionHead}>Not a page, and still public</h2>
      <p className={styles.sectionNote}>
        Two audiences, side by side, never merged. None of these is a page this
        office maintains, so each row links to where the duty or the record is
        tracked inside the platform rather than pretending at a published
        document.
      </p>
      <div style={{ marginTop: 14 }}>
        <OutsideColumns surface={publicRecord} />
      </div>

      <div className={styles.quiet}>
        <strong>The returns and the letters.</strong> {PUBLIC_RECORD_NOTES.returns}
      </div>

      <div className={styles.quiet}>
        <strong>The notices.</strong> {PUBLIC_RECORD_NOTES.notices}
      </div>

      <div className={styles.warn}>
        <div className={styles.warnHead}>Named rather than left blank.</div>
        <p className={styles.rowNote}>{PUBLIC_RECORD_NOTES.gap}</p>
      </div>
    </Shell>
  );
}
