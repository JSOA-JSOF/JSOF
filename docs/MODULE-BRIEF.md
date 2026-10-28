# Module brief

Read this, `ARCHITECTURE.md` and `PRIVACY-AND-PAYMENTS.md` before writing code.
All three are binding. If your module needs to depart from them, say so in your
report rather than departing quietly.

## Own only your own paths

Every module owns a disjoint set of paths. Do not create or edit a file outside
yours — six agents are working in this repo at once and an edit outside your
lane will be lost or will break someone else.

| Module | Owns |
| --- | --- |
| public | `src/app/(public)/**`, `src/app/jsoa/**`, `src/app/jsof/**` |
| membership | `src/app/apply/**` EXCEPT `src/app/apply/scholarship/**`, `src/app/board/membership/**`, `src/lib/membership/**` (except `state.ts`) |
| scholarships | `src/app/apply/scholarship/**`, `src/lib/scholarships/**`. Its board screens at `src/app/board/scholarships/**` are the integration lane, not this module's. |
| secretary | `src/app/board/meetings/**`, `src/lib/meetings/**` |
| treasury | `src/app/board/treasury/**`, `src/lib/treasury/**` |
| foundation | `src/app/donate/**`, `src/app/board/donations/**`, `src/lib/donations/**` |
| store | `src/app/store/**`, `src/app/board/store/**`, `src/lib/store/**` |
| member tier | `src/app/members/**`. The screens a member sees of their own record, as distinct from the board's view of it. It had no row, which is why `src/lib/membership/self.ts` was written with no route to render it: the library is complete and the page is in nobody's lane. |
| comms | `src/lib/comms/**`, `src/app/board/comms/**`. `types.ts`, `queue.ts` and `sender.ts` are the shared seam every other module enqueues through, and are read-only to all of them. |

Shared and **read-only to every module**: `src/lib/authz/**`,
`src/lib/membership/state.ts`, `src/app/globals.css`, `src/app/layout.tsx`,
`src/app/page.tsx`, `src/app/entity.module.css`, `next.config.ts`,
`package.json`, `tsconfig.json`, `prisma/**`.

Your own test file is `tests/<module>.test.ts`. Do not edit
`tests/invariants.test.ts`.

## Reading another module's shared register

Allowed, and in one case required: a **read-only** call into another module's
library for something the spine says there is exactly one of — the compliance
calendar, the projects register. That is the filter the spine asks for, and the
alternative is six private copies, which is the drift the rule exists to stop.

Treasury does this for the compliance calendar and four other roles declined to,
because this brief did not say. It says now. Wrap the call so a failure there
degrades your tab rather than taking it out, and never write through it.

Everything else stays off limits: no reaching into another module's internals,
no writing, no importing its components.

## Do not

- Do not run `npm install` or add a dependency. The toolchain is fixed.
- Do not write a migration. `migrations/` has one owner; see below.
- Do not commit, branch, or run git commands.
- Do not weaken, re-implement, or work around anything in `src/lib/authz/`.
- Do not add a third-party script, font host, analytics tag or pixel.

## Phases, and why the lanes stop working for a while

The lane model above worked because of one sentence that used to be in
this file: persistence was deferred *so that six agents would not fight
over one schema*. That is no longer true. The database exists, and the
work left is exactly the thing that was deferred. Fanning six agents out
onto it now produces six incompatible migrations and six guesses at the
same session shape.

So the remaining work goes in three phases, and only two of them fan out.

### Phase 1. The spine. One agent, no fan-out.

Two things that everything else is shaped by:

1. **The schema**, for all six modules at once, in one numbered migration
   sequence. Not per module, because the foreign keys cross modules: an
   order points at a member, every audit row points at a person.
2. **Authentication and the session**, replacing the dev role switcher
   that currently stands in for it everywhere.

This cannot be parallelised and should not be attempted. Two agents both
writing `0003_*.sql` is a conflict that silently loses a table, and a
repository cannot be ported against a schema that is still moving.

### Phase 2. The ports. Six agents, one per module.

Each module implements its existing `repository.ts` interface against D1,
in its own lane, behind the same interface. This is the ideal fan-out:
the lanes are already disjoint, the interface is already fixed and was
written for this swap, and each module already has a test file that
proves the behaviour.

A module that finds it needs a schema change **reports it and stops**. It
does not write a migration. One owner for `migrations/`, in every phase.

