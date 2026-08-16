/**
 * The engine version.
 *
 * Kept in its own module so both the library and the CLI can read it without
 * importing `package.json` — which would need a JSON import assertion and
 * differs between Node versions and bundlers.
 */
export const VERSION = '0.1.0';
