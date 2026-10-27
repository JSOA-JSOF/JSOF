/**
 * A no-op stand-in for the `server-only` package, under test.
 *
 * `server-only` is not a real module. Next resolves it to one file in a
 * server bundle and to a file that throws in a client bundle, which is
 * how a server-side import is caught at build time rather than at
 * three in the morning. Outside the Next build it resolves to nothing
 * at all, so any module that imports it takes the whole suite down at
 * collection, before a single assertion runs.
 *
 * That is exactly what happened when `src/lib/db` picked up the guard:
 * every repository that imports it is on the test graph. Aliasing it
 * here keeps the guard where it earns its keep, in the real build, and
 * stops it breaking the tests.
 */
export {};
