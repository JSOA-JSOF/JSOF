# Scholarships Chair — requirements for E48 to E53

27 October 2026. Written by the Scholarships Chair against the six functions
her office holds under the signed statement of work. Everything here is
checkable against the repository as it stands today; where a claim is a
judgement rather than a fact, it says so.

## The test every requirement here has to pass

The intake of 27 September named two tasks as the most draining in the role,
and neither of them is a judgement call:

1. **Emailing each student their award amount.** 183 of them, retyped by hand.
2. **Mailing cheques to schools.**

Nothing in this document is worth building unless it reduces one of those two.
Where a contracted line does not, that is said in its section rather than
dressed up.

## The numbers this document is written against

From the Chair's own intake, 27 September 2026, and restated in
`docs/ARCHITECTURE.md` lines 261-263:

| Fact | Figure |
| --- | --- |
| Applications a cycle | ~150 |
| Merit awards | 119, $500 to $2,500, occasionally $5,000 |
| Wounded Patriot awards | 64, flat amount |
| Total awards | 183, across 150 applicants |
| Scorers | the Chair plus four others = 5 |
| Chair's time | ~40 hours a month January to June, ~3 the rest of the year |
| Current tool | Submittable, ~$9,000 a year |
| Continuity | a backup chair exists; the role has been swapped before |

An applicant may hold a Merit award, a Wounded Patriot award, both, or
neither. 183 awards across 150 applicants is not an error in the arithmetic;
it is the design.

## Three facts that cut across all six functions

**The module is a library with four screens, not a system.** The business
logic in `src/lib/scholarships/**` is written, tested and in most places
better than it needs to be. The screens are thin. Several functions the
contract depends on — proposing an award, approving one, recording a
full-board decision, building the cheque run, marking a cheque mailed,
declaring a conflict, running the retention purge — exist in the library with
tests against them and **have no screen at all**. They cannot be reached by a
volunteer. Each section below says which of its functions are in that state.

**The application never changes state after it is submitted.**
`updateApplication` is called in seven places and every one of them is in
`src/lib/scholarships/intake.ts`. Nothing in the module sets `IN_REVIEW`,
`SCORED`, `AWARDED`, `NOT_AWARDED` or `WITHDRAWN`. Those states exist in
`APPLICATION_STATES` and only `src/lib/scholarships/seed.ts` ever writes them.
This single gap is why E49 has no progress to track, why E52 cannot tell an
unsuccessful applicant anything, and why E53's retention clock never starts.
It is the highest-value fix in this document and it is one small state machine.

**Against a real database there is no cycle and no school.** The repository
interface in `src/lib/scholarships/repository.ts` has `listCycles`,
`currentCycle`, `listSchools` and `getSchool`, and **no method that creates
either**. `repository.d1.ts:792` throws `"No scholarship cycle is configured"`.
This is finding 1 of `docs/PHASE2-FINDINGS.md` wearing scholarship clothes, and
it means the apply form 500s on the first request against a fresh database. It
must not be fixed by loading `seed.ts`: that would put 150 invented applicants
and fictional schools into a live system.

---

# E48 Scholarship submission intake

## What it must do

A student answers three routing questions before giving a name. If they are a
North Carolina resident at a North Carolina school, they are sent to the
Patriot Foundation and no record of them is created. Everyone else gets a
staged form that asks only for what their programme needs: Merit always,
Wounded Patriot only if they said they were applying for it, guardian consent
only if they are under 18. Under 13 the form stops and keeps nothing. On
submission the sponsoring member's ID is checked against the membership roster
automatically — today the Chair opens a spreadsheet, and she named this as her
single biggest automation ask. The acknowledgment is identical whatever the
roster says.

## Acceptance criteria

- Three routing questions render before any field that collects a name. A
  tester answering "NC resident = yes, NC school = yes" reaches
  `/apply/scholarship/patriot-foundation` and `listApplications()` returns zero
  new rows.
- A date of birth making the applicant 12 discards the draft and renders the
  under-13 notice. `getApplication(id)` afterwards returns null.
- An applicant who said yes to Wounded Patriot sees a Wounded Patriot step; one
  who said no never sees it and never sees it appear later.
- An applicant aged 17 cannot submit without a `guardian_consent` row carrying
  the guardian's own name, email and phone. The refusal is not clearable by
  ticking a box.
- 150 applications submitted in a cycle each produce exactly one
  `scholarship_sponsor_check` row with `checked_at` set, with no manual step.
- Two applications in one cycle from the same email both succeed, and the
  second carries the `DUPLICATE_EMAIL_THIS_CYCLE` flag. The applicant is told
  nothing about the first.
- Submitting with a well-formed but unknown sponsor ID and submitting with a
  real one produce byte-identical acknowledgment pages.
- Against an empty database, the apply route renders a form rather than an
  error. **This fails today.**

## What already exists

- `src/lib/scholarships/routing.ts` — the three questions, the Patriot
  Foundation decision, `programsOpenTo`. Complete.
- `src/lib/scholarships/intake.ts` — the step model, per-step saves, the
  automatic sponsor check on submission, the guardian refusal. Complete and the
  best-covered part of the module.
- `src/lib/scholarships/minors.ts` — age gate, under-13 refusal, guardian
  consent statement versioned `2026-10-v1`.
