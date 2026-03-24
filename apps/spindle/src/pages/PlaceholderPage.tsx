// Placeholder page used for screens that are not yet implemented.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import "./PlaceholderPage.css";

interface PlaceholderPageProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  phase?: string;
}

export function PlaceholderPage({ title, description, icon, phase }: PlaceholderPageProps) {
  return (
    <div className="placeholder-page">
      <div className="placeholder-page__icon">{icon}</div>
      <h2>{title}</h2>
      <p className="text-muted">{description}</p>
      {phase && (
        <span className="placeholder-page__phase">{phase}</span>
      )}
    </div>
  );
}

// ── Pre-built placeholder pages for each screen ─────────────────────────────

export function AssetsPage() {
  return (
    <PlaceholderPage
      title="Assets"
      description="Import media files, inspect streams, and check compatibility."
      phase="Phase 2"
      icon={
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="8" y="12" width="48" height="40" rx="4" />
          <path d="M20 12V8M44 12V8" />
          <circle cx="24" cy="32" r="6" />
          <path d="M36 28h12M36 36h8" />
        </svg>
      }
    />
  );
}

export function TitlesPage() {
  return (
    <PlaceholderPage
      title="Titles"
      description="Organise titles, map streams, and configure output profiles."
      phase="Phase 3"
      icon={
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="8" y="8" width="48" height="48" rx="4" />
          <line x1="16" y1="20" x2="48" y2="20" />
          <line x1="16" y1="32" x2="40" y2="32" />
          <line x1="16" y1="44" x2="32" y2="44" />
        </svg>
      }
    />
  );
}

export function ChaptersPage() {
  return (
    <PlaceholderPage
      title="Chapters"
      description="Add and edit chapter points for each title."
      phase="Phase 4"
      icon={
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="32" cy="32" r="24" />
          <path d="M32 16v16l12 8" />
        </svg>
      }
    />
  );
}

export function MenusPage() {
  return (
    <PlaceholderPage
      title="Menus"
      description="Design menu layouts, buttons, and navigation for the disc."
      phase="Phase 6–7"
      icon={
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="8" y="8" width="48" height="48" rx="4" />
          <rect x="14" y="36" width="14" height="8" rx="2" />
          <rect x="36" y="36" width="14" height="8" rx="2" />
          <rect x="14" y="16" width="36" height="14" rx="2" />
        </svg>
      }
    />
  );
}

export function PlannerPage() {
  return (
    <PlaceholderPage
      title="Disc Planner"
      description="Budget disc capacity and allocate bitrates across titles."
      phase="Phase 5"
      icon={
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="32" cy="32" r="24" />
          <circle cx="32" cy="32" r="10" />
          <circle cx="32" cy="32" r="3" />
        </svg>
      }
    />
  );
}

export function BuildPage() {
  return (
    <PlaceholderPage
      title="Build"
      description="Configure build settings and export VIDEO_TS or ISO."
      phase="Phase 8–9"
      icon={
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M16 56V32l16-24 16 24v24" />
          <line x1="16" y1="40" x2="48" y2="40" />
        </svg>
      }
    />
  );
}

export function LogsPage() {
  return (
    <PlaceholderPage
      title="Logs & Diagnostics"
      description="View build logs, inspection results, and diagnostic reports."
      phase="Phase 10"
      icon={
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 48h48M8 32h32M8 16h20" />
        </svg>
      }
    />
  );
}

export function SettingsPage() {
  return (
    <PlaceholderPage
      title="Settings"
      description="Configure toolchain paths, capabilities, and application preferences."
      phase="Phase 0"
      icon={
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="32" cy="32" r="12" />
          <path d="M32 4v12M32 48v12M4 32h12M48 32h12M11.5 11.5l8.5 8.5M44 44l8.5 8.5M11.5 52.5l8.5-8.5M44 20l8.5-8.5" />
        </svg>
      }
    />
  );
}
