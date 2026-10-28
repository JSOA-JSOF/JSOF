import type { Entity } from "../authz/model";
import type { SenderIdentity, Stream } from "./types";

/**
 * Which identity a message goes out as.
 *
 * Resolved from the entity rather than passed in, so no caller can
 * pick. The rule it enforces is the one the board review found broken
 * all over the site: the two organizations are separate, and a
 * 501(c)(19) receipt arriving from the Foundation's address is the
 * same confusion in the one artifact a person keeps.
 *
 * `ready` is false where the domain cannot send yet. thejsof.org is on
 * Cloudflare and can be verified; thejsoa.org still has its
 * nameservers pointing at Wix and nobody holds the registrar login,
 * so Association mail queues rather than going out wearing the
 * Foundation's name. That is a deliberate refusal of the obvious
 * shortcut.
 */

const FOUNDATION_DOMAIN = "thejsof.org";

export function senderFor(entity: Entity | null, stream: Stream): SenderIdentity {
  if (entity === "JSOF") {
    return {
      address: `${stream === "BULK" ? "news" : "notices"}@${FOUNDATION_DOMAIN}`,
      name: "Joint Special Operations Foundation",
      ready: true,
    };
  }
  if (entity === "JSOA") {
    return {
      address: `${stream === "BULK" ? "news" : "notices"}@thejsoa.org`,
      name: "Joint Special Operations Association",
      // Blocked on the domain move. See docs/DNS-AND-EMAIL.md.
      ready: false,
    };
  }
  // Platform mail: a sign-in link, which makes no tax claim and speaks
  // in no entity's voice. The board was asked whether this may go from
  // the Foundation's verified domain as infrastructure; until it
  // answers, this is the one identity that is neither organization.
  return {
    address: `platform@${FOUNDATION_DOMAIN}`,
    name: "JSOA / JSOF platform",
    ready: true,
  };
}
