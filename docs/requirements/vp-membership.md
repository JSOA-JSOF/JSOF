# Membership requirements: E06–E15, E25–E30

Office of the Vice President, Membership. 27 October 2026.

Sixteen contracted functions sit with this office. This document says, for each
one, what it has to do, how a tester proves it, what is actually built today,
what is missing, and who decides the parts I cannot decide. Everything under
"What exists" I checked in the repository and name by file. Where something
looks built and is not connected to anything, I say so in those words, because
the alternative is that I find out from a member on the phone.

Three things in here are not straightforward reporting, and they are the three
I would read first.

- **E25 and E26 describe an authentication system we did not build, on
  purpose.** My recommendation is to amend the contracted lines, not the build.
  The argument is in E25.
- **E08 cannot be written.** The vetting rules do not exist in writing anywhere
  in this organization. E08 carries the list of questions the board has to
  answer before anyone can build it.
- **E15 is a migration out of Submittable and nobody has seen the export.** E15
  says what I need from it and what I expect to go wrong.

A fourth thing emerged while writing this and I am not going to bury it: **E28
and E29 assume membership renews, and this organization's own public page says
it does not.** That is in E28.

## How to read the status lines

- **Built** — works end to end, has a test, and a wrong-role request to it
  fails.
- **Part** — some of it exists and the gap is named.
- **Not built** — no code path exists. Saying "the types are there" does not
  make it part.
- **Blocked** — cannot be built until somebody outside this office decides
  something.

One standing caveat on everything below. `docs/PHASE2-FINDINGS.md` section 7
records that **not one line of any D1 repository has run inside a Worker**, and
no board or application screen has been rendered against a real database. The
in-memory implementation is what the 1,330-line `tests/membership.test.ts`
exercises. So "Built" below means built and tested against
`src/lib/membership/repository.ts`, not proven in production. Every acceptance
criterion in this document must be run a second time against D1 in a Worker
before anyone signs it off.

Second standing caveat: `src/middleware.ts` gates `/apply` and `/board` off the
public internet in both the `mvp` and `public-beta` modes. Nothing in this
document is reachable by a member today.

---

## E06 — Public membership application form

**Status: Part.** The form is built. It is not reachable, and the live site
still sends applicants to Submittable.

### What it must do

A person who has never dealt with us before can reach a page on our own site,
answer the questions in four short steps, come back the next day and finish, and
submit — without creating an account, without uploading a document, and without
being told at any point whether the sponsor ID they typed belongs to a real
member.

That last clause is not a nicety. If the form behaves differently for a real
member ID than for an invented one, then the form answers "is this person a
member of JSOA" to anyone with a browser and a list of numbers. For this
organization that is the one question the platform must never answer.

### Acceptance criteria

1. `/apply` renders four steps — contact, eligibility, sponsor, review — and
   each step's answers survive a browser restart within six hours.
2. Submitting step 1 with an empty name returns to step 1 with the name field
   marked, and the other answers still filled in.
3. Submitting with a sponsor ID of `QQQQ`, with a real member's ID, and with an
   empty-but-present field produce **byte-identical** responses apart from the
   random reference. (`tests/membership.test.ts:164`.)
4. A malformed sponsor ID never blocks submission. It produces a hint beside the
   field and nothing else. (`tests/membership.test.ts:264`.)
5. No file input appears anywhere in the flow. Grep the rendered HTML for
   `type="file"`; zero matches.
6. The form works at 375px wide with no horizontal scroll, and the answers never
   appear in a URL — only the step number and the names of failed fields.
7. From the live Association membership page, the "apply" control reaches
   `/apply` on our domain and not `jsoa.submittable.com`.

### What exists

- `src/app/apply/page.tsx` and `src/app/apply/actions.ts` — the four-step form
  and its server actions.
- `src/app/apply/draft.ts` — the draft lives in a `DRAFT` row; the browser holds
  an opaque id in an httpOnly cookie scoped to `/apply`, six-hour life. No
  personal data in the URL.
- `src/lib/membership/intake.ts` — per-step validation, and `sponsorShapeHint`,
  which is advisory and is deliberately ignored by the submission handler.
- `src/lib/membership/types.ts` — ten fields and no more, each traceable to a
  purpose.

### What is missing or undecided

- **It is gated off.** `src/middleware.ts` lists `/apply` in `GATED`. A
  volunteer cannot use this today and neither can an applicant.
- **The in-memory fallback loses applications.** When there is no D1 binding the
  repository holds state on `globalThis`, and a Workers isolate can be recycled
  between two requests with nothing thrown. The middleware comment says this
  plainly. The gate stays until the D1 path is proven in a Worker — that is a
  precondition on opening E06, not a separate task.
- **The live Wix site still points at Submittable.** Ending that dependency is
  the stated reason this module was sequenced first
  (`docs/ASSOCIATION-SITE-REMAP.md`). Redirecting the live button is a webmaster
  task on a site this platform does not own, and somebody has to own the
  cutover date. **VP Membership proposes the date; the Webmaster executes; the
  President approves the Submittable cancellation** (see E15 — do not cancel
  before the export is verified).
- No postal address is collected. The store will want one for fulfilment
  (BOARD-REVIEW R19). I am not adding a field to the membership form for another
  function's workflow; if the store needs an address it collects it at
  checkout. **This is my call and I am recording it so it is not relitigated.**

### Edge cases that will actually happen

- **Somebody applies twice.** Two drafts, two submissions, two application rows.
  The second is flagged `DUPLICATE_EMAIL` for the chair and the applicant is
  told nothing different, because telling them would make the form a lookup for
  a different question. Working as designed. What is missing is the chair-side
  handling: see E09 and E12.
- **An applicant who is already a lapsed member.** Same path, same flag. The
  chair sees `DUPLICATE_EMAIL` only if a prior *application* used that address —
  `countApplicationsByEmail` reads `application`, not `member`. A member
  imported from Submittable with no application row behind them will **not**
  raise the flag. That is a real hole and it belongs to E15: see the import
  requirements there.
- **An applicant with no sponsor at all.** The field is required to be
  non-empty, but any text passes. Somebody will type "I don't have one". The
  chair gets `SPONSOR_ID_MALFORMED` plus `SPONSOR_NOT_ON_ROSTER` and the
  application waits out 72 hours before reaching the queue. That is four days of
  silence for an applicant whose case was always going to the chair. I would
  rather the form said "I don't have a sponsor" as an explicit option and routed
  immediately — **but it must route through exactly the same code path and the
  same acknowledgment**, or we have reintroduced the oracle. That is buildable
  once the board answers question 5 in E08.

---

## E07 — Submission handling with automatic confirmation to the applicant

**Status: Part. The confirmation is not sent.** This is the one I expect to get
phone calls about first.

### What it must do

When somebody submits, two things happen without anybody doing anything: the
application enters the queue, and the applicant receives an email confirming we
have it, carrying their reference and a plain statement of what happens next and
by when. The email is identical for every applicant regardless of what the
system learned about their sponsor.

### Acceptance criteria

1. Submit an application. Within five minutes an email arrives at the address
   given, containing the same reference shown on screen.
2. Submit three applications — valid sponsor, unknown sponsor, malformed ID. The
   three emails are identical apart from the reference and the addressee.
3. Submit with an address that bounces. The queue entry is still created, the
   chair sees a delivery failure, and the applicant's application is not
   affected.
4. Kill the mail provider (bad API key). The submission still completes, the
   acknowledgment page still renders, and the message sits queued rather than
   lost.
5. Time the handler across 50 submissions, half with real sponsor IDs and half
   with invented ones. The two distributions overlap.
   (`tests/membership.test.ts:222` asserts the work is identical; the timing
   check against a Worker has not been run.)
6. The confirmation states the four-day commitment and states that nothing has
   been charged.

### What exists

- `src/lib/membership/intake.ts` `submitApplication` — the handler. Single
  straight line, every lookup unconditional, flags written for the chair and
  never to the response. This is good work and I do not want it touched casually.
