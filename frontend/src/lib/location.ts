// The phone's position, in the shape the API expects. A failure becomes `location_error`
// so the server can record why there is no position instead of guessing.
export type Fix = { latitude: number; longitude: number; accuracy: number };
export type LocationError = "denied" | "unavailable" | "timeout" | "unsupported";
export type PositionResult = Fix | { location_error: LocationError };

export const hasFix = (result: PositionResult): result is Fix => "latitude" in result;

export function toFix(position: GeolocationPosition): Fix {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Math.round(position.coords.accuracy),
  };
}

export function errorCode(error: GeolocationPositionError): LocationError {
  if (error.code === error.PERMISSION_DENIED) return "denied";
  if (error.code === error.TIMEOUT) return "timeout";
  return "unavailable";
}

export function getPosition(timeoutMs = 15000): Promise<PositionResult> {
  // Browsers only share location with secure pages (https, or localhost).
  if (!("geolocation" in navigator) || !window.isSecureContext) {
    return Promise.resolve({ location_error: "unsupported" });
  }
  return new Promise((resolve) => {
    // A backstop: some browsers never answer while their permission prompt is ignored.
    const backstop = window.setTimeout(() => resolve({ location_error: "timeout" }), timeoutMs + 2000);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(backstop);
        resolve(toFix(position));
      },
      (error) => {
        window.clearTimeout(backstop);
        resolve({ location_error: errorCode(error) });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
  });
}

/** What to tell the mechanic when no position could be taken, with the steps to fix it. */
export function locationHelp(error: LocationError) {
  switch (error) {
    case "denied":
      return "Location is blocked for this site. Allow it in your browser's site settings (the icon next to the address), and check that location is on for your browser in your phone's settings. Then try again.";
    case "timeout":
      return "Your phone couldn't find your position in time. Step outside or near a window for a better signal, then try again.";
    case "unsupported":
      return "This browser can't share location here. Open the app over https (or on this computer at localhost) in Chrome, Safari, Edge or Firefox.";
    default:
      return "Your phone couldn't work out where you are. Turn on location (GPS) in your phone's settings, then try again.";
  }
}

/** Metres between two points (haversine). */
export function distanceMetres(a: Fix, b: Fix) {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export const mapLink = (latitude: number, longitude: number) =>
  `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
