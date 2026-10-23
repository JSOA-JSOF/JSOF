import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DROPS, dropByCode } from "@/lib/drop/config";

import { Photos } from "./Photos";

/**
 * The public page for an event's photographs.
 *
 * Everything on it has been through both gates: the person who took it
 * ticked the box, and the board cleared it. Nothing arrives here by
 * default and nothing arrives here quickly, which is the intention.
 *
 * Still noindex, by the header on /drop/:path*. Open to anyone with the
 * link is a different thing from listed in a search engine, and an event
 * page full of faces should be the first and not the second.
 */

export const dynamic = "force-static";

export function generateStaticParams() {
  return DROPS.filter((drop) => drop.publicGallery).map((drop) => ({
    code: drop.code,
  }));
}

export const metadata: Metadata = {
  title: "Photos",
  robots: { index: false, follow: false },
};

export default async function PhotosPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const drop = dropByCode(code);
  if (!drop || !drop.publicGallery) notFound();

  return <Photos code={drop.code} event={drop.event} where={drop.where} />;
}
