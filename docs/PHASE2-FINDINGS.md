# What the D1 ports found

Running notes from phase 2. Each item was reported by a port, then
checked against source or against the live database before being
written down here. Where a port's reasoning was right but its evidence
was thin, that is said.

## 1. No module can create its own reference data

Found independently by the store port and the donations port, which is
what makes it worth the top of this file.

- There is no `saveProduct`. The `product` table is read-only from the
  store module, so **a deployed store with a database shows an empty
  catalogue** and no code path can change that.
- There is no way to create a `fund` or a `sponsorship`. Against a
  fresh database **the public donate form offers no funds** and the
  sponsor register is empty.

Neither is a schema gap. The tables are right and no migration is
needed. It is a gap in the repository contracts, and it was invisible
for as long as the data came from `seed.ts`: the in-memory
implementation filled its arrays at construction, so nothing ever
needed a create method. Swapping the backing store is what exposed it.

**This must not be fixed by seeding the fiction.** `seed.ts` is
deliberately realistic and deliberately false. Loading it into the real
database would put invented products in a live storefront and invented
funds on a live donate form.

What it actually needs is the administrative screens that let a chair
enter the real thing, which is contracted scope that was never built:
Annex A E33 is "Product catalog with images and variants". The status
assessment of 27 October marked E33 "Part" on the strength of the
catalogue existing in data. That was too generous, and this is why.

## 2. Storing a decision and discarding its inputs

Migration 0007 kept the scholarship routing outcome and explanation but
not the three answers behind them. `routing.ts:145` recomputes which
programmes an applicant may apply for from
`answers.applyingForWoundedPatriot`, so with no column the Wounded
Patriot intake step would never have appeared, and nothing would have
thrown. Fixed in 0010. Verified in source before acting.

The general form is worth remembering: keeping a derived result and
dropping what it was derived from is safe right up until something
downstream derives it again.

## 3. The dev persona switcher cannot coexist with a database

It mints ids like `dev:vp-membership`, which are not rows in `person`,
and D1 enforces foreign keys. A chair decision recorded by a persona
failed at the end of a workflow that had already done its work.

Dropping the constraint would have weakened a real control for a
dev-only reason, and writing null would have dropped the approver from
the record the no-self-approval rule depends on. So the fallback is now
refused whenever a binding exists.

## 4. A guard that broke the thing it was meant to protect

`src/lib/db` imported `server-only`, which only the Next build
resolves. Every repository that reached it killed the whole suite at
collection. Four ports hit it independently and three had already
written their own workaround before the central fix reached them.

## 5. Counters must be primed when records are imported

A counter starts at zero, so the first allocation against a roster
imported with its own numbers returns one already taken, and the unique
index fails the write after the money has been taken. Belongs to
whoever writes the import.

## 6. Verified against the live database, so nobody re-asks

- Foreign keys **are** enforced.
- A failed multi-statement request **does** roll back.
- `INSERT … ON CONFLICT … RETURNING` works, and the counter is
  race-free: ten concurrent allocations returned 1 to 10, no duplicate.
- The triggers fire: cross-entity allocation, self-approved
  reimbursement, edited ledger entry, edited audit row, and a transfer
  that does not cross entities.
- Every SQL statement in the store port prepares cleanly against the
  real schema. That port had executed none of its own SQL, so this was
  the only thing standing behind 630 lines of it.

## 7. What no port verified, and still nobody has

**Not one line of any D1 repository has run inside a Worker.** The
ports used SQLite shims or nothing. What that leaves unproven is the
TypeScript around the SQL rather than the SQL itself: the row-to-domain
mapping functions, `one`/`many`/`atomic` under the real driver, whether
`.bind(null)` writes SQL NULL, and the error shape D1 raises on a
trigger abort.

No port opened a browser. No board or storefront screen has been
rendered against a database.

There is also no committed test covering any D1 implementation. The
suite runs against the in-memory repositories, as it should for speed,
but that means nothing in `npm test` will catch a broken
`repository.d1.ts`. The vitest config can now resolve `server-only`, so
the harnesses the ports built in scratch directories could move into
`tests/`.
