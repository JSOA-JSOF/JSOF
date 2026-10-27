# Requirements: President and Vice President, Operations

Written jointly by the two offices, 27 October 2026, for the eleven functions
those offices own under the signed statement of work: E01, E02, E03, E04, E05,
E73, E74, E75, E76, E77 and E78.

These two offices are in one document because the questions they answer are one
question. Governance asks who is accountable. Handover asks what happens when
the people change. On an all-volunteer board with a two-year rotation those are
the same conversation, and a platform that answers one and not the other has
answered neither.

Assume this document will be read by somebody who is not on our side: a state
examiner, a donor's counsel, a reporter who has already found the Form 990. It
is written to be correct in front of that reader rather than comfortable in
front of us.

---

## How to read a status word here

Three words, and we use them strictly.

**Operating** — a volunteer can do it today, on the deployed system, without a
developer in the room.

**Designed** — the code, the schema or the written rule exists and is correct,
and no volunteer can reach it. A screen behind a stage gate is designed. A
function with no caller is designed. A document describing a screen is not even
that; it is a design for a design.

**Absent** — it does not exist.

Several contracted lines in this set were reported against the existence of
design. We have changed those back. Where a line was marked delivered and is
not, it is said flatly and in the section it belongs to, and collected again at
the end of this document so nobody has to hunt for them.

**Measurements in this document.** Counted on 27 October 2026 against the repo
at `26b791f`: 17 roles in `src/lib/authz/model.ts`; 6 data classes; 4 access
levels; 6 capabilities; 60 `page.tsx` routes under `src/app/board`, of which 59
sit beneath six workspace roots and one is the board index; 13 subscription
rows in `src/lib/treasury/seed.ts`, all of them fictional; 0 continuous
integration configurations; 0 callers of `grantRole`.

---

## The governance problem, which is larger than any screen

This belongs at the front because it is not one of the eleven functions and it
constrains all of them.

**Two legal entities share one board.** JSOA is a 501(c)(19) membership
organization. JSOF is a 501(c)(3) public charity. They file separately, hold
separate ledgers, issue separate receipts, and are governed by substantially
the same people wearing different hats in the same room.

That arrangement is lawful and it is common. It is also the arrangement that
draws the question, and the question has a specific shape: *when the same
people control the charity and the membership organization, how does anyone
outside the room know the charity's money served charitable beneficiaries
rather than the membership?*

`docs/BOARD-REVIEW.md` finding 2 records where we currently stand on answering
it. The live site volunteers the shared board — it says the two organizations
work together — and publishes **no EIN for either entity, no state or year of
incorporation, no Form 990, no financial statement, no North Carolina
solicitation licence number, no telephone number, no officer list and no
conflict-of-interest policy**. We disclose the fact that invites the question
and none of the material that answers it. That is the worst available
ordering. A board that said nothing at all would at least not be pointing at
the thing it cannot evidence.

Two findings in the same review show the question is not hypothetical. A
Foundation fund is defined to pay the direct costs of an event the Foundation
has published a policy against funding (`src/lib/donations/seed.ts:42`,
against `/jsof/mission`). And a Gold Star family reading `/jsof/memorial` is
told their gift is deductible and routed to a donate page where the only open
memorial fund belongs to the 501(c)(19) and is marked not deductible
(`src/lib/donations/seed.ts:80`). Both are the shared board failing to hold the
entity line in a place a donor can see.

### What the platform must carry to make a shared board defensible

Disclosure is the floor, not the answer. The answer is a record that lets an
outsider test each decision after the fact. Six things, and they are
requirements on this platform rather than on a page of copy:

1. **One register of entity ownership, rendered everywhere.** Programme,
   owning entity, funding entity, administering office — one file, every page
   generated from it. `BOARD-REVIEW.md` R3. Until it exists, every entity fact
   on the site is restated in two places and will drift. This is the structural
   fix; correcting copy only moves the contradiction.

2. **A person-to-office register, per entity, with dates.** Who holds which
   office, on which entity, from when to when. The schema already supports this
   properly: `role_grant` in `migrations/0001_identity_and_audit.sql` is keyed
   on person, role **and** entity, with `granted_by`, `granted_at`,
   `revoked_by` and `revoked_at`, and nothing is ever deleted. That is exactly
   the shape a shared board needs and it has no screen and no data in it.

3. **Standing conflict declarations, collected and surfaced.** An annual signed
   conflict-of-interest statement per officer, stored against the person,
   surfaced next to their name when they appear as an approver, and overdue
   when it is overdue. No such table exists.

4. **Recusal enforced, not minuted.** Some of this is already real and is the
   best governance asset we have. `assertTransferApprovable` in
   `src/lib/authz/policy.ts` refuses an inter-entity transfer without one
   approval from each entity's actual Treasurer, refuses a President's approval
   on the receiving side, and refuses the whole transfer without a minute
   reference on both sides and a written restriction statement saying what the
   receiving entity may spend it on. A regulator asking how a (c)(3)-to-(c)(19)
   grant was controlled gets a mechanism, not an assurance.

5. **Separation-of-duties findings carried openly.**
   `separationOfDutiesFindings` raises the real arrangements rather than
   pretending a ten-person volunteer board can fully separate duties: Treasurer
   who also chairs the Store, Treasurer of both entities, Webmaster who also
   drafts communications. The design decision to surface rather than block is
   right, and it only works if the findings are reviewed and accepted on the
   record. The acceptance record does not exist.

6. **A `/governance` page generated from 1, 2 and 3**, carrying both EINs,
   state and year of incorporation for each, the 990s, the NC licence number,
   the conflict-of-interest policy, and the shared board stated plainly with
   the control that answers it. `BOARD-REVIEW.md` R13.

On publishing officer names, the Secretary's argument is that Form 990 Part VII
names officers and directors and 990s are public, so withholding the list on
the site withholds what a regulator already has while costing us the
appearance of candour. The OPSEC argument against is that an indexed, scraped,
permanent web page is not a PDF somebody has to go and find. Both are correct
about their own half. **Our position: publish offices on the site, state on
`/governance` that officers are named in each entity's Form 990 and link it.**
That converts what currently reads as evasion into a stated policy. It is the
board's decision and we are recording ours, not making it.

---

## E01 — Discovery session with every board position, findings written into a process map

### What it must do

Sit down with the person who actually holds each office and record how that
office does its work today — the real sequence, the real tools, the real
handoffs, and the places it goes wrong — then write the findings into a process
map that the board can read and correct.

### Acceptance criteria

1. One dated session record per board position, naming the office and
   confirming a person holding that office took part. Positions with no
   incumbent are recorded as vacant with a named person who answered for the
   function.
2. Each record answers, for that office: what triggers the work; what the
   office does step by step; which tool holds each artefact; who hands to whom
   and by what route; what the office is waiting on when it is blocked; how
   many hours a cycle it costs; and what the officer would automate first.
3. Each record names what that office must be able to see and must never see,
   in the officer's own words. This is the input to E04 and the session is not
   complete without it.
4. A process map exists showing each process end to end across offices, with
   the entity boundary drawn on it, and every handoff between two offices
   marked.
5. Every officer has read the map of their own process and either confirmed it
   or corrected it, dated.
6. Each finding in the map traces to a session record. A finding with no source
   session is not a finding.

### What already exists

**Ten structured reviews, which are not discovery sessions.**
`docs/BOARD-REVIEW.md` (23 October 2026) records one reviewer per office —
President, VP Membership, VP Operations, Secretary, Treasurer, and the chairs
for Fundraising, Scholarships, Sales and Memorial, plus the Webmaster — reading
the deployed site as an outsider. It is a good document and it is the wrong
instrument. It asks *is your office represented on this site*, which can only
be answered by someone looking at a build. Discovery asks *how does your office
work*, which can only be answered by someone doing the job. The first produced
35 numbered recommendations about the site. The second produces the process map
and has not been run.

**One real discovery output exists**, and it shows what the rest should look
like. The Scholarships Chair's intake response of 27 September 2026 is quoted
through `docs/ARCHITECTURE.md`: 150 applications, 119 merit awards and 64
Wounded Patriot awards last cycle, roughly 40 hours a month January to June and
240 hours a cycle, the membership check done by opening a spreadsheet, 183
award amounts retyped into emails by hand, students who do not answer email so
the sponsoring member must be copied, and NC-resident routing to Patriot
Foundation handled afterwards by email instead of at the front of the form.
That account reprioritised a whole module out of "deferred" and produced five
concrete requirements. It is the only office we have that for.

