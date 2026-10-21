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
declare namespace JSX {
  interface IntrinsicElements { [name: string]: any }
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