### Phase 3. The new surfaces. Three or four agents.

Communications, the inbox queue screens, the member self-service portal,
and the CI and security gate. These touch different paths and no shared
state, so they run together. Communications is a new lane and needs a
line in the ownership table before it starts.

## Data: the repository interface, now against D1

Each module has, in `src/lib/<module>/`:

1. `types.ts` — the domain types. Money is `amountCents: number`, integer,
   always. Every record that can belong to an entity carries
   `entity: Entity` from `@/lib/authz/model`.
2. `repository.ts` — the interface, plus the in-memory implementation
   backed by seed data. **Keep both.** The in-memory one is what the test
   suite runs against, and it is what makes 818 tests fast enough to run
   on every change.
3. `seed.ts` — realistic but clearly fictional data. Real-looking names
   are fine; do not use the actual board members' names from the live
   site, and do not invent financial figures attributed to the real
   organizations.

The D1 implementation is a new file implementing the same interface,
selected at runtime. If porting forces a change to the interface, that is
a finding worth reporting: it usually means the interface was describing
the in-memory implementation rather than the module's actual needs.

Conventions, which the first two migrations already follow: text ids,
never autoincrementing integers; ISO-8601 UTC in text columns; nothing is
ever deleted, only revoked, closed or superseded. The audit log and the
message routes are append-only by database trigger, not by convention,
and that is deliberate — do not add a code path that expects to update
them.

## Authorization is not optional

Every server action and route handler that touches a data class calls
`authorize()` from `@/lib/authz/policy` first, with the right `dataClass`,
`entity` and `required` level. Read `src/lib/authz/model.ts` to see what your
module's roles actually hold — several roles have `AGGREGATE` where you might
expect `READ`, and that is deliberate.

For the demo, resolve the current subject from a dev-only role switcher:
read `src/lib/authz/policy.ts` for the `Subject` shape. Put your switcher usage
behind a clearly-labelled dev affordance; do not build an auth system.

A feature is not done until a **wrong-role request to it fails in a test.**
Write that test.

## UI conventions

- CSS Modules, one per route or component, co-located.
- Use the tokens in `src/app/globals.css`. Never introduce a colour literal.
  Entity hue is `--jsoa` / `--jsof`; set `--hue` on a wrapper and use
  `var(--hue)` beneath it, as `src/app/entity.module.css` does.
- Type: `Barlow Semi Condensed` for headings, `Source Sans 3` for body,
  `IBM Plex Mono` for labels and figures. Already loaded in the root layout.
- `font-variant-numeric: tabular-nums` anywhere figures line up in a column.
- Works at 375px wide. No horizontal page scroll.
- Both themes must work. Test by checking your colours come from tokens only.
- No emoji. No decorative gradients or shadows. This is an institutional tool
  for a veterans' organization; restraint reads as competence.

## Copy

Write from the reader's side of the screen. A control says what happens
("Send the vouch request", then a confirmation that says it was sent). Errors
say what went wrong and what to do. No exclamation marks.

Never put a member's name, unit, rank or face into a public-tier page.

## Before you report back

Run, from the repo root, and make sure both pass:

    npx tsc --noEmit
    npm test

The whole suite, not only your own file. Your test file passing while
someone else's breaks is not a green build, and a module that only runs
its own tests is a module that finds out at integration.

Then report: what you built, the routes you added, what you stubbed, any place
you had to depart from the spec, and anything you found that the spec gets
wrong. Be specific about what is NOT done.

**Say what you did not verify.** A report that reads as uniformly
confident is the expensive kind, because the reader cannot tell which
parts to check. If you inferred something from a type rather than running
it, say so. If a test passes for a reason you do not fully understand,
say that too.

## What is never delegated

Four things stay with a human, whatever the phase:

- **`src/lib/authz/**`.** The role and capability matrix is the control
  that several other controls are built on. It changes by review, not by
  a module deciding it needs more access.
- **The OPSEC and rights manifests**, `media.ts` and `sponsor-logos.ts`.
  An agent adding an entry is an agent asserting a review happened.
- **Anything that states a tax position or a legal obligation.** The
  deductibility wording, the North Carolina solicitation disclosure, the
  scholarship eligibility rule. Two of these are already with counsel.
- **Anything with a commercial consequence**: scope, fees, what is
  delivered against the statement of work.
