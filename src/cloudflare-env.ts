/**
 * Bindings this Worker expects, for the type checker.
 *
 * A .ts rather than a .d.ts on purpose. `skipLibCheck` is on, which skips
 * declaration files, and that quietly hid the fact that `R2Bucket` did not
 * resolve at all here: the binding was typed as an error, which behaves as
 * `any`, so none of the bucket calls were checked. The runtime types now
 * come from `worker-configuration.d.ts`, regenerated with `wrangler types`
 * whenever wrangler.jsonc changes, and this file is checked like any other.
 *
 * `EVENT_PHOTOS` is optional on purpose. The binding does not exist until
 * R2 is switched on for the account, and the upload route has to compile
 * and deploy before that happens, so the absence is a state the code
 * handles rather than a state that fails the build.
 */
declare global {
  interface CloudflareEnv {
    /** The platform database. See migrations/. */
    DB?: D1Database;
    EVENT_PHOTOS?: R2Bucket;
    /** The board's key for reading a drop back out. A Worker secret. */
    DROP_ADMIN_KEY?: string;
    STAGE?: string;
  }
}

export {};