**A partial map exists in `docs/ENTITY-SPLIT.md`**, which assigns items to
entities and lists what is unsettled. That is an ownership map, not a process
map: it says whose money pays, not who does what in which order.

### What is missing or undecided

- Sessions have not been held for any office except Scholarships.
- No process map exists in any form.
- Several offices in the role table have never been spoken to in any
  instrument: Events Chair, Family Support Chair, Communications Chair,
  Finance Review Officer. The last two are proposed seats
  (`src/lib/authz/personas.ts`) and whether they are being created at all is a
  board decision that has not been taken. **Family Support is the one that
  worries us**: `FAMILY_SUPPORT_CHAIR` is the exclusive holder of the most
  sensitive data class in the system, `APPLICANT_SENSITIVE`, and no session has
  established how those cases actually arrive, who sees them today, or where
  they are currently written down.
- **Who decides:** the President schedules and the board confirms the roster of
  offices to be covered. The Vice President, Operations owns the map and its
  correction cycle. Whether Communications Chair and Finance Review Officer
  exist as seats is a board vote, and it must be taken before their sessions
  can be scheduled rather than after.

### Edge cases

- **An officer resigns mid-term.** The session belongs to the office, not the
  person. A resignation does not void the record; it dates it. The map entry
  carries who gave the account and when, and the successor's first task under
  E75 is to confirm or correct it. An office whose only session was given by
  someone who has left, and which the successor has not confirmed, is marked
  unconfirmed on the map.
- **A president who is also a treasurer.** Two sessions, not one, and held
  separately. A single session with a person holding two offices produces one
  merged account of how *that person* works, which is precisely the thing the
  map must not record — the map must survive the offices being split between
  two people, which is the likeliest outcome of the next election.
- **Somebody holding the same office in both entities.** One session covering
  both, and the map must draw the entity boundary through the process. The
  Secretary is the live example: one Secretary for both entities is correct and
  the minute books stay separate (`src/lib/authz/model.ts`). The session must
  establish where in the process that separation is actually maintained today
  and where it is only intended.

---

## E02 — Current stack review: every tool in use, which features are actually used, and what this platform replaces

### What it must do

List every tool either entity pays for or depends on, say which of its features
anyone actually uses, and state for each whether this platform replaces it,
partly replaces it, or does not touch it.

### Acceptance criteria

1. Every tool appears, including the ones nobody is billed for. A free tool
   that holds the DNS zone is a dependency.
2. Each line names the vendor, the entity or entities that pay, the annual cost
   normalised from whatever cadence it bills on, and the office that owns it.
3. Each line names the features in use, specifically enough that cancelling is
   a decision rather than a guess. "Google Workspace" is not a feature list.
4. Each line carries one of: replaced by this platform, partly replaced (with
   what remains), or not replaced (with why we keep it).
5. Each line names what must be exported before the tool can be switched off,
   and whether that export has been taken.
6. The register is in the running system, not in a document, and a chair can
   add a line without a developer.

### What already exists

**The register exists as a designed screen with fictional contents, and it
cannot be written to.**

`/board/treasury/subscriptions` renders a real register from
`src/lib/treasury/types.ts`, which is a better-shaped record than most
organizations this size keep: vendor, per-entity split in basis points with a
stated basis, owning role, second administrator, cost and cadence, observed
annual spend for variable lines, renewal date, one-sentence justification,
nonprofit rate applied, last review date and last review decision. Costs
normalise to an annual figure through `subscriptionAnnualCents`, and a shared
tool's invoice is apportioned on a stated basis rather than parked on whichever
entity holds the card. Six finding codes fire automatically, including
`MISSING_SECOND_ADMINISTRATOR` and `STALE_REVIEW`.

Three things are true about it at once and all three matter:

- **The thirteen rows in it are invented.** `src/lib/treasury/seed.ts` is
  deliberately realistic and deliberately false, by the standing rule in
  `docs/MODULE-BRIEF.md`. Wix, Vercel, QuickBooks, Resend, Zoom, 1Password,
  Canva, Mailchimp, two Stripe accounts and Submittable are plausible lines,
  not our lines.
- **There is no way to enter a real one.** The `TreasuryRepository` interface
  (`src/lib/treasury/repository.ts:161-191`) exposes `subscriptionRegister`,
  `saveTransfer` and `saveReimbursement`. There is no `saveSubscription`.
  Against the real database the register renders empty and no code path can
  change that. This is exactly the defect `docs/PHASE2-FINDINGS.md` finding 1
  names for products and funds — "no module can create its own reference data"
  — and the subscription register has it too and was not listed.
- **The register omits the two tools that currently block the most work.**
  There is no Network Solutions line and no Wix DNS line, although
  `docs/DNS-AND-EMAIL.md` establishes that the registrar and the DNS host are
  two different vendors with two different logins and that both are needed to
  leave Wix. There is no Cloudflare line, and Cloudflare now holds the
  production Worker, the D1 database `jsoa-platform`, the R2 bucket
  `jsoa-event-photos` and the `thejsof.org` registration. A register that
  names Canva and omits the registrar and the host is not a stack review.

**The replacement analysis exists only in prose**, scattered across
`docs/CLOUDFLARE-MIGRATION.md` and the justification strings in the seed. The
`Subscription` type has `justification` and `lastReviewDecision` but **no field
for what this platform replaces**, which is the field E02 and E78 are both
contracted on.

### What is missing or undecided

- No real tool list has been collected from the board.
- No feature-level usage review for any tool.
- No `replaces` field on the record, and no `exportTaken` field.
- `saveSubscription`, and the screen to reach it, do not exist.
- The register has no concept of a tool nobody pays for, and both the DNS zone
  and the Google Workspace nonprofit grant are that.
- **Who decides:** the Vice President, Operations owns the review. The schema
  change belongs to the single owner of `migrations/`, by the rule in
  `docs/MODULE-BRIEF.md`. Whether a tool is cancelled is the board's, on the
  Treasurer's recommendation, per entity.

### Edge cases

- **An officer resigns mid-term.** Their tools do not resign. Every line owned
  by `owningRole` must survive the person, which is what `owningRole` being a
  role rather than a person already achieves — but `secondAdministratorPersonId`
  is a person, and a resignation can empty it silently. The review must re-run
  on every departure.
- **A president who is also a treasurer.** The register is readable by anyone
  with aggregate financial scope on either entity and is not restricted to the
  Treasurer, which is correct: the stack review is a governance artefact, not a
  treasury one. Nothing in E02 should route through a single officer's view.
- **Somebody holding the same office in both entities.** A shared tool needs a
  `splitBasis` and the type already requires one whenever the split crosses
  entities. The failure to watch for is a tool billed to one entity and used by
  both with no split recorded at all, which looks tidy and is an undocumented
  inter-entity subsidy. The register cannot currently detect that, because it
  has no view of what the other entity uses.

---

## E03 — Role based account for every board position

### What it must do

Every board position has an account in the system that the person holding that
position signs in to, which carries that position's access and nothing else,
and which can be handed to the next holder without being rebuilt.

### Acceptance criteria

1. Every office in the role table can be granted to a person, per entity,
   through a screen, by somebody authorised to do it.
2. Signing in requires the mailbox and a second factor. No board screen renders
   to a session that has not satisfied the second factor.
3. A grant and a revocation are both recorded with who did it and when, and
   neither is destructive: the history of who held an office remains readable.
4. A person may hold several offices and several entities, and the system
   resolves their effective access as the union within each entity, separately.
5. Revoking an office removes the access immediately, on the next request, and
   does not remove that person's name from anything they previously did.
6. A test proves a wrong-role request to each board surface fails.

### What already exists

**The identity layer is real and the account layer is not.**

