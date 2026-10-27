# Treasurer: requirements for E16 to E24

Office: Treasurer, Joint Special Operations Association. Nine contracted
functions under the signed statement of work: E16 to E24.

I sign for these. They are written so that an auditor reading this file and the
repository together can tell, for every line, what the system must do, how to
prove it does, what exists today, and what is still a decision rather than a
build. Where the contract language was loose enough to argue about at
acceptance, I have pinned it here and said so. A pin is my decision as the
officer accountable for the money; where the decision is not mine, it is listed
in the Open decisions register at the end with a named decider.

Companion documents, binding on everything below: `docs/PRIVACY-AND-PAYMENTS.md`
and `docs/ARCHITECTURE.md`. The board's own reading of the public site is
`docs/BOARD-REVIEW.md`; findings 1, 2 and 3 there bear directly on E21 and E22.

---

## 0. Standing conventions

These apply to all nine functions. A requirement below that appears to
contradict one of these is wrong and this section wins.

### 0.1 No payment processor is integrated. None.

Stated plainly because every acceptance conversation will otherwise rediscover
it. There is no Stripe call anywhere in the codebase.

- `src/lib/donations/checkout.ts` exports `STRIPE_ACCOUNT_PLACEHOLDER` as the
  literals `acct_placeholder_jsoa` and `acct_placeholder_jsof`, returns
  `redirectUrl: null` and `stub: true`, and imports no SDK.
- `src/lib/membership/payment.ts` `createHandoff` mints an id of the form
  `cs_stub_<random>` and a `hostedUrl` of
  `https://checkout.stripe.com/c/pay/<that id>`, which resolves to nothing.
- `src/app/apply/pay/[id]/actions.ts` `simulateWebhook` is a dev-only button
  standing in for the webhook that does not exist.
- `src/lib/treasury/seed.ts` carries `sub-stripe-jsoa` and `sub-stripe-jsof`
  rows with observed annual figures of $4,211.12 and $2,689.40. Those are
  fictional. The file's own header says every figure in it is fictional. They
  are the shape of a processor cost, not evidence of an account.

Consequence for acceptance: no requirement below may be signed off against the
stub. Where a criterion needs live money, it is marked **BLOCKED ON E21/E22**
and is tested against a provider test-mode account once one exists.

### 0.2 Money is integer cents. Tax and shares are basis points.

`migrations/0004_store.sql` says it in its header and the schema has no REAL
column anywhere. `src/lib/treasury/money.ts` enforces it at runtime:
`assertIntegerCents` throws `NOT_AN_INTEGER` on anything else, and `apportion`
splits by largest remainder so parts sum back to the whole exactly.

**If a requirement below would need a decimal, I say so in capitals.** There is
one place a decimal is permitted and it is display only: `formatCents` /
`formatCentsWithSymbol` in `src/lib/treasury/money.ts`, which build the string
by integer division and modulo. Note that
`src/lib/store/reports.ts` `dollars()` does `(cents / 100).toFixed(2)` — a
floating-point division. It is the wrong formatter and the treasury export must
not copy it (see E23).

There are currently **three** separate `formatCents` implementations:
`src/lib/treasury/money.ts`, `src/lib/donations/money.ts`, and a private one at
the bottom of `src/lib/membership/payment.ts`. Treasury work uses the treasury
one. A fourth may not be written.

### 0.3 The two entities are never summed and never share a document.

`assertUnblended` in `src/lib/treasury/money.ts` walks an aggregate and throws
`BLENDED_TOTAL` if any key ending in `Cents` sits outside an object that names
an entity. `PositionStatement.columns` and
`SubscriptionRegister.annualOperatingCost` are arrays for that reason — there
is no field on either where a combined total could go. Every view and every
export produced under E16 to E24 is scoped to one entity or is a list of
labelled columns. Never a total row across both.

### 0.4 The ledger is append-only, by database trigger.

`ledger_entry_no_update` and `ledger_entry_no_delete` in
`migrations/0008_treasury.sql` abort any UPDATE or DELETE with
`the ledger is append-only; post a reversing entry`. This is not advisory. A
correction is a new entry. Section 3 below works through what that means for
E24 and E23.

### 0.5 Hosted checkout only, PCI SAQ A.

`docs/PRIVACY-AND-PAYMENTS.md` is binding: every element of a payment page
originates from the provider; no merchant script, no analytics tag, no custom
field, no chat widget, no font host. Card data never reaches our servers or our
logs. Nothing in E16 to E24 may store, display, log or accept a card number,
and no requirement below asks for a card on file (see E19 and the renewal-night
edge case).

### 0.6 Dues are not a charitable contribution.

`DUES_NOT_DEDUCTIBLE` in `src/lib/membership/payment.ts` is required wording on
the dues page and on every dues receipt. JSOA is a 501(c)(19). A deductible
gift goes to the Foundation. Any renewal notice, reminder or receipt built
under E17, E19 or E20 carries this string. It is not decoration.

---

## 1. Pinned: what a "dues cycle" is

The contract gives me E17 "annual renewal cycle management" and E19 "automated
renewal reminders". The repository disagrees with the contract and with itself
about whether dues recur at all. This is the single largest ambiguity in my
nine functions and I am pinning it now.

Three mutually incompatible statements exist today:

1. `src/lib/membership/types.ts`: `DUES_AMOUNT_CENTS = 20_000` — $200.00 — with
   a comment reading "Membership is for life, so this is charged once and never
   again — the payment page said 'annual' in three places, which is the
   difference between billing somebody once and billing them every year."
2. `src/lib/treasury/seed.ts` `LEDGER_ENTRIES` rows `jsoa-l-001` through
   `jsoa-l-003` post "Q1 renewals, 257 members" ($12,865.00), "Q2 renewals, 188
   members" ($9,420.00) and "Q3 renewals, 146 members" ($7,315.00) — roughly
   $50 a head, quarterly, recurring.
3. My contracted E17 and E19, which assume an annual cycle exists.

They cannot all be true. **Pinned:**

- **P1.** E16 to E20 are built against a *dues term*: a membership period with
  a definite start date and a definite end date. The term length and the term
  price are **configuration, not code**. No constant named `DUES_AMOUNT_CENTS`
  and no literal number of months may appear in any file shipped under E16 to
  E20.
- **P2.** A lifetime membership is expressed as a term, not as an exception: it
  is a term row whose end date is null. Everything downstream — status,
  reminders, reconciliation — treats a null end date as "never falls due" and
  must not special-case the word "lifetime".
