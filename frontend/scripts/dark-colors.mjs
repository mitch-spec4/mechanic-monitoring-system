// Dark mode without a second stylesheet. At build time every colour in the app's CSS becomes
// light-dark(<the colour as written>, <a dark-theme partner>), and the theme switch only sets
// `color-scheme` on <html> (see src/lib/theme.ts). Write CSS in light colours as usual.
//
// The dark partner depends on what the colour is for:
// - backgrounds: white cards become dark slate, near-white page greys a shade darker than cards,
//   pale tints (blue, green, amber pills) become deep tints of the same hue; strong colours stay;
// - text: dark text becomes light, greys stay grey, dark coloured text (amber, red) is lightened;
// - borders: pale lines become dark lines that still show against dark cards.
// Each declaration keeps its original value first, for browsers without light-dark().
//
// Skipped: the public site (Home.css is already dark), library CSS, and any rule containing a
// `/* light-only */` comment (for example the white paper the customer signs on).

const SKIP_FILES = /node_modules|[\\/]Home\.css$/;
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/g;

function parse(token) {
  if (token === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (token === "black") return { r: 0, g: 0, b: 0, a: 1 };
  if (token.startsWith("#")) {
    let hex = token.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = (i) => parseInt(hex.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
  }
  const parts = token.match(/[\d.]+%?/g);
  if (!parts || parts.length < 3) return null;
  const channel = (p) => (p.endsWith("%") ? (parseFloat(p) * 255) / 100 : parseFloat(p));
  return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: parts[3] ? channel(parts[3]) / (parts[3].endsWith("%") ? 255 : 1) : 1 };
}

function toHsl({ r, g, b }) {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const css = ({ h, s, l }, a) => {
  const color = `hsl(${Math.round(h)} ${Math.round(clamp(s, 0, 1) * 100)}% ${Math.round(clamp(l, 0, 1) * 1000) / 10}%`;
  return a < 1 ? `${color} / ${Math.round(a * 100) / 100})` : `${color})`;
};
// Greys pick up the app's slate blue, so dark surfaces don't look flat black.
const SLATE = { h: 218, s: 0.24 };
const tone = (hsl) => (hsl.s < 0.08 ? { ...hsl, ...SLATE } : hsl);

function darkPartner(rgba, role) {
  const hsl = toHsl(rgba);
  const { s, l } = hsl;
  if (role === "background") {
    if (l <= 0.3) return null; // already dark: sidebars, heroes
    if (s >= 0.3 && l < 0.82) return null; // strong colours: buttons, badges
    if (s >= 0.3) return css({ ...hsl, s: s * 0.45, l: 0.16 + (1 - l) * 0.35 }, rgba.a); // pale tints
    if (l >= 0.995) return css({ ...tone(hsl), l: 0.135 }, rgba.a); // white cards
    if (l >= 0.8) return css({ ...tone(hsl), l: 0.095 + (1 - l) * 0.45 }, rgba.a); // page greys
    return css({ ...tone(hsl), l: 1.05 - l }, rgba.a);
  }
  if (role === "border") {
    if (l <= 0.3 || (s >= 0.3 && l < 0.8)) return null;
    return css({ ...tone(hsl), s: Math.min(s, 0.35), l: 0.21 + (1 - l) * 0.4 }, rgba.a);
  }
  if (role === "text") {
    if (l >= 0.8) return null; // white text sits on strong colours
    if (s < 0.3) return css({ ...tone(hsl), l: l <= 0.45 ? 0.93 - l * 0.45 : 0.62 + (l - 0.45) * 0.4 }, rgba.a);
    if (l < 0.55) return css({ ...hsl, l: Math.max(0.7, 1 - l) }, rgba.a); // dark coloured text
    return null;
  }
  return null; // shadows and the like work on both
}

function roleOf(prop) {
  if (/background|^fill$/.test(prop)) return "background";
  if (/^border|^outline|column-rule|^stroke$/.test(prop)) return "border";
  if (/^color$|caret-color|text-decoration-color|-webkit-text-fill-color/.test(prop)) return "text";
  return null;
}

function isPale(value) {
  const colors = value.match(COLOR) || [];
  return colors.length > 0 && colors.every((token) => {
    const rgba = parse(token);
    return rgba && toHsl(rgba).l >= 0.82;
  });
}

/** The PostCSS plugin; vite.config.ts adds it. */
export default function darkColors() {
  return {
    postcssPlugin: "dark-colors",
    Declaration(decl) {
      const file = decl.source?.input?.file || "";
      if (decl.raws.darkFallback || SKIP_FILES.test(file) || decl.value.includes("light-dark(")) return;
      const rule = decl.parent;
      if (rule?.nodes?.some((node) => node.type === "comment" && node.text.includes("light-only"))) return;
      // A custom property can be used for anything; only pale ones (--role-soft) are clearly backgrounds.
      const role = decl.prop.startsWith("--") ? (isPale(decl.value) ? "background" : null) : roleOf(decl.prop);
      if (!role) return;
      let changed = false;
      const value = decl.value.replace(COLOR, (token) => {
        const rgba = parse(token);
        const dark = rgba && darkPartner(rgba, role);
        if (!dark) return token;
        changed = true;
        return `light-dark(${token}, ${dark})`;
      });
      if (!changed) return;
      // Browsers without light-dark() keep the declaration before it.
      decl.cloneBefore({ raws: { ...decl.raws, darkFallback: true } });
      decl.value = value;
    },
  };
}
darkColors.postcss = true;
