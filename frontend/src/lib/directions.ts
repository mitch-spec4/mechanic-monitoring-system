// Links that open driving directions in the phone's or computer's map app (Google Maps, which
// hands over to the installed app on phones). Without a starting point it starts from the device.

type Point = { latitude: number; longitude: number };
type From = { latitude: number | null; longitude: number | null } | null | undefined;

// Google Maps takes at most 9 stops between the start and the destination.
const MOST_WAYPOINTS = 9;
const at = (point: Point) => `${point.latitude},${point.longitude}`;
const origin = (from: From) => (from && from.latitude != null && from.longitude != null ? `&origin=${from.latitude},${from.longitude}` : "");

/** Directions to one place, from a point or from wherever the device is. */
export function directionsLink(to: Point, from?: From) {
  return `https://www.google.com/maps/dir/?api=1${origin(from)}&destination=${at(to)}&travelmode=driving`;
}

/** Directions through several stops in order (the first ten: map apps take no more in one link). */
export function routeLink(stops: Point[], from?: From) {
  const route = stops.slice(0, MOST_WAYPOINTS + 1);
  if (route.length === 0) return null;
  const between = route.slice(0, -1).map(at).join("|");
  return `${directionsLink(route[route.length - 1], from)}${between ? `&waypoints=${encodeURIComponent(between)}` : ""}`;
}
