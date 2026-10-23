import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// Set the theme before the first paint, so a dark-mode user doesn't see a white flash.
import "./lib/theme";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