- `src/app/apply/submitted/page.tsx` — the on-screen acknowledgment, rendering
  `INTAKE_MESSAGE` verbatim.
- `src/lib/membership/notify.ts` — an **in-memory outbox**. Nothing is sent.
  Resend is named in `docs/ARCHITECTURE.md` and is not wired.

### What is missing or undecided

- **There is no confirmation to the applicant.** Read `submitApplication`: it
  enqueues a `VOUCH_REQUEST` to the sponsor and, in the dead-draft case, a
  `CHAIR_NOTICE`. It never enqueues anything to the applicant. The contracted
  line says "automatic confirmation to the applicant" and that message does not
  exist, not even as a stub. This is the single clearest unbuilt thing in my
  sixteen.
- **The reference is held in a cookie that expires in 30 minutes**
  (`src/app/apply/draft.ts`). An applicant who closes the tab and comes back has
  no reference and no way to get one, because there is no email. Those two gaps
  compound.
- **No mail is sent at all, anywhere.** Resend is a Communications-lane
  dependency (`docs/MODULE-BRIEF.md` phase 3). Until it lands, E07, E09's
  notifications, E10's decision notices and E25's sign-in links are all
  theoretical. **Who decides: the integration owner sequences Communications;
  the President approves the vendor** (`ARCHITECTURE.md`: confirm before adding
  any vendor).
- The mail queue must be a table with a worker draining it, not an inline API
  call. `notify.ts` says so and is right: an inline send makes response time a
  side channel for whether a sponsor address existed.

### Edge cases that will actually happen

- **A typo'd email address.** We have no other way to reach them — the form
  collects a phone number and nobody will ring it. The chair needs a view of
  undeliverable confirmations. The outbox already carries `deliverable`; the
  screen does not exist.
- **A shared family address.** Two members, one mailbox. Fine for the
  confirmation, a problem for E25 sign-in, where the email **is** the identity
  (`person.email` is `UNIQUE`). Noted again in E25.
- **A corporate or .mil address that silently drops us.** Common in this
  population. The four-day promise is still running while the applicant has
  heard nothing. Delivery failures must reach the chair, not just a log.

---

## E08 — Eligibility verification against written vetting rules

**Status: Blocked. The rules do not exist in writing.**

### Why this section is shorter on requirements and longer on questions

I will not write acceptance criteria for a rule the board has not set, and I
will not infer the rule from what the code happens to do. What the code does
today is route an application to a sponsor and, failing that, to a human. That
is not verification against a standard; it is a well-built queue in front of an
undefined decision. The distinction matters because when a declined applicant
asks "on what basis", the honest answer today is "whoever opened the queue
thought so", and that is also the answer their lawyer gets.

### What exists

- `src/lib/membership/types.ts` — `MEMBERSHIP_CATEGORIES` (`VETERAN`, `CADET`,
  `QUALIFYING_RELATIVE`, `NON_QUALIFYING`) and `QUALIFYING_RELATIONSHIPS`. The
  comment says these "mirror the bylaws' classes". **Nobody has checked them
  against the actual bylaws document.** I have not seen the bylaws.
- `INTAKE_FLAGS` — seven computed flags, every one computed on every submission.
  This is the machinery a rule would run on, and it is sound.
- `src/lib/membership/wartime.ts` — the statutory wartime periods and
  `deriveIsWarVeteran`. This is derived law, not organizational policy, and it
  is correct (including the refusal to use the stale Treas. Reg.
  1.501(c)(19)-1).
- `src/lib/membership/composition.ts` and the report at
  `/board/membership/composition` — the 75%, 97.5% and 90% tests. These are
  compliance constraints on who we may admit, and they exist.

So: the tax-law constraints are built. The organization's own membership
standard is not written down anywhere.

### The list for the meeting

Answers to these, minuted, are what makes E08 buildable. I would take them in
this order.

1. **Do the four categories in the code match the bylaws exactly?** Someone must
   read the bylaws against `MEMBERSHIP_CATEGORIES` and confirm or correct,
   clause by clause. If the bylaws name a class the code does not have, the code
   is wrong and the composition report has been counting the wrong thing.
2. **Is there a service qualification beyond "served in the armed forces"?** We
   are a joint special operations association. Does membership require
   assignment or attachment to a JSOC or component unit? For how long? Does
   supporting-unit service count? If the answer is "any veteran", say so
   explicitly, because today the code assumes it.
3. **Augmentees: who decides, and against what standard?** The public site says
   these are considered case by case, and the state machine routes every one of
   them to the chair. Nothing records who holds that decision or what it turns
   on. (Already standing as `plan-augmentee-decider` in
   `src/lib/membership/workspace.ts`.)
4. **Non-qualifying applicants: admitted at all, and by whom?** The 97.5% test
   governs the exemption itself and the current roster passes it with **zero**
   slack (`tests/membership.test.ts:664` — 39 of 40). The next non-qualifying
   admission ends the exemption. Either admissions in that class stop, or they
   require a named approver and a pre-check against the live count. The roster's
   owner should not be deciding that one application at a time.
5. **Is a sponsor mandatory?** If an applicant has no sponsor, is that a
   decline, a chair review, or an alternative route? And **who may sponsor** —
   any member in good standing, or a member of some standing or tenure? Is there
   a cap on how many applicants one member may sponsor in a year?
6. **What does the vouch actually assert?** "I know this person" and "I attest
   to their service" are different statements with different consequences for
   the sponsor. The vouch page currently offers confirm / decline / do-not-know
   without saying which claim the sponsor is making. Counsel should see the
   final wording.
7. **Relatives: of whom, and for how long?** A qualifying relative of a current
   member, of any member living or dead, or of any qualifying servicemember? And
   does a relative's membership survive the related member's death, lapse or
   revocation? The code stores the degree of relation and not the person
   related to, so an answer of "of a current member" is not currently
   enforceable and would need a schema change.
8. **Cadets: what evidence of enrolment, and what happens on commissioning or
   aging out?** `CADET` is a counted class in the 97.5% test, so people moving
   out of it silently changes a compliance figure.
9. **Is there any disqualifier?** Discharge characterisation, conduct, criminal
   record. If the answer is yes, that is a new field, a new sensitive data class
   and a change to the privacy policy, and it goes to counsel before it goes
   near the form. If the answer is no, record that it is no.
10. **Declines: final or not?** May a declined applicant reapply, after how
    long, and is there an appeal? To whom? The state machine treats `DECLINED`
    as terminal with no path out, so "they can reapply" today means "they start
    a new application and nothing links the two".
11. **Former members: lapsed and revoked.** May they reapply, on what terms, and
    does a revocation bar reapplication? See the edge case below — this one is
    live, not hypothetical.
12. **The in-country Vietnam claim.** `wartime.ts` routes it to a chair
    exception because we do not collect location of service. Who decides it and
    on what evidence, given we accept no documents?
13. **Is the board willing to stand behind "within four days"?** It is published
    in `INTAKE_MESSAGE` and on the acknowledgment page. Who covers it when the
    chair is on holiday? A published commitment nobody owns is BOARD-REVIEW
    finding 3 with a different hat on.

**Who decides:** the board, on the VP Membership's paper, with questions 6, 9
and 12 going to counsel first. Question 4 touches the exemption and should carry
the Treasurer's name as well as mine.

### What I will build once they answer

A written vetting standard in `docs/`, and then the rule as **configuration read
by the chair's screen**, not as branches in code — the same discipline
`ARCHITECTURE.md` already imposes on scholarship eligibility, and for the same
reason: this rule will change, and when it does one value changes, not a
function. The flags are already computed; what is missing is the standard they
are measured against and the record that says which standard a given decision
was made under.

---

## E09 — Reviewer queue with assignment to a named reviewer

**Status: Part. The queue is built. Assignment does not exist anywhere.**

### What it must do