- **P3.** **There is no proration.** A term is charged in full or not at all.
  Part-year pricing would require dividing a price by a day count, which is a
  decimal, and `apportion` in `src/lib/treasury/money.ts` only accepts weights
  that sum to exactly 10,000 basis points — it cannot take day weights. The
  cost of this pin is that a member joining in month eleven pays for twelve
  months. I accept that cost. If the board wants proration, it is a change to
  this file first, and it requires a new weights-based apportion function and a
  decision on rounding direction, in writing.
- **P4.** Until the board minutes the term length and the price (Open decision
  D1), **E17 and E19 cannot be accepted**, and E16, E18 and E20 are accepted
  against a single open-ended term only.

Who decides: the board, on the VP Membership's motion, with my figure. I will
bring the figure. I will not bring the decision.

---

## 2. Pinned: the entity rule for dues and for the store

The gifts side of the house has a real rule, enforced in the database.
`migrations/0006_donations.sql` creates `allocation_entity_must_match`, which
aborts an INSERT into `donation_allocation` where the donation's entity is not
the fund's entity: "a donation cannot be allocated to the other entity's fund".

The contract asks me to say what the equivalent rule is for dues and for the
store, and whether anything enforces it. The answer to the second half is
mostly no.

**The rule, stated.** Every money document belongs to exactly one entity, and
every row it points at belongs to that same entity. There is no document on
which a JSOA line and a JSOF line can both appear. Specifically:

- **Dues.** Membership is an Association function. JSOF has donors, not
  members. A dues invoice, a dues checkout session, a dues receipt and a dues
  ledger posting are JSOA, always.
- **Store.** The store is an Association function
  (`STORE_ENTITY = "JSOA"` in `src/lib/store/types.ts`). An order of one entity
  may contain only products of that entity, and a refund of an order is of the
  order's entity.
- **Ledger.** A ledger entry of one entity may only cite a fund of that entity.
- **Transfers.** The only lawful way money crosses is a `transfer` row with two
  approvals, one per entity. That one is properly built.

**What actually enforces it today.** Four gaps, all confirmed in the schema:

| Rule | Enforced? | Evidence |
|---|---|---|
| Gift cannot be allocated to the other entity's fund | **Yes, by trigger** | `allocation_entity_must_match`, `migrations/0006_donations.sql` |
| A transfer must cross entities | **Yes, by CHECK** | `CHECK (from_entity <> to_entity)`, `migrations/0008_treasury.sql` |
| A transfer needs both treasurers | **Yes, by table shape** | `transfer_approval` keyed on `(transfer_id, entity)` |
| Nobody approves their own reimbursement | **Yes, by trigger** | `reimbursement_no_self_approval` |
| Dues belong to JSOA | **No** | `checkout_handoff.entity` is `CHECK (entity IN ('JSOA','JSOF'))`. `MEMBERSHIP_ENTITY = "JSOA"` is a TypeScript constant in `src/lib/membership/types.ts` and nothing else. A JSOF dues handoff row inserts cleanly. |
| An order's lines are its own entity's products | **No** | `order_line.sku` is plain TEXT with **no foreign key to `product` at all** and no entity column, in `migrations/0004_store.sql`. A JSOA order can carry a JSOF SKU and nothing objects. |
| A refund matches its order's entity | **No** | `refund.entity` and `store_order.entity` are independent columns with no constraint relating them. |
| A ledger entry cites a fund of its own entity | **No** | `ledger_entry.fund_id REFERENCES treasury_fund(id)` with no comparison of `ledger_entry.entity` to `treasury_fund.entity`. A JSOA posting can land in a JSOF fund. |
| A transfer's funds match its entities | **No** | `transfer.from_fund_id` / `to_fund_id` reference `treasury_fund(id)` with no entity comparison. |

The last three are mine. **Required, as part of E24 and as a precondition for
accepting it:** a migration adding three triggers in the shape of
`allocation_entity_must_match` —

1. `ledger_entry_fund_entity_must_match`, BEFORE INSERT on `ledger_entry`.
2. `transfer_fund_entity_must_match`, BEFORE INSERT on `transfer`, checking
   `from_fund_id` against `from_entity` and `to_fund_id` against `to_entity`.
3. `refund_entity_must_match_order`, BEFORE INSERT on `refund`.

The dues and store gaps are the VP Membership's and the Store Chair's modules
respectively; I am recording them here because the reconciliation view (E24) is
where a mis-entitied row surfaces, and I will not be the officer who discovered
it from a reconciliation rather than from a constraint. Open decision D7.

---

## 3. Pinned: what append-only means for E24 and E23

A correction is a reversing entry. Three consequences, all of which change what
gets built.

**3.1 The domain type cannot currently represent a reversal. This is a
defect and it blocks E24.**

`migrations/0008_treasury.sql` says `amount_cents` is **signed**: "A debit is
negative and a credit positive; storing the sign in a separate column is how a
total comes out wrong." The domain type says the opposite:
`src/lib/treasury/types.ts` `LedgerEntry.amountCents` is "Integer cents, always
positive. `kind` carries the direction" — which is precisely the arrangement the
migration's own comment warns against. The D1 port splits the difference:
`toLedgerEntry` at `src/lib/treasury/repository.d1.ts:211` reads
`amountCents: Math.abs(int(row.amount_cents))`.

So a reversal of a revenue posting, stored correctly as a negative
`amount_cents` with `kind = 'revenue'`, is read back into the domain as a
**positive revenue**. It would not cancel the original. It would double it.

Required before E24 is accepted:
- `LedgerEntry.amountCents` becomes signed and matches the column.
- `toLedgerEntry` stops calling `Math.abs`.
- Period totals sum the signed amount within each kind.
- A new nullable column `reverses_entry_id TEXT REFERENCES ledger_entry(id)`,
  so a reversal cites what it reverses rather than saying so in the memo. The
  D1 port's header notes it deliberately does not write migrations it is not
  authorised to write; this one needs to be authorised. Open decision D6.

**3.2 The reconciliation view shows the net, and shows the gross underneath
it.** A bookkeeper looking at a fund balance that moved and then moved back
needs to see both movements, not a quiet net. So E24 renders, for every line:
the gross postings, the reversals, and the net — three figures, never one — and
every reversal renders on its own row with the date it was posted and a link to
the entry it reverses. A reversal is never rendered on the date of the original.

**3.3 The export is a statement of postings, not a statement of balances.**
Because nothing can be edited, a CSV produced on Tuesday and the same CSV
produced on Friday differ only by rows added. That is a property worth keeping:
E23's export carries, in its header, the exact UTC timestamp it was generated
and the id of the last ledger entry included, so two exports can be diffed and
a bookkeeper can prove nothing was removed between them. A row that appears in
the Tuesday file and not the Friday file is a defect, and the test for it is
cheap.

