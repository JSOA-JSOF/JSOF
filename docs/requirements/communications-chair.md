# Communications Chair: requirements for E40 to E47

Buildable requirements for the eight functions my office owns under the signed
statement of work. Binding reading before any of this is built:
`docs/ARCHITECTURE.md`, `docs/PRIVACY-AND-PAYMENTS.md`, `docs/MODULE-BRIEF.md`.
Where this document and one of those disagree, those win and this file is the
thing that changes.

I have written this as the officer who presses send. A mistake in the store
reaches one buyer. A mistake here reaches eight hundred people at once, from an
address they cannot tell apart from a phishing attempt, and it cannot be
recalled.

## What exists today

Nothing. That is the honest one-word answer and the rest of this section is the
evidence.

- `resend` is in `package.json` dependencies at `^6.0.1`. Nothing imports it.
  Every reference in the repository is a comment saying it is not wired.
- There is no `src/lib/comms/`, no `src/app/board/comms/`, no communications
  table in any of the ten migrations, and no route that sends anything.
- Two in-memory outbox stubs exist and are the whole of the outbound side:
  `src/lib/membership/notify.ts` and `src/lib/scholarships/notify.ts`. Both
  push to a `globalThis` array. Both are reset by a process restart.
- `src/lib/meetings/distribution.ts` builds a `ResendPayload` and hands it to
  nobody. `src/app/board/meetings/[id]/distribute/page.tsx:56` tells the
  Secretary so on screen.
- `src/lib/donations/receipts.ts` renders a statutory receipt correctly and
  there is no code path that delivers one.
- Nothing in `src/lib/store/` sends email at all. A buyer gets no confirmation
  and no receipt.
- `src/lib/auth/actions.ts:48` carries `TODO(E46)`. The sign-in link is written
  to the audit log instead of being emailed, which means **nobody outside the
  database can sign in.** Authentication is blocked on this office.
- The legacy list is on Mailchimp (`src/lib/treasury/seed.ts:881`), owned by
  this role, marked `consolidate`, last reviewed April 2025, roughly $456 a
  year. Its subscriber data, and more importantly its unsubscribe history, is
  not in this platform.

The inbound half is in better shape than the outbound half and should be read
before building beside it: `migrations/0002_inbox.sql` and
`src/lib/inbox/routing.ts`. It is rules-first, a model only suggests, routes are
append-only by trigger, and `UNPLACED` is a real answer rather than a failure.
Outbound should read the same way: a named rule, an auditable basis, and a
refusal that is visible rather than silent. What the inbound half does not have
is a door — there is no route handler anywhere that accepts a message into
`inbound_message`. See section 4.

## 1. Two streams. They never share a reputation or a suppression list

This is the decision the other seven depend on, so it comes first.

**Transactional** mail is a message a person's own action asked for, addressed
to that person about their own business with us. **Bulk** mail is a message we
decided to send to a group. The distinction is not a label on a send; it is a
property of the template, fixed when the template is created, and the sender
cannot change it on the way out.

| Function | Stream | Why |
| --- | --- | --- |
| E40 full member list | BULK | We chose to send it |
| E41 segmented send | BULK | Same, to fewer people |
| E42 editable body | both | A property of every template in either stream |
| E43 unsubscribe and suppression | BULK governs, both consume | See below |
| E44 domain authentication | both, separately | Two identities, two reputations |
| E45 send history | both | One record, stream recorded on every row |
| E46 transactional | TRANSACTIONAL | Confirmations, approvals, receipts |
| E47 portal announcement | neither | Not email. See E47 |

Three mechanical consequences:

1. **Separate sending identities**, so a bad newsletter cannot damage the
   deliverability of a dues receipt or a sign-in link. Different subdomain,
   different DKIM key, different reputation at the receiver. Section 3.
2. **Separate suppression semantics.** One suppression table, one row per
   address per stream. An unsubscribe writes a BULK row and nothing else. A
   hard bounce writes both. A spam complaint writes BULK and raises a flag for
   a person; it never suppresses TRANSACTIONAL, because a complaint about a
   newsletter is not a reason to stop sending a receipt.
3. **The check is not optional and not defaultable.** The suppression function
   takes the stream as a required argument with no default value, so a call
   site cannot forget it and get the permissive answer. A bulk template cannot
   render without an unsubscribe footer; a transactional template cannot render
   with one. Both are compile-or-test failures, not review comments.

The case that decides whether this is built right: **a member unsubscribes from
the newsletter in January, and in March their dependent applies for a
scholarship.** Under `src/lib/scholarships/notify.ts` the sponsoring member is a
named recipient of every message to that applicant, with a reason, and there is
no bcc on the type. The award letter must reach them. If it does not, the chair
goes back to chasing sponsors by hand and we have shipped the workaround.

## 2. Nothing is sent inline from a request

Read the header comment of `src/lib/membership/notify.ts` before building this.
The property it protects is not politeness. The membership form must not be
usable to test whether a person is a member (`docs/ARCHITECTURE.md`, membership
state machine), and **response time is a channel.** If the handler calls the
mail API when a sponsor exists and skips it when one does not, the form answers
the question in milliseconds even though the page says the same words both ways.

So:

- **The queue is a D1 table**, `outbound_message`, plus an append-only
  `outbound_attempt` table in the style of `message_route`. A request handler's
  only mail-related work is one INSERT. It does not look up deliverability, it
  does not branch, and it does not await a network call. An undeliverable
  message is **written** with `status = 'UNDELIVERABLE'` and a reason, never
  skipped. Writing a row is the same work either way; skipping one is not.
- **The drain is a Cloudflare Cron Trigger** on the existing Worker, running
  every minute, claiming a bounded batch of due rows and sending them. Cron
  Triggers need no new binding and no plan change. Cloudflare Queues is the
  upgrade when volume justifies it; that is a later decision and the table is
  the record of truth in either design, so the swap does not change the schema.
- **Claiming must be atomic.** The drain sets `status = 'SENDING'` and a lease
  expiry in the same statement that selects the row, so two overlapping ticks
  cannot send the same message twice. A lease that expires without a terminal
  status returns the row to `QUEUED`, once, and increments the attempt count.
