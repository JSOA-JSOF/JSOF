import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DROPS, dropByCode } from "@/lib/drop/config";

import { Drop } from "./Drop";

/**
 * The page behind the code on the signage.
 *
 * Reached by scanning and by nothing else. It is in no navigation, no
 * sitemap and no search index, and the only link to it anywhere is printed
 * on a sign at the course.
 *
 * It is also deliberately not part of the public tier. The Association's
 * pages are a white site with a masthead and a footer, and this is a
 * single-purpose black card somebody looks at for ninety seconds on a
 * phone in sunlight, one-handed, on a course network. Wrapping it in the
 * site chrome would make it slower and harder to use and would gain
 * nothing: nobody arriving here is browsing.
 */

export const dynamic = "force-static";

export function generateStaticParams() {
  return DROPS.map((drop) => ({ code: drop.code }));
}

export const metadata: Metadata = {
  title: "Send us your photos",
  // Belt and braces with the X-Robots-Tag in next.config: the page should
  // not be indexed even if somebody posts the link somewhere.
  robots: { index: false, follow: false, nocache: true },
};

export default async function DropPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const drop = dropByCode(code);
  if (!drop) notFound();

  return <Drop drop={drop} />;
}