Every application that the sponsor route could not settle lands in one list. Any
item in that list can be given to a named person, who can see what is theirs,
and anybody opening the queue can see who holds each item and since when. An
item nobody holds is visibly unheld rather than quietly everyone's.

### Acceptance criteria

1. A decline, a do-not-know, an unanswered 72-hour window, a sponsor ID matching
   nobody, and an augmentee case all appear in the same queue, with the reason
   they arrived shown. (Behaviour asserted at `tests/membership.test.ts:543`,
   `:552`, `:562`, `:282`.)
2. Assigning an item to a named reviewer records who assigned it, to whom, and
   when, in the audit log.
3. A reviewer filtering to "mine" sees exactly their items.
4. Reassignment is possible and leaves both the old and the new assignment in
   the record — nothing is overwritten.
5. A role holding `MEMBER_PII` at `READ` can see the queue and its assignments
   and cannot assign. A role with no member data sees nothing.
   (`tests/membership.test.ts:410` covers read-vs-decide today.)
6. Unassigned items older than a configurable number of days are visibly flagged
   on the queue, not in a report somebody has to open.

### What exists

- `src/lib/membership/board.ts` `loadChairQueue` — the queue, behind
  `authorize()` with `MEMBER_PII` at `READ`, row-level, logged before a name is
  rendered.
- `src/app/board/membership/exceptions/page.tsx` — the screen, with the flags
  rendered per application.
- `src/lib/membership/vouch.ts` `sweepExpiredVouches` — moves lapsed windows in.
  **It runs when somebody opens the page.** In production this is a scheduled
  job and there is no scheduler. An application whose window closed on Friday
  moves on Monday when the chair logs in, inside a promise of four days.

### What is missing or undecided

- **Assignment does not exist.** No column, no field on `Application`, no
  repository method, no UI. I grepped: the only matches for "assign" in this
  module are `Object.assign` and a SQL SET-clause builder. "Part" is generous
  and I am marking it that way only because the queue is real.
- Assignment needs a table — who, to whom, when, by whom, and the reassignment
  history. **I may not write a migration** (`MODULE-BRIEF.md`: one owner for
  `migrations/`). This is a reported finding for the migrations owner, with the
  shape above.
- **Who are the reviewers?** Today the chair queue is effectively VP Membership
  alone, because `MEMBER_PII: WRITE` is held by exactly one role. If the board
  wants a membership committee, that is a role-table change, and
  `src/lib/authz/**` is never delegated — it changes by review. **The board
  decides whether a committee exists; the President and whoever owns authz make
  the grant.**
- **The sweep needs a cron trigger.** Infrastructure, not this module.

### Edge cases that will actually happen

- **The assigned reviewer is the applicant.** `assertNotSelfApproval` already
  blocks the decision (`tests/membership.test.ts:606`), matching applicant to
  person by the address applied with. Assignment must block it at assignment
  time too, not only at decision time — otherwise an item sits assigned to
  somebody who can never act on it.
- **The assigned reviewer leaves the board.** Their grant is revoked, their
  assignments are not. Revoking a role must surface their open items for
  reassignment, or those applications become invisible work.
- **Two reviewers open the same item.** Last write wins, silently, with both
  reasons plausible. Whoever builds assignment handles the concurrent-decision
  case explicitly; `decideChairException` currently re-reads state and refuses
  anything not in `CHAIR_QUEUE`, which handles it by accident rather than by
  design.

---

## E10 — Approve or decline with the reason recorded against the application

**Status: Built, with two defects I would fix before opening it.**

### What it must do

A decision on an application records the outcome, a reason in the decider's own
words, who decided it and when, permanently and against that application. The
applicant is told the outcome. Nobody can decide their own application. A role
that can read the queue cannot decide in it.

### Acceptance criteria

1. Approve an application: state moves `CHAIR_QUEUE → AWAITING_PAYMENT`,
   `decided_at`, `decided_by`, `decision_outcome` and `decision_reason` are all
   populated, and the applicant gets a notice.
2. Decline: state moves to `DECLINED`, the same four columns are populated, and
   **no payment is ever requested**. (`tests/membership.test.ts:570`.)
3. Decide with an empty reason: the form refuses. *(Fails today — see below.)*
4. A role with `MEMBER_PII` at `READ` only (President, Secretary) gets a refusal
   on the decision, and the refusal is in the audit log.
   (`tests/membership.test.ts:410`, `:437`.)
5. A board member deciding their own application is refused.
   (`tests/membership.test.ts:606`.)
6. Deciding an application not in `CHAIR_QUEUE` is refused.
   (`tests/membership.test.ts:595`.)
7. The reason is visible on the application forever and cannot be edited or
   deleted by any screen.

### What exists

`src/lib/membership/board.ts` `decideChairException` and
`src/app/board/membership/actions.ts` `decide`. Authorization first, state
machine second, `assertNotSelfApproval` against the applicant's identity
resolved by email, decision written with outcome, reason, decider and timestamp,
notice enqueued. Columns `decided_at` / `decided_by` / `decision_outcome` /
`decision_reason` exist in `migrations/0003_membership.sql`. The refusal comes
back to the screen as a sentence rather than a stack trace, which is right.

### What is missing or undecided

- **The reason is optional.** `board.ts` writes
  `input.reason.trim() || "No reason recorded."` A chair in a hurry produces a
  record that says nothing, and that record is the whole defence if a decline is
  ever challenged. I want it required at the form and at the service. Small
  change; I am naming it because it is exactly the sort of thing that survives
  to production.
- **The decline notice carries no reason.** `enqueue` sends a subject line and a
  reference. The applicant is told no, with nothing. Whether we tell an applicant
  *why* is a board decision, not mine — there are good arguments for a bare "no"
  — but it has to be decided rather than defaulted. **The board decides what a
  declined applicant is told.**
- **There is no record of which standard was applied**, because there is no
  standard (E08). When there is, the decision record should carry its version.
- The decision record is not editable, which is right, and there is also no way
  to record that a decision was later reversed. If the board wants an appeal
  (E08 question 10), that needs a shape.

### Edge cases that will actually happen

- **An applicant who is a lapsed member, declined on reapplication.** Nothing
  connects the new decline to their old member record, so the roster still shows
  `LAPSED` and the application shows `DECLINED` and no screen shows both.
- **A sponsor confirms, so nobody decides anything.** The vouch route reaches
  `AWAITING_PAYMENT` with no `chairDecision` row at all. That is correct — the
  sponsor is the decision — but anyone auditing "show me the reason for every
  admission" will find most members have none. Say that in the vetting standard
  rather than discovering it in an audit.
- **The chair decides, then the applicant never pays.** The application sits in
  `AWAITING_PAYMENT` forever. There is no expiry, no reminder, no closure state.
  That is a real queue that will accumulate.

---

## E11 — Automatic member account creation on approval, with no re-entry

**Status: Part, and the missing half blocks six other functions.**

### What it must do

An approved applicant who pays becomes a member record without anybody retyping
anything, **and gets a working account** — so that the first thing they do after
paying is sign in and see their own record, rather than wait for a volunteer to
set something up by hand.

### Acceptance criteria

1. Clear dues on an application. A `member` row appears carrying name, email,
   phone, category, relationship and service dates taken from the application,
   with no human input. (`tests/membership.test.ts:343`.)
2. `is_war_veteran` on the new member is **derived** from the service dates, not
   copied from the applicant's checkbox, and the checkbox value is kept
   alongside it.
3. The new member gets a `JSOA-YYYY-NNNN` number allocated from the counter, and
   ten concurrent creations produce ten distinct numbers.
   (`PHASE2-FINDINGS.md` section 6 verified the counter is race-free.)
4. The application's `converted_member_id` points at the new member in the same
   transaction. (`repository.d1.ts` `createMember` batches both.)
5. **A `person` row exists for the new member, linked by `member.person_id`, and
   they hold the `MEMBER` role for JSOA.** *(Fails today.)*
