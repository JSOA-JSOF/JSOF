import type { MetadataRoute } from "next";

/**
 * robots.txt.
 *
 * What was being served was Cloudflare's content-signals preamble:
 * twenty-four lines, every one a comment, declaring nothing and
 * reserving nothing despite the file's own text asserting rights. A
 * file of comments is not a policy.
 *
 * The non-public trees are listed explicitly rather than left to a
 * missing sitemap entry. A crawler that finds /board from a link
 * somewhere should be told not to index it, and `/drop` carries a
 * noindex header already but belongs here too: the gallery is for the
 * people who were at the event, reached by scanning a code, and it
 * should be shareable without being searchable.
 */

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/board",      // the board workspaces
          "/apply",      // application flows, gated
          "/sign-in",    // nothing to index, and it names no one
          "/drop",       // event photo drops, reached by a printed code
          "/soon",       // the holding page
          "/not-yet",    // the gated-feature notice
          "/api/",
          "/store/cart",
          "/store/checkout",
        ],
      },
    ],
    sitemap: "https://thejsof.org/sitemap.xml",
    host: "https://thejsof.org",
  };
}
