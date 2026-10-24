import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";
import darkColors from "./scripts/dark-colors.mjs";

// The frontend calls "/api" on its own origin so session cookies work; in development Vite
// forwards those calls to the Flask backend.
// `npm run dev:phone` serves over HTTPS on your network: phones only share location with
// secure pages, so this is how to test clock-in on a real phone.
// The installable app (built for production only): its manifest and icons, and a service worker
// (src/sw.ts) that keeps the app's own files for opening with no signal. API data is never cached
// there; see src/offline/.
const pwa = VitePWA({
  strategies: "injectManifest",
  srcDir: "src",
  filename: "sw.ts",
  registerType: "prompt",
  injectRegister: false,
  manifest: {
    name: "MechanicPro",
    short_name: "MechanicPro",
    description: "Jobs, worksheets, time, photos and sign-offs for field technicians, with or without a signal.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b1626",
    theme_color: "#3b82f6",
    icons: [
      { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  injectManifest: { globPatterns: ["**/*.{js,css,html,png,svg,woff2,webmanifest}"] },
  devOptions: { enabled: false },
});

export default defineConfig(({ mode }) => ({
  plugins: [react(), pwa, ...(mode === "phone" ? [basicSsl()] : [])],
  // Gives every colour a dark-theme partner; see the script.
  css: { postcss: { plugins: [darkColors()] } },
  server: {
    port: 5173,
    host: mode === "phone" ? true : undefined,
    proxy: { "/api": process.env.VITE_PROXY_TARGET || "http://127.0.0.1:5000" },
  },
}));