- `src/app/apply/scholarship/page.tsx`, `actions.ts`, `draft.ts` — the real
  multi-step form, plus `/not-yet`, `/patriot-foundation` and `/submitted`.
- `migrations/0007_scholarships.sql` — section tables, and
  `migrations/0010_routing_answers.sql` which added the three routing answers
  as columns. Finding 2 of `docs/PHASE2-FINDINGS.md`: 0007 stored the routing
  outcome and discarded the answers, and `routing.ts:145` recomputes from
  `applyingForWoundedPatriot`, so the Wounded Patriot intake step would never
  have appeared and nothing would have thrown. Fixed before it shipped.

Honest about stubs:

- **The form is switched off.** `src/middleware.ts:70` rewrites everything
  under `/apply` to `/not-yet` outside the `live` stage. A family reading
  "eligibility is under legal review" and then hitting a dead apply button
  concludes counsel has suspended the programme — that is finding 3 of
  `docs/BOARD-REVIEW.md`, and R10 is to make the control inert with a note
  rather than a live link into a wall.
- **No cycle, no schools.** See above. The enrolment step offers a school list
  that will be empty.
- Drafts live in a cookie (`draft.ts`) against repositories that hold state in
  `globalThis`. On Workers an isolate can be recycled between two requests and
  the application is gone with no error — the reason the gate exists.

## What is missing or undecided

| Missing | Who decides |
| --- | --- |
| `createCycle` and `createSchool` on the repository, plus a Chair screen to enter the real cycle dates and the real schools | Chair specifies, engineering builds. No board decision needed. |
| Whether the apply control is inert-with-a-note or live, before the cycle opens mid-December | Chair and Webmaster, per BOARD-REVIEW R10 |
| A routed address for the Scholarships Chair. `minors.ts` and `notify.ts` both publish `scholarships@example.org` and nobody reads it | Secretary, per BOARD-REVIEW R11 |
| Whether an applicant may withdraw. `withdrawnAt` exists on the schema and nothing ever sets it | Chair |
| Durable drafts, so a student can finish in two sittings | Engineering, needs the database |

## Edge cases that will actually happen

- **A student starts at 17 and submits at 18.** `stepsFor` recomputes
  `isMinor` from today's date on every render, so the guardian step disappears
  mid-form and `submitApplication` no longer demands consent. That is the right
  behaviour, but the `APPLICANT_IS_A_MINOR` flag set in `saveApplicantDetails`
  is a point-in-time fact that is now wrong on the record. The flag should be
  computed from the date of birth and the date asked about, not stored.
- **A student mistypes their sponsor's ID.** They get the same acknowledgment
  as everyone else, by design, and find out weeks later. The chair's queue sees
  `SPONSOR_ID_MALFORMED` or `SPONSOR_NOT_ON_ROSTER` immediately; there is
  currently no screen listing those flags for her to act on before scoring
  starts.
- **A sibling pair applies from one family email.** Both are accepted, both are
  flagged. This is correct and must stay correct.
- **A student at a school nobody has entered yet.** With no `createSchool`, the
  form has no answer. Expect this in the first week of every cycle.

---

# E49 Reviewer assignment and progress tracking

## What it must do

The Chair gives five people a pile of work and can see, at a glance, how much
of it is done and by whom. A scorer opens their own queue, is handed the next
file, and never sees a file they have declared a relationship to. The Chair can
see which applications are short of a full committee before the decision
deadline rather than after it.

## Acceptance criteria

- With 150 applications and 5 scorers, a scorer's queue page returns in one
  request and shows `remaining`, `reviewed` and `blocked` counts that sum to
  the number of reviewable files in the cycle.
- A scorer with a declared relationship to 3 applications sees 147 files, and
  the 3 appear in `blocked` by reference and relationship kind only — the
  applicant's name is not in the response.
- The Chair's overview shows, for a cycle of 150: how many have no sheet at
  all, how many are short of a full committee, and how many are complete. The
  three must sum to 150.
- A file the Chair has already decided still appears in a scorer's `done` list.
  Filtering on the award decision would empty the committee's queue in the
  middle of the cycle.
- Deliberately: "full committee" must be a single named constant, and changing
  it from 4 to 5 must change every count on every screen with no other edit.

## What already exists

- `src/lib/scholarships/review.ts` — `loadReviewQueue`, `reviewProgress`,
  `nextForReview`, `reviewerCalibration`. The conflict block is enforced twice:
  the file is excluded from the queue and `openReviewFile` throws
  `ConflictBlockedError` and writes the attempt to the log if it arrives
  anyway. The relationship is a declared row in `reviewer_relationship`, not a
  surname match.
- `reviewerCalibration` gives a scorer's running average against the cycle's.
  With five people and arithmetic bands, a scorer sitting ten points low moves
  money, and this makes that visible without exporting to a spreadsheet.
- `src/app/board/scholarships/review/page.tsx` renders the next file and the
  score sheet.

Honest about stubs:

- **There is no assignment.** Every scorer sees every submitted file in the
  cycle minus their own conflicts. The contracted word is "assignment" and the
  module does not do it. That may well be the right answer for five people and
  150 files, but it is not what the line says and the board should know.
- **`declareRelationship` has no screen.** The one function that drives the
  whole conflict block can only be called from a test. A scorer today has no
  way to declare a relationship, which means the block protects nothing in
  practice.