- **Every send carries an idempotency key** derived from the message id, so a
  retry at the provider does not produce a second receipt.
- **Retries are bounded and recorded.** Exponential backoff on a 4xx/5xx that
  is retriable; no retry at all on a hard rejection. After the cap the row goes
  to `status = 'DEAD'`.
- **A message that can never be delivered does not disappear.** DEAD and
  UNDELIVERABLE rows surface on a board screen with the reason and the
  reference, they are counted in E45, and a DEAD transactional message about
  money or an award raises a notice to the owning office. Silence is the failure
  mode this whole design exists to prevent: the Scholarships Chair's current
  process is bad but it is visible, and an invisible queue is worse than a
  spreadsheet.
- **Retention.** The delivery fact is kept; the rendered body is not kept
  forever. A receipt body is reproducible from the donation record, so the body
  is purged on the schedule `docs/PRIVACY-AND-PAYMENTS.md` requires per data
  class and the delivery fact remains. The schedule is set with the Secretary.

I do not own `migrations/`. These tables are a request to whoever does, written
up here so the request is specific rather than a conversation.

## 3. Domains, and what is actually blocked

Three logins, three different blockers. The board review and the common
shorthand both collapse them into "we don't have the registrar login", which is
true and which blocks much less than people think.

| Login | Controls | Blocks |
| --- | --- | --- |
| Network Solutions | Registration, nameservers | Moving the zone off Wix. Nothing else |
| Wix DNS | Every DNS record on `thejsoa.org` today | SPF, DKIM, DMARC, any Resend verification record |
| Google Workspace admin | Mailboxes on `thejsoa.org` | Creating `support@`, `connect@`, and DKIM signing |
| Cloudflare | `thejsof.org` entirely | Nothing. We have it |

Read with `docs/DNS-AND-EMAIL.md`: the registrar and the DNS host are different
vendors, mail is already at Google and does not move when the website does, and
DNSSEC is not actually on, so there is no DS record standing in the way.

**What can be done today, with no login we do not have.** `thejsof.org` was
registered at Cloudflare on 22 October 2026 into an empty zone
(`wrangler.jsonc`). Everything E44 asks for can be done on it this week:

- Verify two Resend sending subdomains, `notices.thejsof.org` (transactional)
  and `news.thejsof.org` (bulk), each with its own DKIM key and its own
  return-path, so the two reputations are separate at the receiver.
- Publish SPF for each sending subdomain. Do not touch the apex SPF.
- Publish `_dmarc.thejsof.org` at `p=none` with an `rua` address, read the
  aggregate reports for a full cycle, then tighten to `quarantine` and then to
  `reject`. Record the dates of each tightening.
- Send nothing from the apex until the subdomains have a record.

This is not a consolation prize. **The Foundation owns scholarships**
(`docs/ARCHITECTURE.md`), the next cycle opens mid-December 2026, and the
Scholarships Chair's most draining task is emailing students one at a time. Her
E52 depends on my E46 and my E46 depends on a sending domain we already control.
There is no reason for that to wait on Network Solutions.

**What genuinely cannot start.** Nothing may be sent from `@thejsoa.org` until
somebody with the Wix DNS login publishes the verification and DKIM records for
a sending subdomain there. Today `thejsoa.org` has no DKIM on the default
selector, no DMARC at all, and an SPF ending in `~all`. Sending eight hundred
unauthenticated messages into that is exactly the silent failure
`docs/DNS-AND-EMAIL.md` warns about.

**The workaround that must be refused.** It is technically easy to send
Association mail from `notices.thejsof.org` and have most of it delivered.
Do not. A JSOA dues receipt carries a dues-not-deductible disclaimer and a JSOF
contribution receipt carries Pub. 1771 language; `docs/ARCHITECTURE.md` says
receipt templates are per entity and never shared, and the board review's single
heaviest finding is three offices independently reporting that the entity map
contradicts itself at the point of payment. Putting a 501(c)(19) receipt in a
Foundation envelope is that same defect, in the one artifact a donor keeps. The
entity separation is a compliance control, not branding.

One carve-out, and it needs a decision rather than my assertion: the **sign-in
link** makes no tax claim and speaks in no entity's voice. If the board accepts
that it is platform infrastructure, it may send from the platform domain and
authentication unblocks immediately. Decider: the President, with the Secretary.

**The standing part of E44 that the contracted line does not buy.** Domain
authentication reads like a one-off DNS task. It is a control with a schedule:
somebody reads the DMARC aggregate reports, somebody tightens the policy on a
stated date, somebody re-checks after any DNS change, and somebody re-checks
immediately before the Wix cutover because a nameserver move silently drops
whatever was not copied across. No office is contracted to do any of that.
I am proposing it lands on me, quarterly, with the compliance calendar.

## 4. Before the site may publish an address

Two addresses are published today that do not exist: `support@thejsoa.org` and
`connect@thejsoa.org` (`src/app/(public)/contact-roles.ts`). Six per-office
mailboxes are marked `mailboxLive: false` in the same file, including
`memorial@` and `familysupport@`, which carry published reply-time commitments of
three and two business days. The Memorial Chair's version of this is the one to
keep in mind: a two-business-day promise to a bereaved family, pointed at a
mailbox nobody reads.

An address may be published only when all five are true:

1. The mailbox exists and accepts mail. For `@thejsoa.org` this is a Google
   Workspace task and **needs no DNS change at all** — the MX records already
   point at Google, so a new alias or group receives mail the moment it is
   created. This is blocked on the Workspace admin login, not the registrar.
2. Mail arriving at it reaches the platform, so `migrations/0002_inbox.sql` has
   something in it. There is currently no route handler that writes an
   `inbound_message` row. That door is the inbox lane's to build; I am naming it
   because every reply-time commitment on the public site rests on it.
3. It is routed to an office by `routeByRules`, and `UNPLACED` lands in a queue
   that a named person opens on a named cadence.
4. A named human is accountable for the published reply time, and the published
   figure is the one that office agreed to, not the one that reads best.
5. An auto-acknowledgment goes out on receipt — which is a transactional send,
   mine, and must carry no unsubscribe link and make no promise the office has
   not agreed to.