---

## 4. The nine functions

### E16 — Dues collection by card payment

**What it must do.** A person who has been approved for membership can pay
their dues by card, on a page served entirely by the payment provider, and
nothing on our side ever sees the card. The payment is recorded against the
Association, in integer cents, only when the provider says it cleared. A person
who has *not* been approved cannot be asked for money and cannot reach the
page.

**Acceptance criteria.**

1. Walking all nine values of `MembershipState`, a request to
   `/apply/pay/<id>` returns HTTP 404 for all eight states other than
   `AWAITING_PAYMENT`. Not a redirect, not a message — a message confirms the
   application exists. `assertPaymentAvailable` already enforces this and the
   test must iterate the array, not the two states anyone thought of.
2. A request to `/apply/pay/<id>` for an application id that does not exist
   returns 404, and its response is byte-identical to the 404 for an
   application that exists in the wrong state.
3. The rendered payment page contains zero `<script>` elements of our origin,
   zero third-party hosts other than the provider, and no `<input>` of any
   kind. Assert against the served HTML, not against intent.
4. No string matching a card number pattern (13–19 digits, with or without
   separators) appears in any request log, any error payload, or any row of
   `checkout_handoff`.
5. The amount sent to the provider equals the configured term price exactly, in
   integer cents, and `assertIntegerCents` is on that path.
6. The success URL alone does not clear anything. Hitting the success URL
   without a provider callback leaves the application in `AWAITING_PAYMENT` and
   creates no `member` row. **This is the criterion I care most about:** a
   success URL is a claim about a payment, not a payment.
7. **BLOCKED ON E21.** A test-mode card that succeeds produces exactly one
   `member` row, one `checkout_handoff` row with status `CLEARED`, and one
   ledger posting (see E20).
8. The page carries `DUES_NOT_DEDUCTIBLE` verbatim, and so does the receipt.

**What exists.** The boundary is built and the money is not.
`src/lib/membership/payment.ts` has the guard (`assertPaymentAvailable`), the
view loader (`loadPaymentView`), the handoff creator (`createHandoff` — **a
stub**, returning a dead URL), and the clear path (`clearDues`), which is real
logic: it advances the state machine, writes the `member` row, derives
`is_war_veteran` from the attested dates rather than the checkbox, and queues
the welcome message. `migrations/0003_membership.sql` has `checkout_handoff`
with a two-value status. `src/app/apply/pay/[id]/actions.ts` has `beginCheckout`
and a dev-only `simulateWebhook`. The PCI reasoning is written into the file
headers and is correct.

**What is missing or undecided.**
- The provider call and the verified webhook. Blocked on E21, not on the build.
- Webhook signature verification, replay protection, and an idempotency key on
  the handoff. Mine to specify, built when E21 lands.
- `clearDues` is currently reachable from a server action. In production only a
  verified webhook may reach it; the dev affordance must not render outside
  development. Same pattern as the store's `?viewer=good-standing` hole that
  `docs/BOARD-REVIEW.md` finding 7 closed. Mine.
- The term price. Open decision D1.

**Edge cases that will actually happen.**
- *A member pays twice.* `createHandoff` can be called repeatedly; nothing
  blocks a second session while a first is outstanding, and `loadPaymentView`
  returns `existing` without using it. Two sessions clear: the first creates the
  member, the second hits `assertPaymentAvailable` on a state that is now
  `PROBATIONARY` and **throws** — money taken, nothing recorded, an exception in
  a log. Required: the webhook is idempotent on the provider's session
  reference; a second distinct cleared session for the same application posts the
  money to an unapplied-receipts fund, raises an exception row, and notifies me.
  It never throws and never silently discards.
- *A payment clears after the applicant was declined or the vouch expired.*
  Same failure mode, same remedy. The money is real whatever our state machine
  thinks. Record it, flag it, refund it by the approved refund path.
- *The provider's callback arrives twice.* Idempotency key. Exactly one member
  row.
- *The applicant abandons after the redirect.* `checkout_handoff` stays
  `CREATED` forever and the application sits in `AWAITING_PAYMENT`. Required: a
  handoff older than 30 days is marked expired, and the row is kept.

---

### E17 — Annual renewal cycle management

**What it must do.** Every member with a dated term has a renewal date. On a
schedule the board sets, the system opens a renewal for each member whose term
is ending, takes payment for the next term by the same hosted-checkout route as
E16, and moves the term forward. A member whose term ends and who has not paid
moves through grace to lapsed (E18) without anyone running a script by hand.

**This function cannot be accepted until Open decision D1 is minuted.** The
repository currently says membership is for life and charged once.

**Acceptance criteria.**

1. A term is a row with a start date, an end date (nullable per P2) and a price
   in integer cents. No renewal period is hardcoded anywhere; grep for a literal
   `12`, `365` or `DUES_AMOUNT_CENTS` in files shipped under E17 returns nothing.
2. A member with a null term end date is never selected for renewal, in any
   query, at any point in the cycle.
3. Running the renewal job twice on the same day produces the same set of open
   renewals, not two. Idempotent by construction.
4. Running the renewal job on a day when the clock is wrong — the job is given
   a date, never `new Date()` inside the logic — produces results that a test
   can pin. The treasury module already models this:
   `AS_OF_DATE` in `src/lib/treasury/seed.ts` exists so "renews soon" is stable.
   Same discipline.
5. A renewal payment that clears advances the term by exactly one term length
   **from the old term's end date, not from the payment date**. A member who pays
   three weeks late does not lose three weeks. A test asserts the new end date
   for a payment on the day, a payment early, and a payment late.
6. No proration appears in any figure (P3). A renewal invoice for a partial
   period is a defect, not a feature.
7. Every renewal is JSOA. A renewal row with entity JSOF fails to insert.

**What exists.** Nothing, and less than nothing: the model actively contradicts
it. `src/lib/membership/types.ts` documents the payment as one-time and for
life. `src/lib/membership/state.ts` `next()` has no renewal event and no
transition out of `GOOD_STANDING` except `REVOKED_FOR_CAUSE`. The only artefacts
that assume recurrence are the three seeded ledger rows in
`src/lib/treasury/seed.ts`, which are fictional.

**What is missing or undecided.**
- Term length, term price, and whether existing lifetime members are
  grandfathered. Board, on the VP Membership's motion. Open decision D1.
- The renewal anniversary: common date for everyone, or each member's own join
  anniversary? Mine to recommend, board to minute. **I recommend each member's
  own anniversary**, because a common date concentrates every failed card on one
  night and makes the reconciliation in E24 unreadable. Open decision D2.