- **`FULL_COMMITTEE = 4`** in `src/lib/scholarships/board.ts:60`, and
  `kpis.ts:547` labels it "Applications scored by all 4 reviewers". The Chair
  said four scorers *besides her*. If she scores, the number is 5 and every
  "partly scored" count on every screen is currently wrong.
- Progress is counted from score sheets, not from application state, because
  no application ever leaves `SUBMITTED`. That works, but the Chair cannot
  distinguish "nobody has started it" from "we decided not to score it".

## What is missing or undecided

| Missing | Who decides |
| --- | --- |
| Does the Chair score? `FULL_COMMITTEE` is 4 or 5 and nothing else turns on it | **Chair. One line.** |
| A screen for `declareRelationship`, reachable by a scorer before they start | Engineering |
| A way to *withdraw* a mis-declared relationship. There is no delete on `reviewer_relationship` and no repository method; a wrong declaration is permanent and silently removes a scorer from a file for good | Chair specifies the rule; it needs an audited revoke, not a delete |
| Whether assignment is wanted at all, or whether a shared pool is the answer | **Chair.** If a shared pool, the contract line should say so. |
| A deadline view: files short of a full committee with N days to `decisions_by` | Chair specifies |

## Edge cases that will actually happen

- **A scorer is related to an applicant.** This is the case the design is built
  around and it is handled correctly in the library: the file is excluded from
  the queue, `openReviewFile` and `recordScore` both throw, and the refusal is
  written to `scholarship_audit`, which is append-only by trigger. The gap is
  that nothing lets them declare it in the first place.
- **A scorer is related to an applicant and does not say so.** Nothing detects
  it. The honest answer is that this is a governance control, not a software
  one, and the committee should be asked to declare against the reference list
  at the start of the cycle.
- **A scorer drops out in March.** Their partial sheets stay, the committee
  count never reaches 4, and every file they touched reads "partly scored"
  forever. There is no way to mark a scorer withdrawn.
- **Two scorers score 30 points apart.** `SPREAD_WORTH_A_LOOK = 20` flags it
  and `loadCycleExceptions` surfaces it. This works and is worth keeping.

---

# E50 Scoring against your defined criteria

**This function cannot be completed and the reason is not technical.**

The scoring engine exists and is finished. The criteria it scores against do
not exist, because the eligibility rule is with counsel and has not been
adopted. `src/lib/scholarships/eligibility.ts` returns `UNDETERMINED` for every
applicant, stamps `ruleVersion: "0-placeholder"` on the record, and says in
terms that a person decides. That is the correct behaviour and must not be
changed to make this line look delivered.

The two things are genuinely separable, and the rest of this section keeps them
separate.

## What it must do — the part that can be built now

Five published criteria totalling 100 points. An applicant can read what they
will be scored against before they write the essay; the same list is what a
scorer fills in. A committee average turns into a default award amount by
arithmetic, not by judgement, because the amounts are the expensive part. The
occasional $5,000 top award sits outside the bands and is designated by the
Chair, never reached by a score.

## What it must do — the part that cannot

Decide who is in the eligible class. Nothing in this module may apply an
eligibility rule until the board adopts one. Every screen showing an
eligibility outcome must also show that there is no rule behind it.

## Acceptance criteria — buildable now

- Five criteria, 30 / 25 / 20 / 15 / 10, summing to 100. A sheet scoring 31 on
  Academic Record is rejected with the criterion named.
- A non-integer or negative score is rejected. No float arithmetic touches a
  score anywhere; GPA is stored in hundredths (`3.87` is `387`).
- One sheet per scorer per application. A scorer submitting twice edits their
  own sheet; a second row is never created.
- A scorer cannot record a score on another scorer's behalf, even by posting
  their person id in the form.
- Committee average 92 previews $2,500; 71 previews $1,500; 49 previews no
  Merit award. The preview writes nothing.
- An application scored 96 by the committee shows as *eligible for* the top
  winner designation and is not awarded $5,000 unless the Chair designates it.
- A reviewer's file contains no disability evidence at any depth. Not redacted
  in the template, not hidden by CSS: absent from the response object.

## Acceptance criteria — blocked on counsel

- Every application in a cycle of 150 carries an `eligibility_rule_version`,
  and today every one of them reads `0-placeholder`.
- No source file in `src/lib/scholarships/**` contains the rule currently under
  review, in code or in a comment. There is a test asserting this.
- When counsel reports, adding criteria to `ELIGIBILITY_RULE.criteria` and
  flipping `status` to `PUBLISHED` must be the only change required. No call
  site branches on how the class is defined.

## What already exists

- `src/lib/scholarships/scoring.ts` — the five published criteria, the five
  bands, `TOP_WINNER` at $5,000, `committeeScore`, `SPREAD_WORTH_A_LOOK`.
  Complete.
- `src/lib/scholarships/review.ts` — `recordScore` with range assertion,
  one-sheet-per-reviewer, conflict re-check, no scoring on another's behalf.
- `src/lib/scholarships/eligibility.ts` — the placeholder, deliberately
  returning `UNDETERMINED`, with `EligibilityFacts` kept deliberately thin so a
  future rule cannot read the essay.
