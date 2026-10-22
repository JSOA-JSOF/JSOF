# What belongs to the Association, and what belongs to the Foundation

Written 2026-10-19 against the live site at thejsoa.org and the data already
held in `src/app/(public)/mission.ts`.

The live site puts everything under one banner. That is the single biggest
content problem it has, and it is not cosmetic: it drives a tax claim that
does not hold, and a donation flow that moves money across an entity line the
architecture forbids.

## The test

**JSOA is a 501(c)(19) veterans organization.** Its purpose is its members.
Dues, member events, mutual aid, merchandise.

**JSOF is a 501(c)(3) public charity.** Its purpose is charitable work for
beneficiaries. Scholarships, the memorial, grants.

The question for any item is not "who does the work" but **"whose money pays
for it, and what does the receipt say."**

## Settled: the Association

| Item | Why |
| --- | --- |
| Membership, applications, renewals, eligibility | The defining function of a (c)(19) |
| Dues | Not a charitable contribution, and the site must stop implying otherwise |
| The ball, golf tournament, youth triathlon, Trunk or Treat | Member and family events |
| The store | Member merchandise |
| Family support for members under strain | Mutual aid between members |
| Contact by office for association business | Association governance |

## Settled: the Foundation

| Item | Why |
| --- | --- |
| Scholarships and grants | Charitable work for beneficiaries |
| The memorial and the paver plaza | Already assigned to JSOF in `mission.ts` |
| Tax-deductible giving, the general fund | Only the (c)(3) can promise deductibility outright |
| Corporate sponsorship seeking a deductible receipt | Qualified sponsorship under IRC 513(i) |
| Partners | Charitable partnerships |

## Not settled, and each one needs a board decision

These are the real findings. Each is a place where the live site currently
does one thing and the entity structure implies another.

### 1. The general fund splits across both entities

The live site says a general fund gift is "distributed evenly across the three
lines of effort." Two of those lines are the Foundation's, one is the
Association's. So an undesignated gift as described **moves money across the
entity boundary**, which `assertUnblended` exists to prevent.

Pick one:

- The general fund is Foundation only, and the events line is funded from
  dues and event income rather than from donations. Simplest, and it matches
  how the two entities are actually meant to work.
- Or the donor chooses the entity explicitly at the point of giving, and the
  site stops describing an even split.

Until it is settled, the donate flow cannot be built correctly, because the
receipt it issues depends on the answer.

### 2. "Donations to the JSOA are Tax-Deductible"

As published, this is not supportable. Gifts to a 501(c)(19) are deductible
only if the organization passes the war-veteran membership composition test,
and nobody is tracking that figure per year.

This is already flagged in the platform as `CLAIM_UNSUPPORTED`, and four board
roles were carrying it in free-text notes before it had a name. The sentence
should move to the Foundation, where it is simply true, or be qualified.

### 3. Pavers carry a benefit, so they are not a pure gift

Buying a paver gets you something: an inscription. The deductible amount is
the payment minus the value of what the donor received, and the receipt has to
say so. This is a substantiation question, not a placement question, but it
has to be answered before the paver flow is built.

The memorial sits with the Foundation, so pavers should too.

### 4. Event sponsorship forks, and the fork is the money

The events are the Association's. Corporate sponsorship of those events is
where IRC 513(i) lives, and it splits:

- A sponsor who wants only an acknowledgment is a **qualified sponsorship**.
  Deductible, Foundation.
- A sponsor who wants advertising, comparative claims, or an endorsement is
  buying **advertising**. Not deductible, and it can create unrelated business
  income.

One sponsor tier sheet cannot serve both. Tiers have to state which side of
that line each benefit sits on, and the 2% safe harbour is all or nothing, so
a single oversized benefit taints the whole payment.

### 5. Family support versus grants

The Association does "family support." The Foundation does "scholarships and
grants to family members of JSOC." An emergency payment to a grieving family
could plausibly be either, and right now there is no line.

Draw it explicitly. A reasonable cut is that help to a **member** is
Association mutual aid, and help to a **beneficiary family** on a written
application is Foundation charitable work. Whatever the board picks, it needs
writing down, because the two produce different receipts.

### 6. The store may create taxable income

Merchandise sold to members is ordinary association activity. Merchandise sold
to the general public by a (c)(19) can be unrelated business income. The store
is the Association's either way; what is unsettled is whether public sales
need tracking separately for tax.

### 7. Committees serve both entities

The live site recruits for a scholarship committee and a fundraising
committee. Scholarship work is Foundation work. Fundraising serves both, which
means volunteer effort and any shared cost need an allocation basis, and a
person sitting on both sides needs the conflict rules the platform already
enforces.

## What the Association page should therefore say

- Membership, events, store, family support. Its own work, in its own voice.
- Dues are not a deductible gift, stated plainly rather than buried.
- The two charitable lines of effort are named, attributed to the Foundation,
  and linked. A reader looking for scholarships should reach them in one click
  and arrive knowing they have changed organizations.
- No donate button that implies deductibility.