Operating: `migrations/0001_identity_and_audit.sql` creates `person`,
`credential`, `login_token`, `session` and `role_grant`. `role_grant` is keyed
on person, role and entity with granter, grantee timestamps and revocation
columns, and a partial unique index allows an office to be regranted to the
same person later. Sessions are single-use hashed tokens with a separate MFA
gate. The TOTP implementation is checked against every published vector in RFC
4226 and RFC 6238 in `tests/auth.test.ts`. `policy.ts` returns false for every
data class when `mfaSatisfied` is false, and `tests/dashboard-access.test.ts`
exercises that through a dedicated persona.

Designed, not operating, and this is the finding that matters:

- **`grantRole()` and `invite()` in `src/lib/auth/store.ts` have no callers.**
  Nothing in `src/`, `tests/` or `scripts/` calls either. There is no screen,
  no action and no script that creates a board account or grants an office. The
  only way to put a person into this system is a hand-written SQL statement
  against production.
- **The `ADMIN_ROLES` capability is defined, granted to the President, and
  checked nowhere.** It appears twice in the codebase, both times in
  `model.ts`. No code path consults it. The capability that is supposed to
  gate account administration guards nothing, because the thing it would guard
  does not exist.
- **The sign-in link is never sent.** `requestLink` in
  `src/lib/auth/actions.ts` issues the token and writes it into the audit log
  behind a `TODO(E46)`, with an honest comment saying an administrator with
  database access can read it there. That is a defensible stopgap and it means
  no board member can sign in without somebody reading the D1 console for them.
- **Thirteen board routes still resolve their viewer through the dev persona
  switcher** rather than the real session: `src/app/board/layout.tsx`,
  `src/app/board/page.tsx` and every page in `src/app/board/meetings`. Those
  call `getCurrentPersona()`, which calls `assertDevOnly()`, which throws on
  `NODE_ENV === production`. The board shell itself is one of them, so in
  production the entire board layer fails before any page renders. The guard
  is right and the call sites are the work.

### What is missing or undecided

- The role administration screen: invite a person, grant an office on an
  entity, revoke it, see the history. Nothing of it exists.
- Delivery of the sign-in link (see E73).
- Migrating the thirteen persona call sites to `requireSubject()`.
- An `ADMIN_ROLES` check on whatever that screen becomes.
- **Who decides:** the board decides who holds which office; the President
  holds `ADMIN_ROLES` and executes it. We recommend and the board must confirm
  that **`ADMIN_ROLES` requires two holders**, so that one person cannot grant
  themselves an office unobserved. The role table currently gives it to the
  President alone.

### Edge cases

- **An officer resigns mid-term.** Revocation must be one action that both
  ends the access and preserves the record. `role_grant` supports this exactly
  — `revoked_at` set, row retained — and `revokeAllSessions(personId)` exists
  to end live sessions. Neither has a caller. Until the screen exists, a
  resignation leaves the access in place until somebody writes SQL, and there
  is no alert anywhere that it is still in place.
- **A president who is also a treasurer.** Two grants on one person, and the
  union of their access is computed per entity by `effectiveLevel`. It is
  permitted. `assertNoConflictingWrites` applies invariant 1 to the
  *combination*, not only to each role, so two separately legal offices that
  add up to write on both FINANCIAL and APPLICANT are denied at request time.
  `separationOfDutiesFindings` raises the combination for the board to accept
  knowingly. The gap is that the acceptance has nowhere to live.
- **Somebody holding the same office in both entities.** Two grants, one per
  entity, which the schema and the policy both model correctly. Treasurer of
  both entities is explicitly permitted and explicitly flagged as "high" on
  **both** entities, because the finding is about both and pinning it to
  whichever came first in the array would hide half of it. That person may not
  approve either side of an inter-entity transfer, and `assertTransferApprovable`
  enforces it by resolving roles rather than trusting the tag on the approval —
  an earlier version checked only that approvals were tagged one per entity,
  which let two approvals from the same person satisfy "one treasurer per
  side". That hole is closed.

---

## E04 — Permission matrix defined with your team, signed off, and enforced in the running system

### What it must do

Three things, in order: the board defines what each office may reach; the board
signs off that definition; the running system enforces it and cannot be talked
out of it.

### Acceptance criteria

1. A written matrix exists covering every office, every data class and every
   capability, in language an officer can check without reading code.
2. Every office holder has confirmed, in writing and dated, the four statements
   about their own office in the sign-off session below.
3. The signed matrix and `src/lib/authz/model.ts` agree line for line, and a
   test fails if they diverge.
4. Every disagreement raised in sign-off is recorded with its resolution:
   accepted and the table changed, or declined with a reason.
5. A wrong-role request to every board surface fails in a test.
6. The invariants hold mechanically at module load, not at review time.

### What already exists

**Enforced: yes, and well. Defined with the team: no. Signed off: no.**

We want to be exact about this, because it is the line most likely to be read
as delivered. The enforcement is genuinely good and it is a third of the
contracted item.

Operating:

- `src/lib/authz/model.ts` holds 17 roles against 6 data classes, 4 ordered
  levels and 6 capabilities, as data rather than logic.
- `assertRoleTableValid()` runs at module import and throws rather than warns.
  It refuses a role that writes both FINANCIAL and APPLICANT; refuses a
  read-only role declaring any write; refuses a role holding
  `APPLICANT_SENSITIVE` above `APPLICANT`, because the evidence lives inside
  the application; and refuses a role holding both `ATTEST_COUNT` and
  FINANCIAL WRITE.
- That last one is the separation of duties the brief points at. `ATTEST_COUNT`
  exists as a capability rather than a financial write *because recording a
  count used to require FINANCIAL WRITE, which only the Treasurer holds, so
  when the Treasurer also chairs the Store there was nobody left who could
  perform the count that checks the Treasurer.* The comment in `model.ts` puts
  it better than we can: a control only its subject can execute is not a
  control. VP Operations, the Secretary and the Finance Review Officer hold
  `ATTEST_COUNT`; the Treasurer cannot.
- `FINANCE_REVIEW_OFFICER` carries `readOnly: true`, and the platform refuses
  to grant it write scope anywhere whatever a later edit to the table says.
  Independence is mechanical rather than procedural.
- `tests/dashboard-access.test.ts` asserts every role dashboard refuses a role
  holding nothing, and asserts the harder rule underneath it: a figure the
  reader may not see is **withheld**, never zero.
  `tests/reviewer-boundary.test.ts` enumerates every read in the scholarships
  module and asserts which side of the reviewer line each sits on, so adding a
  read without deciding makes the suite fail.

Not done:

- **Nobody outside the build has seen this matrix.** It was written by the
  people building the system, from the architecture document and from one
  chair's intake response. The board has never been shown it.
- **There is no sign-off artefact of any kind.**
- **`docs/ARCHITECTURE.md` lists five capabilities and the code has six** — it
  omits `ATTEST_COUNT`, the one that encodes the Treasurer separation. The
  binding specification and the enforced table already disagree, in the exact
  place a sign-off would have caught.

### What a sign-off session actually looks like

This is contracted work and it has a shape. We are specifying it here so it
cannot be satisfied by circulating a spreadsheet and counting silence.

**Format.** One session, both entities, two hours, every office holder present
or represented by their named deputy. Not a circulated document. The value is
in the disagreements, and disagreements do not arrive by email.

**What goes in front of each officer.** One page per office, in their language,
never the TypeScript. Six blocks:

1. *What my office can see.* Each data class in plain words, with the level
   spelled out and an example of the difference. "Member records: counts and
   totals only. You can see that 212 members are in good standing. You cannot
   see which 212."
2. *What my office cannot see, and who can.* Named. An officer must leave
   knowing who to ask rather than discovering a wall.
3. *What my office can approve alone.*
4. *What my office cannot approve alone, and who the second person is.*
5. *What is logged when I do my job.* Specifically that row-level reads of
   member and applicant records are logged, not only edits, and that break-glass
   access notifies the President and the Secretary. An officer discovering this
   after the fact is an officer who will not trust the system again.
6. *What this office may still do outside the system*, and which of those we
   are asking them to stop doing.

**The four confirmations we ask for.** Each officer initials each one, dated:

- This is what my office does need.
- This is not more than my office needs.
- Where it says I cannot, I accept that, or I object and the objection is
  recorded below.
- I understand that what I see is recorded.

**Two sessions within the session, which cannot be skipped.**