- Who runs the job. Cloudflare scheduled worker; see
  `docs/CLOUDFLARE-MIGRATION.md`. VP Operations owns the infrastructure, I own
  the schedule.

**Edge cases that will actually happen.**
- *A member dies mid-term.* No renewal opens, no reminder sends, and the term
  is closed with a reason. A renewal reminder to a widow is the worst thing this
  system can do and it is one unguarded query away. The status change is a
  member record change, not a treasury one, but E19's send list must read the
  live status at send time and not a list built the night before.
- *A card fails on renewal night.* See E19.
- *A member pays the renewal and then the term dates are changed by a board
  decision.* The term already paid for is never re-priced. The new length
  applies from the next term.
- *The job does not run for a week* (deploy, outage). The job is written to be
  given a date range, not "today", so a catch-up run opens exactly the renewals
  that were missed and sends exactly one reminder each, not seven.

---

### E18 — Membership status tracking: current, lapsed, grace

**What it must do.** At any moment, for any member, the system can say which of
current / grace / lapsed they are in, since when, and why. Access to member
benefits follows from that status and nothing else.

**Acceptance criteria.**

1. `MEMBERSHIP_STATES` contains a grace state. It does not today — the nine
   values in `src/lib/membership/state.ts` are DRAFT, AWAITING_VOUCH,
   CHAIR_QUEUE, AWAITING_PAYMENT, PROBATIONARY, GOOD_STANDING, DECLINED,
   LAPSED, REVOKED.
2. **`LAPSED` is reachable.** Today it is not: `next()` has no event that
   returns it and no case that transitions out of it. A test that walks every
   state and every event and asserts each state is reachable from DRAFT fails on
   `LAPSED` right now. That test is the acceptance criterion.
3. The transitions, pinned: `GOOD_STANDING --TERM_EXPIRED--> GRACE`;
   `GRACE --GRACE_EXPIRED--> LAPSED`; `GRACE --RENEWAL_CLEARED--> GOOD_STANDING`;
   `LAPSED --RENEWAL_CLEARED--> GOOD_STANDING`. No other edges.
4. `grantsMemberAccess` returns true for `GRACE` and false for `LAPSED`. That is
   what grace *is*: the benefit continues while the money is late. Stated here so
   it is not re-litigated at acceptance.
5. **A reinstated member keeps their original `member_id` and their original
   `joined_at`.** No second `member` row is ever created for a person who has
   lapsed and returned. `member_id` is `UNIQUE` in
   `migrations/0003_membership.sql` and is the key the store, the roster and the
   sponsor-vouch flow all use; reissuing one would orphan every historical
   record. A test asserts one member row per person across a lapse-and-return
   cycle.
6. Status is derived from the term dates and the payment record, never typed in.
   A screen that lets someone set a member to GOOD_STANDING by hand does not
   ship.
7. Entering GRACE and entering LAPSED each write a `membership_audit` row. That
   table is append-only by trigger already.
8. `member.state` has **no CHECK constraint** in the schema. Adding GRACE is
   therefore a code change and not a migration — which also means a typo inserts
   silently. Required: add the CHECK, listing the states, in the same migration.

**What exists.** The state machine is good work and its two rules — no payment
requested without a vouch or a chair approval, and the intake never reveals
whether a sponsor is real — are correctly implemented. `PROBATIONARY` and
`GOOD_STANDING` deliberately grant identical access. `member.payment_cleared_at`
exists and the 30-day audit clock starts there. `membership_audit` is
append-only. What is absent is the whole back half of a member's life: no grace,
no reachable lapse, no term.

**What is missing or undecided.**
- Grace period length. Board. Open decision D3. **I recommend 30 days**, because
  it is one statement cycle and it keeps a reconciliation window closing monthly.
- Whether a lapsed member's roster record is suppressed from the member
  directory. VP Membership, not me.
- Revocation stays out of scope: `docs/PRIVACY-AND-PAYMENTS.md` is explicit that
  no revoke button ships until the bylaws say what it does. Nothing under E18
  touches `REVOKED`.

**Edge cases that will actually happen.**
- *A payment clears after the member has already lapsed.* This one is certain,
  because the grace period and the postal and banking delays guarantee it.
  Required behaviour: the money is always recorded; the member returns to
  `GOOD_STANDING`; the term that was paid for is the one that was due, so the
  new end date is computed from the *lapsed* term's end date; and the
  reinstatement is audited. The current code would instead throw, because
  `clearDues` calls `assertPaymentAvailable`, which only tolerates
  `AWAITING_PAYMENT`. Fixing that is part of E18, not a later tidy-up.
- *A member in grace buys from the store.* `store_order` freezes
  `membership_state_at_sale` at the moment of sale, which is exactly right and
  must not be changed to a live lookup. The member-versus-non-member receipts
  report depends on the frozen value.
- *A member lapses between the reminder being queued and being sent.* Read
  status at send, not at queue.
- *A member pays on the last day of grace, in a different timezone.* Term
  boundaries are UTC dates (`YYYY-MM-DD`), rendered in America/New_York, as
  everywhere else in this codebase. The comparison is on the UTC date. Pinned so
  nobody argues it at midnight.

---

### E19 — Automated renewal reminders on a schedule I set

**What it must do.** Before and after a term ends, the system emails the member
a reminder with a link to pay, on a schedule I control without a deploy. Each
reminder is sent once. A member who has paid never receives one.

**Acceptance criteria.**

1. The schedule is data, not code: a list of offsets in days relative to the
   term end date, editable by the Treasurer. A test changes the schedule and
   asserts the send dates move, with no code change.
2. Running the sender twice for the same day sends nothing the second time.
   Exactly-once per member per offset, asserted against the outbox.
3. A member whose payment cleared between the schedule being computed and the
   send does not receive the reminder. Status is read at send.
4. Every reminder carries `DUES_NOT_DEDUCTIBLE` and the North Carolina
   solicitation disclosure, in **one** wording (see below).
5. The reminder's payment link resolves to a live hosted-checkout page or the
   reminder does not send. `docs/BOARD-REVIEW.md` finding 3 and recommendation
   R10 state the rule: a control that cannot complete its action does not render
   as a control. A reminder is a control. **BLOCKED ON E21.**
6. A member with no deliverable email address still gets a queued record marked
   undeliverable, and that record appears in a report I can read. It is not
   skipped.
7. No reminder is sent to a member in any state other than GOOD_STANDING
   approaching expiry, GRACE, or LAPSED within the recovery window.

