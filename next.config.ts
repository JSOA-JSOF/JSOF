import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // No third-party tags ship by default. See docs/PRIVACY-AND-PAYMENTS.md:
  // analytics and session-replay scripts are being litigated as wiretapping
  // and carry no nonprofit exemption. Anything added later needs a consent
  // gate and a tag-inventory entry.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            // There was none.
            //
            // Worth doing now rather than later: the site loads
            // Google Fonts and nothing else third-party, so a strict
            // policy is achievable today and gets harder with every
            // addition. `unsafe-inline` on styles is Next's
            // requirement for its own style injection, not ours.
            //
            // `frame-ancestors 'none'` is the modern form of
            // X-Frame-Options, which stays alongside it for older
            // browsers rather than instead of it.
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // 'unsafe-inline' for Next's hydration bootstrap. A
              // nonce would be better and needs middleware on every
              // response, which is a change to make deliberately.
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              // blob: is the photo drop: the browser resizes before
              // upload and previews the result from a blob URL.
              "img-src 'self' data: blob:",
              "media-src 'self'",
              "connect-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "upgrade-insecure-requests",
            ].join("; "),
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Everything that is not the public tier, as one rule.
        //
        // These were relying on per-page metadata, which is a thing
        // somebody forgets on the next page they add. robots.txt
        // disallows them too, but that is a request a crawler may
        // ignore and this is a header it must honour.
        //
        // The drop pages are the sharpest case: they are reached by
        // scanning a code on a sign, and the gallery should be
        // shareable without being searchable.
        source: "/:path(board|apply|drop|sign-in|soon|not-yet)/:rest*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
      {
        // The same prefixes without a trailing path, which the rule
        // above does not match.
        source: "/:path(board|apply|drop|sign-in|soon|not-yet)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
    ];
  },
};

export default nextConfig;