6. **The new member can complete sign-in at `/sign-in` using the address they
   applied with, without a volunteer touching anything.** *(Fails today.)*
7. Only a verified payment-provider webhook can trigger any of this. A browser
   hitting the success URL does not create a member.

### What exists

- `src/lib/membership/payment.ts` `clearDues` — creates the roster record from
  the application with no re-entry. This part is genuinely done and it is the
  right shape.
- `migrations/0003_membership.sql` — `member.person_id TEXT REFERENCES
  person(id)`, with a comment saying it is "the account, once there is one".
- `src/lib/auth/store.ts` `invite()` and `grantRole()` — the functions that
  would create the account and the grant.

### What is missing or undecided

This is the honest part and it is worth being blunt.

- **`person_id` is hardcoded `NULL`.** `repository.d1.ts` `createMember` binds
  the literal `NULL` into that column. `memberOf` does not read it back. The
  `Member` domain type in `types.ts` **has no `personId` field at all**. The
  column exists, the comment explains it, and no code path writes it.
- **Nothing calls `invite()`.** No `person` row is created on approval. No
  `MEMBER` role is granted. No sign-in link is sent. A new member cannot sign in,
  which means **E25, E26, E27, E28, E29 and E30 are all blocked on this one
  missing join.** Six of my sixteen.
- **Creation happens at payment, not at approval.** The contracted word is
  "approval"; the build creates the member when dues clear. I think the build is
  right — an approved applicant who never pays is not a member, and the
  composition report counts members — but the contracted line and the build do
  not say the same thing and somebody will notice. **Record the correction:
  "automatic member record and account creation when dues clear following
  approval."**
- **Stripe is not integrated.** `createHandoff` builds a stub session and the URL
  goes nowhere. `clearDues` is reachable today from a labelled dev affordance.
  Before this is live, only a signature-verified webhook may call it, and that
  needs the Treasurer's Stripe account for JSOA.
- `MEMBER` holds no grants in `src/lib/authz/model.ts` — member-tier access is
  "scoped by ownership of the record", and the ownership-scoped path does not
  exist yet either. That is E28/E30's problem but it starts here.

### Edge cases that will actually happen

- **The email on the application already has a `person` row** — a board member
  joining as a member, or a member who was invited to the platform for some other
  reason. `invite()` is idempotent and returns the existing person, which is the
  right behaviour. The member record must link to that existing person, not
  create a second identity.
- **A lapsed member pays again.** Today this creates a **second member record**
  with a second member number and the same email. `member.email` is indexed and
  **not unique**. Two rows for one human breaks the composition denominator and
  gives them two numbers. Before E11 is finished, re-admission has to be a
  decision: reinstate the existing record or create a new one with a documented
  link between them. **The board decides what re-admission means; I will not
  default it.**
- **Two family members sharing one mailbox.** `person.email` is `UNIQUE`, so the
  second one cannot have an account. The roster will hold two member records and
  the platform one identity. This will happen in this population and there is no
  design for it.

---

## E12 — Application status tracking from submitted through to decision

**Status: Part, and the contracted line partly contradicts the security model.**

### What it must do

Two different readers, two different answers.

**The chair** sees exactly where every application is, how long it has been
there, what it is waiting on, and the full history of what happened to it.

**The applicant** can check that we still have their application and whether a
decision has been made — and can learn nothing from that page about whether
their sponsor exists, whether the sponsor answered, or whether the chair has
picked it up. A status page that distinguishes "waiting on your sponsor" from
"with the chair" tells the applicant whether the ID they typed matched a real
member. That is the oracle the whole intake design exists to prevent, rebuilt on
a different page.

So the applicant's view has two states: **received** and **decided**. Not five.

### Acceptance criteria

1. The chair's queue shows, per application, its state, when it was submitted,
   when the vouch window closes, and its flags. (Built.)
2. For an application in `AWAITING_VOUCH` and one in `CHAIR_QUEUE`, the
   applicant-facing status page returns identical content apart from the
   reference.
3. The applicant's status page requires the reference **and** the email address
   together, and answers identically for a reference that does not exist.
4. Rate-limit the status lookup; 20 wrong references from one source in a minute
   stops answering.
5. Every state change on an application is recoverable from the record: who, what
   and when, including the automated sweep.
6. A decided application shows the applicant the outcome and nothing about how it
   was reached.

### What exists

- `MembershipState` (nine states) and `OPAQUE_TO_APPLICANT` in
  `src/lib/membership/state.ts` — the design decision is already encoded.
- The chair-side views: `/board/membership/queue` and
  `/board/membership/exceptions`.
- `getApplicationByReference` on the repository — the lookup an applicant status
  page would need, built and **called by nothing**.

### What is missing or undecided

- **There is no applicant-facing status page.** `/apply/submitted` renders once
  and the reference lives in a cookie for 30 minutes. After that the applicant
  has no way to check anything, and no email to look back at (E07).
- `getApplicationByReference` is wired to no route. That is a method sitting
  ready for a page that was never built, which is exactly the "looks built, is
  not connected" case I was asked to flag.
- **The sweep is not in the history.** When `sweepExpiredVouches` moves an
  application to the chair queue it writes the new state and enqueues a notice;
  it writes nothing to `membership_audit`. So "why is this in the chair queue"
  is answerable from the flags but not from a timeline.
- **No elapsed-time view for the chair.** The four-day promise is in the copy and
  on no screen. The chair cannot see which applications are about to breach it.

### Edge cases that will actually happen

- **Somebody applied twice and checks the status of the first reference.** Two
  applications, two references, two independent answers. If one is approved and
  one declined, both answers are true. Deduplication is E09's problem; the status
  page just has to not lie.
- **An applicant forwards their reference to the sponsor to chase it.** The
  reference identifies the application; if the status page keys on reference
  alone, the sponsor learns the applicant's progress. Hence requiring the email
  too.
- **A member of the public types a random reference.** Must get the same answer
  as a real one that is not theirs: nothing.

---

## E13 — Full member roster with search and filter

**Status: Part. The roster is built; search and filter are not.**

### What it must do

A member of this office can open one list of every member record, find one
person quickly by name, number or email, and narrow the list by standing,
category and sponsor. Opening it is logged. Roles that hold only aggregate
access cannot open it at all — and can still open the composition report.

### Acceptance criteria

1. The roster lists every member record with number, name, category, service
   dates, derived war-veteran status, whether the attestation agrees, standing
   and sponsor. (Built.)
2. Typing part of a surname narrows the list; so does a partial member number and
   a partial email.
3. Filtering by standing to `LAPSED` shows only lapsed records and the count
   shown matches the rows rendered.
4. VP Operations and both Treasurers are refused the roster and allowed the
   composition report. (`tests/membership.test.ts:374`.)
5. A JSOF role is refused both, because membership is an Association function.
   (`tests/membership.test.ts:394`.)
6. The correct role **without MFA** is refused. (`tests/membership.test.ts:402`.)
7. Opening the roster writes one row-level `READ_ROSTER` entry to
   `membership_audit`, and a refusal writes a `:DENIED` entry.
   (`tests/membership.test.ts:437`.)
8. A search that matches nothing writes the same audit entry as one that matches
   everything — the log records that the roster was opened, not what was looked
   for.

### What exists

`src/lib/membership/board.ts` `loadRoster` and
`src/app/board/membership/roster/page.tsx`. The authorization, the logging and
the aggregate/row-level split are all correct and tested. The page also renders
the last fourteen audit entries, and VP Membership — me — deliberately cannot
read that log, because the person who owns the roster should not curate the
record of who read it. That is right and I do not want it changed.

### What is missing or undecided

- **No search box. No filters.** The page renders every row.
- `listMembers()` loads the whole table and sorts in memory. At a few hundred
  members that is fine and I would not build pagination for it. Say the limit out
  loud: this approach stops being reasonable somewhere around a few thousand
  rows, which this organization will not reach.
