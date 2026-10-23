import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DROPS, dropByCode } from "@/lib/drop/config";

import { Gallery } from "./Gallery";

/**
 * The event gallery.
 *
 * Not a publication. It is a window, open for as long as the drop is,
 * at an address nobody reaches except by scanning the code on the sign,
 * and noindex so it cannot be found any other way. Its job is to let
 * somebody who has just sent photographs from a phone see that the
 * photographs arrived.
 *
 * It closes with the drop, and after that the routes behind it stop
 * serving rather than quietly carrying on.
 */

export const dynamic = "force-static";

export function generateStaticParams() {
  return DROPS.filter((drop) => drop.gallery).map((drop) => ({ code: drop.code }));
}

export const metadata: Metadata = {
  title: "Gallery",
  robots: { index: false, follow: false, nocache: true },
};

export default async function GalleryPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const drop = dropByCode(code);
  if (!drop || !drop.gallery) notFound();

  return (
    <Gallery
      code={drop.code}
      event={drop.event}
      where={drop.where}
      closesAt={drop.closesAt}
    />
  );
}
