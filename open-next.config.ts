import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Next.js on Cloudflare Workers, via the OpenNext adapter.
 *
 * No incremental cache is configured yet, because nothing on the public tier
 * is revalidated on a timer: every page is content that changes when we
 * deploy. When the board workspaces land they will need R2 or KV here.
 */
export default defineCloudflareConfig();
