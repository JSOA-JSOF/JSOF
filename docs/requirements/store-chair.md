# Store and Sales Chair: requirements for E31 to E39

27 October 2026. Written by the office that owns these nine lines under
Annex A of the signed statement of work. The test of every requirement
below is whether I could hand it to a builder and then, later, stand in
front of a member whose polo arrived in the wrong size and explain what
happened.

Everything marked CONFIRMED I read in the repository and name by file.
Where I am asking the board to decide something, the decision is named
with the office that owns it, because an undecided question in a
requirements document is a delay with better manners.

## Read this part first

Three of the nine lines are in better shape than I expected. E31, E34
and E39 have real machinery behind them and need finishing rather than
building. E35 is a deliberate stub with the right shape. The other five
have a problem in common, and it is not the same problem the status
assessment of 27 October recorded.

**E33 cannot be delivered at all in its current state, and it is the
first thing that has to be fixed, because E31, E32 and E34 all sit on
top of it.** There is no way for me, or anyone, to create a product. The
catalogue a visitor sees is whatever `seed.ts` invented. Against the
real database the shop is empty and no screen in the platform can change
that. This is finding 1 of `docs/PHASE2-FINDINGS.md` and I am the office
it lands on.

Two of the nine lines are blocked by one upstream omission: **checkout
collects no name, no email and no postal address.** E37 has nothing to
print on a label and E38 has nowhere to send a confirmation. Neither is
a hard problem. Both are impossible until the fulfilment step exists.

And one contracted line cannot be delivered as written. **E32 says
"member pricing". There is no member price anywhere in the data model**
— a product carries a single `price_cents` and an order line carries a
single `unit_price_cents`. What is actually built, and built well, is a
member-only *catalogue*: extra SKUs that the public never sees. Those
are different products, not different prices. Section E32 says what I
would deliver instead and what it costs to deliver the contracted thing.

---

## E31 Public storefront

### What it must do

A visitor who has never heard of us can open `/store`, see every item
that is on sale to the public with a price and a picture, understand
before they commit that sales tax and postage will be added, see what
postage costs and what it takes to avoid it, put things in a cart, and
reach a payment page. No member-only item is named, counted, greyed out
or hinted at anywhere on that page.

### Acceptance criteria

1. Request `/store` as an anonymous visitor against a database holding
   at least one public and one member-restricted product. Every public
   product appears. The response body contains no member-restricted SKU,
   no member-restricted product name, and no count of hidden items. Grep
   the raw HTML for the restricted SKU string: zero matches.
2. Repeat with every query parameter a person might guess appended
   (`?viewer=good-standing`, `?member=1`, `?all=1`). The result is
   identical to criterion 1. This is the regression test for R31.
3. The page states the postage charge and the free-shipping threshold in
   figures, above the fold, before the buyer adds anything. Today it
   states neither.
4. The page states that sales tax is added at checkout and that purchases
   are not deductible. Both already pass.
5. With an empty catalogue the page says the catalogue is empty for an
   administrative reason, not that "the store reopens with the winter
   collection". See the edge cases.
6. Every product card carries a photograph. Today none can, because
   there is nowhere to put one. Blocked on E33.

### What already exists

- `src/app/store/page.tsx` — the page. Takes no viewer at all, by design.
- `src/lib/store/catalogue.ts` — `publicCatalogue()` and
  `toPublicProduct()`. The projection throws on a member-restricted
  product rather than redacting it, which is the structural reason
  criterion 1 holds rather than a filter somebody has to remember.
- `src/app/store/parts.tsx` — `PublicCard`, the card component.
- `src/lib/store/dev.ts` — `resolveDevViewer()`, which outside
  development resolves every key to the visitor. This is the fix for the
  `?viewer=good-standing` leak the Sales Chair and VP Membership found
  (R31). CONFIRMED in source; it is the reason criterion 2 passes now.

### What is missing or undecided

- **Product photography.** No image field exists on `product` in
  `migrations/0004_store.sql` and no image is rendered. Blocked on E33.
