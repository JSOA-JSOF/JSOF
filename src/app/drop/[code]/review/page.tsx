import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DROPS, dropByCode } from "@/lib/drop/config";

import { Review } from "./Review";

/**
 * The board's view of what a drop has collected.
 *
 * Deliberately a plain page behind a key rather than part of the board
 * workspaces: those need a real database and real authentication, neither
 * of which exists, and the photographs need looking at this week. The key
 * is the same Worker secret `scripts/collect-photos.sh` uses, so there is
 * one credential rather than two.
 *
 * Nothing about this page is linked from anywhere. It is noindex by the
 * header on /drop/:path* and by its own metadata.
 */

export const dynamic = "force-static";

export function generateStaticParams() {
  return DROPS.map((drop) => ({ code: drop.code }));
}

export const metadata: Metadata = {
  title: "Review",
  robots: { index: false, follow: false, nocache: true },
};

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const drop = dropByCode(code);
  if (!drop) notFound();

  return <Review code={drop.code} event={drop.event} />;
}
