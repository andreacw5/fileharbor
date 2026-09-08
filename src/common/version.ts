/**
 * Application version, read from package.json at runtime.
 *
 * `require` (not `import`) on purpose: importing the JSON would pull a file
 * outside `rootDir` into the compilation and shift the emitted `dist/` layout.
 * The relative path resolves identically from `src/common/` and `dist/common/`.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const APP_VERSION: string = require('../../package.json').version;