- **An export does not exist and I would not add one lightly.** A CSV of the
  roster is the single highest-consequence file this platform could produce. If
  the board wants one it is a separate decision with its own audit entry and
  probably a second approver. **The board decides whether a roster export
  exists.**
- **Whether a member directory should exist for members** is open and is flagged
  as such in `src/lib/membership/workspace.ts` (`MEMBER_DIRECTORY_QUESTION`). It
  is not a feature question: a searchable list of who belongs to this community
  is precisely the query the intake is built never to answer, and the reasons do
  not stop applying because the reader is signed in. Nothing was built. **The
  board decides.**

### Edge cases that will actually happen

- **Two members with the same name.** Common. Search must show the member number
  in the result, and the chair must disambiguate on something other than name
  before acting.
- **Searching for somebody who is not there** because they were never migrated
  (E15). The roster looking complete when it is not is worse than it looking
  empty.
- **A sponsor who has left.** `sponsor_member_id` is free text on the member
  record pointing at a number that may now be `LAPSED` or `REVOKED`, or that may
  not resolve at all after the import. The roster shows the string. Filtering by
  sponsor must not imply the sponsor is current.

---

## E14 — Member record carrying service history and contact details

**Status: Part. The record exists; "service history" means two dates and the
board has to decide whether it should mean more.**

### What it must do

One record per member, holding what the organization actually needs: how to
reach them, which membership class they are in and on what basis, and the
service dates that the exemption tests are computed from. Every field traces to
a named workflow. No field exists because it seemed useful.

### Acceptance criteria

1. The member record holds name, email, phone, category, qualifying
   relationship, service from and to, derived war-veteran status, attested
   war-veteran status, standing, sponsor, joined date, payment-cleared date and
   last-audited date.
2. `is_war_veteran` is derived and never writable from a form. A member who
   ticked the box while their dates say otherwise shows as "disagrees" on the
   roster and is counted on the composition report rather than silently
   corrected. (`tests/membership.test.ts:708`.)
3. There is **no** rank field, **no** unit field, and **no** document or
   attachment of any kind on this record. Grep the schema; zero matches.
4. Nothing on this record appears on a public-tier page. There is already a test
   that fails the build on that.
5. Every row-level read of a member record is in `membership_audit`.
6. A record with a veteran category and no service dates is counted as a finding
   on the composition report, not hidden. (`CompositionReport.missingServiceDates`.)

### What exists

`Member` in `src/lib/membership/types.ts` and the `member` table in
`migrations/0003_membership.sql`. The 30-day record audit at
`/board/membership/audit` checks exactly these fields and records a finding or a
pass.

### What is missing or undecided

- **"Service history" in the contract is two dates.** No branch, no component, no
  unit, no rank, no deployments, no awards. That is deliberate — a field that
  exists is a field that leaks, and the only service data any built workflow
  needs is enough to derive wartime status. If the board means something richer,
  **every additional field is an OPSEC decision and a privacy-policy change, and
  it goes to the board and to counsel, not into a sprint.** My recommendation is
  that we collect nothing further.
- **No postal address.** Nothing in membership needs one. The store will.
- **No contact preferences and no do-not-contact flag.** Somebody will ask to
  stop receiving things and today there is nowhere to record it. Small, real, and
  I would build it with E30.
- **Nothing is encrypted at rest beyond what D1 gives us.**
  `PRIVACY-AND-PAYMENTS.md` requires MEMBER_PII encrypted at rest because under
  NC's ITPA encryption is built into the definition of a breach and functions as
  a safe harbour. The `credential` table's comment says the TOTP secret is
  "encrypted at rest with a key held as a Worker secret" — **the code stores the
  raw base32** (`beginEnrolment` binds `secret` directly). That is an auth-lane
  defect, not mine, but it sits next to my data and I am recording that I saw it.
- **No retention rule.** `PRIVACY-AND-PAYMENTS.md` requires a retention period
  per data class enforced by a scheduled job. For declined applicants, nobody has
  set one. **The board sets retention; counsel confirms.**

### Edge cases that will actually happen

- **A member who changes their name.** No field, no history, no path. It will
  happen and the roster will be wrong until somebody edits the database by hand.
  Goes with E30.
- **A member who dies.** There is no deceased state, and `LAPSED` is both wrong
  and unreachable (see E29). A family member calling to tell us is a real call
  with no answer on this platform.
- **A record imported with no service dates at all** (E15). Counted as a finding
  and excluded from the war-veteran numerator, which is correct and which will
  make the 90% test look worse on import day than it did the day before. Expect
  that and explain it before it appears, not after.

---

## E15 — Roster and application history migrated off Submittable

**Status: Not built, and not startable. Nobody has seen the export.**

### What it must do

Every membership application Submittable holds, and the roster the organization
actually works from, land in this platform as records a chair can act on — with
every record whose provenance is "imported" visibly marked as imported, and with
a reconciliation that two officers have signed before the old system is turned
off.

### Acceptance criteria

1. A dry run against a copy of the database produces a reconciliation sheet:
   records in the export, records imported, records rejected, and the reason for
   every rejection. No row is unaccounted for.
2. The counted member total after import matches the roster the organization
   works from today, and the Treasurer and VP Membership both sign that number.
3. Every imported record is marked as imported and carries its Submittable
   identifier, so any figure can be traced back.
4. The composition report runs after import and its denominator, its three test
   results and its excluded-record count are all explainable line by line.
5. The member-number counter is primed, **per year**, to the highest number used
   in that year. Allocating a new member number immediately after import produces
   a number that is not already taken.
6. No file from Submittable is stored by this platform. Zero attachments
   imported.
7. The import is idempotent: running it twice produces the same roster, not two.

### What I need from the export, before anything is designed

Ordered by how badly its absence hurts.

1. **A full export, not a filtered view** — every submission, every form, every
   status (draft, in review, accepted, declined, withdrawn), from the first to
   the last, with no date window applied by whoever pulls it.
2. **The form definitions, for every version the form has ever had.** A
   volunteer-run intake changes over years. Old submissions carry fields that no
   longer exist and are missing fields that now do. Without the definitions, the
   answers are unlabelled strings.
3. **Per record:** Submittable's internal id, submitted timestamp *with its
   timezone*, applicant name, email, phone, every answer, the status, the
   decision and its date, who decided it, reviewer notes and scores, internal
   labels and tags.
4. **An attachment manifest — filenames and types — delivered and reviewed
   before any file is downloaded.** This is a hard stop. If there are DD-214s in
   that account, they carry full SSNs for anyone discharged before roughly 2015,
   and `PRIVACY-AND-PAYMENTS.md` forbids this platform ever ingesting one. They
   must not be imported, must not be staged, and must not be copied anywhere in
   our infrastructure. **What happens to them inside Submittable before the
   account closes is a board decision with counsel**, and it needs answering
   before the subscription lapses.
5. **The authoritative roster, which is probably not Submittable.** Submittable
   is an intake tool. The actual list of who is a member today is likely a
   spreadsheet, the Wix member list, or the Treasurer's payment records. I need
   to be told which one is authoritative, by name, and I expect the real work of
   E15 to be reconciling it against the intake history rather than parsing a CSV.
6. **Existing member numbers**, if any, and the pattern behind them.
7. **Payment records** — who paid, when, how much, through which processor — so
   that `joined_at` and `payment_cleared_at` are facts rather than the import
   date. The 30-day audit clock and the probationary cohort both run off
   `payment_cleared_at`.
8. **Format, encoding and escaping:** CSV or JSON, delimiter, how multi-line
   answers and embedded commas are escaped, character encoding, and the date
   format and timezone.

### What could go wrong, and what I will do about it

- **Field drift breaks the exemption tests.** Older records will have no
  membership category, no relationship, no service dates — and those four fields
  are exactly what the 75%, 97.5% and 90% tests are computed from. An import that
  writes a default would quietly change a compliance figure. **Rule: the import
  never guesses.** A record with no category imports with the category unknown
  and is **excluded from the denominator**, counted in
  `CompositionReport.excludedRecords`, and listed for the chair to chase. A
  blanket default of `NON_QUALIFYING` would destroy the exemption on paper; a
  blanket default of `VETERAN` would be a false statement to the IRS.
