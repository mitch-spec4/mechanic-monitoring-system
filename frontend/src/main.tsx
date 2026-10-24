import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
import App from "./App";
// Set the theme before the first paint, so a dark-mode user doesn't see a white flash.
import "./lib/theme";
import { startPwa } from "./offline/pwa";

// The installable app: its service worker, "Update ready", and the install offer (which comes early).
startPwa();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
