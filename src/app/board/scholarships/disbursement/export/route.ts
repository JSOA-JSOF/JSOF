import { AuthzError } from "@/lib/authz/policy";
import { getCurrentSubject } from "@/lib/authz/session";
import { chequeRunCsv } from "@/lib/scholarships/disbursement";
import { scholarshipRepository } from "@/lib/scholarships/repository";

/**
 * The cheque run, as a file the Treasurer can work from.
 *
 * Two lines of handler, because the library builds the CSV and decides who may
 * read it. Worth knowing what is deliberately absent: no applicant name is in
 * this file. The payee is the school and the student appears only as an award
 * reference on the memo line, which is why the Treasurer — who holds no
 * applicant grant at all — can open it without being handed the applicant roll.
 */
export async function GET() {
  try {
    const csv = await chequeRunCsv(scholarshipRepository(), await getCurrentSubject());
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="scholarship-cheque-run.csv"',
        // A cheque run is a point-in-time working document, not something to
        // serve from a cache after the figures have moved.
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const denied = error instanceof AuthzError;
    return new Response(
      denied ? error.message : "The cheque run could not be built.",
      { status: denied ? 403 : 500, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
}
