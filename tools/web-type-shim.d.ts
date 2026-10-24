/** Minimal stand-ins for the web dependencies, so the web sources can be typechecked on a
 * machine where `npm install` cannot run.
 *
 * This exists because of a build failure it would have caught. A refactor deleted a helper
 * and left its call site, and `tsc --project web/tsconfig.json` reports only
 * "cannot find type definition file for 'vite/client'" when the dependency is absent --
 * it never typechecks the program at all. So the local check printed nothing, I read
 * nothing as clean, and the undefined identifier was found by Cloudflare.
 *
 * Everything here is deliberately `any`. The point is not to typecheck React usage; it is
 * to get a complete program so that errors about *our own* names surface. Real type
 * checking against the real dependencies still happens in the build.
 */
declare module 'react' {
  const react: any;
  export default react;
  // Generic rather than `any`: the sources call useState<T>() and useRef<T>(), and an
  // untyped function cannot accept type arguments (TS2347), which would bury the real
  // errors under hundreds of those.
  export function useState<T>(initial?: T | (() => T)):
    [T, (next: T | ((previous: T) => T)) => void];
  export function useRef<T>(initial: T | null): {current: T | null};
  export function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;
  export function useCallback<T>(fn: T, deps?: readonly unknown[]): T;
  export function useEffect(fn: () => unknown, deps?: readonly unknown[]): void;
  export function useLayoutEffect(fn: () => unknown, deps?: readonly unknown[]): void;
  export const StrictMode: any;
  export type ReactNode = any;
  export type CSSProperties = any;
  export type KeyboardEvent<T = any> = any;
  export type MouseEvent<T = any> = any;
  export type PointerEvent<T = any> = any;
  export type ChangeEvent<T = any> = any;
  export type ComponentPropsWithoutRef<T = any> = any;
  export type ReactElement = any;
}
declare module 'react/jsx-runtime' {
  export const jsx: any, jsxs: any, Fragment: any;
}
declare module 'react-dom/client' {
  const client: any;
  export default client;
  export const createRoot: any;
}
/** A DOM event, to the extent this shim needs one.
 *
 * Exists so JSX event handlers are not typed `any`. They were, and it cost a Cloudflare
 * build: `startAudio` grew an optional `MusicTrack` parameter and stayed wired as
 * `onPointerDownCapture={startAudio}`, so React would have called it with its own
 * PointerEvent and the app would have tried to play a track named after an event object.
 * The real build caught it; this shim had said it was fine.
 *
 * Deliberately structural and minimal rather than an attempt at React's real event types:
 * the point is only that an event is *an object*, which is enough to reject a function
 * expecting a string union. */
interface ShimDomEvent {
  currentTarget: any;
  target: any;
  // Required rather than optional, and knowingly over-provided: a keyboard event has no
  // clientX. Assignability runs the other way here -- a handler declaring `{clientX:
  // number}` only accepts an event type that *has* it, so an optional field rejects an
  // honest handler. Over-providing costs nothing, because the thing this must still reject
  // is a function whose parameter is not an object at all.
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  clientX: number;
  clientY: number;
  pointerId: number;
  preventDefault(): void;
  stopPropagation(): void;
}

/** Element props: handlers typed, everything else still open.
 *
 * The index signature keeps the shim's bargain -- it knows nothing about real DOM
 * attributes and must not start failing builds over them -- while the named handlers are
 * specific enough to catch a function wired to the wrong shape. */
interface ShimElementProps {
  onClick?: (event: ShimDomEvent) => unknown;
  onChange?: (event: ShimDomEvent) => unknown;
  onSubmit?: (event: ShimDomEvent) => unknown;
  onKeyDown?: (event: ShimDomEvent) => unknown;
  onKeyUp?: (event: ShimDomEvent) => unknown;
  onPointerDown?: (event: ShimDomEvent) => unknown;
  onPointerDownCapture?: (event: ShimDomEvent) => unknown;
  onPointerUp?: (event: ShimDomEvent) => unknown;
  onFocus?: (event: ShimDomEvent) => unknown;
  onBlur?: (event: ShimDomEvent) => unknown;
  onInput?: (event: ShimDomEvent) => unknown;
  onError?: (event: ShimDomEvent) => unknown;
  onLoad?: (event: ShimDomEvent) => unknown;
  [other: string]: any;
}

declare namespace JSX {
  interface IntrinsicElements { [name: string]: ShimElementProps }
  interface Element { [key: string]: any }
  // React accepts `key` on any element; the shim has to say so or every keyed component
  // reports an excess property.
  interface IntrinsicAttributes { key?: string | number }
  interface ElementAttributesProperty { props: any }
  interface ElementChildrenAttribute { children: any }
}
interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly MODE: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
