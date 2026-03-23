// Renders the Spindle desktop workspace shell.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useCallback, useEffect, useState } from "react";
import { useProjectStore } from "./store/project-store";
import { Topbar } from "./components/Topbar";
import { Sidebar } from "./components/Sidebar";
import { Statusbar } from "./components/Statusbar";
import { OverviewPage } from "./pages/OverviewPage";
import { AssetsPage } from "./pages/AssetsPage";
import { TitlesPage } from "./pages/TitlesPage";
import { ChaptersPage } from "./pages/ChaptersPage";
import { PlannerPage } from "./pages/PlannerPage";
import {
  MenusPage,
  BuildPage,
  LogsPage,
  SettingsPage,
} from "./pages/PlaceholderPage";
import "./design-system.css";
import "./App.css";

const ROUTES: Record<string, () => React.ReactNode> = {
  "/": () => <OverviewPage />,
  "/assets": () => <AssetsPage />,
  "/titles": () => <TitlesPage />,
  "/chapters": () => <ChaptersPage />,
  "/menus": () => <MenusPage />,
  "/planner": () => <PlannerPage />,
  "/build": () => <BuildPage />,
  "/logs": () => <LogsPage />,
  "/settings": () => <SettingsPage />,
};

function App() {
  const [currentRoute, setCurrentRoute] = useState("/");
  const saveProject = useProjectStore((s) => s.saveProject);

  const handleNavigate = useCallback((route: string) => {
    setCurrentRoute(route);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveProject();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [saveProject]);

  const PageComponent = ROUTES[currentRoute] ?? ROUTES["/"];

  return (
    <div className="app-shell">
      <Topbar />
      <Sidebar currentRoute={currentRoute} onNavigate={handleNavigate} />
      <main className="main-content">
        {PageComponent!()}
      </main>
      <Statusbar />
    </div>
  );
}

export default App;