**What exists.** The transport pattern, stubbed, and it is the right pattern.
`src/lib/membership/notify.ts` queues to an in-memory outbox; `enqueue` does
constant work on every path and records `deliverable: false` rather than
skipping, specifically so response time cannot leak whether an address exists.
Its header states a real implementation writes to a table and lets a worker
send, and must not call the mail API inline. `OutboxMessage.kind` has four
values — `VOUCH_REQUEST`, `PAYMENT_LINK`, `CHAIR_NOTICE`, `DECISION_NOTICE` —
and **no renewal reminder kind**. `paymentUrl` exists. Resend is the named
vendor and is not integrated.

**What is missing or undecided.**
- The schedule itself. Mine. **I pin the default to minus 30, minus 7, plus 1
  and plus 14 days** relative to term end, and I will minute any change. Four
  messages is the most I will send before a lapse.
- An outbox table and a worker. VP Operations' infrastructure, my content.
- The NC solicitation disclosure wording. It exists **twice, differently**, and
  they cannot both be the statutory text: `src/lib/donations/disclosure.ts:23`
  says "at 888-830-4989" and `src/lib/treasury/workspace.ts:628` says "at
  1-888-830-4989 (within North Carolina) or (919) 814-5400". That is
  `docs/BOARD-REVIEW.md` R8, confirmed. One string, confirmed with the Branch,
  before any reminder goes out. Secretary owns the reconciliation of the two;
  I will not ship a solicitation carrying a number I cannot source.
- Whether a renewal reminder is a "solicitation" for the disclosure's purposes.
  Counsel. I am treating it as one until told otherwise, which is the
  conservative direction.

**Edge cases that will actually happen.**
- *A card fails on renewal night.* We hold no card and may not: SAQ A means
  hosted checkout only, and nothing on our side stores a payment instrument. So
  there is no retry to schedule in the ordinary sense. **Pinned: no card on file
  in this phase.** A failure produces a reminder with a fresh hosted-checkout
  link, on the schedule above, and the member re-enters their card on the
  provider's page. The alternative — the provider's saved-payment-method flow —
  changes the PCI analysis and goes through `docs/PRIVACY-AND-PAYMENTS.md`
  first, not through a module. Open decision D4.
- *A member bounces.* A hard bounce marks the address undeliverable and stops
  further sends to it; it does not stop the lapse. The member still lapses and
  my reconciliation still shows the unpaid term.
- *A member has two overlapping terms* because of a double payment (see E16).
  Reminders key on the latest term end date, and the duplicate raises an
  exception row rather than a second reminder stream.
- *The sender runs during a catch-up after an outage.* Offsets already past are
  collapsed to the single most recent one. A member does not receive four
  reminders in one morning.

---

### E20 — Payment history recorded against each member

**What it must do.** For any member, I can see every payment they have ever
made to the Association, with the date, the amount in cents, what it was for,
the opaque provider reference, and any refund or reversal against it. The
history is complete and nothing can be edited out of it.

**Acceptance criteria.**

1. Every cleared dues payment produces exactly one ledger posting under a dues
   revenue account in a JSOA fund, and exactly one payment-history row linking
   that posting to the member.
2. The history row carries the provider's session reference and **never** a
   token, a card number, a last-four, a brand, or an expiry. Assert the absence
   by column list, not by inspection.
3. The sum of a member's history rows, net of reversals, equals the sum of the
   ledger postings that cite them, to the cent, for every member. This is the
   test that catches a posting written without a history row or the reverse.
4. A refund appears as a second row citing the first, never as a change to the
   first. Attempting an UPDATE on the ledger raises
   `the ledger is append-only; post a reversing entry`, which is already true —
   `ledger_entry_no_update` in `migrations/0008_treasury.sql`.
5. Reading a member's payment history requires FINANCIAL READ **and**, because
   the row identifies a member, MEMBER_PII. The store's board layer already
   models exactly this split (`src/lib/store/board.ts` header): a Store Chair
   holds FINANCIAL AGGREGATE and sees totals but not who bought. Payment history
   is row-level and member-identifying; it is not an aggregate screen.
6. A view of one member's history is one entity's by construction. There is no
   query that returns a member's JSOA and JSOF payments together, because there
   are no JSOF members.

**What exists.** Less than the schema suggests. `migrations/0008_treasury.sql`
has `ledger_entry` with its append-only triggers, indexed on
`(entity, fund_id, date)` and `(entity, date)`. `migrations/0003_membership.sql`
has `checkout_handoff` and `member.payment_cleared_at`. But:

- **There is no write path to the ledger anywhere in the application.** The
  `TreasuryRepository` interface in `src/lib/treasury/repository.ts` has
  `ledger()` to read, `saveTransfer` and `saveReimbursement` to write — and no
  method that posts a ledger entry. The in-memory implementation reads the
  constant array `LEDGER_ENTRIES` from `src/lib/treasury/seed.ts`. The D1 port
  says so in its own header: "The interface has no ledger write on it at all."
- There is no payment-history table. `checkout_handoff` is per application, not
  per member, and carries two statuses.
- Nothing connects a cleared dues payment to a ledger posting. `clearDues` in
  `src/lib/membership/payment.ts` writes the member and queues an email. It does
  not touch treasury.

**What is missing or undecided.**
- A `postLedgerEntry` on `TreasuryRepository`, with authorization (FINANCIAL
  WRITE, which only TREASURER holds per
  `src/lib/authz/model.ts` `ROLE_DEFINITIONS`) and `assertIntegerCents` on the
  amount. Mine.
- A payment-history table, or the decision that `ledger_entry` plus a join
  table is enough. **I pin it to a join table**: `member_payment`, carrying
  member id, ledger entry id, provider reference, and the term it pays for. The
  ledger stays the book of record and nothing duplicates an amount into two
  tables that can disagree.
- Which fund dues land in. Today `jsoa-general` in the seed. Mine to set,
  minuted.
- The signed-amount defect in §3.1 must be fixed first, or a refund in the
  history will read as a second payment.

**Edge cases that will actually happen.**
- *A refund crosses a financial year.* Covered under E24.
- *A payment with no member* — a cleared session for an application that was
  declined, or an unmatched bank credit. It still posts, to an unapplied
  receipts fund, with no member link, and it shows on the reconciliation as
  unapplied. It is never dropped because it does not fit.
- *A member pays twice in the same minute.* Two history rows, two postings, one
  term advanced, one overpayment flagged. The history tells the truth about what
  arrived; the term tells the truth about what was bought.
- *A member changes their email.* History is keyed on `member_id`, which is
  stable for life (E18 criterion 5). Never on email.

---

### E21 — JSOA payment account, configured with products and pricing