- **Counter collision.** `PHASE2-FINDINGS.md` section 5 warns about this and the
  detail is worse than it reads: `nextMemberId` allocates from
  `membership:member_id:${year}`, so the counter is **per year**. Every year
  present in the imported roster needs priming separately, or the first new
  member in some year collides with the `member_id` unique index — and that write
  happens in `createMember`, i.e. **after the money has been taken**.
- **Duplicate humans.** `member.email` is indexed and not unique. Shared family
  mailboxes and people who applied twice over the years will both produce them.
  The import must report duplicates for a human to resolve and must not merge
  them automatically.
- **Sponsor references will not be member numbers.** They will be names, or
  blank. Import them as null rather than fabricating an id, and accept that
  imported members have no sponsor chain.
- **Status mapping is not obvious.** Submittable's statuses do not map onto the
  nine membership states, and "accepted" is not "paid". The mapping table is
  written and signed by the chair **before** anything is written, not inferred
  during the run.
- **Timezone drift.** Submittable timestamps may be local. One day of drift moves
  the 30-day audit clock and, at a period boundary, flips a wartime derivation.
- **No vouch history exists**, so every imported member has an admission with no
  recorded basis. The record must say "imported, no vouch on file" rather than
  look like a vouched admission. That needs a provenance column — **a migration,
  which I may not write.** Reported to the migrations owner.
- **There is no rollback.** Nothing in this schema is ever deleted and
  `membership_audit` is append-only by trigger. A bad import cannot be undone,
  only superseded. Hence the dry run against a copy, and two signatures.
- **Do not cancel the subscription first.** Treasury carries a `sub-submittable`
  row with a renewal date; that date is the real deadline and it should be on the
  compliance calendar, with the export verified well before it.

### Edge cases that will actually happen

- **An applicant mid-flight on cutover day** — submitted to Submittable, not yet
  decided. Either the chair clears the Submittable queue to empty before cutover,
  or those applicants are re-entered here and told. I would clear the queue; a
  record re-entered by hand has no applicant consent trail behind it.
- **A lapsed member who reapplies after the import.** This is the case that makes
  the `DUPLICATE_EMAIL` flag matter: today the flag is computed from the
  `application` table only, so an imported member with no application row behind
  them will not raise it. **The import must either create application rows for
  imported members, or the duplicate check must also read `member`.** I prefer
  the second: it is a small change to `countApplicationsByEmail` and it does not
  fabricate applications that nobody submitted. Either way it is a change to the
  repository contract and I am recording it as a known dependency rather than
  letting it be discovered.
- **A member in the export who should never have been admitted** — wrong
  category, no qualifying basis. Importing them makes it our figure. The
  reconciliation sheet has to surface them before the chair signs, not after.

---

## E25 — Member sign in by email and password
## E26 — Google and Apple sign in

**Status: Not built, and I recommend they are not built. Amend the contract.**

I am taking these two together because they are one decision.

### What the contract says, and what exists

E25 says email and password. E26 says Google and Apple. What exists is a
**passwordless** flow: a single-use link to the address we hold, then a
time-based one-time code from an authenticator app.
`src/lib/auth/tokens.ts`, `src/lib/auth/store.ts`, `src/lib/auth/totp.ts`,
`src/app/sign-in/**`. There is no password field anywhere in the codebase, no
OAuth client of any kind, and no `password` column. This was a decision, recorded
in `docs/ARCHITECTURE.md` ("Auth.js became our own session layer") and on the
sign-in page itself. It is not an oversight and it is not half-finished work.

These do not agree and I am not going to write a requirement that pretends they
do.

### My recommendation: amend E25 and E26

**On passwords.** The sensitive asset on this platform is the roster — who
belongs to this community. A password database for several hundred volunteers is
a thing an attacker can steal and work on offline at leisure. What we have
instead is a table of SHA-256 hashes of single-use tokens that expire in fifteen
minutes; a dump of it is worth nothing. More practically: this membership will
reuse passwords, they will reuse them from accounts that have already been
breached, and we will be running a password-reset help desk staffed by
volunteers. The contracted line asks us to take on a liability in exchange for
familiarity.

The outcome the line is really specifying — *a member signs in with their email
address and reaches their own record* — is delivered by what is built. The
difference is the second half of the credential, and ours is the stronger half.

**On Google and Apple.** Four reasons, and the first is the one that decides it.

1. **Our identity model is the email address on the roster.** `person.email` is
   `UNIQUE` and is the whole identity. An OAuth identity whose email does not
   match a roster row leaves two options: dead-end the member, or create an
   account from an external identity — which is self-registration, which
   `src/lib/auth/store.ts` deliberately does not have, because an open sign-up
   form on a platform whose roster is the sensitive thing is a way to enumerate
   it. Neither option is acceptable, and this population's addresses on file are
   frequently not Google addresses.
2. **Vendor.** `ARCHITECTURE.md` requires a vendor be confirmed before it is
   added, and `PRIVACY-AND-PAYMENTS.md` requires the privacy policy to name the
   actual subprocessor chain. Two identity providers is two subprocessors, two
   contracts and two entries in the policy, for a sign-in that already works.
3. **Cost and ongoing administration.** Sign in with Apple requires an Apple
   Developer Program membership, renewed annually, with a verified domain and
   key rotation. That is a recurring bill and a recurring task for a volunteer
   board — exactly the class of thing that lapses and takes a login with it.
4. **It buys nothing we do not have.** The member still has to reach a mailbox we
   hold, because we will not grant access to an account we cannot match to the
   roster. The social button saves a click and adds a dependency.

**What I would put in the contract instead:**

> E25. Member sign in by email address, without a password: a single-use link to
> the address held on the roster, with a second factor.
> E26. No third-party identity provider. Reviewed again if the board asks for
> one, with the subprocessor and annual-renewal cost stated.

**Who decides:** this is a change to what is delivered against a signed statement
of work. That is a commercial matter and it is explicitly not delegated
(`MODULE-BRIEF.md`). I recommend; the President and whoever holds the contract
decide. I am happy to be in the room.

### The cost of my own position, stated plainly

A TOTP authenticator app is a genuine barrier for parts of this membership, and
"open your authenticator" is a support call I will personally be taking. The
honest version of my recommendation is therefore two-tier:

- **Board tier keeps the link plus TOTP.** Non-negotiable; those accounts reach
  the roster.
- **Member tier should be the link alone, with a short session**, because a
  member reaching only their own record is a different risk than a chair reaching
  everybody's.

I cannot make that change myself: `ARCHITECTURE.md` says "member — auth + MFA",
and `src/lib/authz/**` is never delegated. **It needs the board's decision and
the authz owner's review.** If the answer is that members keep TOTP, I will build
it and I will own the support load, but somebody should make that choice
knowingly rather than inherit it from a line in an architecture document.

### Acceptance criteria (for the amended E25)

1. A member enters the address on their roster record and receives a sign-in
   link within five minutes.
2. An address that is **not** on file produces the identical response, identical
   wording, identical timing, and no email. (`src/lib/auth/actions.ts`
   `SAME_ANSWER`.)
3. The link works once. Opening it twice, or from two browsers, signs in once.
   (`consumeLoginToken` marks and reads in one statement.)
4. The link expires in fifteen minutes.
5. The database holds no usable credential: `login_token` and `session` store
   SHA-256 hashes, not the token.
6. A session that has only proved the email can reach the second-factor screens
   and nothing else. (`mfa_passed_at` is null; the policy layer refuses.)
7. A new member created by E11 can do all of the above with no volunteer
   involvement. **Fails today — E11.**

### Edge cases that will actually happen

- **A member whose address on file is dead.** They cannot sign in and cannot tell
  us, because telling us requires signing in. There must be an out-of-band route
  — a phone call to the chair, a verified change, logged. That is E30 and it is a
  prerequisite, not a nicety.
