/// <reference types="vite/client" />

/** Build-time configuration. Declared explicitly rather than relying on Vite's index
 * signature, so a typo in an env var name is a compile error. */
interface ImportMetaEnv {
  /** Endpoint that the optional email reminder form POSTs to. Unset disables the form. */
  readonly VITE_REMINDER_ENDPOINT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Build-time asset revision, injected by `define` in web/vite.config.ts. Appended to
 * media URLs so new art is never served from a cache entry keyed to the old art. */
declare const __ASSET_REV__: string;
