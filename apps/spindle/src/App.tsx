// Renders the base Spindle shell for the desktop authoring workspace.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import "./App.css";

function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Optical-disc authoring studio</p>
        <h1>Spindle</h1>
        <p className="lede">
          A base Tauri shell for planning, building, and packaging authored
          DVD and Blu-ray workflows.
        </p>
      </section>

      <section className="panel-grid" aria-label="Workspace status">
        <article className="panel">
          <p className="panel-label">Workspace</p>
          <h2>pnpm monorepo</h2>
          <p>
            The repository is organised around `apps/*` and `plugins/*` so the
            desktop shell and future shared packages can grow together.
          </p>
        </article>

        <article className="panel">
          <p className="panel-label">Application shell</p>
          <h2>Tauri + React + Rust</h2>
          <p>
            This starting point keeps the desktop runtime, web UI, and native
            backend ready for the first authoring features.
          </p>
        </article>

        <article className="panel">
          <p className="panel-label">Next foundations</p>
          <h2>Project model, inspection, and planning</h2>
          <p>
            Upcoming work can layer real project data, media analysis, and disc
            build orchestration onto this shell without restructuring the repo.
          </p>
        </article>
      </section>
    </main>
  );
}

export default App;