Until all five hold, the page carries the address as inert text with a note, per
R10 and R11 of `docs/BOARD-REVIEW.md`: a control that cannot complete its action
does not render as a control.

---

# E40 Template-based email to the full member list

## What it must do

A board member can check this: the Communications Chair opens a template, writes
the body, chooses "all members", previews it, sends a test to themselves, and
sends. Every current member receives one copy. The chair can afterwards see how
many were sent and how many arrived.

**And the chair never sees the roster.** `src/lib/authz/model.ts:223` grants
`COMMUNICATIONS_CHAIR` `MEMBER_PII: "NONE"`, with the note that the newsletter
list is a separate scope from the roster. That is deliberate and
`docs/MODULE-BRIEF.md` forbids me from working around it. So "the full member
list" is an audience **named by criteria and resolved server-side at send time**.
The chair composes against a count. The addresses are assembled inside the drain,
which runs with its own authority and not with the chair's.

## Acceptance criteria

1. A chair-role session can create, preview, test-send and send a BULK template.
   It receives a count of recipients and never a name or an address.
2. A request by the chair for the resolved recipient list of any audience returns
   403 and writes an audit row. This is the wrong-role test
   `docs/MODULE-BRIEF.md` requires.
3. Sending to an audience of N members produces exactly N `outbound_message`
   rows, one per member, each with its own id and idempotency key. No row has
   more than one recipient, and no row carries a bcc.
4. A member suppressed on BULK produces a row with `status = 'SUPPRESSED'` and
   the reason, not a missing row. Suppressed rows are counted and shown.
5. A member suppressed on BULK, sent a transactional message in the same hour,
   receives it.
6. The handler that accepts the send returns before any mail API call is made.
   A test asserts that the provider client is not invoked on the request path.
7. Re-submitting the same send (double-click, retry, browser back) does not
   produce a second set of rows. The send has a client-supplied idempotency key
   and a unique constraint behind it.

## What already exists

Nothing. There is no template, no audience, no send, no table. The nearest
things in the repository are the two outbox stubs, which model one message at a
time to a named recipient and have no concept of an audience.

The member fields an audience could be resolved from do exist, in
`migrations/0003_membership.sql`: `state`, `entity`, `membership_category`,
`is_war_veteran`, `joined_at`, `payment_cleared_at`, `last_audited_at`, `email`.

## Missing or undecided

- **Who may hold the newsletter list.** The authz note says the newsletter list
  is a separate scope, and no such scope exists in
  `src/lib/authz/model.ts`. Non-member subscribers — donors, friends of the
  organization, the people on the legacy Mailchimp list — are not MEMBER_PII and
  not APPLICANT, and there is no data class that fits. `src/lib/authz/**` is
  explicitly never delegated (`docs/MODULE-BRIEF.md`). **Decider: whoever owns
  the authz matrix, by review.** I will not propose a diff to it; I am reporting
  that E40 and E41 cannot be finished without an answer.
- Whether a JSOA-wide send and a JSOF-wide send are ever the same send. My
  position is no: every row carries `entity` and the From, the footer and the
  postal address differ. **Decider: the board**, as part of R3.
- The floor below which an exact recipient count is not shown. See E41.
- Whether the chair may attach a file. My position is no, for the first version:
  attachments are the most attractive thing to spoof from an address a member
  trusts. Link to the site instead.

## Edge cases that will actually happen

- **A bounced address on the roster.** Three members changed jobs and the
  address on the roster is dead. The bounce arrives at the webhook, the address
  is suppressed, and the chair sees "3 undeliverable" and no names, because the
  chair holds no MEMBER_PII. The names go to a **VP Membership** queue, because
  correcting a roster address is a membership function and a dead address is
  also a failed sponsor-vouch channel (`src/lib/membership/kpis.ts:762`).
- **A send that half-completes.** The drain sends 400 of 800 and the Worker is
  evicted, or the provider starts rate-limiting at 500. Per-recipient rows plus
  the idempotency key make the resume safe: the next tick picks up only
  `QUEUED`, and nobody gets a second copy. The batch is not "sent" until every
  row is terminal; until then E45 shows it in progress with the real split. The
  failure this prevents is the one everyone has seen, where a nervous chair
  presses send again and four hundred people get it twice.
- **A household with one address.** Two members, one email, qualifying-relative
  membership. The audience resolves to two rows with the same address. Deduplicate
  by normalized address within a single send, so they get one copy, and accept
  that their subscription state is shared. Say so on the unsubscribe page.
- **A merge field that resolves for 799 members and not the 800th.** Covered in
  E42, and it blocks the send rather than sending "Dear ,".
- **The chair sends at 2am local to a nationwide roster.** Not a bug, and not
  worth building a scheduler for in version one. Worth a line in the preview
  showing the send time in America/New_York per `docs/ARCHITECTURE.md`.

## Where the line is thinner than the job

"The full member list" is written as though it were a thing the chair can see.
It is not, and it should not become one. The job is an audience abstraction that
lets a chair mail eight hundred people without ever being shown eight hundred
veterans' names and addresses — which is also the single most useful file an
attacker could take from this organization.

---

# E41 Segmented sends to a filtered group

## What it must do

The chair picks a saved segment, or builds one from a small fixed set of
criteria, sees how many it matches, and sends to it. The definition of the
segment is stored with the send, so a year later somebody can answer "who got
this?" without re-running a query against a roster that has since changed.

## Acceptance criteria

1. Segments compose only from an allow-listed set of fields. A free-text or
   SQL-ish filter box fails review; the allow-list is in code and tested.
2. A segment preview returns a count and nothing else. Below the minimum segment
   size the preview returns "fewer than N" rather than an exact figure.
3. The resolved criteria **and** the resulting count are written onto the send
   record at send time, immutably. Changing the segment afterwards does not
   change the history of a send that used it.
4. Two segments that overlap, sent as one campaign, deliver one copy per address.
5. A segment resolving to zero recipients produces a send with zero rows, a
   clear "nobody matched" result, and no provider call.
6. Wrong-role test: a non-chair role cannot create, preview or run a segment.

## What already exists

