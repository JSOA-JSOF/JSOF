/**
 * Bindings this Worker expects, for the type checker.
 *
 * `EVENT_PHOTOS` is optional on purpose. The binding does not exist until
 * R2 is switched on for the account, and the upload route has to compile
 * and deploy before that happens, so the absence is a state the code
 * handles rather than a state that fails the build.
 */
declare global {
  interface CloudflareEnv {
    EVENT_PHOTOS?: R2Bucket;
    /** The board's key for reading a drop back out. A Worker secret. */
    DROP_ADMIN_KEY?: string;
    STAGE?: string;
  }
}

export {};