- `src/app/board/scholarships/review/ScoreSheet.tsx` and
  `actions.ts:submitScoreSheet` — a working write path.
- `migrations/0007_scholarships.sql` — `score_sheet` with
  `UNIQUE (application_id, reviewer_person_id)`, and `score_point` per
  criterion.

Honest about stubs:

- `WOUNDED_PATRIOT.amountCents` is `100_000` with `amountConfirmed: false`.
  **The flat Wounded Patriot figure was never supplied.** 64 awards a cycle are
  currently priced at a number somebody made up. It is a constant so that
  confirming it is a one-line change, and it needs confirming before the cycle
  opens.
- The band boundaries ($500 / $1,000 / $1,500 / $2,000 / $2,500 at 50 / 60 / 70
  / 80 / 90) are evenly spaced inside the Chair's stated range because the range
  was stated and the boundaries were not. They are a proposal, not a decision.

## The questions counsel must answer

This is the list to take to them. Each one blocks a specific thing.

1. **What defines the eligible class, if not membership of the Association?**
   `docs/ARCHITECTURE.md` records the advice that "dependent child of a current
   JSOA member" is the fact pattern used to deny or revoke 501(c)(3) exemption,
   and that approved analogues define the class by service connection and
   community. We need the replacement wording, not a direction of travel.
2. **May the sponsoring member's good standing be a criterion at all,** or only
   an administrative check? The platform collects it either way; whether it may
   *decide* anything is the question.
3. **Is the class different for Merit and for Wounded Patriot?** They are
   different programmes with different money and the schema holds them as
   separate sections.
4. **What objective, checkable criteria does the board adopt, and under what
   authority?** Each one becomes an `EligibilityCriterion` with a `key`, a
   `question` on the form and an `authority`. A criterion with no authority is
   somebody's opinion and does not belong in a charitable class.
5. **May an applicant be told why they are not eligible?** The record stores an
   explanation for exactly this. BOARD-REVIEW R18 says to drop "you will get an
   answer about your own situation" from the placeholder because it is a private
   ruling on an unpublished standard. Once the standard is published, is the
   answer restored?
6. **Does the adopted rule apply to the cycle opening mid-December 2026, or
   from the following cycle?** `eligibility_rule_version` exists so a decision
   can be explained after the rule moves; we need to know which version governs
   the cycle that is about to open.
7. **Is the rule published to applicants before they apply?** The scoring
   criteria are published on principle. If the eligibility rule is not, say so,
   and we will not publish it.
8. **What happens to the 150 applications already judged under
   `0-placeholder`** if counsel reports mid-cycle?
9. **Does the North Carolina Patriot Star routing need its own legal note?**
   BOARD-REVIEW R17: our legal hold and our calendar do not govern a Patriot
   Foundation award, and we currently route people there with no callout.

Questions 1 to 4 block the function. Questions 5 to 9 block the copy around it,
which is cheaper but not free.

## What is missing or undecided

| Missing | Who decides |
| --- | --- |
| The eligibility criteria | **Counsel, then the board adopts.** Nothing else. |
| The flat Wounded Patriot amount | **Chair, before the cycle opens.** |
| The band boundaries | Chair proposes, board confirms |
| Whether the Chair's own sheet counts toward the committee average | Chair |

## Edge cases that will actually happen

- **Counsel reports in February, mid-cycle.** Half the applications carry
  `0-placeholder` and half would carry `1-adopted`. The schema handles it; the
  policy question in item 8 above does not have an answer.
- **A scorer scores a file, then declares a relationship.** The sheet stays in
  the committee average. Nothing removes it. The rule should be that declaring
  a relationship voids that scorer's sheet, and it currently does not.
- **All five scorers score one file 50 and one scores it 90.** The average
  lands at 58, one point above a band boundary. `BAND_BOUNDARY_MARGIN = 3` in
  `board.ts` surfaces near-boundary cases, which is exactly why it exists.
- **An application with no sheets at all at the decision deadline.** It has no
  band, no award and no outcome, and nothing currently forces a decision on it.

---

# E51 Award decision recording

## What it must do

An award amount is a field on a record, set once from the band the committee
average falls in. Nobody types an amount anywhere, ever. The Chair proposes,
somebody approves, and the record carries who decided and when. An award to a
board member's dependent does not get approved by the Chair at all: it goes to
the full board with that member recused, and the record carries the minute it
was taken under and the names of the approvers.

## Acceptance criteria

- Proposing awards across a cycle of 150 produces 183 `award` rows and the
  Chair types no amount at any point. Every row's `amount_cents` traces to a
  band, to the Chair's top-winner designation, or to the flat Wounded Patriot
  figure, and `basis` says which.
- An award whose application has `board_member_person_id` set is created with
  status `BOARD_REVIEW`, not `PROPOSED`. `approveAward` on it throws
  `BoardReviewRequiredError` and names the recused person.
- `recordFullBoardDecision` refuses without a minute reference, refuses with
  fewer than 3 named approvers, and refuses if the recused member is among
  them.
- The person who requested the board review cannot be one of the approvers.
- An award left in `BOARD_REVIEW` that the board never reaches stays there.
  Nothing times out, nothing defaults to approved.
- The audit trail for one award, read back a year later, answers: what the
  committee average was, which band applied, who proposed, who approved, and
  under which minute.

## What already exists