Nothing. The fields listed under E40 exist; nothing reads them for this purpose.
`src/lib/membership/` has a roster and KPI layer but it is membership's lane and
is read through its repository interface, not reached into
(`docs/MODULE-BRIEF.md`).

## Missing or undecided

- **The minimum segment size.** A chair who cannot see the roster but can see
  that a segment matches exactly one person has an oracle: they can confirm a
  specific member exists by narrowing until the count hits one. This is the same
  class of leak the membership form is designed against. My proposal is a floor
  of 10, below which the count is bucketed and the send is refused with "use a
  direct message instead". **Decider: the board**, because it is a usability
  cost against an OPSEC gain and it is not mine to choose alone.
- Whether `membership_category` and `is_war_veteran` may be segmentation fields
  at all. They are the 501(c)(19) composition inputs. A send addressed to "the
  non-qualifying class" is a message to the people whose membership category is
  a tax exposure, and it will be read that way. **Decider: the President and the
  Treasurer.**
- Whether event registrants and donors are segmentable from here. Both are
  explicitly separate scopes (`src/lib/authz/model.ts`, Events Chair note).

## Edge cases that will actually happen

- **The segment drifts between preview and send.** Two members lapse in the
  eleven minutes between the chair previewing 614 and pressing send. Resolve the
  audience exactly once, at send, and show the chair the resolved number on the
  confirmation; never claim the preview number was what went out.
- **A segment that is really one person.** Refused by the floor, above.
- **"Everyone except" segments.** The chair wants all members except those who
  already registered for the ball. Exclusion needs registrant data the chair
  cannot see, and the exclusion count itself leaks. Resolve server-side, show
  only the final count.
- **A send that half-completes across two segments** run back to back: the second
  campaign must not inherit the first campaign's partial state. Campaign id on
  every row, and the drain never groups across campaigns.
- **A member moves out of the segment mid-send.** They still get the message;
  the audience was resolved once. That is correct and should be stated, not
  discovered.

---

# E42 Editable body copy on every send

## What it must do

Every template has an editable region and locked regions. The chair writes
whatever they want in the editable region. The chair cannot, by any route in the
UI, remove the locked regions: the entity identity and postal address, the
unsubscribe footer on a bulk message, and the North Carolina Chapter 131F
disclosure wherever it is required.

## Acceptance criteria

1. Rendering a template stores the exact rendered body that was sent, per
   message. "What did we tell the members" is an audit question with a
   byte-exact answer.
2. A template whose stream is BULK renders with a one-click unsubscribe link and
   a `List-Unsubscribe` header. A template whose stream is TRANSACTIONAL renders
   with neither. Attempting the opposite fails a test, not a review.
3. A template that solicits a contribution renders the 131F disclosure through
   `src/lib/donations/disclosure.ts` and passes
   `assertDisclosureConspicuous` on the rendered output. The string is imported,
   never retyped — `docs/ARCHITECTURE.md` is explicit, and the board review found
   two different wordings already live in the codebase.
4. Every merge field used in the body is resolvable for **every** recipient in
   the resolved audience before a single message is queued. One unresolvable
   field blocks the whole send and names the field and the count affected —
   never the member.
5. A test send to the chair's own address is required before a BULK send above
   the minimum segment size, and the test render uses the same code path as the
   real one.
6. Plain-text alternative is generated for every HTML message and is not empty.
7. No remote images, no tracking pixel, no click rewriting. See E45.

## What already exists

Nothing for templates. Three things exist that templates must consume rather
than restate:

- `src/lib/donations/disclosure.ts` — the canonical 131F text, the type spec and
  the conspicuousness checker.
- `src/lib/donations/receipts.ts` — `buildReceipt`, which already refuses to
  produce a receipt for a gift with benefits and no recorded fair market value.
  The mail layer must not have a path around that refusal.
- `src/lib/scholarships/types.ts:588` — `AwardNotification` keeps
  `mergedAmountCents` beside the body specifically so the merged figure can be
  checked against the record. That pattern generalizes: a merged figure is
  stored next to the message, not only inside it.

## Missing or undecided

- Whether the chair writes Markdown, a constrained rich-text, or raw HTML. My
  position is Markdown with a small allow-list, because sanitizing chair-authored
  HTML is a job nobody has been contracted to do well and the inbox schema
  already took the same position on sender-supplied HTML
  (`migrations/0002_inbox.sql`). **Decider: me, unless the board wants otherwise.**
- Which templates are "solicitations" for 131F purposes. The statute attaches at
  the point of solicitation, and the board review's finding 2 is that we
  currently claim otherwise. **Decider: counsel.** `docs/MODULE-BRIEF.md` is
  clear that anything stating a legal obligation is never delegated.
- Who approves template copy before first use. A template is reusable copy going
  to the whole membership; it is not the same as one send. My position: a second
  officer signs off on a template's first use, not on every send.

## Edge cases that will actually happen

- **"Dear {{first_name}}," with an empty first name.** Blocked by criterion 4.
  The alternative — a default of "Member" — is worse, because it hides a roster
  data problem behind a polite word.
- **An apostrophe, an accent, or a unit designation that breaks encoding.** Test
  with a name containing a non-ASCII character. This community has plenty.
- **The chair pastes from Word** and brings smart quotes and a font tag. The
  Markdown-plus-allow-list position handles this; raw HTML does not.
- **A chair edits the body after the send has started.** Refused. Once a campaign
  leaves `DRAFT` the body is frozen, because half the recipients already have the
  old one and a send that says two different things is unanswerable afterwards.
- **A correction send.** It is a new campaign with a link to the one it corrects,
  not an edit. The history shows both.

---

# E43 Unsubscribe handling and a suppression list

## What it must do

Anyone who receives a bulk message can stop receiving them in one click, without
signing in, and we never mail them again on that stream. We keep a suppression
list that no send can bypass, and it is the record of truth — not the
provider's copy of it.

## Acceptance criteria

1. An unsubscribe link works without authentication, in one click, and is
   honoured on the next send. `List-Unsubscribe` and `List-Unsubscribe-Post` are
   present on every BULK message so a mail client's own unsubscribe button works.
2. The unsubscribe URL carries an **opaque HMAC token**, not an address and not
   a sequential id. A token is single-purpose and scoped to one address.