*The separation-of-duties conversation.* Run
`separationOfDutiesFindings` against the actual proposed grants and read the
findings out. The Treasurer who also chairs the Store is rated critical: one
person sets prices, holds inventory, takes payment, records the receipt and
reconciles the account. The board either splits the office or accepts the
finding **on the record with the stated mitigation** — card only with no cash
custody, quarterly inventory counted by someone else, and the Finance Review
Officer reconciling processor statements received directly from the
institution. An accepted finding with no recorded mitigation is not an
acceptance, it is a shrug, and it will read as one.

*The two-hat conversation.* Every person holding offices across both entities
reads their combined access aloud, per entity. This is where a shared board
either demonstrates that it understands its own structure or does not.

**What a disagreement does to the code.** This is the part that makes sign-off
real rather than ceremonial, and we commit to it:

- A disagreement becomes a numbered change request against
  `src/lib/authz/model.ts`. It is never settled verbally in the room and it is
  never settled by giving somebody a workaround.
- If accepted: the table changes, a test is written that would have failed
  before, and the change ships with the request number in the commit. The
  matrix sheet and the code are re-diffed.
- If declined: the request is recorded with the reason, in the same list, and
  the declining officer is named. An officer who asked for access and did not
  get it is entitled to a written reason and to raise it at the board.
- **If the request would break an invariant, it cannot be accepted as a code
  change at all.** `assertRoleTableValid()` throws at module load, so a table
  granting the Treasurer `ATTEST_COUNT` does not start. The answer to "I need
  to attest my own count" is not a smaller permission, it is a different
  person. The board changes the office, not the matrix. We expect this to come
  up and we expect it to be the most useful ten minutes of the session.
- **Nothing in `src/lib/authz/**` changes without this route.**
  `docs/MODULE-BRIEF.md` already says the authorization layer is never
  delegated and changes by review. Sign-off is the review.

**Output.** A signed matrix, a numbered list of requests with dispositions, a
dated record of accepted separation-of-duties findings with mitigations, and a
test asserting the signed sheet against `model.ts`.

### What is missing or undecided

- Everything above. Not one element of the sign-off exists.
- The per-office sheets have to be written before the session can be held.
- Reconciling `docs/ARCHITECTURE.md`'s capability list with the code.
- **Who decides:** the Vice President, Operations runs the session and owns the
  disposition list. The President signs the matrix for both entities. Each
  officer signs their own page. A declined request is appealable to the board.

### Edge cases

- **An officer resigns mid-term.** The matrix attaches to the office and
  survives. The successor signs the existing page at handover rather than
  reopening the session; their objections become change requests in the same
  numbered list. A page that has gone two successive holders without a
  signature is a finding.
- **A president who is also a treasurer.** They sign both pages, separately,
  and they read their combined access aloud. One signature covering two offices
  is how an authorisation that should never have been granted survives the next
  election: the combination was signed once, by the one person for whom it was
  convenient, and nobody separated it again.
- **Somebody holding the same office in both entities.** They sign once per
  entity. The important check is not the duplicate access, it is the
  cross-entity actions: approving on both sides of a transfer, or carrying a
  fact learned on one entity into a decision on the other. The platform blocks
  the first mechanically and cannot touch the second, which makes the second a
  policy question the session must name rather than assume.

---

## E05 — Administrative portal with a dedicated working screen for each role

### What it must do

One signed-in place where a board member lands and finds their own work, with
a screen built for their office rather than a menu of everybody's.

### Acceptance criteria

1. Every office in the role table has a working screen, or is recorded as
   deliberately having none with the reason stated on screen.
2. A screen shows the holder what needs doing, derived from data rather than
   typed in by hand.
3. Figures a reader may not see are withheld and say so; they are never zero
   and never absent.
4. A wrong-role request to any screen fails, and that failure is tested.
5. The portal is reachable over the internet by an authenticated officer.
6. No screen requires a developer to operate.

### What already exists

**Six workspaces, 59 routes, strong conventions, gated off the internet, and
eleven offices with no screen.**

Operating in development, behind `STAGE=public-beta` in production:

- Six workspaces — membership, treasury, meetings, donations, store,
  scholarships — carrying 59 routes beneath them, plus the board index.
- A common spine from `docs/ROLE-WORKSPACE.md`: Overview, Dashboard, Planning,
  Projects, Outside view, then the role's own function tabs. The rule beneath
  it is the right one — four of the five are **filtered views of shared data,
  never per-role copies**, because six roles each with their own meetings
  archive is six doors into one room, five of which go stale.
- `docs/DASHBOARD-BRIEF.md` governs the figures: one to three that would change
  a decision, provenance on every tile, a figure that cannot be computed yet
  says so rather than showing zero, good takes no colour.
- Tasks derived from state, never typed. The reasoning is explicitly about this
  organization: a task list people must populate is dead within a cycle on an
  all-volunteer board, which is the same failure as the spreadsheet this
  platform replaces.
- `scripts/verify-workspace.sh` turns the spine contract into a check that
  either holds or does not, per workspace, per persona.

Not done:

- **`src/middleware.ts` rewrites `/board` to `/not-yet` at the current stage.**
  Nobody outside a developer's laptop has reached any of these 59 routes. The
  stated reasons are correct — six modules held state in `globalThis`, and the
  dev persona switcher stands in for authentication and must never be reachable
  from the internet. The first is now largely addressed by the D1 ports. The
  second is not.
- **Eleven of seventeen offices have no screen of their own.** With workspaces:
  VP Membership, Treasurer, Secretary, Scholarships Chair, Store Chair, and
  Fundraising Chair by way of donations. Without: **President, VP Operations**,
  Memorial Chair, Webmaster, Communications Chair, Events Chair, Family Support
  Chair, Finance Review Officer, Scholarship Reviewer, Member, Donor. The two
  offices writing this document have no working screen. We are not asking for
  one out of vanity: the President holds `ADMIN_ROLES` and `BREAK_GLASS`, VP
  Operations is the standing release approver and an `ATTEST_COUNT` holder, and
  none of those four functions has anywhere to be performed.
- **No role administration screen** (E03).
- **No inbox screen.** `src/lib/inbox/routing.ts` decides which office an
  inbound message belongs to, with rules first and a model only where rules are
  silent, and nothing calls it from a screen. Meanwhile `BOARD-REVIEW.md`
  finding 3 records that `/jsof/memorial` and `/jsoa/family-support` publish a
  two-business-day reply commitment to bereaved families and families in
  trouble, pointed at a mailbox nobody reads. The routing logic that would fix
  that is written and has no door.
- **Three roles have no persona** and therefore cannot be exercised at all:
  Events Chair, Family Support Chair, Donor.
- The Family Support Chair is the exclusive holder of the most sensitive class
  in the system and has no screen and no persona.

### What is missing or undecided

- Screens for the eleven offices without one, or a recorded decision that an
  office legitimately has none. `ROLE-WORKSPACE.md` already licenses the second
  answer well: some roles have almost no external surface and saying so plainly
  beats an empty screen that implies something is broken. Finance Review Officer
  is the clean example — its independence depends on having no external voice.
  President and VP Operations are not that case.
- Lifting the stage gate, which depends on E03 and E73.
- A shared compliance calendar. `ROLE-WORKSPACE.md` says there is one calendar
  to filter; there is one, and it lives inside the Secretary's module, and five
  other roles derive their dates locally and say so. That is correct behaviour
  under a known gap and it is six sources of truth waiting to drift.
- **Who decides:** which offices get a screen is the Vice President, Operations
  to propose and the board to approve, because it is a spend decision. Lifting
  the stage gate is the President's call on the board's record, and we will not
  make it while the dev switcher can resolve a viewer on any board route.

### Edge cases

- **An officer resigns mid-term.** Their screens must keep working for the
  successor with no rebuild, which the design already achieves by scoping on
  role rather than person. The real exposure is the derived task list: tasks
  derived from state survive a resignation, and anything a predecessor was
  holding in their head does not. This is the argument for E75 and it is the
  same argument.
- **A president who is also a treasurer.** They see both workspaces, scoped to
  the union of their grants per entity, and the shell renders the
  separation-of-duties findings for the combination at the top. That strip is
  already built. What must not happen is a merged screen that quietly presents
  treasury figures under presidential authority: the entity and the office a
  figure is being read under have to stay visible on the screen.
