import type { MetadataRoute } from "next";

import { changeFrequency, publicRoutes } from "./(public)/routes";

/**
 * The sitemap.
 *
 * There was none: /sitemap.xml returned 404 while robots.txt carried
 * no directives either, so the two things that tell a crawler what to
 * read were both absent.
 *
 * The base URL is thejsof.org because that is the domain this
 * deployment actually serves. When thejsoa.org moves to Cloudflare
 * this needs revisiting, and so does every canonical on the site.
 */

const BASE = "https://thejsof.org";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return publicRoutes().map((route) => ({
    url: `${BASE}${route}`,
    lastModified: now,
    changeFrequency: changeFrequency(route),
    priority: route === "/" ? 1 : route.split("/").length === 2 ? 0.8 : 0.5,
  }));
}
