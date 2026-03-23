// Top bar with cross-platform window controls (pattern from Threshold),
// Spindle logo, project selector, and build status indicator.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { useProjectStore } from "../store/project-store";
import { ContextMenu, type MenuModel, type MenuPosition } from "./ContextMenu";
import "./Topbar.css";

// ── Window control icons (from Threshold) ──────────────────────────────────

const MinimiseIcon = () => (
  <svg width="10" height="1" viewBox="0 0 10 1" fill="none">
    <path d="M0 0.5H10" stroke="currentColor" strokeWidth="1" />
  </svg>
);

const MaximiseIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
  </svg>
);

const RestoreIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <rect x="2.5" y="0.5" width="7" height="7" stroke="currentColor" strokeWidth="1" />
    <path d="M0.5 2.5H7.5V9.5H0.5V2.5Z" fill="transparent" stroke="currentColor" strokeWidth="1" />
  </svg>
);

const CloseIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M0.5 0.5L9.5 9.5" stroke="currentColor" strokeWidth="1" />
    <path d="M9.5 0.5L0.5 9.5" stroke="currentColor" strokeWidth="1" />
  </svg>
);

// ── Platform-specific window controls ──────────────────────────────────────

type PlatformType = "mac" | "linux" | "win";

function MacControls({ onMinimise, onToggleMaximise, onClose }: WindowControlProps) {
  return (
    <div className="window-controls mac">
      <button onClick={onClose} className="control-button mac-close" title="Close" />
      <button onClick={onMinimise} className="control-button mac-minimize" title="Minimise" />
      <button onClick={onToggleMaximise} className="control-button mac-maximize" title="Maximise" />
    </div>
  );
}

function WinControls({ onMinimise, onToggleMaximise, onClose, isMaximised }: WindowControlProps) {
  return (
    <div className="window-controls win">
      <button onClick={onMinimise} className="control-button win-minimize" title="Minimise">
        <MinimiseIcon />
      </button>
      <button onClick={onToggleMaximise} className="control-button win-maximize" title={isMaximised ? "Restore" : "Maximise"}>
        {isMaximised ? <RestoreIcon /> : <MaximiseIcon />}
      </button>
      <button onClick={onClose} className="control-button win-close" title="Close">
        <CloseIcon />
      </button>
    </div>
  );
}

function LinuxControls({ onMinimise, onToggleMaximise, onClose, isMaximised }: WindowControlProps) {
  return (
    <div className="window-controls linux">
      <button onClick={onMinimise} className="control-button linux-minimize" title="Minimise">
        <MinimiseIcon />
      </button>
      <button onClick={onToggleMaximise} className="control-button linux-maximize" title={isMaximised ? "Restore" : "Maximise"}>
        {isMaximised ? <RestoreIcon /> : <MaximiseIcon />}
      </button>
      <button onClick={onClose} className="control-button linux-close" title="Close">
        <CloseIcon />
      </button>
    </div>
  );
}

interface WindowControlProps {
  onMinimise: () => void;
  onToggleMaximise: () => void;
  onClose: () => void;
  isMaximised?: boolean;
}

// ── Main Topbar ────────────────────────────────────────────────────────────