3. The unsubscribe landing page does not display the address, and returns the
   same page whether or not the token resolves. An unsubscribe endpoint that
   confirms an address is on the list is a membership oracle, and in this
   organization membership is itself the sensitive fact.
4. A suppressed address on BULK still receives TRANSACTIONAL mail. There is a
   test named for this and it is the first one I would run.
5. A hard bounce suppresses both streams. A spam complaint suppresses BULK and
   raises a flag. Soft bounces suppress nothing until N consecutive failures;
   N is configuration.
6. Suppression is append-only in the style of `message_route`: a resubscribe is a
   new row superseding the old, never an update or a delete. "We never mailed
   them after they asked us to stop" has to be provable.
7. No send path can read the audience without going through the suppression
   check. The audience resolver returns rows already marked, and the drain
   re-checks immediately before handing a message to the provider, because a
   person may have unsubscribed while a long campaign was draining.

## What already exists

Nothing. No table, no endpoint, no token. `migrations/0002_inbox.sql` provides
the append-only pattern to copy and `src/lib/auth/tokens.ts` provides the hashed
single-use token pattern.

## Missing or undecided

- **The legacy Mailchimp list.** `src/lib/treasury/seed.ts:881` records it as
  "to be folded into Resend". Importing its subscribers without first importing
  its **unsubscribed, cleaned and bounced** segments would mail people who opted
  out years ago, from a brand-new domain with no reputation, and it is the single
  most likely way for this project to get the organization blocked at Gmail. The
  order is: export the suppressions, seed the suppression table from them, verify
  the counts, and only then import a single subscriber. **Owner: me. Blocker:
  the Mailchimp login, which is a fourth login nobody has confirmed we hold.**
- Consent provenance for the legacy list: when and how those people opted in is
  not recorded anywhere we can see. **Decider: counsel**, if the answer is
  "unknown" — the options are to re-permission the list or to drop it.
- Address normalization. My default: lowercase, trim, and nothing else. Do not
  strip dots or plus-tags, because the equivalence is provider-specific and
  over-normalizing suppresses an address the person never suppressed. If a
  complaint arrives for a plus-tagged variant, suppress the exact address and
  flag the base for a human.
- Whether one unsubscribe covers both entities. My position is yes for version
  one — a member who says stop does not mean "stop, but the Foundation may
  continue". **Decider: the board.**

## Edge cases that will actually happen

- **A member unsubscribes, then their dependent applies for a scholarship.**
  Criterion 4. The member is a named recipient with a reason on every message to
  the applicant and they must receive all of it. If this breaks, the Scholarships
  Chair goes back to chasing sponsors by hand, which is the thing E46 exists to
  stop.
- **A member unsubscribes and then complains they are not hearing from us.**
  A member-facing page shows their own subscription state and lets them resubscribe.
  Needs the member portal, which does not exist (E47).