**What it must do.** The Association holds its own payment-processor account,
in its own legal name, under its own EIN, with its own bank account, and the
products and prices the Association sells are configured in it. No other entity
has access to it.

**This is blocked on the organization, not on the build.** There is no account.
Writing the integration before the account exists produces a second stub.

**What the board must do, in order.** Each step blocks the next.

1. **Confirm the Association's legal name, state of incorporation and EIN**, and
   publish the EIN. `docs/BOARD-REVIEW.md` finding 2 is confirmed: there is no
   EIN for either entity anywhere on the site, no state of incorporation, no
   Form 990 and no solicitation licence number. R7 is blocking. *From the board:
   the EIN, in writing, and the incorporation certificate.* Owner: Secretary.
2. **Confirm the bank account the Association settles into**, with the account
   in the Association's own name and two signatories. *From the board: a minuted
   resolution naming the account and the signatories.* Owner: President and me.
3. **Minute the decision that the two entities hold separate processor
   accounts**, so the record exists before the application rather than after.
   *From the board: one minute.* Owner: President.
4. **Resolve the programme-ownership question**, because it decides which
   products belong in which account. `docs/BOARD-REVIEW.md` R1 and R2 are
   blocking: who owns the memorial asset and its capital campaign, and whether
   the golf fund pays event costs or only charitable proceeds. Today
   `src/lib/donations/seed.ts` puts the only open memorial fund under JSOA while
   the programme register says the memorial is JSOF, and `fund-jsof-golf` is
   defined to pay the direct costs of an event the Foundation has published a
   policy against funding. I cannot configure a product catalogue against a map
   that contradicts itself. *From the board: two answers.* Owner: board.
5. **Open the account**, with me and one other named administrator. A tool with
   one administrator is a tool the organization loses when that person leaves —
   `subscription.second_administrator_person_id` exists in
   `migrations/0008_treasury.sql` precisely to make that a finding. *From the
   board: the second administrator, named.* Owner: me, board ratifies.
6. **Decide the demo question before any live key exists.**
   `docs/BOARD-REVIEW.md` R12: the footer says "Demo build, no live member data"
   on pages soliciting $200 dues, and the site is indexed. A live processor key
   behind a page labelled a demo is the worst combination available. *From the
   board: one decision.* Owner: board.
7. **Get the acquirer to confirm the applicable SAQ in writing.**
   `docs/PRIVACY-AND-PAYMENTS.md` is explicit: do not assert SAQ A without it.
   *From the acquirer: written confirmation.* Owner: me.
8. **Then** configure products and prices, in integer cents, mirrored from our
   catalogue, and record the processor cost against `sub-stripe-jsoa` with real
   figures replacing the fictional ones.

**Acceptance criteria.**

1. Every product and price in the JSOA account matches our catalogue exactly, in
   cents. A test reads the provider's price list in test mode and asserts
   equality against `product.price_cents` for every active JSOA SKU and against
   the dues term price.
2. No JSOF product exists in the JSOA account. Assert by iterating the account's
   product list and failing on any SKU whose `product.entity` is JSOF.
3. The account's settlement bank account is the Association's. Evidenced by the
   acquirer's record, not by a config file.
4. API keys are in the Worker's secret store, never in the repository, and the
   JSOF key is not readable by anything that handles a JSOA request. Assert by
   grep over the repository and by configuration review.
5. `sub-stripe-jsoa` in the subscription register carries a real
   `observedAnnualCents` and a real second administrator, and
   `MISSING_SECOND_ADMINISTRATOR` does not fire for it.

**What exists.** Placeholders that document the intent correctly and do nothing:
`STRIPE_ACCOUNT_PLACEHOLDER.JSOA = "acct_placeholder_jsoa"` in
`src/lib/donations/checkout.ts`, and the `sub-stripe-jsoa` register row whose
justification reads "Hosted checkout for dues, events and the store. Separate
account per entity." The register, the findings engine and the renewal calendar
in `src/lib/treasury/workspace.ts` are real and will report on the account the
day it exists.

**Edge cases that will actually happen.**
- *Underwriting asks for a beneficial-owner document.* It will. Have the
  incorporation certificate, the EIN letter and the board minute ready; this is
  step 1 and 2 existing for a reason.
- *The account is opened in an individual's name because it was faster.* This is
  the failure I am most worried about and it is unrecoverable without closing the
  account. The account is in the Association's name or it is not opened.
- *Pricing drifts* because someone edits a price in the provider's dashboard and
  not in the catalogue. Criterion 1 is a scheduled test, not a one-off.

---

### E22 — Separate JSOF payment account, no shared invoices

**What it must do.** The Foundation holds a processor account of its own,
settling to the Foundation's own bank account under the Foundation's own EIN.
No document, no invoice, no checkout session and no payout ever contains money
belonging to both entities.

**Also blocked on the organization.** Same sequence as E21, run separately and
not in parallel with the same paperwork: steps 1, 2, 5 and 7 above, with the
Foundation's EIN, the Foundation's bank account, the Foundation's Treasurer
(`p-okonkwo` in the seed) as owner, and a second administrator who is not the
Association's Treasurer. Step 4 — programme ownership — is shared and must be
answered once.

*What I need from each:* from the Foundation board, the Foundation EIN and a
resolution naming its bank account and signatories; from the Association board,
the same for itself and the shared answer on programme ownership; from the
President, a minute recording that the accounts are separate by policy; from
the acquirer, two written SAQ determinations, one per merchant.

**Acceptance criteria.**

1. The two accounts have different merchant ids and different settlement bank
   accounts. Evidenced, not asserted.
2. A checkout session is created against exactly one account, selected from the
   `entity` on the record being paid for, and there is no code path that can
   select the other. Assert by test: constructing a JSOA dues session with the
   JSOF key fails loudly rather than succeeding.
3. No invoice, receipt, session or payout contains a line from both entities. A
   test builds the full set of documents the system can emit and runs
   `assertUnblended` over each.
4. A refund is issued from the account that took the money. Always.
5. The restricted-gift rule is unaffected: a JSOF gift still cannot be allocated
   to a JSOA fund, enforced by `allocation_entity_must_match`.
6. Nothing moves between the accounts except by a `transfer` row with both
   approvals (`transfer_approval` keyed on `(transfer_id, entity)`) and a minute
   reference on both sides. A direct processor-to-processor transfer is a control
   failure, and there is no feature that performs one.

**What exists.** `STRIPE_ACCOUNT_PLACEHOLDER.JSOF`, the `sub-stripe-jsof`
register row ("Never shares an account with the Association"), the transfer
tables and their two-treasurer approval model, and the gift-allocation trigger.
The separation is well modelled in the database and entirely unbuilt in the
processor, because there is no processor.