- **Somebody holding the same office in both entities.** Every cross-entity
  figure renders as two labelled columns and is never summed —
  `assertUnblended` exists to enforce that, and `SubscriptionRegister` has no
  all-entities total field at all, deliberately, because adding one would be
  the bug the shape exists to prevent. That discipline must hold on every new
  screen, including the two we are asking for.

---

## E73 — Hosting, database, and email delivery provisioned

### What it must do

The platform runs on infrastructure the organization owns, with a database that
keeps what is written to it and mail that arrives.

### Acceptance criteria

1. The application serves on the organization's own domain over TLS, from an
   account the organization controls.
2. The database is provisioned in the required region, migrations are applied,
   and a write survives a restart.
3. Transactional mail sends from the organization's domain, authenticated, and
   arrives in an ordinary inbox rather than a spam folder.
4. Sign-in mail in particular arrives, because without it nobody can sign in.
5. Every account is held under an organization address with at least two
   administrators and MFA on.
6. Nothing in step 1 to 4 depends on a single person's personal account.

### What already exists

**Hosting: operating, half. Database: provisioned, unproven in production.
Email delivery: absent.**

Hosting. The Worker is deployed on Cloudflare and serves `thejsof.org` and
`www.thejsof.org` as custom domains (`wrangler.jsonc`). That domain was
registered at Cloudflare on 22 October 2026 into an empty zone, so there was no
DNS to migrate and nothing to break. `workers.dev` is deliberately kept alive
because a QR code pointing at it may already be printed.

**`thejsoa.org` has not moved and cannot.** It is registered at Network
Solutions, its nameservers point at Wix, and the old site is still served from
there. The cutover is fully planned in `docs/DNS-AND-EMAIL.md` and
`docs/CLOUDFLARE-MIGRATION.md`, down to the record list, the ordering and the
confirmation that there is no DS record to remove despite WHOIS claiming the
zone is signed. The plan is good and **nobody has the Network Solutions
login**. See E77; this is the live example that section is built on.

Database. D1 `jsoa-platform` is provisioned with a real database id, bound as
`DB`, in region ENAM, which satisfies the US-hosting requirement the
scholarship intake explicitly imposes. Ten migrations exist. All six module
repositories are ported. `docs/PHASE2-FINDINGS.md` section 6 records what was
verified against the live database: foreign keys enforced, multi-statement
rollback working, `INSERT … ON CONFLICT … RETURNING` race-free across ten
concurrent allocations, and every append-only trigger firing — cross-entity
allocation, self-approved reimbursement, edited ledger entry, edited audit row,
transfer that does not cross entities. That is a serious verification record.

Section 7 of the same document is the honest other half, and we repeat it here
rather than let it sit in a findings file: **not one line of any D1 repository
has run inside a Worker.** The ports used SQLite shims or nothing. No board or
storefront screen has been rendered against a database. There is no committed
test covering any D1 implementation, so nothing in `npm test` catches a broken
`repository.d1.ts`.

Email. **Not provisioned, and this is the item that blocks the most.**

- Resend is named in `docs/ARCHITECTURE.md`, is in `package.json`, and is
  called from nowhere. Every send is a stub: `src/lib/membership/notify.ts`,
  `src/lib/scholarships/notify.ts`, `src/lib/meetings/distribution.ts` (which
  builds the exact payload and says plainly that nothing was sent).
- **The sign-in link is written to the audit log instead of being emailed**
  (`src/lib/auth/actions.ts`, `TODO(E46)`). No board member can sign in without
  a developer reading the database for them. This is the single dependency
  that makes E03, E05, E76 and the stage gate all unreachable.
- Mailbox hosting is a separate thing and is the good news: mail is already at
  Google Workspace, not Wix, so moving the website does not move the mailbox
  provided the MX and SPF records are carried across before the nameservers
  change.
- **The domain can be spoofed today.** There is no DMARC record at
  `_dmarc.thejsoa.org`, nothing at `google._domainkey.thejsoa.org` — so DKIM
  was never switched on — and SPF ends in `~all`, a softfail. An organization
  that emails donation receipts, scholarship outcomes and membership notices to
  a community that is a standing phishing target can currently be impersonated
  by anyone with a good chance of delivery. The fix is ordinary: enable DKIM,
  publish the key, DMARC at `p=none`, read the reports, tighten. It needs the
  DNS login, which is the same blocker again.
- `support@` and `connect@` are published on the site and not routed
  (`BOARD-REVIEW.md` R11), alongside published reply times.

### What is missing or undecided

- The Network Solutions login, which blocks the DNS move, the mailbox routing,
  DKIM and DMARC, and the `thejsoa.org` cutover. One missing credential, four
  contracted dependencies.
- Resend wired, including the sign-in link.
- Any D1 repository exercised inside a Worker, and a committed test for one.
- A backup and restore procedure for D1. There is none, and nothing in the
  contracted lines names one, which we are flagging as a gap in the statement
  of work rather than in the build.
- **Who decides:** the board authorises the account recovery attempt at Network
  Solutions and any spend on it. The Vice President, Operations owns the
  cutover sequence. Both entities' Treasurers confirm the billing arrangement
  before any account moves, because an infrastructure account paid by one
  entity and used by both is an undocumented subsidy (see E02).

### Edge cases

- **An officer resigns mid-term.** Every account must be held under an
  organization role address with at least two administrators, and
  `docs/CLOUDFLARE-MIGRATION.md` already says so for the Cloudflare account
  specifically. The registrant privacy proxy on `thejsoa.org` means account
  recovery runs entirely through the Network Solutions login, which is the
  structural version of this edge case and is currently unresolved.
- **A president who is also a treasurer.** Infrastructure accounts are not
  personal, and a person holding two offices must not become the single
  administrator of anything because they are the obvious candidate twice.
- **Somebody holding the same office in both entities.** Shared infrastructure
  serving both entities needs the cost split recorded with a basis, the same
  requirement as E02, and it needs to be clear which entity's board can
  authorise a change to it. A Worker serving both front doors from one
  Cloudflare account is one change away from one entity's officer altering the
  other entity's public site.

---

## E74 — Build and deployment pipeline

### What it must do

Getting a change from a developer's machine to the live site is a repeatable,
recorded sequence that a second person could run, that refuses to ship a build
that fails its tests, and that can be undone.

### Acceptance criteria

1. One documented command sequence builds and deploys, and a named second
   person has run it successfully.
2. Type check and the full test suite run automatically before a deploy, and a
   failure stops it.
3. Database migrations are applied as a step in that sequence, in order, with a
   record of what was applied when.
4. A non-production environment exists that is not a laptop.
5. A deploy is recorded: what shipped, when, by whom, from which commit.
6. A rollback to the previous version is a documented step with a stated
   expected duration.

### What already exists

**The build works. There is no pipeline.**

Operating: `package.json` defines `cf:build`, `cf:deploy` and `cf:preview`
through `@opennextjs/cloudflare`, plus `typecheck` and `test`.
`docs/MODULE-BRIEF.md` requires every contributor to run `npx tsc --noEmit` and
the full `npm test` before reporting, and the suite is large and fast against
the in-memory repositories. `wrangler.jsonc` is complete and well commented,
with observability on and a `STAGE` variable gating what is served.
`migrations/` has a single owner by written rule, in a numbered sequence, which
is the discipline that prevented six agents producing six conflicting
migrations.

Absent, all of it:

- **No continuous integration of any kind.** No `.github`, no workflow file, no
  CI configuration anywhere in the repository. Nothing prevents a deploy of a
  build whose tests fail; the only thing standing between a red suite and
  production is a human remembering a convention in a markdown file.
- No staging environment. `cf:preview` is a local preview.
- Migrations are applied by hand:
  `npx wrangler d1 migrations apply jsoa-platform --remote`, from somebody's
  laptop, not as a step in the deploy.
- No deploy record, no tagging, no changelog.
- No rollback procedure. Nobody has tested one.
- **No committed test covers any D1 implementation**, so the suite that would
  gate the pipeline does not cover the layer most likely to break in
  production. `PHASE2-FINDINGS.md` notes the vitest config can now resolve
  `server-only`, so the harnesses the ports built in scratch directories can
  move into `tests/`; one of them has.
