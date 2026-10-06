/**
 * War-veteran derivation.
 *
 * `isWarVeteran` decides whether gifts to JSOA are deductible (the 90% test),
 * so it is derived here from the attested service dates rather than taken from
 * a checkbox. The checkbox is kept, compared, and disagreements are counted on
 * the composition report — a member who ticks the box while their dates say
 * otherwise is a record to fix, not a number to quietly adjust.
 *
 * DO NOT rebuild this from Treas. Reg. 1.501(c)(19)-1. That regulation still
 * says 75% of members must be *war* veterans; Congress deleted that in 1982
 * and the regulation was never conformed. Using it would fail a roster that
 * passes the statute. The periods below are the statutory wartime periods
 * (38 U.S.C. 101), and the tests they feed come from the statute and
 * IRS Pub. 3386, not from the stale regulation.
 */

export type WartimePeriod = {
  name: string;
  /** ISO `YYYY-MM-DD`, inclusive. */
  from: string;
  /** ISO `YYYY-MM-DD`, inclusive. Null means the period has never been terminated. */
  to: string | null;
  note?: string;
};

export const WARTIME_PERIODS: WartimePeriod[] = [
  { name: "World War II", from: "1941-12-07", to: "1946-12-31" },
  { name: "Korean conflict", from: "1950-06-27", to: "1955-01-31" },
  {
    name: "Vietnam era",
    from: "1964-08-05",
    to: "1975-05-07",
    note:
      "Begins 1961-02-28 for service in the Republic of Vietnam. The platform " +
      "does not collect location of service, so the later general start date " +
      "is used and an in-country claim is a chair exception.",
  },
  {
    name: "Persian Gulf War",
    from: "1990-08-02",
    to: null,
    note:
      "Never terminated by Congress or by Presidential proclamation. Any " +
      "service from 1990-08-02 onward is wartime service, which is why most " +
      "of this roster qualifies.",
  },
];

function toDayNumber(iso: string): number | null {
  // Parse without timezone drift: dates here are calendar dates, not instants.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day);
}

/** True when the service range overlaps the period at all, by even one day. */
function overlaps(
  serviceFrom: number,
  serviceTo: number,
  period: WartimePeriod,
): boolean {
  const periodFrom = toDayNumber(period.from);
  if (periodFrom === null) return false;
  const periodTo = period.to === null ? Number.POSITIVE_INFINITY : toDayNumber(period.to);
  if (periodTo === null) return false;
  return serviceFrom <= periodTo && serviceTo >= periodFrom;
}

/**
 * Which wartime periods a service range touches. Empty means peacetime-only
 * service, which still counts toward the 75% armed-forces test and does not
 * count toward the 90% war-veteran test.
 */
export function wartimePeriodsServed(
  serviceFrom: string | null,
  serviceTo: string | null,
): WartimePeriod[] {
  if (!serviceFrom) return [];
  const from = toDayNumber(serviceFrom);
  if (from === null) return [];
  // Still serving: an open end date runs to today, which lands inside the
  // Persian Gulf period and so qualifies.
  const to = serviceTo ? toDayNumber(serviceTo) : Date.now();
  if (to === null || to < from) return [];
  return WARTIME_PERIODS.filter((period) => overlaps(from, to, period));
}

export function deriveIsWarVeteran(
  serviceFrom: string | null,
  serviceTo: string | null,
): boolean {
  return wartimePeriodsServed(serviceFrom, serviceTo).length > 0;
}

/** For the applicant-facing copy: plain English, no citation. */
export function describeWartimeService(
  serviceFrom: string | null,
  serviceTo: string | null,
): string {
  const periods = wartimePeriodsServed(serviceFrom, serviceTo);
  if (periods.length === 0) return "No wartime period matches these dates.";
  return periods.map((p) => p.name).join(", ");
}
