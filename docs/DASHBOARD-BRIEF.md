# Role dashboards

Every `/board/<module>` overview is that role's dashboard. Not a link menu
with a few counts on it — the figures that tell the person holding the seat
whether their part of the organization is working, and what needs doing next.

Use `@/components/dashboard/Kpi`: `KpiGrid`, `KpiTile`, and the `Kpi` type.
It is shared and read-only. Do not write your own tile.

## The rules, and why they exist

**1. A figure that cannot be computed yet says so.** Set `value: null` and give
`needs`. Never substitute zero. Zero is a measurement; "not yet measured" is
the truth, and someone deciding whether a number is bad needs to know which one
they are looking at. Several of the best KPIs here are not computable until
there is real data, and saying so is more useful than a confident nought.

**2. Every tile states what it was computed from,** in one line, in `from`. A
figure whose provenance nobody can reconstruct gets argued about instead of
acted on. "119 of 150 applications" is provenance. "Live data" is not.

**3. Good is unremarkable.** `status: "good"` takes no colour. Only `watch` and
`problem` are coloured. A wall of green ticks trains people to stop reading,
and the palette is black, gold and white — there is no room for a fourth hue.
Gold is the brand, never a status.

**4. No vanity metrics.** A number that only ever goes up, or that rises when
you publicise and falls when you don't, is not a KPI. If you cannot say what
decision a figure would change, leave it out.

**5. Honest arithmetic.** Integer cents, no floats. A percentage states its
denominator. A median says it is a median.

**6. Then say what to do.** Under the figures, the actions that follow from
them, each with a count and a link into the work. A dashboard that only reports
is a report.

## What a tile looks like

```ts
{
  key: "outcome-told",
  label: "Applicants who received an outcome",
  value: "119 of 150",
  target: "150 of 150",
  status: "problem",
  from: "Awards notified, against applications decided this cycle",
}
```

and one that cannot be computed yet:

```ts
{
  key: "chair-hours",
  label: "Chair hours per cycle",
  value: null,
  status: "unmeasured",
  from: "Timestamps on the chair's own actions",
  needs: "action timing, which lands with persistence",
}
```

## Scope

Four to seven tiles. Past that nobody reads any of them. If you have more
candidates than that, the extras go in a second tier below the actions as plain
rows, or they go away.

## Authorization

The dashboard is scoped like every other screen: resolve the subject with
`getCurrentSubject()` and read through your module's library, which is where
authorization lives. A viewer lacking scope for a figure sees it withheld, not
zero — the same distinction as rule 1, for the same reason.

Do not widen a grant to make a tile work. If a role cannot legitimately see a
figure, that is the answer; say so in the tile and report it.
