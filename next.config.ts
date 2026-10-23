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
        // The drop pages are reached by scanning a code on a sign at an
        // event. They are not in the navigation, not in the sitemap, and
        // they should not be in an index either, whatever gets posted
        // where. The page metadata says the same thing; this says it in a
        // header, which is the one a crawler reads before the HTML.
        source: "/drop/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
    ];
  },
};

export default nextConfig;