- **A shared household address.** One unsubscribe stops the newsletter for two
  members. Accept it, say it plainly on the landing page ("this address will no
  longer receive..."), and never render it as "you".
- **A bounced address on the roster.** The address is suppressed on both streams
  and the member record is flagged for VP Membership. Critically, suppressing
  does not fix the dues receipt problem: that member now cannot be reached at
  all, and somebody has to telephone them. The platform's job is to make that
  visible, not to pretend the mail went out.
- **A spam complaint from a member who forgot they joined.** Suppress BULK,
  raise the flag, do not suppress the dues receipt, and do not argue with them.
- **Somebody forwards a newsletter and the recipient clicks unsubscribe.** The
  token belongs to the original address, so the original member is unsubscribed
  without having asked. There is no clean fix in one click; mitigate by having
  the landing page state what will stop and offer an immediate undo.

## Where the line is thinner than the job

The contracted line buys an unsubscribe link and a list. The job is sender
reputation: classifying bounces, acting on complaints, keeping a complaint rate
under a provider's threshold, pruning addresses that have not engaged, and
reading DMARC reports. At eight hundred addresses we sit below the 5,000-a-day
threshold that triggers the strictest bulk-sender rules at the large providers,
but the baseline requirements — authentication, a working unsubscribe, a low
complaint rate — apply at any volume, and today `thejsoa.org` fails the
authentication baseline outright.

---

# E44 Sending domain authentication on thejsoa.org

## What it must do

Mail we send is provably ours, and mail somebody else sends claiming to be us is
rejected by the receiver. Checkable by a board member: a message from us lands in
the inbox and its headers show SPF, DKIM and DMARC all passing; a forged message
does not arrive.

## Acceptance criteria

On `thejsof.org`, runnable this week:

1. `dig TXT notices.thejsof.org` and `dig TXT news.thejsof.org` each return an
   SPF record authorizing the provider, and the two subdomains have **different
   DKIM selectors and different keys.**
2. A message sent through each identity passes SPF, DKIM and DMARC alignment at
   an external receiver. Evidence is the received headers, saved.
3. `_dmarc.thejsof.org` exists, starts at `p=none` with a working `rua`
   destination, and the first aggregate report has been received and read.
4. A dated plan exists for `p=quarantine` then `p=reject`, and the dates are on
   the compliance calendar rather than in somebody's memory.
5. Nothing sends from the `thejsof.org` apex.

On `thejsoa.org`, when the Wix DNS login is in hand:

6. Google Workspace DKIM is enabled and `google._domainkey.thejsoa.org`
   resolves. Today it does not, which means every human-written message from
   this organization is already unauthenticated.
7. SPF is tightened from `~all` once DMARC reports show nothing legitimate is
   being missed. Not before.
8. `_dmarc.thejsoa.org` exists at `p=none`, then tightens on the same schedule.
9. The sending subdomains are verified and the same evidence in criterion 2 is
   captured.
10. Immediately before the nameserver cutover, every record above is re-checked,
    and immediately after, mail delivery is confirmed before anything else is
    (`docs/DNS-AND-EMAIL.md`, cutover step 6).

## What already exists

On `thejsof.org`: a Cloudflare zone we fully control, created into an empty zone
on 22 October 2026, with the Worker on custom domains (`wrangler.jsonc`). No
mail records at all, because nothing sends.

On `thejsoa.org`: measured on 2026-10-19 and recorded in `docs/DNS-AND-EMAIL.md`.
MX at Google, SPF `~all`, **no DKIM on the default selector, no DMARC**, DNSSEC
claimed by WHOIS and not actually present. Zone at Wix. Registration at Network
Solutions, expiring 2028-06-01.

## Missing or undecided

- **The three logins.** `docs/DNS-AND-EMAIL.md` records that account recovery
  runs through the Network Solutions login and that who holds it is an open
  question, alongside the Wix and Google Workspace accounts. This is the whole
  blocker and it is not a technical one. **Decider: the board**, and it should be
  a named person with a named alternate, recorded.
- Subdomain names. `notices.` and `news.` are my proposal, not a decision.
- Whether a BIMI record is worth it. Not now: it requires a registered trademark
  and a VMC, and we have `p=reject` to reach first.
- Whether to add MTA-STS and TLS-RPT on `thejsof.org`. Cheap, and worth doing
  once DMARC is at `reject`.

## Edge cases that will actually happen

- **The nameserver move drops a record.** The MX records stop mail outright and
  somebody notices in minutes. The SPF record failing is the dangerous one,
  because it is silent and looks like nothing happened — `docs/DNS-AND-EMAIL.md`
  says exactly this, and it applies with more force once we also have DKIM and
  DMARC records that a move could drop.
- **DMARC tightened to `reject` with a forgotten sender.** Somewhere there is a
  service sending as us that nobody remembers — an events tool, the legacy
  Mailchimp list, a volunteer's mail-merge. The `p=none` reporting period exists
  precisely to find it, and tightening before a full cycle of reports have been
  read is how an organization silently stops delivering its own invoices.
- **A member reports a phishing message from "us".** Today we cannot tell them it
  was forged, because our own mail is also unauthenticated. After this, we can,
  and the DMARC reports show the volume.
- **Wix's DNS editor refuses a required record type.** Some hosted DNS panels
  will not accept an MX on a subdomain, which some providers want for the
  return-path. Check before promising a date; do not assume.
- **A send that half-completes because the domain was unverified mid-campaign.**
  Verification can lapse if a record is edited. The drain must treat an
  authentication failure as a hard stop on the campaign, not a per-message retry,
  because retrying eight hundred unauthenticated messages is worse than stopping.

---

# E45 Send history with delivery counts

## What it must do

For any send, now or two years from now, anyone with the right role can answer:
what was sent, to which audience, by whom, when, how many were accepted by the
provider, how many were delivered, how many bounced, how many complained, how
many were suppressed and never attempted, and how many are still in flight. The
numbers must add up to the audience size.

## Acceptance criteria

1. Every message has exactly one terminal state and the states partition:
   `DELIVERED + BOUNCED + COMPLAINED + SUPPRESSED + DEAD + UNDELIVERABLE +
   (QUEUED + SENDING) = audience size`, always, with no gap.
2. A delivery webhook endpoint verifies the provider's signature and rejects an
   unsigned or stale payload. It is the only writer of delivery status.
3. The webhook is idempotent and order-independent. Webhooks arrive twice and
   out of sequence; a `delivered` arriving after a `bounced` for the same message
   must not resurrect it.
4. A campaign that half-completes shows the true split while it is draining, not
   a figure that implies it finished.
5. The history row keeps the segment definition and the resolved count from E41,
   the template version and the exact body from E42, the stream, the entity, the
   sender, and the authorizing basis.
6. Role-scoped: the chair sees counts. Named per-recipient outcomes for members
   are MEMBER_PII and the chair does not hold it. Wrong-role test required.
7. A message that is DEAD appears on a dead-letter screen with the reason and the
   reference, and transactional DEAD messages concerning money, an award, or an
   approval notify the owning office.
8. No open pixel and no click rewriting by default.

## What already exists

Nothing. `readOutbox()` in both stub files returns the last 50 in-memory
messages and is the closest thing to history we have.
`src/lib/membership/notify.ts` does get one thing right that the real version
must keep: the recipient is redacted in the outbox view, because the record is
the point and the address is not.

## Missing or undecided

- **Open and click tracking is off, and I am asserting that rather than asking.**
  `docs/PRIVACY-AND-PAYMENTS.md` forbids third-party tags without consent and
  frames tracking as the live litigation risk. An open pixel is a silent
  retrieval from a remote server that tells us when a Gold Star family read a
  message. The counts the board actually needs — accepted, delivered, bounced,
  complained, unsubscribed — require no tracking at all. If anyone wants open
  rates, it is a decision with a privacy-policy consequence and it goes to the
  board with counsel, not to me.
- Retention. Delivery facts versus bodies versus addresses are three different
  retention questions. **Decider: the Secretary**, on the schedule
  `docs/PRIVACY-AND-PAYMENTS.md` requires.
- Whether non-member recipient addresses are stored in plain or as a reference.
  My position: reference the person or member row where one exists, and store the
  address only where there is no row to point at.

## Edge cases that will actually happen

- **A bounce arrives three days later.** Soft bounces and some hard bounces are
  asynchronous. A campaign is never "final" on the day it is sent, and the screen
  must say so rather than freezing a number that will change.
- **A webhook that never arrives.** The provider had an outage. Messages sit in
  `SENDING` past their lease. Reconcile on a schedule against the provider's own
  record rather than assuming delivery.
- **A send that half-completes and is abandoned.** Someone decides mid-campaign
  that the copy was wrong. There must be a stop control that stops the drain for
  that campaign and leaves the already-sent rows exactly as they are, with the
  history showing "stopped after 412 of 800". Not a delete.
- **The board asks "did the renewal notice go to Mr. ---?"** The chair cannot
  answer, by design, and must not be given a workaround. The answer comes from
  VP Membership, who holds MEMBER_PII, looking at the same rows under their own
  role. Build the screen twice rather than widening one grant.

## Where the line is thinner than the job

A count is not a delivery record. "Sent 800" is the number that reassures a board
and tells them nothing. The job is a per-recipient terminal state, a reconciliation
against the provider, and a dead-letter queue that a named person looks at on a
named day. The only number that matters in a bad week is the number of messages
nobody will ever receive and nobody knows about.

---

# E46 Transactional email: confirmations, approvals, receipts

## What it must do

Every point in the platform where a person is told something about their own
business with us actually reaches them. This is the function the rest of the
build is waiting on, and it is the one I would ship first.

The messages already named in code, waiting for a sender:

| Kind | Source | Who is waiting |
| --- | --- | --- |
| Sign-in link | `src/lib/auth/actions.ts:48`, `TODO(E46)` | Everybody. Authentication does not work |
| `VOUCH_REQUEST` | `src/lib/membership/intake.ts:308` | The sponsor, within 72 hours |
| `PAYMENT_LINK` | `src/lib/membership/vouch.ts:129` | The applicant |
| `DECISION_NOTICE` | `src/lib/membership/payment.ts:165`, `board.ts:187` | The applicant |
| `CHAIR_NOTICE` | `src/lib/membership/intake.ts:241`, `board.ts:316` | VP Membership, the President |
| `AWARD_NOTIFICATION` | `src/lib/scholarships/awards.ts:501` | The student and their sponsor |
| `NOT_AWARDED_NOTICE` | `src/lib/scholarships/notify.ts` | The student |
| `GUARDIAN_CONSENT_REQUEST` | `src/lib/scholarships/notify.ts` | A guardian, under 18 |
| `CHAIR_NOTICE` (scholarships) | `src/lib/scholarships/notify.ts` | The Scholarships Chair |
| `BOARD_REVIEW_NOTICE` | `src/lib/scholarships/notify.ts` | The board |
| Agenda distribution | `src/lib/meetings/distribution.ts:354` | The board, before a meeting |
| Donation receipt | `src/lib/donations/receipts.ts` — rendered, never sent | Every donor |
| Store order confirmation | nothing exists | Every buyer |

Eleven named kinds across four modules, plus two documents that are produced
correctly and delivered to nobody.

## Acceptance criteria

1. One `enqueue` writes to one table, and both existing stubs are replaced by it
   without losing either of their design properties:
   - **Constant work on every path** (`src/lib/membership/notify.ts`). The
     enumeration test must still pass: a submission naming a real sponsor and one
     naming a fabricated sponsor are indistinguishable in response time, and the
     undeliverable case is a written row, not a skipped call.
   - **A list of named recipients with roles and reasons, and no bcc field on the
     type** (`src/lib/scholarships/notify.ts`, `src/lib/scholarships/types.ts:580`).
     The sponsor is a recipient, visibly, for a stated reason.
2. No transactional message carries an unsubscribe link, and none is blocked by a
   BULK suppression. A dues receipt reaches a member who unsubscribed in January.
3. A receipt is only produced through `buildReceipt`, so a gift with benefits and
   no recorded fair market value still cannot produce one. The mail path adds no
   way around that refusal.
4. JSOA and JSOF receipts render from separate templates sharing no paragraph,
   and a test asserts the JSOA dues-not-deductible disclaimer never appears on a
   JSOF contribution receipt or vice versa.
5. A sign-in link is single-use, expires in fifteen minutes, and is delivered by
   the queue rather than written to the audit log. The audit fallback at
   `src/lib/auth/actions.ts:48` is removed in the same change that lands the send,
   not left beside it.
6. The amount merged into an award notification matches the amount on the record,
   asserted by comparing the message's stored `mergedAmountCents` against the
   award. The chair currently retypes 183 figures by hand each cycle; a merged
   figure that silently disagrees with the record is worse than retyping.
7. Wrong-role test on every board-facing send control.

## What already exists

Two in-memory stubs and eleven call sites that already produce the right message
shapes. This is the most-prepared function of the eight: the hard thinking about
what each message contains and who is on it has been done by other offices
already. What is missing is the table, the drain, and the provider call.

## Missing or undecided

- **Zero recipients: throw or record?** The two stubs answer differently and both
  are right in their own context. `scholarships` throws `NoRecipientsError`
  because an award with nobody to tell is a programming error and should be loud.
  `membership` deliberately queues an undeliverable message because the
  zero-recipient case there comes from attacker-controlled input and a throw is a
  timing signal. **Proposed resolution:** `enqueue` never throws — it writes
  `UNDELIVERABLE` with a reason and that row raises a dead-letter notice within
  the minute, which is loud without being observable from outside. Scholarship
  call sites keep their own assertion *before* the mail path, where no attacker
  controls the input. **Decider: me with the Scholarships Chair and VP
  Membership**, because it changes a property each of them designed for.
- Which From domain carries the sign-in link. Section 3.
- Whether a store order confirmation is mine or the Store Chair's. The template
  is theirs; the sending is mine. Agree the seam before either of us builds.
- The agenda distribution carries attachments (`ResendPayload`). Attachments are
  a decision I flagged against under E40. Board papers may be the exception.
  **Decider: the Secretary and me.**

## Edge cases that will actually happen

- **A member unsubscribes and then applies for a scholarship.** Their award
  letter must arrive. Criterion 2, and the test for it is named in E43.
- **A bounced address on an award notification.** A student does not get their
  award letter and the sponsor does. That is precisely the case the
  copy-the-sponsor design exists for, and it is also the case where the chair
  must be told, because the award has a deadline and a disbursement behind it.
  A DEAD or BOUNCED `AWARD_NOTIFICATION` is an alert, not a log line.
- **A send that half-completes mid-cycle.** 183 award notifications drain and
  the Worker dies at 90. Per-recipient rows, idempotency keys, resume. The
  failure to avoid is the chair re-running the notification step and ninety
  families receiving two different award letters.
- **A guardian consent request to a guardian who is also a member who
  unsubscribed.** Transactional. It sends.
- **An applicant and their guardian share an address.** Deduplicate within the
  message, but keep both roles and both reasons visible in the body, because the
  reason each person is on the message is part of what the message says.
- **A receipt that cannot be produced** because the fair market value is missing
  — the paver, today (`docs/BOARD-REVIEW.md` finding 4). The queue must surface
  "a donor paid and has no receipt" as an exception somebody acts on, not drop it.
- **The same server action runs twice** because a volunteer double-clicked.
  Idempotency key, and no second receipt.

---

# E47 Announcement posting to the member portal

## What it must do

A member signs in and sees announcements from the board, most recent first. The
Communications Chair drafts one. **The Communications Chair does not publish it.**
`src/lib/authz/model.ts:223` gives this role `PUBLIC_CONTENT: "WRITE"` with the
note "Drafts only; never self-publishes", and the `PUBLISH` capability is held by
the Webmaster and the President. That is the control, it is not negotiable from
inside this module, and the feature is not correct unless it enforces it.

## Acceptance criteria

1. A chair-role session can create and edit a draft announcement and cannot
   transition it to published. The attempt returns 403 and writes an audit row.
2. A `PUBLISH` holder can publish a draft they did not write.
3. An announcement flagged as carrying a person's name, unit, or face cannot
   reach `APPROVED` unless the approver differs from the author and holds
   `APPROVE_RELEASE` — invariant 3 in `src/lib/authz/policy.ts`, asserted in
   `tests/invariants.test.ts`. The announcement path must route through the same
   gate, not a parallel one.
4. Anything touching the fallen or Gold Star families additionally requires the
   Memorial Chair as approver (`src/lib/authz/model.ts:205`).
5. An announcement is visible only to signed-in members at the tier it is scoped
   to. A member-tier announcement is not reachable from the public tier, and a
   test proves it, because no member's name, unit, rank or face may appear on a
   public page (`docs/MODULE-BRIEF.md`).
6. Publishing an announcement does **not** email it. If the board wants it
   emailed, that is a separate BULK send under E40 or E41, with its own
   suppression check, its own unsubscribe footer and its own history row.
7. Every publication and every withdrawal is audited with the actor.

## What already exists

Nothing, and also no portal. There is no `src/app/members/` and no announcement
table. `docs/MODULE-BRIEF.md` lists "the member self-service portal" as a
separate Phase 3 lane alongside Communications. `src/app/store/members/` is the
only member-gated surface and it is the store's.

What exists is the governing machinery: the release gate in
`src/lib/authz/policy.ts`, the capability matrix, and the audit log. E47 consumes
all three and adds none of its own.

## Missing or undecided

- **The portal.** E47 is a posting function into a surface nobody in my lane is
  contracted to build. **Decider: whoever scopes Phase 3.** Until it exists, the
  deliverable from this office is the announcement record, the draft and release
  workflow, and a rendering contract the portal consumes. I can build all three
  and demonstrate none of them to a member.
- Whether announcements are entity-scoped. They should be — every row that can
  belong to an entity carries one — but whether a member sees both entities'
  announcements in one list is a board question tied to R3.
- Retention and withdrawal. An announcement that becomes wrong is superseded, not
  deleted, consistent with the convention in every migration so far. Who may
  withdraw one is undecided. **Decider: the President.**

## Edge cases that will actually happen

- **An announcement naming this cycle's scholarship recipients.**
  `src/lib/scholarships/workspace.ts:777` names this as the thing that will land
  in the release queue, "because that carries identity and so cannot be published
  by whoever wrote it." It is worse than that. Recipients are frequently minors,
  and `docs/PRIVACY-AND-PAYMENTS.md` forbids publishing a minor's name, school,
  photo or likeness without separate written guardian consent. So the gate is two
  gates: the release approver, and a per-name consent record that does not exist
  as a field anywhere today. **This should be refused outright until the consent
  field exists.** Flagging it to the Scholarships Chair and the Secretary.
- **A member-tier announcement that quotes a public page.** Fine. The reverse —
  a public page quoting a member-tier announcement — is a leak, and the copy
  direction needs to be one-way by construction.
- **An announcement posted and emailed, where the email went out and the posting
  failed** (or the reverse). They are two actions with two records and neither
  implies the other. Do not couple them into one button that can half-succeed;
  the publish happens first and the send references the published announcement.
- **A withdrawal after an email went out.** The email cannot be recalled. The
  announcement page must say it was withdrawn and when, because members who have
  the email in their inbox will go looking.
- **The chair drafts, nobody approves, the moment passes.** A draft sitting in a
  release queue nobody opens is the same silent failure as a mailbox nobody
  reads. Drafts awaiting approval past a threshold raise a notice.

## Where the line is thinner than the job

The contracted line reads like a CMS feature. What it actually is: the only
channel this organization has for telling its members something that is not an
email, built on a portal that is not in anyone's scope, gated by a release
control that already exists and that this office is deliberately on the wrong
side of.

---

# What I need from other people, in order

1. **Who holds the Google Workspace admin login.** Unblocks `support@` and
   `connect@` with no DNS change at all, and therefore unblocks every reply-time
   commitment the site publishes. This is the cheapest item on the list and it is
   blocking the most visible promise. Board.
2. **Who holds the Wix DNS login.** Unblocks all of E44 on `thejsoa.org`:
   DKIM, DMARC, and a sending subdomain. Not the registrar. Board.
3. **A decision on the newsletter-list scope in the authz matrix.** E40 and E41
   cannot be finished without it, and `src/lib/authz/**` is never delegated.
   Whoever owns that matrix, by review.
4. **The From domain for the sign-in link.** One sentence, and authentication
   works. President and Secretary.
5. **The minimum segment size.** Board.
6. **The zero-recipient resolution.** Scholarships Chair and VP Membership.
7. **The Mailchimp login, and the consent provenance of the legacy list.**
   Board, then counsel if the answer is "nobody knows".
8. **The retention schedule for send history.** Secretary.
9. **Who holds the registrar login.** Last on this list on purpose. It is the
   item everybody names first and it blocks only the nameserver move.

# What is in none of the eight lines, and will be needed anyway

- Reading DMARC aggregate reports on a schedule, and the tightening dates.
- A dead-letter screen and the named person who opens it.
- The inbound ingestion route that `migrations/0002_inbox.sql` is waiting for.
- Importing the Mailchimp suppressions before the Mailchimp subscribers.
- A quarterly re-check of every mail DNS record, and a re-check pinned to the
  Wix cutover.
- An incident procedure for the day a send goes out wrong, which at eight hundred
  recipients is not a hypothetical. It needs to say who can stop a draining
  campaign, who writes the correction, and how fast.