- **The shipping statement** (see "Shipping, and where the buyer is
  told" below). Mine to decide; I have decided it, below.
- **The empty-catalogue copy.** The current line is cheerful fiction. It
  is mine, and I will rewrite it.
- **"Members: sign in for the full catalogue"** is a live link to a
  sign-in that does not exist. R10 says make it inert with a note until
  it does. I agree, and it is mine to change. Until membership ships a
  real sign-in, the line should read as a statement, not a control.

### Edge cases that will actually happen

- **The catalogue is empty on launch day.** This is not hypothetical, it
  is the default state against a real database. A visitor sees a shop
  that says it will reopen in the winter and concludes we folded. The
  empty state must distinguish "nothing is listed yet" from "we sold
  out", and until E33 ships, the honest copy is that the store is not
  open yet.
- **A visitor hand-types a member SKU into the cart URL.** Already
  handled: `priceLines()` in `src/lib/store/cart.ts` runs through
  `purchasableForViewer`, so the line is dropped from pricing exactly as
  it is dropped from the listing. One gate, used twice. The cart then
  says "Nothing that was in it can be bought on this catalogue", which
  is the right wording — it does not confirm the SKU exists.
- **A product is retired while a visitor has it in their cart.** The
  cart lives in the query string, so the line silently disappears at the
  next page load and the total drops. Nothing tells the buyer why. The
  cart must say "one item is no longer available and has been removed".

---

## E32 Member only storefront with member pricing

### What it must do, and what it cannot

Two separate promises are bundled in this line and only one of them is
built.

**Built: the member-only catalogue.** A member in good standing signs
in and sees the full catalogue, including lines never shown publicly,
grouped into seasonal collections. A lapsed member or a visitor sees
nothing of it, not even its existence.

**Not built, and not buildable without a schema change: member
pricing.** CONFIRMED. `product` in `migrations/0004_store.sql` has one
`price_cents`. `order_line` has one `unit_price_cents`. `Product` in
`src/lib/store/types.ts` has one `priceCents`. There is no member price,
no discount percentage and no price list. Nothing in the module computes
a different figure for a member.

**What I would deliver instead, if the board will take it.** The
member-only catalogue as built, plus a single member discount expressed
as basis points on the order, applied at pricing and recorded on the
order row beside the buyer-type snapshot. That is one column on
`store_order` (`member_discount_basis_points`), one on `order_line`
(`list_price_cents`, so the line records what a non-member would have
paid), and a line on the receipt reading "member price". It keeps the
receipt honest, it keeps the tax base correct — the discount reduces the
sales price and therefore the taxable base, which a per-product second
price would also have to do — and it is one figure the board can change
without re-pricing a catalogue.

**What the contracted thing costs instead.** A genuine second price list
means a price-per-product-per-tier table, a tier concept, and an answer
to what happens to an order placed by a member whose tier changes. I do
not recommend it for a store this size and I will say so to the board.
If the board wants it anyway, it is a schema change and a repository
change, and it should be decided before E33's product editor is built,
because the editor is where the second price would be typed.

### Acceptance criteria

1. A signed-in member in GOOD_STANDING sees every active product,
   including every member-restricted one, plus the seasonal collections.
2. A member in PROBATIONARY sees exactly the same thing. They have paid.
3. A LAPSED member and an AWAITING_PAYMENT applicant see the refusal
   page, and that page names no product that is not on the public
   catalogue. Grep for a restricted SKU in the response: zero matches.
4. No member catalogue read happens at all for a viewer without access.
   CONFIRMED already true: `src/app/store/members/page.tsx` makes the
   repository read conditional on `hasAccess`, so there is nothing
   fetched for a later change to leak by accident.
5. Once a discount exists: a member and a non-member put the same SKU in
   the cart. The member's line shows the list price struck through and
   the member price beside it, the order records both, and the receipt
   states the discount in dollars.
6. The sales tax is computed on the discounted price, not the list
   price.

### What already exists

- `src/app/store/members/page.tsx` — the page and the gate.
- `src/lib/store/catalogue.ts` — `memberCatalogue()`,
  `viewerHasMemberAccess()`, `purchasableForViewer()`.
- `src/lib/membership/state.ts` — `grantsMemberAccess()`, which is the
  single definition of who counts. Not reimplemented in the store, which
  is right.
- `src/lib/store/dev.ts` — the viewer switcher. **This is not a sign-in.**
  It is a development affordance keyed on a query parameter, and outside
  development every key resolves to the visitor. So on the live site
  there is currently no way for a real member to reach the member
  catalogue at all.

### What is missing or undecided

- **A sign-in.** Not mine. VP Membership owns it and the whole of E32
  waits on it. Until then the member catalogue is reachable only in
  development, and the public page should say "members, sign in" as a
  statement rather than a link (R10).
- **Member pricing**, above. **Board decision**, and it is a money
  decision rather than a build decision: does a member pay less for the
  same coin, and by how much. President and Treasurer, with me.
- **Whether a member discount changes the member/non-member receipts
  split.** It does — gross receipts from members fall. The Treasurer
  should see the figure before the discount is set, not after.

### Edge cases that will actually happen

- **A member lapses between adding to the cart and paying.** Covered in
  full under E35, because that is where the money moves.
- **A member buys a member-restricted item, then lapses, then asks for a
  refund.** The order line keeps the name and price, so the refund works
  and the receipt still reads correctly. Confirmed by design in the
  migration comment on `order_line`. Nothing to build.
- **A member-restricted product is made public.** Every past order
  placed by a member for that SKU still reads MEMBER, which is correct,
  and the item appears publicly from that moment. No back-fill. The
  product editor must say plainly that this is what the switch does.
- **A member shares the member catalogue URL.** Once a real sign-in
  exists, the recipient gets the refusal page, which names nothing. That
  is already the designed behaviour and it should be tested as such.

---

## E33 Product catalog with images and variants

**This is the headline of this document and the blocking item for my
office.** The status assessment of 27 October marked E33 "Part". It is
not part. It is zero, and the data it was marked "Part" on is fictional.

### What it must do

I must be able to run the catalogue by myself, from a screen, without a
developer and without a deployment. That means: add a product, price it,
photograph it, describe it, say whether it is public or members-only,
say whether we hold it on a shelf or print it to order, say whether it
is taxable, give it the sizes and colours it actually comes in, take it
off sale when it sells out, and put it back when it does not.

None of that exists today.

### Acceptance criteria

1. Against a fresh, empty database, a person holding my role signs in,
   creates a product through a screen, and that product appears on
   `/store` without a deployment. **Today this test fails at step two
   and there is no workaround.**
2. The same person uploads a photograph and it appears on the product
   card and the product page.
3. The same person defines the polo's sizes S, M, L, XL, 2XL, 3XL, and a
   buyer cannot add the polo to a cart without choosing one. The chosen
   size appears on the cart line, the order line, the receipt and the
   packing list.
4. A product with no stock in the chosen size cannot be added in that
   size, and the size shows as unavailable rather than being absent.
5. Retiring a product removes it from both catalogues and leaves every
   past order line reading exactly as it did. CONFIRMED already true by
   schema design; it needs the screen.
6. A product created as members-only never appears in a public response,
   tested by the E31 grep.

### What already exists

Honestly: the read path, and nothing else.

- `migrations/0004_store.sql` — the `product` table. It has `sku`,
  `entity`, `name`, `blurb`, `category`, `price_cents`, `currency`,
  `publicly_purchasable`, `fulfilment`, `collection`, `tax_treatment`,
  `active`. **It has no image column and no variant table.**
- `src/lib/store/repository.ts` — the `StoreRepository` interface. It
  has `listProducts` and `findProduct`. CONFIRMED: **there is no
  `saveProduct`**, and the interface is the contract, so no caller can
  work around its absence.
- `src/lib/store/repository.d1.ts` — CONFIRMED: contains no `INSERT INTO
  product` and no update of it. The table is read-only from this module.
- `src/lib/store/seed.ts` — eleven invented products. This is where the
  live catalogue currently comes from when there is no database binding,
  and `docs/PHASE2-FINDINGS.md` is right that it must not be loaded into
  the real database to paper over this. Invented merchandise in a live
  shop is worse than an empty shop.
- `src/app/store/item/[sku]/page.tsx` — the product page. Shows price,
  SKU, fulfilment and tax treatment. No image. No size selector.

Two things the catalogue is selling today that it cannot deliver:

- `JSOA-POLO-NAVY`, blurb "Sizes S to 3XL", with no way to say which.
- `JSOA-TEE-RUCK`, blurb "printed to order in the size and colour you
  pick", with nothing anywhere that asks the buyer to pick.

I would be the one answering that complaint, and I would have no answer.

### What the Store Chair needs, screen by screen

This is the buildable list. Seven screens, in the order I need them.

**1. Catalogue list — `/board/store/catalogue`**
Every product, active and retired, in one table: photo thumbnail, SKU,
name, category, price, public or members-only, stock or print-on-demand,
units on hand, active. Filter by active and by visibility. Buttons: new
product, edit, retire, reinstate. This is the screen I would live on.

**2. New or edit product — `/board/store/catalogue/[sku]`**
Fields, with validation stated so a tester can fail them:
- SKU. Required, unique, uppercase and hyphens only, immutable once an
  order line references it. The screen refuses an edit to the SKU of a
  product with sales and says why.
- Name. Required. This is what the order line copies, so it must be the
  name a member would use in a complaint.
- Blurb. Required. Plain text.
- Category. One of the five in `PRODUCT_CATEGORIES`.
- Price in dollars and cents. Stored as integer cents. The screen must
  refuse a price typed as a float string and must never round one
  silently — `migrations/0004_store.sql` opens with a comment about
  exactly this and the screen is where it would be broken.
- Publicly purchasable. Yes or no, with the consequence spelled out on
  the screen: "no" means the item is not named anywhere publicly.
- Fulfilment: held in stock, or printed to order. The screen states that
  a print-on-demand line has no stock figures and will show "not
  stocked" on the inventory screen rather than zero.
- Tax treatment: tangible goods, or exempt service. The screen states
  what each means in one sentence, because this field decides whether we
  charge a member sales tax and I am the one who gets that wrong.
- Collection. Optional, free text, with a picker of existing names.
- Active.

**3. Photographs — part of screen 2, or a tab of it**
Upload one to five images per product, reorder them, pick the primary.
Each stored with the alt text that is required, not optional: a store
page with no alt text is an accessibility finding waiting for the
Webmaster. This needs a storage decision (below) and an `product_image`
table: `sku`, `position`, `url`, `alt`, `is_primary`.

**4. Variants — a tab of screen 2**
An option set per product (Size, Colour), the values in each, and a row
per combination carrying its own SKU suffix, its own price delta if any,
and its own stock. This is a new `product_variant` table and it changes
`order_line` as well: the line must record the variant chosen, by its
own SKU and by its human label, copied at the moment of sale like the
name and the price already are, and for the same reason.

**5. Retire and reinstate — a confirmation, not a button**
Retiring says in words what it does: off both catalogues, past orders
unchanged, remaining stock still on the shelf. See the E34 edge case —
today retiring a product also hides its remaining units from the
inventory screen, which is wrong.

**6. Preview — `/board/store/catalogue/[sku]/preview`**
The product page as a visitor sees it and as a member sees it, side by
side. I will not trust the public/member switch until I can look at it,
and neither should anyone reviewing my work.

**7. Collections — `/board/store/catalogue/collections`**
List the collection names in use, rename one across its products, see
what is in each. A rename that has to be done product by product will be
done wrong once and then never again.

### What is missing or undecided

- **`saveProduct` on `StoreRepository`, and its D1 implementation.** The
  single blocking change. Developer work, no decision needed.
- **Image storage.** Where does a photograph live: R2, the existing
  `/media` path, or the fulfilment provider? **Decision: Webmaster**,
  with me, and it should match whatever the event-photos work chose
  (`docs/EVENT-PHOTOS.md`).
- **Variant schema.** Two migrations: `product_image` and
  `product_variant`, plus columns on `order_line`. Developer work once
  the shape below is agreed.
- **Which permission governs a product record.** This one is sharp and I
  cannot decide it alone. CONFIRMED from `src/lib/authz/model.ts:197`:
  STORE_CHAIR holds `PUBLIC_CONTENT: WRITE` and `FINANCIAL: AGGREGATE`.
  A product is both — the blurb and the photograph are public content,
  the price is a financial figure. If the product editor requires
  FINANCIAL WRITE, **I cannot run my own catalogue**, which makes E33
  undeliverable to the office that was contracted to own it. My
  recommendation: product descriptive fields under PUBLIC_CONTENT WRITE,
  price changes under PUBLIC_CONTENT WRITE but written to an audit row,
  and nothing in this module touching the ledger. **Decision: President
  and Treasurer**, as a role-table change.
- **Who supplies the photographs.** Nobody has been asked. Mine.

### Edge cases that will actually happen

- **Two products are given the same SKU.** The primary key refuses the
  second write. The screen must catch it and say "that item code is
  already in use by *Low-profile cap, stone*", not show a database
  error.
- **A price is edited while an order is awaiting payment.** The order
  line already copied the old price, so the buyer pays what they were
  quoted. That is correct and it is the whole point of the copy. The
  product editor should say so, because the instinct of whoever edits
  the price will be to worry about it.
- **A variant is deleted that has been sold.** Refuse it. Retire the
  variant instead, exactly as a product is retired. An order line that
  cannot resolve its own variant label is a packing slip I cannot read.
- **A photograph is uploaded that shows a member's face.** Not a
  commerce question. `docs/PRIVACY-AND-PAYMENTS.md` has rules about
  likeness, and the upload screen must carry the same warning the event
  photos work carries. Mine to write, Secretary to approve.

---

## E34 Inventory counts with low stock visibility

### What it must do

I open one screen and see, for every item we hold on a shelf, how many
we have, how many we sold, which lines are about to run out, and when
somebody other than me last walked the shelves and counted. A line we
print to order shows as not stocked rather than as zero.

### Acceptance criteria

1. Receive 50 units of a SKU, sell 3, and the screen reads 47 on hand.
   **This test fails today.** See below.
2. A print-on-demand SKU shows "not stocked", never 0, and never appears
   as a variance.
3. A SKU whose on-hand figure is at or below its reorder point is
   flagged on the screen and appears as a task on my overview.
4. A person who is not the store chair records a quarterly count; the
   screen shows the counted figure, the computed figure, and the
   difference between them.
5. The store chair attempts the same count and is refused, on screen,
   with the reason. **This test currently reports success and records
   nothing.** See below.
6. A count entered twice for the same SKU and quarter behaves as decided
   below, identically against the in-memory store and against D1.

### What already exists

- `src/lib/store/inventory.ts` — `inventoryRows()`, `latestCount()`,
  `skusMissingCount()`, `buildPhysicalCount()` and the second-counter
  refusal through `assertNotSelfApproval`. This is good work and the
  control is the right one.
- `src/app/board/store/inventory/page.tsx` — the screen, including the
  count form, which is rendered for the store chair with the refusal
  explained rather than hidden.
- `src/lib/store/kpis.ts` — `thinCover`, the only low-stock notion in the
  module: lines whose on-hand is below what they sold in the window.
- `migrations/0004_store.sql` — `stock_movement` and `physical_count`.

Three things are honestly broken.

**Sales do not move stock.** CONFIRMED: `saveMovement` is called from
nowhere in `src/` outside the repository itself. Every `SALE` movement
in the system is in `seed.ts`. A real order writes no stock movement, so
the on-hand figure never falls and criterion 1 fails. This is the single
most consequential gap on this line and it is also why the coin can be
sold twice.

**The count action does not wait for its own result.** CONFIRMED in
`src/app/board/store/actions.ts`: `recordCountAction` calls
`boardRecordPhysicalCount(subject, {...})` without `await`, and
`approveRefundAction` calls `boardApproveRefund(subject, refundId)`
without `await`. Both functions became async in the D1 port. The
`try`/`catch` around a promise that is never awaited catches nothing, so
a refused count redirects to "Count recorded for JSOA-COIN-STD." while
recording nothing, and a self-approved refund reports success the same
way. The separation-of-duties refusal is intact in the domain layer and
invisible in the interface, which is the worst of both. One-word fix,
but it needs a test, because this is a control failing silently.

**There is no reorder point.** `thinCover` is a clever derivation, not a
threshold I set. I want a number per SKU that I choose.

### What is missing or undecided

- **A `SALE` movement written when an order is paid**, noting the order
  ID the way the seed rows do, and a `POD_FULFILMENT` movement for a
  printed line. Developer work. Must be written on payment confirmation,
  not on order placement, so an abandoned checkout does not consume
  stock.
- **A receipts screen**, so I can record 50 coins arriving from the mint
  without a developer. Same gap as E33: the module can read movements
  and cannot create one from any screen.
- **`reorder_point` on `product`**, set by me per SKU, null for
  print-on-demand.
- **The two `await`s.** Developer work, with a test.
- **Whether a refund restocks.** My recommendation: no automatic
  restock. A returned item has to be inspected before it goes back on
  the shelf, so an approved refund raises a task and I record an
  `ADJUSTMENT` when the box actually arrives. **Decision: mine**, and I
  have made it.

### The double count: which behaviour I want

The two implementations disagree, CONFIRMED. `physical_count` in
`migrations/0004_store.sql` carries `UNIQUE (entity, sku, quarter)` and
`saveCount` in `src/lib/store/repository.d1.ts` is a plain `INSERT`, so
D1 refuses a second count for the same SKU and quarter. The in-memory
implementation in `src/lib/store/repository.ts` pushes onto an array and
allows any number of them.

**I want the database's behaviour, and I want the in-memory one changed
to match it.** The comment above the table says it exactly right: a
count is an observation, not a correction, and the difference between it
and the running total is the finding. If a second count can quietly
replace the first, then the one number in this module that nobody can
edit becomes editable, and the compensating control for the Treasurer
also chairing the store stops being worth anything.

**What the screen does when somebody counts twice.** Not a database
error, and not a silent overwrite. The form refuses the submission and
says:

> A count for *Association challenge coin* in 2026-Q4 was already
> recorded on 14 October by J. Ferris: 46 units. A count is an
> observation and is not replaced. If that count was wrong, record a
> stock adjustment with a note, which is a correction and is visible as
> one.

Then it offers the adjustment form, pre-filled with the SKU. That turns
the refusal into the next action rather than a wall. And the test for
criterion 6 is that both implementations produce that same refusal, so
`npm test` can actually catch a regression in it — today nothing in the
suite touches the D1 path at all (`docs/PHASE2-FINDINGS.md` finding 7).

### Edge cases that will actually happen

- **The last coin is sold twice.** Two buyers reach checkout within the
  same minute with the one remaining coin in their carts. Today both
  orders are written, both are paid, and nothing anywhere notices,
  because stock is never decremented and nothing is reserved. One of
  them gets a coin and the other gets an email from me. The fix in order
  of cost: (a) check on-hand at order placement and refuse the line with
  a clear message; (b) decrement on payment, which closes most of the
  window; (c) a real reservation held for the life of the checkout
  session, which closes it properly and which I would want before we
  ever sell a numbered item. Given the volumes this store will actually
  do, (a) and (b) are enough and (c) is for the founders coin only.
  **Decision: mine, with the developer on the cost of (c).**
- **A product is retired with units still on the shelf.** CONFIRMED
  problem: `inventoryRows()` filters on `p.active`, so the retired SKU
  vanishes from the inventory screen while its units are still in the
  cupboard. They then cannot be counted, cannot be written off, and
  reconcile to nothing. The inventory screen needs a "retired, stock
  remaining" section, and retiring a product with units on hand should
  warn me.
- **The count is zero.** Permitted and meaningful — it says the shelf is
  empty. `buildPhysicalCount` already allows zero and refuses negative.
  The screen must not treat a zero as a blank field.
- **The store chair is the only person who will do it.** This is the
  real-world failure of the compensating control. The refusal is
  correct; the answer is the overview task naming the three people who
  can enter it, which `src/lib/store/workspace.ts` already writes.

---

## E35 Card checkout

### What it must do

A buyer pays by card, on the provider's own page, and gets back to a
receipt. We never see a card number. The order exists before the money
is asked for, and only the provider can tell us the money arrived.

### Acceptance criteria

1. From a cart, the buyer reaches a payment page served by the provider.
   Our page contains no card field, no analytics tag, no chat widget and
   no font or script of ours.
2. An order row exists in `AWAITING_PAYMENT` before the buyer reaches
   the payment page, carrying its lines, its tax figure and its
   buyer-type snapshot. CONFIRMED already true.
3. The order moves to `PAID` only through a signature-verified webhook.
   A request to our own URLs cannot move it, and neither can a button.
4. A buyer who abandons the payment page leaves an `AWAITING_PAYMENT`
   order that appears on my tracker and never counts as a receipt.
   CONFIRMED already true: `isReceipted()` in
   `src/lib/store/reports.ts` excludes it.
5. The amount the provider charges equals `total_cents` on the order, to
   the cent, including tax.
6. The buyer is shown the tax figure and the postage before the handoff.
   CONFIRMED already true on `/store/checkout`.

### What already exists

The shape is right and the plumbing is a stub, which is the honest
position.

- `src/app/store/checkout/page.tsx` — the review step. Shows the lines,
  the postage, the tax with its jurisdiction and rate, the total, and
  what the order will record about the buyer. Carries no card field and
  the file comment says it never will.
- `src/lib/store/orders.ts` — `placeOrder()`, `snapshotBuyerType()`,
  `markPaid()`, and `createHostedCheckoutSession()`, which is explicitly
  a **STUB**: it returns `stub_cs_<order id>` and a URL to a page of
  ours. No provider API is called anywhere in the repository.
- `src/app/store/checkout/hosted/page.tsx` — a stub standing in for the
  provider's page, with a button labelled "Stand in for the provider
  confirming the payment".
- `src/app/store/actions.ts` — `placeOrderAction`, which writes the
  order before redirecting and awaits that write, and
  `simulateProviderSuccessAction`, the stub webhook.
- `docs/PRIVACY-AND-PAYMENTS.md` — the SAQ A rule that produced all of
  the above. Stripe hosted Checkout is the named vendor.

**No payment provider is called anywhere in this platform.** There is no
webhook route. Nothing has ever taken a dollar.

### What is missing or undecided

- **The provider integration itself**, and a signature-verified webhook
  route that is the only writer of `PAID`. Developer work, blocked on
  credentials.
- **Two provider accounts, or one.** The Association sells goods and the
  Foundation does not, so the store needs one JSOA account. But donations
  need a JSOF one, and `orders.ts` says this is an integration-module
  decision. **Decision: Treasurer.**
- **The demo-versus-live question (R12).** We cannot ship a stub payment
  button on a site that is indexed and soliciting. Either the payment
  steps are disabled or the site is noindexed. **Decision: board**, and
  it blocks launch, not just this line.
- **The fulfilment step** that E37 and E38 both need, which belongs in
  this flow. See the next section.
- **The postcode.** CONFIRMED: `/store/cart` tells the buyer "Only the
  state, county and postal code are kept on the order", and
  `src/app/store/cart/page.tsx` calls `shipToFromParams(state, county)`
  with no postcode at all, so `ship_postal_code` is written empty on
  every order. The checkout form posts no postcode field either, though
  `placeOrderAction` reads one. We are publishing a claim about our own
  data handling that the code does not perform. This is R21 and it is
  mine to close.

### Edge cases that will actually happen

- **A member lapses between adding to the cart and paying.** This is the
  one I expect to have to explain. Today: `placeOrder()` takes the
  buyer-type snapshot when the order row is written, which is *before*
  the payment page, so an order placed on Monday by a good-standing
  member and paid on Thursday after the membership lapsed is recorded
  MEMBER. **I want that behaviour kept.** The snapshot is a tax record,
  not a loyalty check, and the sale was made to a member on the day the
  price was quoted and agreed. The order says so and
  `src/lib/store/types.ts` explains why it must never be recomputed.
  What has to change is the *window*: an `AWAITING_PAYMENT` order should
  expire — my recommendation is 24 hours — after which the buyer starts
  again at current prices and current eligibility, and the stale order
  is `CANCELLED` rather than left to be paid a month later. And once
  member pricing exists, the same rule has to be stated to the buyer on
  the checkout page: "this price was quoted to you as a member and holds
  until [time]".
  The reverse case needs a word too: somebody who joins between adding
  to the cart and paying is recorded NON_MEMBER, because they were one
  when the order was written. If they ring me about it, the answer is to
  refund and re-place the order, and I would rather have that answer
  written down than invent it on the phone.
- **The buyer pays twice** because they hit back and resubmit. Two
  `AWAITING_PAYMENT` orders, one paid, and possibly two. The provider's
  idempotency key must be the order ID, and the tracker must show
  duplicate carts from the same session so I can spot it.
- **The webhook arrives before the redirect**, which is normal. The
  receipt page must read the order fresh and handle both `PAID` and
  `AWAITING_PAYMENT` without looking broken. CONFIRMED already handled
  in `src/app/store/checkout/complete/page.tsx`.
- **The webhook never arrives.** The order sits `AWAITING_PAYMENT` while
  the buyer's card was charged. There must be a reconciliation screen
  comparing the provider's settled payments to our `PAID` orders, run
  monthly by somebody who is not me.
- **The buyer is outside North Carolina.** Handled, and handled well:
  zero rate, jurisdiction code `OUT-OF-STATE-NOT-REGISTERED`, and a note
  on the cart explaining it. Keep that note.

---

## Shipping, and where the buyer is told

This belongs to no single E-number and it is the complaint I expect
most, so it gets its own section.

CONFIRMED in `src/lib/store/cart.ts`: postage is a flat
`SHIPPING_FLAT_CENTS = 895`, waived at
`FREE_SHIPPING_THRESHOLD_CENTS = 15_000`. Neither figure appears
anywhere a buyer can see until the cart totals render.

**What the buyer should be told, and where.**

1. **On `/store` and `/store/members`, above the catalogue, in one
   line:** "Postage is $8.95 on any order. Orders over $150 ship free.
   North Carolina sales tax is added at checkout."
2. **On every product card and product page**, nothing further. One
   statement in one place, repeated once at the cart. A postage line on
   forty cards is forty places for it to go stale.
3. **In the cart, when the order is under the threshold**, the amount
   left to reach free shipping: "Add $31.40 to ship free." That is a
   merchandising line, and it is the only one I want.
4. **On the checkout page**, the postage as its own row, which it
   already is.

**And the gift certificate bug.** CONFIRMED: `shippingFor()` charges
$8.95 on any order with a non-zero subtotal, looking only at the
subtotal and the ship-to, never at what is in the cart. So a $50 gift
certificate delivered by email is charged $8.95 postage. That is R20 and
it is indefensible. Postage must be charged only when the order contains
at least one line that physically ships; an order of nothing but emailed
or collected lines ships free and says so.

**Collection at an event** is the other case. `PICKUP_SHIP_TO` exists in
the code (Cumberland County, 28307) and is used as the tax fallback, but
no buyer can choose collection, and the tax treatment of a collected
sale is sourced to where it is handed over rather than to a delivery
address. I want "collect at the next event" as a fulfilment choice
before the ball. **Decision: mine, with the Treasurer on the sourcing.**

---

## E36 Order tracker for the store manager

### What it must do

I open one screen and see every order that needs something from me, in
the order it needs it: paid and not yet packed, packed and not yet
posted, posted with a tracking number, and the ones stuck awaiting
payment. I work down it until it is empty.

### Acceptance criteria

1. A person holding STORE_CHAIR and nothing else opens
   `/board/store/orders` and sees the orders. **This test fails today,
   by design of the role table.** See below.
2. Each row shows what to pack: product, variant, quantity.
3. Each row shows a fulfilment state, and I can move an order from paid
   to packed to posted, with a tracking number on the last step.
4. An order awaiting payment for more than 24 hours is visibly flagged.
5. A refunded or partly refunded order shows the refunded amount.
   CONFIRMED already true.
6. The member ID is shown only to a role that holds member data access.
   CONFIRMED already true and correctly implemented in
   `src/lib/store/board.ts`.

### What already exists

- `src/app/board/store/orders/page.tsx` — the screen: order ID, date,
  buyer type at sale, member ID or "withheld from this role", units,
  goods, postage, tax jurisdiction and rate, tax, total, status, refunds.
  Filterable by buyer type.
- `src/lib/store/board.ts` — `boardOrderRows()` and
  `boardOrderSummary()`, with the authorization split that is the
  interesting part of this line.
- `src/app/board/store/dashboard/page.tsx` and `src/lib/store/kpis.ts` —
  the tiles. `src/lib/store/workspace.ts` — the derived task list,
  calendar and planning tabs. Genuinely useful and already built.

**The problem, CONFIRMED and structural.** `src/lib/authz/model.ts:197`
gives STORE_CHAIR `FINANCIAL: AGGREGATE`. `boardOrderRows()` requires
`FINANCIAL: READ` because an order row carries a buyer handle. So **the
store manager cannot see the order list on the order tracker contracted
as the store manager's screen.** I get the totals and the receipts
report; I do not get the rows. The screen says so honestly rather than
pretending the data is missing, which I respect, but it means E36 as
written is not deliverable to me.

The role table is not wrong. The person who sells the goods should not
hold a list of who bought them, and that is a reasonable control. But
somebody has to pack the box.

**What I would deliver instead.** Split the screen in two:

- **A fulfilment queue**, which is what I actually need: order ID, what
  to pack, variant, quantity, destination state and postcode, fulfilment
  state. No buyer handle, no member ID, no financial totals beyond the
  order value. That is a packing list, and it should sit under a new
  narrow capability — `FULFIL_ORDERS` — rather than under FINANCIAL at
  all. The recipient's name and address are needed for the label and
  should be visible on that one screen and exported, not listed.
- **The order list as it stands**, under FINANCIAL READ, for the
  Treasurer and the Finance Review Officer.

**Decision: President and Treasurer**, as a role-table change, with me.
It is the same question as the E33 permission one and should be answered
once for both.

### What is missing or undecided

- **Fulfilment state.** CONFIRMED: `ORDER_STATUSES` in
  `src/lib/store/types.ts` is `AWAITING_PAYMENT`, `PAID`,
  `PARTIALLY_REFUNDED`, `REFUNDED`, `CANCELLED`. There is no packed, no
  shipped, no collected, and no tracking number anywhere in the schema.
  A tracker that cannot record that something was posted is not a
  tracker. This is a second state field, not a widening of the payment
  status: payment state and fulfilment state are different questions and
  folding them together is how an order ends up "shipped" and unpaid.
- **A per-order detail screen.** There is no `/board/store/orders/[id]`.
  I cannot open one order, see its lines, and act on it.
- **Who packs.** If the fulfilment queue carries the address, whoever
  works it is handling personal data and needs the retention rules under
  E37 applied to them. **Decision: mine and the Secretary's.**

### Edge cases that will actually happen

- **An order with a stocked line and a printed line.** Two shipments,
  from two places, and the tracker must show the order as partly
  fulfilled rather than flipping to posted when the coin goes out and
  the print is still at the printer. `fulfilments` on the board row
  already exposes the mix; the state has to be per line, not per order.
- **An order is refunded before it ships.** It must drop off the
  fulfilment queue, loudly. Today nothing connects the two, so I would
  cheerfully post a refunded coin.
- **An order awaiting payment for a month.** Covered by the 24-hour
  expiry under E35. Until that exists, these accumulate on the tracker
  and nobody can tell a stuck order from an abandoned one.
- **A buyer emails asking where their order is**, quoting the order ID.
  With no fulfilment state and no tracking number, I have nothing to
  tell them. This is the single most common question a store gets and
  the tracker currently cannot answer it.

---

## E37 One click shipping label export in the PirateShip column format

### What it must do

I select the orders that are ready to post, click once, and get a CSV
that Pirate Ship imports without me touching a cell. Then I buy the
labels there, print them, and the tracking numbers come back onto the
orders.

### Acceptance criteria

1. With at least one paid, unposted, physically shipping order, one
   click downloads a CSV.
2. That file imports into Pirate Ship with no manual column mapping and
   no rejected rows, tested against a real Pirate Ship account before
   this line is signed off. Not tested against a specification written
   from memory, including mine.
3. An order with no deliverable address does not appear in the file and
   does appear on screen as an exception with the reason.
4. An order already exported is excluded by default, and including it
   again takes a deliberate second action.
5. A print-on-demand line, an emailed gift certificate and a
   collect-at-event order are all absent from the file.
6. Tracking numbers imported back from Pirate Ship land on the right
   orders by order ID.

### What already exists

**Nothing.** CONFIRMED by search across the repository: no Pirate Ship
export, no CSV of orders, no address fields, no shipment record. The
only CSV in the module is the receipts report under E39.

And the reason nothing exists is upstream of this line.

### The blocker, and the minimum to unblock it

**Checkout collects no name, no email and no street address.** The
checkout form at `src/app/store/checkout/page.tsx` posts four fields:
`viewer`, `items`, `state`, `county`. The order row holds `ship_state`,
`ship_county` and `ship_postal_code` and nothing else, and the postcode
is written empty today.

That omission is deliberate and I do not want it reversed. The comment
in `migrations/0004_store.sql` says the order keeps "only what the tax
figure has to be justified by", and `src/lib/store/types.ts` says
STORE_CHAIR holds NONE on member data and the module is built so that is
not an inconvenience. Both are right. The fix is not to widen the order
row.

**Where it has to be collected.** A fulfilment step between the cart and
the payment handoff — `/store/checkout/delivery`, before
`/store/checkout` — asking for the delivery details once. The buyer
needs to give them before they pay, not after, because a buyer who has
paid and closed the tab never comes back to a form.

**What the minimum is.** For a label and a confirmation:

- Recipient name
- Email address
- Address line 1, and line 2 optional
- City
- State
- Postcode
- Country, defaulted and for now restricted to the United States
- Phone, optional, and only because some carriers want it

The postcode is doing double duty here: it is the one field that is both
a label field and a tax field, and it is the field R21 already says must
be wired in and used to resolve the rate. The county dropdown of four
options should go; the rate should come from the postcode.

**Where it has to live.** Not on `store_order`. A separate `shipment`
table keyed on order ID, holding the address, the email, the export
state and the tracking number, with its own retention: purged a fixed
period after delivery, in code and on a schedule, not by intention.
`docs/PRIVACY-AND-PAYMENTS.md` makes that argument about applicants and
the same argument applies here. The order row keeps state, county and
postcode for the tax figure and keeps them forever. The street address
is operational data with a short life.

**Decision: Secretary, with counsel, on the retention period. Mine on
the form.** The split itself I would defend as proposed.

### The column format

The export must be written against a template downloaded from Pirate
Ship on the day it is built, not from anybody's recollection of it,
including this document's. Pirate Ship changes its importer and a label
exported into the wrong columns is a parcel delivered to the wrong
street.

The working column set, to be confirmed against that template:

`Order ID`, `Recipient Name`, `Company`, `Address Line 1`,
`Address Line 2`, `City`, `State`, `Zip`, `Country`, `Phone`, `Email`,
`Item Description`, `Quantity`, `Value`, `Weight (lb)`, `Weight (oz)`,
`Length`, `Width`, `Height`.

Which raises the thing nobody has mentioned: **weight and dimensions do
not exist on a product.** Pirate Ship needs them to price a label. Three
more fields on the product editor under E33 — weight in ounces, and
length, width and depth of the shipping box — plus a rule for a
multi-line order. My recommendation for the rule: sum the weights, use
the largest single box, and let me override on the export screen,
because I am the one holding the parcel.

### What is missing or undecided

- The delivery step, the `shipment` table, the exporter, the tracking
  re-import, and product weights and dimensions. All blocked on the
  first of those.
- **Whether tracking comes back automatically** through Pirate Ship's
  API or by me pasting a CSV. Start with the paste. An API integration
  for a store doing this volume is not worth the key management.
- **International orders.** We will get one. The export, the tax posture
  and the postage are all United States only today. My recommendation is
  to say so on the storefront and refuse the order at the delivery step
  rather than discover it at the post office counter. **Decision: mine.**

### Edge cases that will actually happen

- **The address is undeliverable or mistyped.** No validation exists.
  Either we validate at the delivery step through the carrier's own
  lookup, or I find out when the parcel comes back. Validation at the
  step, with the buyer able to override, is the right answer.
- **The buyer wants it sent somewhere other than their own address.**
  A gift. The delivery step must not assume the recipient is the buyer,
  which is also why the confirmation email under E38 goes to the buyer's
  email and the label carries the recipient's name.
- **An order is exported twice** and two labels are bought for one
  parcel. That is real money. Hence criterion 4 and the export state on
  the shipment row.
- **An order ships in two parcels.** One shipment row per parcel, each
  with its own tracking number, both pointing at the order.
- **A retired product is in an unshipped order.** The line still
  resolves, because the order line copied the name. The export uses the
  order line's own name, never a lookup through to the product. If it
  looked the product up, retiring a SKU would blank a label.

---

## E38 Order confirmation emails to the buyer

### What it must do

Within a minute of the payment clearing, the buyer gets an email that
tells them what they bought, what it cost, what tax was charged, where
it is going, and who to contact. When it posts, they get a second email
with the tracking number.

### Acceptance criteria

1. A paid order produces exactly one confirmation, addressed to the
   email the buyer gave, containing the order ID, the lines with
   variants, the subtotal, the postage, the tax with its rate, and the
   total.
2. The confirmation states that the purchase is not a charitable
   contribution and no part of it is deductible. Same wording as the
   receipt page.
3. The confirmation carries the North Carolina solicitation disclosure
   in the one agreed wording. See below.
4. No confirmation is sent for an unpaid, cancelled or expired order.
5. A failed send is visible to me as a failure, with the order ID, and
   is retried.
6. The email contains no card data, no member ID and no address other
   than the delivery address the buyer typed.
7. Posting an order sends the tracking email.

### What already exists

**No mail is sent anywhere in this platform.** Resend is the named
vendor (`docs/ARCHITECTURE.md:104`). The pattern to follow already
exists twice and is good: `src/lib/membership/notify.ts` and
`src/lib/scholarships/notify.ts` queue messages to an in-memory outbox
and never call a mail API inline. The membership one has a property
worth copying — `enqueue` does the same constant work on every path and
records undeliverability on the message rather than skipping the call.

For the store there is nothing at all, not even a stub. There is also no
email address to send to, which is the same blocker as E37 and is solved
by the same delivery step.

The receipt page at `src/app/store/checkout/complete/page.tsx` is
effectively the confirmation's content, already written and already
correct about deductibility. The email is that page, in text.

### What is missing or undecided

- **The delivery step**, for the address. See E37.
- **A store outbox** on the membership module's pattern, and a worker
  that sends from it. A send must never happen inline in the webhook
  handler: a mail API that is slow or down must not be able to stop us
  recording a payment.
- **The from address and the reply-to.** R11 is still open and this is
  my version of it. A confirmation that replies into an unrouted mailbox
  is worse than one with no reply address, because the member will reply
  to it about the wrong size. **Decision: Secretary and Webmaster**, and
  I need `store@` routed to a person before this line can ship.
- **The disclosure wording.** CONFIRMED in `docs/BOARD-REVIEW.md`
  finding 2: the statutory North Carolina text exists in two different
  wordings in the codebase, at `src/lib/donations/disclosure.ts:23` and
  `src/lib/treasury/workspace.ts:628`, and they cannot both be verbatim.
  R8 says reconcile them to one and confirm the number with the Branch.
  Until that is done I will not put either on a store email. **Decision:
  Secretary.**
- **Whether a store purchase is a "solicitation" for the statute at
  all.** It is merchandise, not a contribution, and the receipt already
  says so. The Secretary wants the disclosure at every point of
  solicitation and put checkout on that list. I would rather carry it
  than argue it. **Decision: Secretary, with counsel.**

### Edge cases that will actually happen

- **The email bounces.** The order is paid and we cannot reach the
  buyer. The order must show "confirmation undeliverable" on the
  tracker, and that flag is the only thing that will ever make me go
  looking for them before the parcel is returned.
- **The buyer mistypes their email.** Nothing detects it. A confirmation
  step on the delivery form that shows the address back to them in full
  before payment is the cheapest mitigation.
- **The buyer never gives an email** because the order is collected at
  an event. Then no confirmation is sent, the order says so, and the
  paper receipt is what they get. The flow must not require an email to
  complete a collected order, and it must not pretend one was sent.
- **The same order is confirmed twice** because the webhook was
  delivered twice. The send has to be keyed on the order ID and
  idempotent. Nothing undermines a receipt faster than two of them with
  different timestamps.
- **A refund is issued.** A refund email is not in scope for E38 as
  written, and it should be, because the alternative is that I type one
  by hand every time. Flagging it as a gap rather than quietly adding
  it: **scope question for the board.**

---

## E39 Sales export for the treasurer

### What it must do

The Treasurer, or the CPA, picks a period, clicks once, and gets a file
they can use without retyping anything: what the store took in, split
between members and non-members, with refunds and with the sales tax
collected shown separately from the receipts.

### Acceptance criteria

1. Picking a month, a quarter or a year produces a CSV whose figures
   reconcile to the on-screen report to the cent.
2. Both buyer-type rows appear even when one is zero. CONFIRMED already
   true.
3. Sales tax collected is reported beside the receipts, never inside
   them, because it is the state's money held in trust. CONFIRMED
   already true.
4. Orders awaiting payment and cancelled orders are excluded. CONFIRMED
   already true.
5. A role without aggregate access to Association financial records gets
   403 and no bytes of the file. CONFIRMED already true and well built.
6. A refund issued in a later period than the sale is reported where the
   board decides it should be. See below.

### What already exists

This is the line in the best shape and most of it is done.

- `src/lib/store/reports.ts` — `receiptsReport()`, `receiptsReportCsv()`,
  `taxPeriodRows()`, the period helpers, and `RECEIPTS_REPORT_NOTE`,
  which explains in plain words why the split exists. The note is
  carried into the CSV itself, so the CPA gets the reasoning with the
  figures.
- `src/app/board/store/receipts/page.tsx` — the screen.
- `src/app/board/store/receipts/export/route.ts` — the download. The
  authorization is inside `boardReceiptsCsv`, so the route cannot skip
  it and does not re-implement it.
- `src/app/board/store/tax/page.tsx` and `boardTaxPeriods()` — sales tax
  collected per month with the jurisdictions.
- STORE_CHAIR holds AGGREGATE, so **this is the one board screen I can
  fully use.**

### What is missing or undecided

- **A line-level export.** The receipts CSV is a compliance artefact and
  a good one. It is not a sales export: it cannot tell the Treasurer
  which products sold, and it cannot tell me what to reorder. A second
  export — one row per order line, with SKU, variant, name, quantity,
  unit price, line total, tax treatment, buyer type and order date — is
  what "sales export" means to the person asking for it. It needs the
  same AGGREGATE-level guard and it must carry no buyer handle and no
  member ID, which is what keeps it at AGGREGATE.
- **Refund timing.** CONFIRMED: `receiptsReport()` attributes
  `refundedCents` to the period of the *original order*, because it reads
  `order.refundedCents` and filters orders by `placedAt`. So a December
  refund of an October sale reduces October's net receipts after October
  was reported. That may be what the Treasurer wants and it may not, but
  nobody has been asked and the report does not say which it does.
  **Decision: Treasurer**, and whichever way it goes the CSV should
  state it in the note.
- **Nothing in the test suite covers the D1 path.** `npm test` runs
  against the in-memory repositories, so a broken
  `repository.d1.ts` would not fail a single test
  (`docs/PHASE2-FINDINGS.md` finding 7). For a file the Treasurer files
  a tax return from, that is the gap I would close first.
- **The export has never been run against real data**, because there has
  never been real data. The first run is with the CPA in the room.

### Edge cases that will actually happen

- **A refund on an order whose product has since been retired.** Works,
  and works by design. `order_line` copied the name, the price and the
  tax treatment at the moment of sale, so the refund computes its tax
  portion from the order row and never touches the product. The CSV
  reports it correctly. The two places this still bites: the retired
  SKU's remaining stock has vanished from the inventory screen (see
  E34), and a line-level sales export that joined back to `product` to
  get a category would lose the retired rows — so it must not join, it
  must read the line. Worth writing into the export's own comment, since
  the next person to extend it will be tempted.