- `src/lib/scholarships/awards.ts` — `proposalFor`, `proposeAwards`,
  `approveAward`, `recordFullBoardDecision`, `loadAwardsBoard`,
  `loadAwardRows`. The amount is a field, set from the band. The recusal path
  is the strongest-written code in the module: `FULL_BOARD_MINIMUM_APPROVERS`,
  the minute reference, the recused-approver refusal, and the no-self-approval
  check pointed at the approvers rather than at whoever is typing.
- `migrations/0007_scholarships.sql` — `award`, `award_board_review` with
  `recused_person_id`, `minute_ref` and `outcome`, and `award_board_approver`.
  The table exists precisely because this has to be auditable years later.
- `src/app/board/scholarships/awards/page.tsx` — read-only. It shows the bands
  and the exceptions.

Honest about stubs:

- **`proposeAwards`, `approveAward` and `recordFullBoardDecision` have no
  screen.** All three are library functions with tests and no route. The Chair
  cannot propose, approve or record a board decision from the application. The
  awards page shows her what *would* happen and offers no control.
- **The application state never becomes `AWARDED` or `NOT_AWARDED`.** An award
  record reaching `APPROVED` leaves the application sitting at `SUBMITTED`. So
  "awarded" and "not awarded" are not recorded anywhere on the applicant's own
  record, and `decided_at` is never set.
- **Nothing records a decision *not* to award.** There is no "decline this
  applicant" path at all. 150 applicants, 119 Merit awards: that is at least 31
  people a cycle about whom the system holds no decision.

## What the board-member-dependent screen must do

This is a contracted control and it is worth being exact about.

- The screen shows the award with the flag stated in words, not an icon: "This
  applicant's sponsoring member holds a board seat. This award goes to the full
  board with *[name]* recused."
- There is **no approve button on that screen.** The only control is "Record
  what the board decided", and it opens a form.
- The form requires: the outcome (approved or declined), the minute reference,
  and the names of at least three approvers chosen from the board, with the
  recused member not selectable. A missing minute reference blocks submission
  with the reason stated.
- After submission the screen shows the decision, the minute reference, the
  approvers by name, and who recorded it. It does not offer to change it.
- The recusal is visible on the awards list, not only on the detail screen, so
  the Chair cannot approve a batch and miss one.

**What the minute must say.** The board's own record, not the platform's, has
to carry: that the application was identified as being from a board member's
dependent; that the member was named and recused and took no part in the
discussion or the vote; the award programme and the amount; the basis
(committee average and band, or verified service connection and the flat
amount); the names of the members who voted to approve; and the outcome. The
platform stores the minute *reference* and the approvers; it does not store the
minute, and the Secretary's record is the authority.

## What is missing or undecided

| Missing | Who decides |
| --- | --- |
| Screens for propose, approve and record-board-decision | Engineering. Nothing blocks them. |
| An application-level decision: `AWARDED`, `NOT_AWARDED`, `decided_at` | Engineering, specified by the Chair |
| A recorded decision for the ~31 applicants a cycle who get nothing | **Chair.** The public site already promises "every applicant receives an outcome". |
| **How a board member's dependent is actually detected.** Today `intake.ts:540` sets `boardMemberPersonId` from `personIdForEmail(sponsor.sponsorEmail)`, which looks the sponsor's address up in `BOARD_CONTACTS` in `src/lib/membership/contacts.ts` — a hard-coded map of *dev personas* that includes `dev:member`, who holds no board seat. It keys off the **sponsor**, so a board member's dependent sponsored by somebody else is not detected at all. And finding 3 of `docs/PHASE2-FINDINGS.md` says `dev:` ids are not rows in `person` and D1 enforces foreign keys. | Engineering must replace this with a real lookup against the board roster. Until then the control does not work. |
| Who may approve an ordinary award, if not the Chair who proposed it | Board |
| Whether a declined board review can be reconsidered | Board |

## Edge cases that will actually happen

- **Two awards to one person.** Normal: 183 awards across 150 applicants. A
  Merit and a Wounded Patriot award are separate rows, separately approved,
  separately notified, and they produce **two cheques to the same school**.
  `loadChequeRun` already groups by payee so they go in one envelope. What is
  not decided is whether the student gets one email or two. One email naming
  both amounts is the obviously right answer and nothing builds it.
- **A board member's dependent also qualifies for Wounded Patriot.** Two awards,
  both in `BOARD_REVIEW`, and the board must take two decisions or one minute
  covering both. The current code creates the board review separately on each
  award, so the minute reference would be typed twice.
- **The recused member is the Chair.** Then the Chair cannot propose, cannot
  approve, and should not be the one recording the board's decision either. The
  backup chair exists and the role has been swapped before; nothing in the
  platform knows that.
- **An award is approved at the wrong amount.** There is no "revise" path. The
  only recorded statuses are `PROPOSED`, `BOARD_REVIEW`, `APPROVED`, `DECLINED`
  and `NOTIFIED`.

---

# E52 Applicant notification on decision

**This function is blocked on a module nobody has built.** There is no
communications module. `docs/MODULE-BRIEF.md` puts Communications in phase 3
and says it "is a new lane and needs a line in the ownership table before it
starts". That line does not exist. `src/lib/scholarships/notify.ts` is an
in-memory outbox in `globalThis`: nothing is sent, and on Workers the outbox
does not survive an isolate recycle.

