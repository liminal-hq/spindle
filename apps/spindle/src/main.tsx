// Boots the Spindle React application inside the Tauri webview.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initialiseLogger } from "./utils/logger";

initialiseLogger();
console.info("webview startup: logger initialised");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
