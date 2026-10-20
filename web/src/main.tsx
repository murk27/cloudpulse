/**
 * Entry point of the React app. HashRouter keeps every route after "#" (e.g. /#/dashboard),
 * so S3 + CloudFront only ever need to serve index.html: no server-side routing rules.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { App } from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