- `prisma` and `next-auth` remain in `package.json`. Prisma has no schema and
  the architecture records that Auth.js was replaced by our own session layer.
  Dependencies nothing uses are a supply-chain surface and a false signal to
  the next person reading the manifest.

### What is missing or undecided

- CI with a type check and the full suite as a required gate.
- Migrations as a deploy step.
- A staging environment, which is also what E76 should be walked through on.
- A rollback procedure, written and rehearsed.
- A second person who has deployed. **Today one person can deploy this
  platform.** That is the same defect as a single-holder credential, wearing a
  different hat, and it belongs in the E77 inventory as a capability rather
  than an account.
- **Who decides:** the Vice President, Operations owns the pipeline and names
  the second deployer. Whether a staging environment is worth its cost is the
  board's, on our recommendation, which is that it is.

### Edge cases

- **An officer resigns mid-term.** Deployment must never depend on one person's
  machine, one person's Cloudflare login or one person's unrecorded knowledge.
  All three are true today.
- **A president who is also a treasurer.** Not materially different. The rule
  is that deploy authority is a named capability with at least two holders,
  recorded in the E77 inventory and reviewed on every change of officer.
- **Somebody holding the same office in both entities.** One Worker serves both
  front doors. A deploy is therefore a change to both entities' public faces at
  once, and no board approved that coupling — it arrived as an architecture
  decision. It should be stated on the record and accepted, or the entities
  should be served from separate Workers.

---

## E75 — Written operations runbook covering each board role

### What it must do

A written procedure that lets a person who has never seen this system, taking
an office in January, do that office's work correctly through a full cycle,
without ringing the person they replaced.

That is the whole test and it is deliberately unforgiving. An all-volunteer
board rotates. Institutional memory is the thing this organization loses, and a
runbook is the only artefact in the contract whose job is to stop it.

### Acceptance criteria

1. One runbook section per office, written for a reader with no prior exposure.
2. Each section carries the recurring cycle for that office — what happens
   weekly, monthly, quarterly, annually — with dates, not descriptions.
3. Each section names every system the office touches, how to get into it, and
   who to ask when it refuses.
4. Each section states what the office may not do, and who does it instead.
5. Each section includes a first-week checklist for a new holder.
6. **The acceptance test is the handover test**: an incoming officer performs
   one full cycle of their office's work from the runbook alone, and any point
   at which they had to ask a question becomes an amendment. Until that has
   happened for an office, that section is unverified.

### What already exists

**Nothing. This line is absent, and it has been reported against documents that
are not runbooks.**

What exists is good design documentation, and we want to be precise about why
that is a different artefact:

- `docs/ROLE-WORKSPACE.md` specifies the five-tab spine, the filters-not-copies
  rule and the derived-task rule. It is binding on developers. It tells an
  incoming Treasurer nothing about what a Treasurer does.
- `docs/DASHBOARD-BRIEF.md` specifies how a figure must be presented. It does
  not say what to do when the figure is bad.
- `docs/ARCHITECTURE.md` is a build specification carrying real operational
  content — the 75% and 97.5% and 90% membership composition thresholds, the
  member-versus-non-member receipt rule that makes the store's gating a tax
  control, the volunteer-hours records exception, the sponsorship fair-market-
  value rule — buried in a document no officer will ever open.
- `docs/DNS-AND-EMAIL.md` is the closest thing to a runbook in the repository,
  because it has an ordered procedure with confirmations. It covers one task.

A design document says what the system should be. A runbook says what the
person should do. We have a shelf of the first and none of the second.

### What a runbook contains for an officer starting in January

Written per office, in this order, because it is the order a new holder needs
it in.

**1. What this office is answerable for.** Three sentences. Not the bylaws
clause — what goes wrong if nobody does this.

**2. The cycle, by date.** The single most valuable page, and the one that only
exists in people's heads today. For the Scholarships Chair: the cycle opens
mid-December, applications close mid-February, scoring runs February to April,
awards and notification in May, disbursement in June, and the whole thing costs
roughly 40 hours a month January through June. For the Treasurer: filing dates,
the annual solicitation licence re-filing, reconciliation cadence, the quarterly
controls checklist. For the Secretary: meeting cadence, notice periods, when
minutes must be adopted. A new officer in January needs to know what is already
late.

**3. Getting in.** How to sign in, how the second factor works, what to do when
it refuses, and who can help. Name the office that can help, never a person.

**4. The screens you will use, and what each is for.** Plain language, with
what each figure means and what a bad one implies. Including, explicitly, that
a withheld figure is not a broken screen.

**5. The work, step by step, for each recurring task.** The actual sequence.
Where approval is needed, who gives it, and what to do when they are
unavailable.

**6. What you cannot do, and who does it.** With the reason, because an officer
who understands a control respects it and an officer who does not routes around
it. The Treasurer's section says plainly: you cannot attest your own count, and
here is why, and here are the three offices that can.

**7. What is logged.** That row-level reads of member and applicant records are
logged, not only edits. That break-glass access notifies the President and the
Secretary. Stated up front, not discovered.

**8. The handover.** What you must hand over, what the incoming holder needs
from you in their first week, and the standing rule from E77 — no credential
lives in your head or in your personal inbox.

**9. First week checklist.** Sign in and enrol the second factor. Read your
office's cycle. Confirm your process map entry (E01). Sign your permission
matrix page (E04). Confirm every account your office owns in the inventory
(E77). Meet the second administrator on each of them. File your
conflict-of-interest declaration.

**10. When it goes wrong.** Who to tell, in what order, with what information.
Specifically for a suspected data exposure: under North Carolina's Identity
Theft Protection Act, encryption is built into the definition of a breach, so
whether the data was encrypted at rest materially changes the obligation, and
the officer discovering it must not guess.

### What is missing or undecided

- All ten sections, for all seventeen offices. Offices with no screen (E05)
  still need a runbook section; an office whose work happens outside the
  platform needs it more, not less.
- The cycle dates for most offices, which come out of E01.
- **Who decides:** the Vice President, Operations owns the runbook and its
  structure. Each officer owns the content of their own section and signs it.
  The President signs the whole at the start of each board year.

### Edge cases

- **An officer resigns mid-term.** This is the case the runbook is built for,
  and a mid-term resignation is harder than a January handover because there is
  no overlap and often no exit conversation. The runbook must be sufficient
  with the predecessor unreachable. That is the standard: not "with help", not
  "with a call" — unreachable.
- **A president who is also a treasurer.** Two sections, read separately, with
  an explicit note that the combination raises a separation-of-duties finding,
  what mitigation the board accepted, and what that person must therefore not
  do alone. A combined section would hand the next pair of officers a procedure
  built for a conflict the board was trying to unwind.
- **Somebody holding the same office in both entities.** One section, with
  every step marked per entity where it differs, and an explicit statement of
  what must never be carried across. The Secretary again: one Secretary, two
  minute books, and the runbook must say where the separation is maintained and
  how to check it was.

---

## E76 — Administrator walkthrough session on the finished system

### What it must do

A live session on the running system in which the people who will administer it
do the real tasks themselves, and leave able to run it.

### Acceptance criteria

1. Held on the deployed system, against real data, not a laptop and not seed
   data.
2. Each attendee performs their own tasks with their own account. Watching is
   not attendance.
3. Covers, at minimum: signing in and enrolling the second factor; granting and
   revoking an office; what the audit log shows and how to read it; performing
   a break-glass request and seeing the notification arrive; the release
   approval path; the subscription register and the account inventory; and what
   to do when a screen refuses you.
4. Every attendee completes one task of their own end to end.
5. Questions that the runbook could not answer are recorded and become
   amendments to it.
6. Recorded, with the recording and the written notes kept where a future
   officer can find them.

### What already exists

**Nothing, and it is not currently possible.** This line cannot be run until
E03, E73 and E05 are operating: there are no accounts to sign in with, no mail
to deliver a sign-in link, and no role administration screen to demonstrate.
Running it on a developer's laptop against seed data would produce a session
about a system nobody present can subsequently reach, and we will not sign that
off as delivery.

The near-term sequencing is: Resend wired → role administration screen → board
accounts created → stage gate lifted → walkthrough.

### What is missing or undecided