This is the function that removes the Chair's single most time-consuming task.
Until the communications module exists, nothing here saves her a minute.

## What it must do

Each student is told their decision, with their award amount merged from the
record. The sponsoring member is a named recipient on every message, with the
reason printed in the message — not a bcc. Students frequently do not read or
answer email and the Chair's current workaround is to leave the platform and
chase the sponsor by hand; a bcc would preserve that workaround while looking
like a fix. Where the applicant is under 18, the guardian who consented is also
a recipient. Unsuccessful applicants are told too: the public site promises
"every applicant receives an outcome, not only the successful ones."

## What the notification must contain

- The applicant's name, and the decision in the first sentence.
- The programme and **the amount, merged from `award.amount_cents`**. Never
  typed.
- That the cheque is made out to the school and sent to the bursar, not to the
  student, and that it carries their student number.
- An instruction to tell the Chair before the cheque is mailed if their
  enrolment changes.
- A statement that the sponsoring member is copied, and why.
- The application reference.
- For an unsuccessful applicant: the outcome, plainly, and who to write to.

## What it must never contain

- **Another recipient's name.** The Foundation does not publish the names of
  recipients and never will — that promise is on `/jsoa/scholarships` and in
  `MINORS_NOTICE`. A decision email is the easiest place in the whole system to
  break it: one batch send with the wrong recipient field, one "congratulations
  to this year's recipients" paragraph, one list attached for the sponsor's
  convenience, and the promise is gone and cannot be recalled.
- **A bcc.** `ScholarshipOutboxMessage` has no bcc field and no copy field, and
  it must stay that way. Every recipient is named with a role and a reason.
- Any disability information, any service-connection narrative, any verification
  method or note. A Wounded Patriot award notification says the programme and
  the amount and nothing about why the applicant qualified.
- A score, a band name, a ranking, or any comparison to other applicants.
- A date of birth, a student number in the subject line, or the sponsor's
  membership standing.
- Any statement about eligibility while the rule is unpublished.

## Acceptance criteria

- 183 approved awards produce 183 notifications and the Chair types no amount.
  Every `mergedAmountCents` equals its award's `amount_cents`.
- Every notification has at least two recipients: the applicant and the
  sponsor. A notification with zero recipients throws rather than sending.
- Where the roster did not resolve a sponsor address, the sponsor slot is still
  filled, addressed to the Chair, saying the sponsor could not be reached.
  Dropping the recipient is a failure.
- An applicant under 18 at the time of consent has the guardian as a third
  recipient, named, with the reason.
- An award not in `APPROVED` cannot be notified. `sendAwardNotification` throws
  `AwardNotApprovedError`.
- Sending is one deliberate act with a persistent not-yet-sent state before it,
  not a confirmation dialog. The screen states how many will go and to whom.
- After a send, the award is `NOTIFIED` with `notified_at` set, and re-sending
  does not produce a second message.
- **Grep the rendered body of all 183 messages: no applicant's name appears in
  any message other than their own.**
- An applicant with two awards receives one message naming both, or two
  messages — whichever the Chair chooses — and the choice is the same for all
  150 applicants.

## What already exists

- `src/lib/scholarships/awards.ts` — `recipientsFor`, `buildAwardNotification`
  (pure, amount merged from the record), `awardNotificationFor` (preview,
  writes nothing), `sendAwardNotification`.
- `src/lib/scholarships/notify.ts` — the outbox type. The important part is
  structural: `recipients: Recipient[]`, each with a role and a `because`, and
  **no bcc field on the type**. `ref` is an application or award reference,
  never a name.
- `src/app/board/scholarships/notify/page.tsx`, `SendPanel.tsx`,
  `actions.ts:sendOneNotification` — the screen, with the preview and the
  highlighted merged amount.
- `src/components/workspace/SendGate.tsx` — the not-yet-sent state and the
  closing summary.

Honest about stubs:

- **No mail is sent.** Resend is named in `docs/ARCHITECTURE.md` and is not
  wired to anything. The outbox is an array on `globalThis`.
- **`sendOneNotification` sends one award at a time.** The screen shows one
  preview and one button. 183 awards is 183 button presses. The task the
  contract is here to remove is still, today, a task.
- **`NOT_AWARDED_NOTICE` is a message kind that nothing creates.** The module's
  own notes say so at `workspace.ts:369` and `kpis.ts:385`. The unsuccessful
  applicant — at least 31 people a cycle — hears nothing, and the public site
  says they will.
- `SendGate.tsx` is a demonstration component: it sets local state to "sent"
  and calls an optional callback. It does not send.
- `GUARDIAN_CONSENT_REQUEST` and `BOARD_REVIEW_NOTICE` are declared message
  kinds that nothing creates either.

## What is missing or undecided

| Missing | Who decides |
| --- | --- |
| The communications module, and its line in the ownership table | **Engineering lead / scope owner.** Everything in E52 waits on it. |
| A batch send: one act, 183 messages, with a per-message failure list | Engineering |
| The not-awarded message, and its wording | **Chair writes it; it goes nowhere near counsel because it states no legal position.** |
| One message or two for an applicant with two awards | Chair |
| A delivery record: what was sent, to whom, when, and whether it bounced. Today `notified_at` is the only evidence and it says a message was queued, not delivered | Engineering |
| A routed mailbox for the Chair so replies reach a person | Secretary, BOARD-REVIEW R11 |