export function Topbar() {
  const [platformType, setPlatformType] = useState<PlatformType>("linux");
  const [isMaximised, setIsMaximised] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ x: 0, y: 0 });

  const project = useProjectStore((s) => s.project);
  const isDirty = useProjectStore((s) => s.isDirty);
  const openProject = useProjectStore((s) => s.openProject);
  const saveProject = useProjectStore((s) => s.saveProject);

  const appWindow = getCurrentWindow();

  useEffect(() => {
    const os = platform();
    if (os === "macos") setPlatformType("mac");
    else if (os === "linux") setPlatformType("linux");
    else setPlatformType("win");

    const updateState = async () => {
      try {
        setIsMaximised(await appWindow.isMaximized());
      } catch (e) {
        console.error("Failed to check window state", e);
      }
    };

    updateState();
    const unlistenPromise = appWindow.listen("tauri://resize", updateState);
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const minimise = () => appWindow.minimize();
  const toggleMaximise = async () => {
    await appWindow.toggleMaximize();
    setIsMaximised(await appWindow.isMaximized());
  };
  const close = () => appWindow.close();

  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    setIsMaximised(await appWindow.isMaximized());
    setMenuPosition({ x: e.clientX, y: e.clientY });
    setMenuOpen(true);
  };

  const handleMenuAction = async (itemId: string) => {
    switch (itemId) {
      case "minimize":
        minimise();
        break;
      case "maximize":
        toggleMaximise();
        break;
      case "move":
        void appWindow.startDragging();
        break;
      case "close":
        close();
        break;
    }
    setMenuOpen(false);
  };

  const windowMenuModel: MenuModel = {
    sections: [
      { items: [{ id: "minimize", label: "Minimise" }, { id: "maximize", label: isMaximised ? "Restore" : "Maximise" }] },
      { items: [{ id: "move", label: "Move" }] },
      { items: [{ id: "close", label: "Close", danger: true }] },
    ],
  };

  const controlProps: WindowControlProps = {
    onMinimise: minimise,
    onToggleMaximise: toggleMaximise,
    onClose: close,
    isMaximised,
  };

  const projectName = project?.project.name ?? "No Project";
  const titleSuffix = isDirty ? " *" : "";

  // ── Spindle content (between platform controls) ──────────────────────────
  const SpindleContent = () => (
    <>
      <div className="topbar__logo" data-tauri-drag-region>
        <svg className="logo-mark" viewBox="0 0 24 24" fill="none">
          <defs>
            <linearGradient id="logo-grad" x1="0" y1="0" x2="24" y2="24">
              <stop offset="0%" stopColor="#CF5D22" />
              <stop offset="50%" stopColor="#F19B18" />
              <stop offset="100%" stopColor="#ffaa40" />
            </linearGradient>
          </defs>
          <path d="M4 4 L8 4 L8 6 L6 6 L6 18 L8 18 L8 20 L4 20 Z" stroke="url(#logo-grad)" strokeWidth="1.5" fill="none" />
          <path d="M20 4 L16 4 L16 6 L18 6 L18 18 L16 18 L16 20 L20 20 Z" stroke="url(#logo-grad)" strokeWidth="1.5" fill="none" />
          <line x1="12" y1="6" x2="12" y2="18" stroke="url(#logo-grad)" strokeWidth="1.5" opacity="0.6" />
        </svg>
        Spindle
      </div>

      {project && (
        <button className="project-selector" onClick={openProject}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" opacity="0.5">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="8" cy="8" r="2" fill="currentColor" />
          </svg>
          <span className="project-selector__name">{projectName}{titleSuffix}</span>
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path d="M1 1L5 5L9 1" stroke="#7c8796" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}

      <div className="topbar__spacer" data-tauri-drag-region />

      <div className="topbar__actions">
        {project && (
          <>
            <button className="btn btn--ghost btn--sm" onClick={saveProject} title="Save (Ctrl+S)">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 2h8l3 3v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
                <path d="M5 2v4h5V2" />
                <rect x="5" y="10" width="6" height="3" rx="0.5" />
              </svg>
            </button>
            <div className="build-indicator build-indicator--idle">
              <svg width="10" height="10" viewBox="0 0 10 10">
                <circle cx="5" cy="5" r="4" fill="#2ec66a" />
              </svg>
              Ready
            </div>
          </>
        )}
      </div>
    </>
  );

  return (
    <>
      <header className={`topbar is-${platformType}`} data-tauri-drag-region onContextMenu={handleContextMenu}>
        {platformType === "mac" && (
          <>
            <MacControls {...controlProps} />
            <SpindleContent />
          </>
        )}

        {platformType === "linux" && (
          <>
            <SpindleContent />
            <LinuxControls {...controlProps} />
          </>
        )}

        {platformType === "win" && (
          <>
            <SpindleContent />
            <WinControls {...controlProps} />
          </>
        )}
      </header>

      {menuOpen && (
        <ContextMenu
          model={windowMenuModel}
          position={menuPosition}
          onClose={() => setMenuOpen(false)}
          onItemClick={handleMenuAction}
        />
      )}
    </>
  );
}