- Who counts as an administrator. We propose the President, the Vice President
  Operations, the Secretary and the Webmaster, which is four people across both
  entities and gives every critical function at least two holders. The board
  confirms.
- Whether the Finance Review Officer attends. We say yes for the audit log and
  the attestation path, and that they should be shown nothing else, because
  their independence is the point.
- **Who decides:** the Vice President, Operations schedules and runs it. The
  President confirms the attendee list. Neither of us will certify this line
  against a session held before the preconditions are met.

### Edge cases

- **An officer resigns mid-term.** A walkthrough held once decays. Either the
  runbook is sufficient for a successor alone, which is E75's acceptance test,
  or the session must be repeatable — which argues for recording it and for a
  short standing re-run at each board turnover.
- **A president who is also a treasurer.** They attend as both, and the session
  must demonstrate the refusals that apply to the combination rather than skip
  past them because the one person present can do everything. The most useful
  five minutes of this session is a screen saying no to somebody senior.
- **Somebody holding the same office in both entities.** They perform each task
  once per entity, because the entity switch is exactly where a two-entity
  administrator makes a mistake that nothing downstream will catch.

---

## E77 — Account and credential inventory

### What it must do

A complete record of every account, login and credential either entity depends
on, who can get into each one, and what happens when that person cannot be
reached.

### Acceptance criteria

1. Every account appears, including free ones and ones nobody remembers
   creating.
2. Each entry names at least two people who can get into it today, and both
   have confirmed within the last twelve months that they can.
3. No credential appears in the inventory itself. The inventory records where
   the credential is held, never the credential.
4. Each entry records the recovery path and who controls it.
5. The inventory is reviewed at every change of officer and at least annually.
6. **The acceptance test:** pick any three entries at random and have the second
   named administrator sign in, with the first person unavailable. An entry
   that fails this is not an entry, it is a hope.

### What already exists

**A field, not an inventory, and the field is empty of real data.**

`Subscription.secondAdministratorPersonId` in `src/lib/treasury/types.ts` is
nullable, and the comment on it is exactly right: "Null is a finding, not a
blank cell: it is the handover test. If the owner is unreachable, nobody can
get into the account." It fires `MISSING_SECOND_ADMINISTRATOR`, renders as a
finding with severity rather than an empty cell, and produces a task on the
Treasurer's overview telling them to record the credential in the shared
password manager and not in one volunteer's personal inbox
(`src/lib/treasury/kpis.ts`). Somebody thought about this properly.

What is not there:

- Thirteen rows, all fictional (`seed.ts`). The real inventory is empty.
- **No way to add a row.** No `saveSubscription`, no screen.
- The record has one handover field. It has **no** field for where the
  credential is held, no recovery email or phone, no record of whether MFA is
  on, no record of who holds the MFA device or the recovery codes, no
  confirmation date, and no way to record an account that costs nothing.
- The inventory is modelled as a *subscription* register, so an account with no
  bill — the DNS zone, a social account, a free tier — has no home in it.

### The live example, which is the whole argument

`docs/DNS-AND-EMAIL.md` and `docs/CLOUDFLARE-MIGRATION.md`, measured 19 October
2026:

- `thejsoa.org` is registered at **Network Solutions**, created 2016-06-01,
  expiring 2028-06-01.
- The DNS zone is at **Wix**. The registrar and the DNS host are two different
  vendors with two different logins, and the board needs both to leave Wix.
- WHOIS shows **Perfect Privacy, LLC** rather than a person, which is normal
  and has one consequence: account recovery runs entirely through the Network
  Solutions login.
- **Nobody has written down who holds it.**

One unrecorded credential, and this is what it blocks: the DNS move to
Cloudflare, the `thejsoa.org` cutover, routing `support@` and `connect@` and
the Memorial and Scholarships chair mailboxes, enabling DKIM, publishing DMARC
— and therefore E73 in full and E78 in part, because Wix cannot be cancelled
while it is still serving the only live site. Two contracted lines and a
spoofable domain, from one login nobody listed.

It is not an exotic failure. It is the ordinary one, and it is the reason this
section exists in the statement of work.

### The inventory format

One row per account. These fields, and we are specifying them so the record
cannot be reduced to a name and a password manager entry.

| Field | What it holds |
| --- | --- |
| Account | What it is, in the words a board member would use |
| Vendor | Who it is with |
| Entity | JSOA, JSOF, or both — and if both, on what basis the cost is split |
| What depends on it | Named. "The domain", "board mail", "the public site" |
| Owning office | A role, never a person |
| Primary administrator | The person holding the owning office now |
| Second administrator | A different person, named, **who has signed in** |
| Last confirmed | Date the second administrator last got in and proved it |
| Where the credential lives | The shared password manager vault, by name. Never the credential |
| MFA | On or off; which device or method; **who holds the recovery codes and where** |
| Recovery path | The recovery email or phone on the account, and who controls that |
| Billing | Which card or account pays, who holds it, expiry |
| Renewal or expiry | Date, on the compliance calendar, not in anyone's memory |
| Cost | Annual, normalised; zero is a valid and important answer |
| What this platform replaces | Full, partial with what remains, or nothing |
| Export needed before cancelling | What must be pulled out first, and whether it has been |
| Notes | Anything the next holder would be annoyed not to know |

Three rules about the format itself:

- **The inventory never contains a credential.** It records where the
  credential lives. An inventory that holds secrets becomes the thing that must
  be protected instead of the thing that makes handover possible.
- **An account with no bill still gets a row.** The DNS zone has no invoice and
  is the most load-bearing thing on the list.
- **A capability gets a row too.** "Can deploy the platform" is an account in
  everything but name, it currently has one holder (E74), and it will be missed
  by any inventory that only lists vendors.

### The rule that stops it recurring

**No account becomes a dependency until it has two administrators and a
recorded recovery path. No exceptions, and the rule bites at creation, not at
review.**

Operationally, four parts:

1. **Created under the organization, never a person.** Every account is opened
   on a role address in the organization's own domain, with MFA on and at least
   two administrators, before anything is pointed at it. This is already
   written for the Cloudflare account in `docs/CLOUDFLARE-MIGRATION.md` and it
   generalises.
2. **Entered in the inventory in the same sitting it is created.** An account
   that exists and is not in the inventory is the defect; the inventory is not
   a thing you catch up on.
3. **Proved, not asserted.** The second administrator signs in once and the
   date goes in `Last confirmed`. Being listed is not the same as being able to
   get in, and the Network Solutions row would have failed this test on day
   one.
4. **Re-proved on a schedule and on every change of officer.** Annually at
   minimum, and as a first-week item in the incoming officer's runbook
   checklist (E75).

And the sanction that makes it real: **an account with one administrator is a
finding on the Treasurer's and the Vice President, Operations' screens until it
is fixed, and it is read into the minutes at the next board meeting.** The
mechanism for the first half already exists — `MISSING_SECOND_ADMINISTRATOR`
fires today. What is missing is real data for it to fire against, and the
board-level consequence.

### What is missing or undecided

- A real inventory. Nothing has been collected.
- The schema changes above, owned by the single owner of `migrations/`.
- `saveSubscription` and a screen, which E02, E77 and E78 all wait on.
- The shared password manager itself. `1Password Teams` appears in the seed
  with the justification "shared vendor credentials, so no account depends on
  one volunteer's personal inbox" — which is the correct sentence, in a
  fictional row. Whether the organization actually has one is unknown to us.
- **Who decides:** the Vice President, Operations owns the inventory. Each
  owning office confirms its own rows. The President authorises recovery
  attempts on accounts nobody can reach. The board approves the no-single-
  administrator rule, because it has a cost: it means buying seats.

### Edge cases

- **An officer resigns mid-term.** This is the case. Their rows are reassigned
  before their access is removed, in that order, and the new second
  administrator proves access before the departing one loses it. Doing it the
  other way round is how an account becomes unreachable in the gap. For a
  departure that is not amicable or not orderly, the order inverts — revoke
  first, recover after — and the runbook must say who makes that call. It is
  the President's.
- **A president who is also a treasurer.** They must not be both administrators
  of anything. Two names on a row that resolve to the same person is a single
  point of failure that looks compliant, and it is the failure mode a register
  with a `secondAdministrator` column invites. The validation has to compare
  people, not slots.