**Edge cases that will actually happen.**
- *A donor gives to the Foundation on the Association's page*, or the reverse.
  `docs/BOARD-REVIEW.md` finding 1 is this exact failure already live in the
  copy: `/jsof/memorial` tells a Gold Star family their gift is deductible and
  routes them to a page whose only memorial fund is the 501(c)(19). Fix the
  register (R3) before taking money, not after.
- *One combined payout* because the two accounts were opened under one platform
  profile. Check before the first settlement, not at the first reconciliation.
- *A shared sponsorship* where a company pays one cheque intended for both. It
  is two payments or it is one payment to one entity followed by a `transfer`
  with two approvals and a restriction statement. There is no third option and
  the schema offers none.
- *A chargeback lands on the wrong account.* It cannot, if criterion 4 holds;
  if it does, it is a reversing entry in the account that received it and a
  transfer, not a journal edit.

---

### E23 — Transaction export for the Treasurer

**What it must do.** I can download, for one entity and one date range, every
transaction in that range as a file a bookkeeper opens in Excel and a CPA can
tie to a bank statement, without re-keying anything and without the spreadsheet
silently changing a value.

**Acceptance criteria.**

1. **One entity per file.** The filename and the first header row both name the
   entity. There is no "both entities" option and no combined total row.
   `assertUnblended` runs over the report object before the file is built.
2. The export refuses, with a reason, when the reader lacks FINANCIAL scope on
   that entity. The ledger page already does this correctly and its refusal text
   is the model: an empty table would read as "the Foundation had no activity",
   which is a worse lie than "this is not yours to see"
   (`src/app/board/treasury/ledger/[entity]/page.tsx`).
3. Every money column appears **twice**: once as integer cents, headed
   `… (cents)`, and once as a display string with two decimals, headed
   `… (USD)`. The cents column is the one that reconciles. The USD column is
   produced by `formatCents` from `src/lib/treasury/money.ts`, which builds the
   string by integer division — **not** by `src/lib/store/reports.ts` `dollars()`,
   which divides by 100 in floating point.
4. **No decimal is ever parsed back in.** The USD column is output only. If a
   future requirement asks the system to read a dollar figure from a
   spreadsheet, say so loudly: the schema has no column for a decimal and
   `assertIntegerCents` will throw `NOT_AN_INTEGER` the moment one reaches the
   domain.
5. **Formula injection is blocked.** Any cell whose first character is `=`, `+`,
   `-`, `@`, tab or carriage return is prefixed with a single quote before
   quoting. The existing helper
   `csvCell` in `src/lib/store/reports.ts:131` escapes `"`, `,` and `\n` only —
   it does not handle `\r` and has no injection guard. The treasury export does
   not reuse it unfixed. A test feeds a memo of `=cmd|'/c calc'!A1` and asserts
   the cell is inert.
6. **Dates are ISO `YYYY-MM-DD`, quoted.** Unquoted, Excel reformats them on
   open and the file no longer matches what was exported. A test round-trips a
   date through a CSV parser and asserts the string is unchanged.
7. **Identifiers are text.** `JSOA-2026-0042`, `jsoa-l-001` and provider
   references are quoted. A test asserts no identifier column loses a leading
   zero.
8. UTF-8 with a BOM, and CRLF line endings. Excel on Windows mis-renders a
   UTF-8 CSV without a BOM, and the bookkeeper is on Windows.
9. The header block carries: entity, period start and end (UTC, inclusive,
   labelled as such), the UTC generation timestamp, the id of the last ledger
   entry included, and the sentence that the ledger is append-only and a
   correction appears as a separate reversing row. §3.3.
10. Row counts and totals in the file equal those on the matching screen, to the
    cent, for the same period and the same reader. A test asserts screen and file
    agree; a discrepancy between what I see and what I send the CPA is the
    failure this criterion exists to prevent.
11. The export contains no member name, no member email and no card data. A
    member id is member PII and appears only for a reader holding MEMBER_PII; for
    a reader holding FINANCIAL only, the column is omitted and the file says it
    was omitted. The scholarships cheque-run export already takes this posture
    and its page says so.

**What exists.** Two working CSV exports, neither of them mine, and both good
patterns to copy:
`src/app/board/store/receipts/export/route.ts` with
`boardReceiptsCsv` / `receiptsReportCsv` (`src/lib/store/board.ts:186`,
`src/lib/store/reports.ts:145`), and
`src/app/board/scholarships/disbursement/export/route.ts` with `chequeRunCsv`.
Both authorise in the library and keep the route to a few lines, which is the
right division. There is **no treasury export of any kind** — no route under
`src/app/board/treasury/`, no CSV function in `src/lib/treasury/`.

**What is missing or undecided.**
- The whole export. Mine to build.
- Whether the CPA wants one file per period or a running file. Mine, after
  asking the CPA. Open decision D5.
- Whether the export includes the store and donations as well as the ledger. **I
  pin it to the ledger plus its linked source references**, because the ledger is
  the book of record and a second export that can disagree with it is worse than
  no second export.

**Edge cases that will actually happen.**
- *A memo contains a comma, a quote, a newline and an em dash.* All four, in one
  memo, written by me. Test with that exact string.
- *The period is empty.* The file has its header block, its column row, and a
  stated zero. Not an empty file, which reads as a failed download.
- *The period spans a reversal of a prior-period entry.* The reversal appears
  with its own posting date, inside the period; the original does not. The header
  note (criterion 9) is what makes that legible.
- *Two exports taken minutes apart.* Identical but for rows added. §3.3.
- *The bookkeeper opens it in Google Sheets instead.* Same rules; the BOM is
  harmless there.

---

### E24 — Reconciliation of payments received against dues owed

**What it must do.** For a period and one entity, show what dues were owed, what
was received, and the difference, with every item in the difference nameable and
actionable. I take this to the board monthly and sign it.

**Acceptance criteria.**

1. The view presents, for one entity: dues billed in the period, dues received
   in the period, received against prior periods, outstanding, and the
   reconciling items. Five figures, all integer cents, all for one entity.
2. **Gross, reversals, net — three figures per line, never one.** §3.2.
3. The arithmetic closes exactly: opening outstanding + billed − received −
   written off + reversals = closing outstanding, to the cent, asserted by test
   over a seeded period that deliberately contains a double payment, a late
   payment and a cross-year refund.
4. Every reconciling item is a row with a reason and a link, not a residual. A
   line labelled "unexplained difference" does not ship. If the figure cannot be
   explained, the view says how much is unexplained **and lists the candidate
   rows**, which is a different thing from a plug.