- **Two members sharing a mailbox.** `person.email` is `UNIQUE`. The second
  cannot have an account. No design exists. **The board decides whether a
  household can have two accounts, and if so, how a second one is identified.**
- **A forwarded sign-in link.** Single-use and fifteen minutes limits it, and
  whoever opens it first is in. A member forwarding their own link to a spouse to
  "check something" is the realistic case, and the second factor is what stops it
  mattering — which is an argument against dropping TOTP at member tier that I am
  recording against my own recommendation above.

---

## E27 — Password reset and secure session handling

**Status: Session handling built. "Password reset" does not apply. The real gap
is recovery, and it is unbuilt.**

### What it must do

Read as written, half of this is void: there is no password to reset. The need
behind it is real and does not go away — **a member who has lost access gets it
back, through a route that is safe and that somebody owns.** And a session, once
started, behaves itself.

### Acceptance criteria

**Sessions (should pass today, against D1, in a Worker — not yet verified):**

1. The session cookie is `httpOnly`, `secure`, `sameSite=lax`, path `/`.
2. Sessions expire after twelve hours. A session created at 19:00 does not work
   at 08:00 the next day.
3. Signing out revokes the session server-side, not only in the browser, and the
   revoked token does not work afterwards.
4. The `session` table holds a hash. A reader of the table cannot sign in as
   anybody.
5. A session without `mfa_passed_at` is refused everything except the
   second-factor screens.
6. Six-digit codes are validated against RFC 4226 and 6238 published vectors.
   (`tests/auth.test.ts`.)
7. Code comparison is constant-time and does not exit early on a wrong digit.
   (`src/lib/auth/totp.ts` `constantTimeEqual`.)

**Recovery (fails today):**

8. A member who has lost their authenticator has a documented route back, it is
   logged, and it is not "email the chair and hope".
9. Resetting a second factor requires a named officer's action and leaves a
   record naming them.
10. A member who believes their account is compromised can have every session
    revoked, and that revocation is visible.

### What exists

- `src/lib/auth/tokens.ts`, `src/lib/auth/store.ts` — hashed single-use tokens,
  hashed sessions, consume-not-check, MFA gate separate from the session.
- `src/lib/auth/totp.ts` — RFC-conformant TOTP checked against the published
  vectors, with a one-step drift window and constant-time comparison. This is
  careful work.
- `revokeAllSessions(personId)` — written, **called from nowhere**. Another
  function that exists without a route to it.

### What is missing or undecided

- **No device-loss recovery.** `beginEnrolment` refuses to replace a confirmed
  credential — correct, because silent re-enrolment is how somebody with a live
  session locks the owner out — but there is no deliberate revoke-and-re-enrol
  path exposed anywhere, for any role. The first member who changes phones is
  stuck, permanently, and so is the first board member. **This will happen within
  weeks of go-live.**
- **No backup codes, and I would not add them casually** — a printed list of
  codes in a drawer is a credential with no expiry.
- **No rate limiting** on link requests or code attempts that I can find.
  Six digits with a three-step window is a small space.
- **`revokeAllSessions` is unreachable.** It should be on an admin screen and on
  the member's own screen (E28).
- **The TOTP secret is stored raw.** `migrations/0001_identity_and_audit.sql`
  says the column holds a secret "encrypted at rest with a key held as a Worker
  secret"; `beginEnrolment` binds the base32 string straight in. The comment
  describes a control that is not there. **Auth lane, reported here because the
  schema comment will otherwise be believed.**
- **Who may reset a second factor?** Not me — the roster's owner resetting
  authentication for roster-holders is a bad separation. My recommendation: the
  President or the Secretary, logged and notified to both. **The board decides.**

### Edge cases that will actually happen

- **New phone, old authenticator gone.** The common case. No path.
- **A board member leaves mid-dispute.** `disabled_at` on `person` stops new
  sign-ins; live sessions last up to twelve hours. `revokeAllSessions` is what
  closes that window and nothing calls it. Revoking a role grant should call it.
- **A member who changes their email and loses sign-in.** Covered in E30 —
  because it is a contact-details problem that presents as an authentication
  problem, which is exactly why it will be reported to the wrong person.

---

## E28 — Member views their own status and renewal date

**Status: Not built. The renewal half may not be buildable at all.**

### The contradiction that has to be settled first

The contracted line assumes membership renews. This organization's own public
page says it does not: `/jsoa/membership` reads "One payment, no renewal" and
lists "Renewal: None". `src/lib/membership/types.ts` calls `DUES_AMOUNT_CENTS` a
one-time lifetime payment and says the payment page "said 'annual' in three
places, which is the difference between billing somebody once and billing them
every year". And `/apply/submitted`, the page every applicant sees, **still
says "Dues are $200 a year"** today.

So we currently publish three different answers to "what does membership cost
and how often", and this is already a standing board item
(`plan-dues-period` in `src/lib/membership/workspace.ts`).

**There is no renewal date because there are no renewals.** If the board confirms
lifetime membership, E28's renewal clause should be amended to "membership
standing and the date dues cleared" and E29 should be struck or redefined (see
E29). If the board decides membership becomes annual, that is a far larger change
than a date field: it needs a lapse rule, a renewal payment, reminders, and a
state transition that **does not currently exist in the state machine**.

**Who decides: the board sets dues. Until they do, half of E28 and all of E29 are
unbuildable, and I will not guess.**

### What it must do (the part that is buildable today)

A signed-in member sees their own record and nothing else: their member number,
their standing in plain words, when they joined, when their dues cleared, and the
contact details we hold. No other member's anything.

### Acceptance criteria

1. A signed-in member at their own page sees their number, standing, joined date
   and the contact details on file.
2. Changing the id in the URL to another member's shows nothing — not a different
   record, not an error that confirms the record exists.
3. A `PROBATIONARY` member and a `GOOD_STANDING` member see the **same** access
   and are not told they are on probation. The 30-day audit is a check on the
   record, not a probation the member serves
   (`MEMBER_ACCESS_STATES` in `state.ts`), and telling them otherwise would be
   making them wait for something they have paid for.
4. A member whose record carries a held audit finding sees their standing
   unchanged, because it is.
5. Opening one's own record writes an audit entry whose subject is that member.
6. A signed-in member cannot reach any roster screen, any queue, or any other
   member's record.
7. Where a renewal date would be, the page states the dues basis as the board has
   minuted it. Today that sentence cannot be written.

### What exists

Essentially nothing. There is **no `/members` route**
(`docs/ASSOCIATION-SITE-REMAP.md` plans one; it was never built). The `MEMBER`
role holds **no grants at all** in `src/lib/authz/model.ts` — the note says
member-tier access is "scoped by ownership of the record", and the
ownership-scoped authorization path does not exist. `member.person_id` is never
written (E11), so there is no link from a signed-in person to their record even
if the page existed. The store's member gate reads membership state through
`viewerHasMemberAccess` and proves the pattern works, but it runs off a dev
viewer, not a session.

`docs/BOARD-REVIEW.md` finding 3 already caught the consequence: the store
promises "Members: sign in for the full catalogue" and that sign-in does not
exist anywhere on the site.

### What is missing or undecided

- The whole member tier: route, ownership-scoped policy path, `person_id` link.
- **The dues question** above.
- Whether a member may see their own audit trail — who in the office has opened
  their record. I think they should; it is their data, and we log the reads
  precisely because reads matter here. **Worth a board view, as it sets a
  precedent.**

### Edge cases that will actually happen

- **A member whose record was imported with no service dates** opens their page
  and sees blanks. That is an invitation to fix it, which is good, but only if
  E30 exists. Otherwise it is an invitation to phone me.
- **A lapsed member signs in.** They still have an account; the roster says
  `LAPSED`. The page must say so plainly and say what to do about it — and today
  there is nothing to do about it, because there is no reinstatement path.
