import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend calls "/api" on its own origin so session cookies work; in development Vite
// forwards those calls to the Flask backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": process.env.VITE_PROXY_TARGET || "http://127.0.0.1:5000" },
  },
});
