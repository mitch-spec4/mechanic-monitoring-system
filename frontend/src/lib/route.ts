import { useEffect, useState } from "react";

/** The public pages (home, sign in, sign up, checkout) live in the URL hash, so any static host
 * can serve them without server-side routing: "#/signup?plan=professional" -> { path: "/signup", query }. */
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

/** Plan prices are in cents. Shillings are written the Kenyan way, "KSh 4,500", the same in every browser. */
export function money(cents: number, currency = "KES") {
  const digits = cents % 100 ? 2 : 0;
  if (currency === "KES") {
    return `KSh ${new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(cents / 100)}`;
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: digits }).format(cents / 100);
}
