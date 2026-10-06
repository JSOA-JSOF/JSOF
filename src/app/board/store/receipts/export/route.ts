import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { boardReceiptsCsv } from "@/lib/store/board";
import { monthPeriod, quarterPeriod, yearPeriod } from "@/lib/store/reports";
import type { Period } from "@/lib/store/types";

/**
 * CSV export of the member versus non-member receipts report.
 *
 * `boardReceiptsCsv` calls `authorize()` for AGGREGATE on FINANCIAL for JSOA
 * before it reads an order, so a wrong-role request to this URL returns 403 and
 * no bytes of the report. The handler does not re-implement the check and
 * cannot skip it: there is no path from here to the repository that does not go
 * through that function.
 */

function periodFrom(key: string | null): Period {
  if (key === null || key === "2026") return yearPeriod(2026);
  const quarter = /^(\d{4})-Q([1-4])$/.exec(key);
  if (quarter) {
    return quarterPeriod(Number(quarter[1]), Number(quarter[2]) as 1 | 2 | 3 | 4);
  }
  const month = /^(\d{4})-(\d{2})$/.exec(key);
  if (month) return monthPeriod(Number(month[1]), Number(month[2]));
  return yearPeriod(2026);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const subject = await getCurrentSubject();
  const period = periodFrom(url.searchParams.get("period"));

  let csv: string;
  try {
    csv = boardReceiptsCsv(subject, period);
  } catch (error) {
    if (error instanceof AuthzError) {
      return new Response(
        "This role does not hold aggregate access to JSOA financial records, " +
          "so the receipts report is not available to it.\n",
        { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    }
    throw error;
  }

  const filename = `jsoa-store-receipts-${period.label.replace(/\s+/g, "-").toLowerCase()}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