- **An applicant who has paid but whose record is not created** because the
  webhook failed. They have a receipt and no membership. The page must not claim
  they are not a member; it has to be able to say "we have your payment and your
  record is being created", which means the payment and the record need to be
  reconcilable by someone on the phone.

---

## E29 — Member renews their own membership

**Status: Blocked, and probably void as written.**

### What it must do

As contracted: a member whose membership is expiring pays and continues without
contacting anybody.

**If membership is for life, this function does not exist** and should be struck
from the statement of work rather than built as a page that says "nothing to do".
I would rather hand the client back a line than deliver a screen that exists to
apologise for itself.

**If the board decides membership becomes annual**, E29 is not one feature. It is:

- a renewal due date on the member record;
- a lapse rule — how long after the due date, and what happens in between;
- a transition into `LAPSED`, which **does not exist in the state machine**. I
  checked: `LAPSED` is in `MEMBERSHIP_STATES` and appears in the terminal case
  list of `next()`, and **no event produces it**. The only lapsed members in this
  system are two seeded records
  (`src/lib/membership/seed.ts:123`) created already lapsed. There is no code path
  that can lapse anybody;
- a reinstatement rule — pay and resume, or reapply (this is also E08 question 11
  and E11's duplicate-record problem);
- renewal reminders, which need the mail queue that does not exist;
- a second payment flow, where the existing one is built for an *application*
  (`CheckoutHandoff.applicationId` is not nullable, so a renewal payment has no
  shape in the current schema — a migration, which I may not write);
- a decision on what a member who does not renew loses and when. The store gate
  reads membership state directly, so this is not only a membership question.

And it is retrospective: if membership becomes annual, what happens to the
members who were sold a lifetime membership? **That is a board and counsel
question before it is a software question.**

### Acceptance criteria

Not written. I will write them when the board has answered the dues question. A
tester cannot run a criterion against a policy that does not exist.

### What exists

The payment machinery that a renewal would reuse — `src/lib/membership/payment.ts`,
the handoff table, the non-deductibility disclaimer, the integer-cents
discipline. All of it is built around an application, not a member.

### Edge cases that will actually happen (if it ever ships)

- **Somebody renews twice**, or renews after a reminder they had already acted
  on. The handoff must be idempotent per period.
- **Somebody pays after lapsing.** Is that a renewal or a reapplication? The
  answer changes whether a sponsor is needed again, and it changes the
  composition count.
- **A member dies and the renewal reminder goes out anyway.** There is no
  deceased state (E14). This one costs more than a bug report.

---

## E30 — Member updates their own contact details

**Status: Not built, and the email case is the one that will hurt.**

### What it must do

A signed-in member changes the email address and phone number we hold, without
help, and without that change being a way to take over an account or to silently
detach a person from their roster record.

### Acceptance criteria

1. A signed-in member changes their phone number; the roster shows the new one
   immediately and the change is in the audit log with the member as both actor
   and subject.
2. A member changes their email. **Both** `member.email` and `person.email`
   change, atomically, or neither does.
3. The new address is **verified before it takes effect**: a confirmation link to
   the new address, and the old address keeps working until it is used.
4. A notice goes to the **old** address telling them the change happened and whom
   to contact if it was not them.
5. Changing to an address that already belongs to another person is refused
   without disclosing that it belongs to someone.
6. A member cannot change their name, category, service dates, standing or
   sponsor from this page. Those are chair-side with a reason recorded.
7. No field on this form appears on any public page.
8. A member can revoke all their other sessions from this page.

### What exists

Nothing for the member. And nothing for the chair either: the repository
interface has **no method that updates a member's email or phone**. The only
member writes are `createMember` and `setMemberState`. Today, correcting a
typo'd email on the roster means editing the database by hand — and that edit
does not appear in `membership_audit`, because it did not go through the
application.

### What is missing or undecided

- A member-tier route (shared with E28) and the ownership-scoped policy path.
- `updateMemberContact` on the repository, with the audit entry.
- The email-change flow: verify-new, notify-old, keep-old-until-used, and the
  two-table atomic update.
- **A chair-side correction path** with a reason recorded. Needed on day one,
  independently of the member-facing version, because E15 will land records with
  bad addresses in them.
- Contact preferences and a do-not-contact flag (E14).
- **Who may change an address out of band**, for the member who cannot sign in
  because the address is dead. My view: the chair, after a phone call, with the
  change logged and a notice to the old address, and never on an emailed request
  alone — an emailed request to change an email address is the attack. **The
  board should bless that procedure, because it is a procedure before it is a
  feature.**

### Edge cases that will actually happen

- **A member changes their email and loses sign-in.** The headline case.
  `person.email` is the identity; `member.email` is the roster contact. They are
  separate columns in separate tables with nothing keeping them together. Change
  one and the member either cannot sign in or is signed in as somebody whose
  roster record now shows the wrong address. If the verification link goes to the
  new address and the new address was typed wrong, they have locked themselves
  out with no way to tell us — hence the old address continuing to work until the
  new one is confirmed. **Build it in that order or do not build it.**
- **A `.mil` address that stops working on retirement.** Extremely common here.
  Members should be prompted to put a personal address on file, and the chair
  needs a view of addresses that have started bouncing.
- **A spouse updating the record.** It will happen, often with the member sitting
  next to them. The controls above do not stop it and should not try to; the
  notice to the old address is what makes it visible.
- **A member who changes their email to one that another member already uses** —
  a couple consolidating. Refused by the unique constraint, and the refusal must
  not confirm who holds it. Related to the household question in E25.

---

## What this office needs from other people, collected

So it can be read in one place at a meeting.

| # | Decision | Who |
| --- | --- | --- |
| 1 | The written vetting standard: the thirteen questions in E08 | Board, with counsel on 6, 9, 12 and the Treasurer on 4 |
| 2 | Dues: one payment for life, or annual. Settles E28 and E29, and corrects three contradictory published statements | Board |
| 3 | Amend E25 and E26 to passwordless, no third-party identity provider | President and the contract holder, on this paper |
| 4 | Whether member tier requires TOTP or the link alone | Board, with the authz owner |
| 5 | Whether a membership committee exists, and therefore whether E09's assignment has anyone to assign to | Board; role grants by the President |
| 6 | What a revocation means, so the 30-day audit has an outcome other than hold | Board, per the bylaws; already standing as `plan-revocation-meaning` |
| 7 | What a declined applicant is told | Board |
| 8 | Whether a roster export exists, and whether a member directory exists | Board |
| 9 | Re-admission: does a returning member reinstate or get a new record | Board |
| 10 | Retention periods for declined applicants and for application history | Board, confirmed by counsel |
| 11 | What happens to Submittable attachments before the account closes | Board, with counsel |
| 12 | Which list is the authoritative roster today | VP Membership and the Treasurer, named in a minute |
| 13 | The `/apply` cutover date and the Submittable cancellation | VP Membership proposes, Webmaster executes, President approves |
| 14 | Who may reset a member's second factor | Board; not VP Membership |

## Things I found that belong to other lanes

Recorded so they are not lost, not because they are mine to fix.

- **The TOTP secret is stored raw** while the schema comment says it is encrypted
  at rest with a Worker secret. `src/lib/auth/store.ts` `beginEnrolment` against
  `migrations/0001_identity_and_audit.sql`. Auth lane.
- **`revokeAllSessions` is called from nowhere.** Revoking a role grant should
  call it. Auth lane.
- **`/apply/submitted` tells every applicant dues are "$200 a year"**, against
  the public page's "One payment, no renewal". That page is mine and the sentence
  is wrong either way until the board settles the dues question — I have not
  changed it, because changing it would be picking the answer.
- **The vouch sweep runs on page load**, not on a schedule. It needs a cron
  trigger. Infrastructure.
- **No D1 repository has run inside a Worker** and no board screen has been
  rendered against a database (`PHASE2-FINDINGS.md` section 7). Every acceptance
  criterion above has to be run a second time once that is true.