- **Somebody holding the same office in both entities.** An account used by
  both entities must name an administrator the other entity's board can also
  reach, or the entities must hold separate accounts. The question to ask of
  every shared row is: if the two boards disagreed tomorrow, who holds this?
  That question has no answer today for the Cloudflare account, which holds
  both front doors.

---

## E78 — Subscription audit naming what the platform replaces and what can be cancelled

### What it must do

For every tool the organization pays for, state whether this platform replaces
it, what remains if it only partly does, what can be cancelled and when, and
what the cancellation saves.

### Acceptance criteria

1. Every paid line carries one of: cancel now, cancel on a stated date, keep
   with a stated reason, downgrade, or consolidate into another line.
2. Every "cancel" names the date, the precondition that must be true first, and
   the office that executes it.
3. Every "cancel" names the export that must be taken first, and whether it has
   been taken.
4. The saving is stated per entity, annualised, and never summed across
   entities into one figure.
5. No cancellation executes before its precondition is confirmed true.
6. Reviewed at least annually and at every renewal date.

### What already exists

**The frame is built; the audit has not been done.**

The `Subscription` record already carries `lastReviewedOn` and
`lastReviewDecision`, and the decisions are the right five: keep, consolidate,
downgrade, cancel, not reviewed. A `STALE_REVIEW` finding fires on lines that
have not been looked at. `RENEWAL_IMMINENT` fires inside a window, and the
Treasurer's overview produces a task from it.

The gaps, in order of consequence:

- **The register cannot be written to**, so no real audit can be recorded in
  the system even if the board performed one tomorrow.
- **There is no `replaces` field**, which is the specific thing E78 is
  contracted to produce. `justification` is a sentence about why a tool exists,
  not a statement of what supersedes it.
- **There is no precondition field and no export field**, which is what turns
  a cancellation decision into a safe one.
- The thirteen rows are fictional, and they omit Network Solutions, the Wix DNS
  zone, and Cloudflare.

**One real cancellation decision is already recorded in prose and it is
blocked.** Wix is the current public site and must be retired when this
platform ships. `docs/CLOUDFLARE-MIGRATION.md` is unambiguous about the
precondition: **do not cancel Wix yet.** Wix has no clean content export, so
the pages, images and event history have to be captured by hand before the
subscription lapses, and losing the account means losing the only copy. The
precondition is "replacement live and content pulled", the content has not been
pulled, and the whole chain sits behind the Network Solutions login nobody
holds. That is precisely the pattern this field set exists to make visible, and
today it is visible only in a markdown file.

### What is missing or undecided

- The audit itself, against the real tool list from E02.
- The `replaces`, `precondition`, `exportTaken` and `cancelOn` fields.
- The write path and the screen.
- Which tools this platform genuinely replaces is a board decision informed by
  E01, not a developer's assumption. Our view, to be tested in discovery
  rather than assumed: the platform plainly replaces the website host, the
  membership spreadsheet and the scholarship intake spreadsheet. It does not
  replace accounting, mail hosting, the password manager or video calls. It may
  partly replace the newsletter tool and the forms tool, and "partly" is the
  answer that costs money quietly.
- **Who decides:** the Treasurer of the paying entity recommends, the board
  approves, the owning office executes, and nothing is cancelled until the
  Vice President, Operations confirms the precondition is true. On a shared
  line, both entities' Treasurers must agree before it is cancelled.

### Edge cases

- **An officer resigns mid-term.** A renewal does not pause for a vacancy. Every
  renewal date belongs on the shared compliance calendar rather than in the
  outgoing officer's calendar, and the card on file must outlive both the
  officer and the date — the `thejsoa.org` renewal on 2028-06-01 is the
  standing example. A line whose owning office is vacant needs a named interim
  before the next renewal, not after it.
- **A president who is also a treasurer.** They should not be the sole
  recommender and approver of a cancellation on an entity where they hold both.
  This is `APPROVE_SPEND` concentrated, and a cancellation is a spend decision
  in the negative — it can destroy an asset as easily as a purchase can waste
  one. Wix is the example: cancelling it in the wrong week loses the only copy
  of the organization's content.
- **Somebody holding the same office in both entities.** A shared line
  cancelled on one entity's decision leaves the other entity paying the whole
  invoice or losing the tool it depends on. The cancellation record must carry
  both entities' approvals whenever `split` names both, and the register's
  refusal to produce a single blended total is the structural reason this stays
  visible rather than disappearing into one number.

---

## Two standing rules this document creates

Both are handover rules, and both are stated as rules rather than
recommendations because the ordinary failure here is a good intention with no
consequence attached.

**Rule 1. Nothing the organization depends on may have one holder.** Accounts,
credentials, recovery paths, deploy authority, and the ability to perform any
office's recurring work. Two named holders, both proved, both recorded, before
the thing becomes a dependency. A single holder is a finding on the Vice
President, Operations' screen and is read into the minutes until it is closed.

**Rule 2. Nothing operational lives only in a person.** If a procedure exists
only because somebody knows it, it is not a procedure. It belongs in the
runbook (E75), the inventory (E77), the process map (E01) or the compliance
calendar. The test for all four is the same, and it is the test E75 is
acceptance-checked against: the predecessor is unreachable.

---

## What we are saying is not delivered

Collected so a reader does not have to assemble it from eleven sections.
Everything here is measured against the repository at commit `26b791f` on
27 October 2026.

| Line | Reported | Actual |
| --- | --- | --- |
| E01 Discovery with every board position | Covered by the ten-office board review | **Not done.** Those were site reviews against a build. One office, Scholarships, has a real discovery record. No process map exists |
| E02 Current stack review | Register screen exists | **Partly designed.** Thirteen fictional rows, no write path, no `replaces` field, and the registrar, DNS host and Cloudflare are all absent from it |
| E03 Role based account per position | Identity layer built | **Not operable.** `grantRole` and `invite` have zero callers, `ADMIN_ROLES` is checked nowhere, the sign-in link is never emailed, and 13 board routes still resolve the viewer through the dev persona switcher |
| E04 Matrix defined with your team, signed off, enforced | Enforced and tested | **One third delivered.** Enforcement is real and good. It has not been defined with anybody and nobody has signed anything. `ARCHITECTURE.md` and the code already disagree on the capability list |
| E05 Administrative portal, a screen per role | Six workspaces, 59 routes | **Partly designed, unreachable.** Gated off the internet by `STAGE`. Eleven of seventeen offices have no screen, including both offices signing this document, and including Family Support, which holds the most sensitive class in the system |
| E73 Hosting, database, email | Deployed on Cloudflare | **Two of three, and the third blocks the most.** `thejsof.org` serves; `thejsoa.org` cannot move because nobody holds the registrar login. D1 provisioned and verified by SQL, but no D1 repository has ever run inside a Worker. **Email delivery is absent** — Resend is called from nowhere and the sign-in link is written to the audit log |
| E74 Build and deployment pipeline | `cf:deploy` works | **No pipeline.** No CI anywhere in the repository, no test gate, no staging, no deploy record, no rollback, migrations applied by hand, and exactly one person can deploy |
| E75 Operations runbook per board role | Role workspace documents | **Absent.** Those are design specifications for developers. No runbook exists for any office |
| E76 Administrator walkthrough | — | **Not held, and not currently possible.** Needs E03, E73 and E05 first |
| E77 Account and credential inventory | `secondAdministrator` field exists | **Absent.** The field is right and empty; the register holds no real account. The Network Solutions login is unrecorded and blocks four contracted dependencies |
| E78 Subscription audit | Review decisions in the register | **Not done.** Thirteen fictional rows, no `replaces` field, no precondition or export field, no write path. The one real decision — retire Wix — is blocked on a credential nobody holds and an export nobody has taken |

One sentence we would want a regulator to read: the controls in this platform
are better than the governance around them, and the gap between those two is
this document's subject. The matrix that nobody signed is enforced at module
load and throws. The transfer rule that nobody has been briefed on refuses a
President's approval on the receiving side. The separation of duties that
protects the Treasurer from attesting their own count is mechanical. What is
missing is not rigour in the build. It is the board's hand on it, and the
record that the board's hand was there.

Signed for the offices,

**President** — \
**Vice President, Operations** — \
Date —