## Edge cases that will actually happen

- **An applicant who turned 18 between consent and decision.** The consent
  record still exists, so `recipientsFor` still copies the guardian on a
  message about an adult's money. Legally defensible, socially awkward, and
  nobody has decided. The Chair should decide, and the rule should be written
  down either way.
- **A scorer related to an applicant.** Irrelevant to the notification itself,
  but the scorer must not be on the recipient list for any reason, and the
  "sponsor could not be resolved" fallback routes to the Chair's inbox rather
  than to anyone else — keep it that way.
- **Two awards to one person.** Two messages today, each naming one amount, and
  the student has to add them up. Fix this before the cycle, not after.
- **A student's email bounces.** The sponsor is a recipient precisely for this,
  which is the design working. But nothing records the bounce, so the Chair
  finds out when the student calls in September.
- **The send is interrupted at message 90 of 183.** There is no resume, no
  record of which 90 went, and re-running would send 90 duplicates — except
  that `sendAwardNotification` flips the award to `NOTIFIED`, so it would not.
  That is luck rather than design and should be made deliberate.

---

# E53 Award history and permanent records

## What it must do

The Foundation can answer "how was this decided" years after the application
itself has been destroyed, and can do it without holding the applicant. An
unsuccessful applicant's personal data is deleted a year after the decision —
deleted, not archived, not anonymised in place. A selection record carrying the
decision, the figures and no identity is kept five years. The cheque run and
what was mailed is recoverable for an audit.

## Acceptance criteria

- Purging a cycle's unsuccessful applicants writes a `selection_record` for
  each **before** deleting anything. A failure between the two leaves a record
  of a decision rather than no trace of one.
- After the purge, the application, its guardian consent, its score sheets and
  its disability verification are gone, and the selection record remains
  carrying `application_ref`, outcome, total score, scores recorded,
  `eligibility_rule_version`, school *state* and `retain_until`.
- The purge result names references, never applicants, so it can go into the
  audit log without putting back what the purge removed.
- `retain_until` is exactly five years after the decision date.
- Selection records past `retain_until` are purged by their own function.
- `scholarship_audit` cannot be updated or deleted. The triggers in
  `migrations/0007_scholarships.sql` abort both. A test must prove this against
  the real database, not against the in-memory repository.
- For a cycle of 150 with 183 awards, the Chair can produce: the cheque run,
  the mailed list with dates and who mailed them, and the per-cycle totals,
  with no applicant name in any of it.

## What already exists

- `src/lib/scholarships/retention.ts` — `purgeUnsuccessfulApplicants` (record
  first, delete second), `purgeExpiredSelectionRecords`,
  `loadRetentionSchedule`, with the clocks as named constants.
- `src/lib/scholarships/disbursement.ts` — `loadChequeRun`, `buildChequeRun`
  (idempotent: running twice does not double-pay), `markChequeMailed`,
  `chequeRunCsv`. The payee is the school; the student appears only as
  `memo_reference`, which is the award reference plus the student number and
  never a name. That is why the Treasurer, who holds no APPLICANT grant at all,
  can open it.
- `src/lib/scholarships/board.ts:loadScholarshipAudit` — the audit view, and it
  is correctly closed to the Chair and open to the Secretary.
- `migrations/0007_scholarships.sql` — `selection_record` with its own
  retention date, `cheque` with the school's address copied at the moment of
  issue, and the append-only triggers on `scholarship_audit`.

Honest about stubs:

- **The retention clock never starts.** `isDueForPurge` requires the
  application to be in `NOT_AWARDED` or `WITHDRAWN`, and nothing in the module
  ever sets either. Against real data the purge finds nothing, forever. The
  function is correct; its precondition does not occur.
- **There is no scheduler.** The module says so plainly. The purge is a
  function with a test and no button, because `loadRetentionSchedule` and
  `purgeUnsuccessfulApplicants` have no screen either.
- **`buildChequeRun` and `markChequeMailed` have no screen.**
  `/board/scholarships/disbursement` is read-only: it renders the run and the
  consolidations and offers no control to build it or to tick a cheque off.
  There is a CSV export at `disbursement/export/route.ts`, which is real and
  useful.
- **Not one line of `repository.d1.ts` has run inside a Worker**
  (`docs/PHASE2-FINDINGS.md` finding 7). For this function specifically, what
  is unproven is the error shape D1 raises when the append-only trigger aborts
  — which is the thing the permanent record depends on.

## On the cheque-mailing task

This is the Chair's second named task and it is worth saying exactly what is
and is not automated. **The envelopes are still hers.** What the platform
removes is: compiling the list, looking up each school's payable name and
address, copying the amount, working out which schools get more than one cheque
so they go in one envelope, and keeping track of what has gone. What it does
not remove is printing, stuffing and posting. There is no payment integration,
no provider, no account number and no field that would carry one, and that is
deliberate.

If the goal is to actually reduce those hours rather than reorganise them, the
next step is a print-ready cheque or a mail-merge letter file generated from the
run — not more tracking. **A tracking screen with no mailing output does not
save her an hour.** Say so now rather than at the end of the cycle.

