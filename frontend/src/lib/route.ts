import { useEffect, useState } from "react";

/** The public pages (home, sign in, sign up, checkout) live in the URL hash, so any static host
 * can serve them without server-side routing: "#/signup?plan=team" -> { path: "/signup", query }. */
export type Route = { path: string; query: URLSearchParams };

export function readRoute(): Route {
  const [path, search = ""] = window.location.hash.replace(/^#/, "").split("?");
  return { path: path || "/", query: new URLSearchParams(search) };
}

export function go(target: string) {
  window.location.hash = target.startsWith("#") ? target : `#${target}`;
  window.scrollTo({ top: 0 });
}

export function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

/** Plan prices are in cents. */
export const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
