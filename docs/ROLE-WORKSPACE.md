# The role workspace

Every board role gets the same spine. Five tabs, then that role's own function
tabs. This file is binding; `docs/DASHBOARD-BRIEF.md` still governs the
Dashboard tab specifically.

    Overview · Dashboard · Planning · Projects · Outside view · <function tabs>

## The rule that shapes all of it

**Four of the five are filtered views of shared data, not per-role copies.**

There is one compliance calendar, one minute book per entity, one register of
lines of effort. A per-role copy of any of them is a second source of truth
that will drift from the first, and six roles each with their own "meetings
archive" is six doors into one room, five of which go stale.

So: build a filter, not a copy. If you find yourself creating a per-role store
of something that exists centrally, stop — that is the mistake this rule names.

## Overview — what needs doing

The landing tab. Two things, both filtered to the signed-in role:

1. **Calendar items** that are theirs, from the shared calendar.
2. **Tasks**, which are **derived from state and never entered by hand.**

The second is the one that fails silently. A task list people must populate is
dead within a cycle on an all-volunteer board — that is the same failure as the
spreadsheet this platform replaces. A task is a function of the data: three
applications waiting on you, a renewal in fourteen days with no second
administrator, a verification outstanding, a minute book with a decision and no
motion. If you cannot derive it, it is not a task, it is a note.

Most of this already exists as the `actions` lists on the dashboards. Lift them
here. The Dashboard keeps its figures; the Overview takes the doing.

## Dashboard — how we know it is working

**One to three figures.** Not seven. A volunteer looking at seven numbers has
none, and the board asked specifically for 1–3 per role.

Pick the ones that would change a decision. Everything else moves behind a
"more figures" disclosure or goes away. `docs/DASHBOARD-BRIEF.md` still applies
in full: honest about what cannot be measured, provenance on every tile, good
takes no colour.

## Planning — my items for the next meeting

What this role wants on the next agenda, with the type (decision, discussion,
information), an estimate, and the reason. These flow into the Secretary's
agenda builder rather than being retyped there.

This is how agendas actually get built, and it has a second effect worth
knowing: it makes the communications material a by-product of what every role
already filed, instead of something nobody volunteers to write.

## Projects — lines of effort

Filtered from **one** org-level register, never a per-role store. Most projects
cross roles — the Ball is Events plus Fundraising plus Treasury plus
Communications — and per-role silos would hide exactly the handoffs where this
organization loses things.

The three published lines of effort are the top of that register: memorialize
the fallen, scholarships and grants for JSOC families, support JSOC family
events. A role sees what it owns and what it contributes to, and who holds the
other parts.

## Outside view — what the world sees of my function

The newest tab and the one with the clearest payoff, because every finding we
have about the live site is the same failure: nobody owns what their function
looks like from outside.

Three parts:

1. **Public pages this function owns**, with staleness flagged — a date in the
   past, a year that contradicts the content, a dead link.
2. **What is queued for release** awaiting a second approver. The OPSEC gate
   already exists but lives in a shared queue; surfacing it here means a person
   sees what is about to go out under their name.
3. **Two audiences, side by side: public, and member or donor.** The
   architecture already separates them and conflating them is how OPSEC
   problems start. Show both columns, never one blurred "outside".

**Some roles have almost no external surface**, and that is correct rather than
missing. The Secretary's output is the minute book, which is internal by
design; the Finance Review Officer's independence depends on having no external
voice at all. For those, the tab says so plainly. An empty screen implies
something is broken; a sentence explaining why it is empty does not.

## Function tabs

Unchanged. The role's actual work: Review, Verify, Awards, Notify for
scholarships; Ledger, Transfers, Subscriptions, Controls for treasury.

## Shared code

Use these. Do not write your own.

- `@/lib/workspace/types` — `RoleTask`, `RoleCalendarItem`, `PlanningItem`,
  `OutsideItem`, `OutsideSurface`
- `@/components/workspace-shell/RoleTabs` — the tab strip
- `@/components/workspace-shell/TaskList` — derived tasks
- `@/components/workspace-shell/OutsideColumns` — the two-audience view
- `@/lib/projects` — the one lines-of-effort register
- `@/components/dashboard/Kpi` — tiles, per DASHBOARD-BRIEF

## Authorization

As everywhere: resolve the subject with `getCurrentSubject()`, read through
your module's library, never widen a grant to make a tab work. A figure or an
item the reader may not see is **withheld**, which is a different state from
absent and from zero. If a role cannot legitimately see something, that is the
answer — say so in the tab and report it.