## What is missing or undecided

| Missing | Who decides |
| --- | --- |
| The application state machine, without which retention never runs | Engineering |
| Screens for build-the-run, mark-mailed, and the retention schedule | Engineering |
| A scheduler, or an accepted answer that the Chair presses the purge button once a year and the audit log records it | Chair and Secretary |
| A cheque status beyond `QUEUED` and `MAILED` | **Chair specifies; it needs a migration, which has one owner.** |
| Whether the successful applicant's data is also purged, and when. `retainedForAwards` counts them and no clock applies | Chair and Secretary |
| A D1 test proving the append-only triggers abort as expected | Engineering |

## Edge cases that will actually happen

- **A school returns a cheque.** `CHEQUE_STATUSES` is `["QUEUED", "MAILED"]`.
  There is nowhere to record a return, a void, or a reissue. The money is out of
  the account, the student is not enrolled, and the only record says "mailed".
  This happens every year and the schema cannot hold it. It needs at least
  `RETURNED`, `VOIDED` and `REISSUED`, a reason, and a link from the reissue to
  the cheque it replaces.
- **A student transfers schools between the decision and the cheque.** The
  cheque carries the school's address copied at the moment of issue, which is
  correct for the audit and wrong for the student. The notification already
  tells them to say something before it is mailed; there is no path for the
  Chair to act when they do.
- **An applicant who turned 18 mid-cycle is purged.** The guardian consent row
  goes with the application, which is right. The selection record keeps no
  guardian reference, which is also right.
- **Two awards to one person, one purged clock.** `selection_record_award`
  holds both programmes against one selection record, keyed by programme. An
  applicant with two awards of the same programme would collide on the primary
  key. That cannot currently happen and should be checked before anyone adds a
  third programme.
- **An auditor asks about a 2022 decision in 2027.** The selection record is
  five years, so it is there — just. The cheque is not covered by any retention
  rule at all and will still be in the table.

---

# What this office needs decided, in order

Nothing below is a nice-to-have. Each one blocks a contracted function.

1. **The eligibility criteria.** Counsel, then the board. E50 cannot be
   completed and nothing else will make it completable. Take the nine questions
   above.
2. **The flat Wounded Patriot amount.** The Chair, one line. 64 awards a cycle
   are currently priced at an invented figure.
3. **The communications module.** It has no owner and no line in the ownership
   table, and the single most time-consuming task in this role waits on it.
4. **The application state machine.** `AWARDED`, `NOT_AWARDED`, `WITHDRAWN`,
   `decided_at`. One small piece of work that unblocks progress tracking, the
   not-awarded notification and the entire retention schedule.
5. **A real board-roster lookup** to replace the dev-persona map that currently
   decides whether an award goes to the full board. The recusal control does not
   work today.
6. **`createCycle` and `createSchool`,** and the Chair screens behind them.
   Without these the apply form cannot open against a real database.
7. **Cheque statuses for a returned cheque.** Migration, one owner.
8. **Does the Chair score?** `FULL_COMMITTEE` is 4 and she said four besides
   her.

## What would not save me an hour

Said plainly, so nobody builds it in good faith.

- A tracking screen for cheques without a printable output. Ticking 183 boxes
  by hand replaces one clerical task with another.
- Reviewer assignment, if the answer for five people and 150 files is a shared
  pool. Build the declare-a-conflict screen instead; that one is load-bearing
  and missing.
- A dashboard. `kpis.ts` and `workspace.ts` are already substantial. What I need
  on opening a screen is how many files are waiting, how many verifications are
  mine, and how many cheques have not gone out — and `loadCycleOverview`
  already returns exactly that.
- Anything that sends a notification one award at a time. 183 presses is not a
  reduction of 183 retypings; it is the same evening.

## One line that must not move

Nothing in this module may hold a medical record. `disability_verification`
stores the outcome, who checked, when, how, and a note in the Chair's own
words. It does not store a document, an attachment, a diagnosis, or an image.
`migrations/0010_routing_answers.sql` holds the line explicitly for the
applicant's own evidence fields: their account, what they say the connection to
service is, and who may confirm it — never a document, never a diagnosis.

Where somebody will be tempted to cross it:

- **An upload field.** The obvious "just let them attach the VA letter" solves
  the Chair's verification problem by creating a records-retention problem the
  Foundation cannot carry. There is no upload anywhere in this module and there
  must not be one.
- **The verification `note`.** It is free text written by the Chair and nothing
  stops her typing a diagnosis into it. The field must say, on the screen, that
  it records *who said what*, not *what the condition is*. The screen copy is
  the only control here and it is worth getting right.
- **`evidence_narrative`** on `scholarship_wounded_patriot`, which is the
  applicant's own words and where an applicant will volunteer a diagnosis
  unprompted. The form's prompt should ask for the connection to service, not
  the condition.
- **The reviewer's file.** A scorer must never see any of it. The withholding
  is structural today — `buildReviewerFile` constructs the object field by
  field and `woundedPatriot` has no landing place on the target type — and the
  temptation will be to add "just a flag so they know". `appliedForWoundedPatriot`
  is a boolean and that is already the most a scorer may have.
- **The award notification.** A message explaining *why* a Wounded Patriot
  award was made would put it in a student's inbox and their sponsor's.
