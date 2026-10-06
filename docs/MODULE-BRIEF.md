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

Shared and **read-only to every module**: `src/lib/authz/**`,
`src/lib/membership/state.ts`, `src/app/globals.css`, `src/app/layout.tsx`,
`src/app/page.tsx`, `src/app/entity.module.css`, `next.config.ts`,
`package.json`, `tsconfig.json`, `prisma/**`.

Your own test file is `tests/<module>.test.ts`. Do not edit
`tests/invariants.test.ts`.

## Do not

- Do not run `npm install` or add a dependency. The toolchain is fixed.
- Do not touch `prisma/`. Persistence lands in a later pass (see below).
- Do not commit, branch, or run git commands.
- Do not weaken, re-implement, or work around anything in `src/lib/authz/`.
- Do not add a third-party script, font host, analytics tag or pixel.

## Data: repository interface + seed, no database yet

This is a demo build. Persistence is deliberately deferred so the demo runs with
no database and so six agents do not fight over one schema.

Each module defines, in its own `src/lib/<module>/`:

1. `types.ts` — the domain types. Money is `amountCents: number`, integer,
   always. Every record that can belong to an entity carries
   `entity: Entity` from `@/lib/authz/model`.
2. `repository.ts` — an interface describing the reads and writes your module
   needs, plus an in-memory implementation backed by seed data.
3. `seed.ts` — realistic but clearly fictional data. Real-looking names are
   fine; do not use the actual board members' names from the live site, and do
   not invent financial figures attributed to the real organizations.

Swapping to Prisma later should be one new file per module implementing the
same interface.

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

Then report: what you built, the routes you added, what you stubbed, any place
you had to depart from the spec, and anything you found that the spec gets
wrong. Be specific about what is NOT done.
