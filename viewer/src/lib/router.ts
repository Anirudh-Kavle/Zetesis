import { useMemo, useSyncExternalStore } from "react";

// Hand-rolled instead of a router dependency: two routes, one query param,
// zero nesting — the codebase is "vanilla by design" (see ARCHITECTURE.md)
// and a routing library is overkill for this shape.
export type Route = "/" | "/timeline";

function currentKey(): string {
  return window.location.pathname + window.location.search;
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  // pushState/replaceState never fire popstate themselves — dispatch one so
  // every useRoute() subscriber re-renders.
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function parseLocation(key: string): { route: Route; params: URLSearchParams } {
  const [pathname, search] = key.split("?");
  return {
    route: pathname === "/timeline" ? "/timeline" : "/",
    params: new URLSearchParams(search ?? ""),
  };
}

export function useRoute(): { route: Route; params: URLSearchParams } {
  const key = useSyncExternalStore(subscribe, currentKey, currentKey);
  return useMemo(() => parseLocation(key), [key]);
}
