import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import darkColors from "./scripts/dark-colors.mjs";

// The frontend calls "/api" on its own origin so session cookies work; in development Vite
// forwards those calls to the Flask backend.
// `npm run dev:phone` serves over HTTPS on your network: phones only share location with
// secure pages, so this is how to test clock-in on a real phone.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === "phone" ? [basicSsl()] : [])],
  // Gives every colour a dark-theme partner; see the script.
  css: { postcss: { plugins: [darkColors()] } },
  server: {
    port: 5173,
    host: mode === "phone" ? true : undefined,
    proxy: { "/api": process.env.VITE_PROXY_TARGET || "http://127.0.0.1:5000" },
  },
}));