- **A refund larger than the goods.** Refused:
  `buildRefundRequest()` caps at subtotal plus postage. Correct.
- **A refund that crosses a filed period.** The sales tax portion was
  already remitted. `refund.tax_portion_cents` is carried separately
  exactly so the Treasurer can claim it back on the right return, which
  is the right design. The export should show it as its own column.
- **A $40 refund approved by the person who raised it.** Under the $50
  threshold, so permitted by `refundRequiresSecondApprover()`. That is
  the designed threshold and I agree with it, but note that two $40
  refunds on one order are also permitted and nothing watches the
  pattern. A report of refunds by requester, monthly, is the cheap
  control.
- **The silent approval bug.** `approveRefundAction` in
  `src/app/board/store/actions.ts` does not await `boardApproveRefund`,
  so a refused self-approval redirects to "Refund rf-0003 approved." and
  approves nothing. Same defect as the count action under E34, same
  one-word fix, and it needs a test for the same reason: this is a
  financial control reporting success when it refused.

---

## Decisions I need, in the order they block work

| # | Decision | Who decides | What it blocks |
|---|---|---|---|
| 1 | Which data class governs a product record, so the Store Chair can run the catalogue | President, Treasurer, with me | E33 entirely, and E36's fulfilment queue |
| 2 | Member pricing: a discount in basis points, a full second price list, or neither | President, Treasurer | E32, and the shape of E33's product editor |
| 3 | Where product photographs are stored | Webmaster, with me | E33 screen 3, and every product card |
| 4 | Retention period for a delivery address, and that it lives outside the order row | Secretary, with counsel | E37, E38, and the delivery step both need |
| 5 | One North Carolina disclosure wording, confirmed with the Branch (R8) | Secretary | E38 |
| 6 | A routed `store@` mailbox (R11) | Secretary, Webmaster | E38 |
| 7 | Demo against live, and whether the stub payment button may ship (R12) | Board | E35, and launch |
| 8 | One or two payment provider accounts | Treasurer | E35 |
| 9 | Which period a refund is reported in | Treasurer | E39's note, and the first filing |
| 10 | Whether a refund confirmation email is in scope | Board | E38 |

Decisions I have made and am not asking for: the free-shipping
threshold stays at $150 and is stated on the storefront; postage is not
charged on an order with nothing to post; a refund does not
automatically restock; a second physical count for the same quarter is
refused rather than overwritten, with the adjustment form offered
instead; and an unpaid order expires after 24 hours.

## The one-line summary for the board

Of my nine contracted lines, E39 is substantially delivered, E31 and E34
need finishing, E35 is correctly stubbed and waits on a provider, E32
cannot be delivered as written and I have proposed what to deliver
instead, E36 cannot be delivered to the office it was contracted for
without a role-table change, E37 and E38 are blocked on one missing
checkout step, and **E33 does not exist at all and blocks four of the
others.** The first line of code I want written is `saveProduct`.