5. The view reconciles three sources and says which is which: our ledger, the
   processor's settlement, and the bank. A member who paid but whose payout has
   not settled is a timing item and renders as one, not as a discrepancy.
   **BLOCKED ON E21/E22** for the second and third sources; the ledger side is
   buildable now.
6. A payment with no matching member, and a member with no matching payment,
   each appear as named items. Neither is netted away.
7. Nothing in the view can be edited. A correction is made by posting a
   reversing entry, from a separate screen, with FINANCIAL WRITE and a reason.
   The view then recomputes. Attempting an UPDATE raises the trigger's message.
8. `assertUnblended` passes on the whole view object.
9. The view states the as-of date and the fiscal year it sits in, in words, at
   the top.

**What exists.** The surrounding furniture, and not the thing itself. There is a
position statement with per-entity columns and a `withheldReason` where a reader
lacks scope — withheld is explicitly not zero, which is the right call. There is
a ledger view with fund and kind filters. There is a monthly-close task generated
in `src/lib/treasury/workspace.ts` reading "bank and processor statements agreed
to the ledger, and the reconciliation filed". There is a separation-of-duties
panel that correctly flags that one person holds the Association's treasury and
its store — authorize, custody, record and reconcile in one pair of hands
(`src/lib/treasury/kpis.ts:424`). What does not exist: any notion of dues owed,
any ledger write path, any processor data, and the signed-amount fix in §3.1.

**What is missing or undecided.**
- Dues owed requires terms, which requires Open decision D1.
- The fiscal year end. Nothing in the repository states it; the seed period is
  "FY2026 to date, 2026-01-01 to 2026-09-30" with `AS_OF_DATE = "2026-09-30"`,
  which is a reporting window and not a year end. **Pinned to the calendar
  year** until the board minutes otherwise, because that is what both seed
  periods imply and because a silent assumption here misstates two years at
  once. Open decision D8.
- Write-off policy: at what age an outstanding term is written off, and who
  approves it. Board, on my motion. Open decision D9.
- Who reviews the reconciliation. It must not be me alone — the Finance Review
  Officer (`p-brill`, FINANCE_REVIEW_OFFICER on both entities) exists for this.
  The signer and the preparer are different people. Mine to propose, board to
  minute.

**Edge cases that will actually happen.**
- *A refund that crosses a financial year.* Certain, and the one most likely to
  be got wrong. **Pinned: the reversing entry is dated the date the refund is
  made, not the date of the original.** Prior-year figures never move — they are
  filed, and the ledger cannot be edited anyway. The reconciliation shows
  prior-year reversals on their own line, labelled with the year reversed, and
  they are excluded from the current year's "received" figure and included in the
  current year's net. If the amount is material to the prior year, that is a
  prior-period adjustment and a conversation with the CPA, not a posting I make
  alone.
- *A payment clears after the member lapsed.* Reconciles against the term that
  was owed, not the period it arrived in. Shows as "received against prior
  periods".
- *A member pays twice.* The overpayment is a reconciling item in an unapplied
  receipts fund with the member named, not a credit silently applied to a future
  term. Applying it forward is a decision, taken once, visibly.
- *A card fails on renewal night and succeeds three days later.* Two processor
  events, one payment, one posting. The failure is not a transaction and does not
  appear in the ledger; it appears, if anywhere, in the dunning report.
- *A chargeback.* A reversing entry plus a separate fee posting. The fee is an
  expense of the entity that took the money and is never netted against the
  revenue, because netting hides the chargeback rate.
- *The processor's monthly statement is in dollars with two decimals.* It is
  parsed to integer cents at the boundary, once, with a test on a value ending in
  `.005` asserting the parse is **refused** rather than rounded.
  `parseDollarsToCents` in `src/lib/donations/money.ts` already refuses three
  decimal places and returns null rather than guessing. That is the behaviour I
  want: a figure nobody can read is not a figure I will post. **IF ANY
  REQUIREMENT EVER NEEDS A DECIMAL STORED, IT HAS NOWHERE TO GO: THERE IS NO
  DECIMAL COLUMN IN THIS SCHEMA AND NONE WILL BE ADDED.**

---

## 5. Open decisions register

Nothing below is a build problem. Each one blocks at least one contracted
function and each needs a named person to decide it.

| # | Decision | Blocks | Decider | What I need |
|---|---|---|---|---|
| D1 | Does membership recur? If so, the term length and the term price. Are existing lifetime members grandfathered? | E17, E19, and the "owed" half of E24 | Board, on VP Membership's motion | One minute. I bring the figures |
| D2 | Common renewal date or each member's own anniversary | E17, E19 | Board | One minute. I recommend own anniversary |
| D3 | Grace period length | E18 | Board | One minute. I recommend 30 days |
| D4 | Card on file for renewals, which changes the PCI analysis | E19 | `docs/PRIVACY-AND-PAYMENTS.md` change first, then board, then acquirer | A written SAQ determination before any build |
| D5 | Export cadence and format the CPA wants | E23 | Me, after asking the CPA | A call |
| D6 | Authorise migration 0011: signed `amountCents` in the domain, `reverses_entry_id`, and the three entity triggers in §2 | E20, E23, E24 | Whoever owns schema changes | Authorisation to write the migration |
| D7 | Close the dues, order-line and refund entity gaps in §2 | E24's integrity | VP Membership and Store Chair, with me | Agreement that the constraints go in |
| D8 | Fiscal year end | E24, E23 | Board | Confirmation it is the calendar year |
| D9 | Write-off policy and who approves a write-off | E24 | Board, on my motion | One minute |
| D10 | `docs/BOARD-REVIEW.md` R1, R2, R3, R7, R8, R12 — the entity register, the two EINs, the one disclosure string, and demo versus live | E19, E21, E22 | Board; R8 to the Secretary and the Branch | Answers, in the order R1 → R3 → R7 → R12 |

---

## 6. What I will not sign

Recorded so there is no argument at acceptance.

1. A dues flow accepted against the stub. No Stripe call exists anywhere; a
   green test over `cs_stub_…` proves the redirect boundary and nothing about
   money.
2. A reconciliation with an unexplained residual line.
3. An export with one file covering both entities, or with a total row across
   them.
4. Any figure in this system held as a decimal.
5. A reminder carrying a solicitation disclosure whose phone number I cannot
   source, while two different wordings sit in the repository.
6. A processor account in anyone's personal name, or one administrator on
   either account.
7. A correction made by editing a ledger row. The trigger will stop it; I am
   saying it anyway, because the next person may be tempted to drop the trigger.
