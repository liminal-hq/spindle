// Project Overview dashboard showing disc health, capacity, and activity.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useProjectStore } from "../store/project-store";
import { CAPACITY_LABELS, CAPACITY_BYTES } from "../types/project";
import type { VideoStandard, CapacityTarget, AllocationStrategy } from "../types/project";
import "./OverviewPage.css";

export function OverviewPage() {
  const project = useProjectStore((s) => s.project);
  const updateProject = useProjectStore((s) => s.updateProject);
  const validationIssues = useProjectStore((s) => s.validationIssues);

  if (!project) return <NoProjectView />;

  const disc = project.disc;
  const titleCount = disc.titlesets.reduce((s, ts) => s + ts.titles.length, 0);
  const assetCount = project.assets.length;
  const menuCount =
    disc.globalMenus.length +
    disc.titlesets.reduce((s, ts) => s + ts.menus.length, 0);
  const chapterCount = disc.titlesets.reduce(
    (s, ts) => s + ts.titles.reduce((c, t) => c + t.chapters.length, 0),
    0,
  );

  const capacityBytes = CAPACITY_BYTES[disc.capacityTarget];
  const errorCount = validationIssues.filter((i) => i.severity === "error").length;
  const warningCount = validationIssues.filter((i) => i.severity === "warning").length;

  return (
    <div className="overview">
      <div className="page-header">
        <input
          className="page-title page-title--editable"
          value={project.project.name}
          onChange={(e) =>
            updateProject((p) => ({
              ...p,
              project: { ...p.project, name: e.target.value },
            }))
          }
        />
        <span className="badge badge--neutral">
          {disc.family === "dvd-video" ? "DVD-Video" : disc.family} &middot; {disc.standard}
        </span>
      </div>

      {/* Stats grid */}
      <div className="overview__stats">
        <StatCard label="Titles" value={titleCount} icon="titles" />
        <StatCard label="Assets" value={assetCount} icon="assets" />
        <StatCard label="Menus" value={menuCount} icon="menus" />
        <StatCard label="Chapters" value={chapterCount} icon="chapters" />
      </div>

      {/* Capacity card */}
      <div className="card overview__capacity">
        <div className="card__header">
          <h3 className="card__title">Disc Capacity</h3>
          <span className="text-muted">{CAPACITY_LABELS[disc.capacityTarget]}</span>
        </div>
        <div className="capacity-bar">
          <div
            className="capacity-bar__segment"
            style={{
              width: "0%",
              background: "var(--brand-gradient)",
            }}
          />
        </div>
        <div className="overview__capacity-legend">
          <span className="text-muted">
            No titles added yet &middot; {formatBytes(capacityBytes)} available
          </span>
        </div>
      </div>

      {/* Validation summary */}
      <div className="card overview__health">
        <div className="card__header">
          <h3 className="card__title">Project Health</h3>
        </div>
        {errorCount === 0 && warningCount === 0 && titleCount === 0 && (
          <p className="text-muted">
            Add titles and assets to see validation results here.
          </p>
        )}
        {errorCount === 0 && warningCount === 0 && titleCount > 0 && (
          <p style={{ color: "var(--colour-success)" }}>
            No issues found. Project looks ready to build.
          </p>
        )}
        {(errorCount > 0 || warningCount > 0) && (
          <div className="overview__issues">
            {validationIssues.map((issue, i) => (
              <div
                key={i}
                className={`overview__issue overview__issue--${issue.severity}`}
              >
                <span className="overview__issue-dot" />
                {issue.message}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Project settings */}
      <div className="card overview__settings">
        <div className="card__header">
          <h3 className="card__title">Project Settings</h3>
          <span className="text-muted">
            Created {new Date(project.project.createdAt).toLocaleDateString()}
          </span>
        </div>
        <div className="overview__settings-grid">
          <div className="overview__setting">
            <label className="overview__setting-label">Video Standard</label>
            <select
              className="overview__setting-select"
              value={disc.standard}
              onChange={(e) =>
                updateProject((p) => ({
                  ...p,
                  disc: { ...p.disc, standard: e.target.value as VideoStandard },
                }))
              }
            >
              <option value="NTSC">NTSC (29.97 fps, 720×480)</option>
              <option value="PAL">PAL (25 fps, 720×576)</option>
            </select>
          </div>
          <div className="overview__setting">
            <label className="overview__setting-label">Capacity Target</label>
            <select
              className="overview__setting-select"
              value={disc.capacityTarget}
              onChange={(e) =>
                updateProject((p) => ({
                  ...p,
                  disc: { ...p.disc, capacityTarget: e.target.value as CapacityTarget },
                }))
              }
            >
              <option value="DVD5">{CAPACITY_LABELS.DVD5}</option>
              <option value="DVD9">{CAPACITY_LABELS.DVD9}</option>
            </select>
          </div>
          <div className="overview__setting">
            <label className="overview__setting-label">Allocation</label>
            <select
              className="overview__setting-select"
              value={project.buildSettings.allocationStrategy}
              onChange={(e) =>
                updateProject((p) => ({
                  ...p,
                  buildSettings: {
                    ...p.buildSettings,
                    allocationStrategy: e.target.value as AllocationStrategy,
                  },
                }))
              }
            >
              <option value="equal-share">Equal share</option>
              <option value="duration-weighted">Duration weighted</option>
              <option value="priority-weighted">Priority weighted</option>
            </select>
          </div>
          <div className="overview__setting">
            <label className="overview__setting-label">ISO Output</label>
            <label className="overview__setting-checkbox">
              <input
                type="checkbox"
                checked={project.buildSettings.generateIso}
                onChange={(e) =>
                  updateProject((p) => ({
                    ...p,
                    buildSettings: { ...p.buildSettings, generateIso: e.target.checked },
                  }))
                }
              />
              Generate ISO image
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function NoProjectView() {
  const createProject = useProjectStore((s) => s.createProject);
  const openProject = useProjectStore((s) => s.openProject);

  const handleNew = () =>
    createProject({ name: "Untitled Project", standard: "NTSC", capacityTarget: "DVD5" });

  return (
    <div className="overview__empty">
      <svg className="overview__empty-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="32" cy="32" r="28" />
        <circle cx="32" cy="32" r="12" />
        <circle cx="32" cy="32" r="3" />
      </svg>
      <h2>Welcome to Spindle</h2>
      <p className="text-muted">
        Optical-disc authoring studio for DVD-Video projects.
      </p>
      <div className="overview__empty-actions">
        <button className="btn btn--primary" onClick={handleNew}>New Project</button>
        <button className="btn" onClick={openProject}>Open Project</button>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number; icon: string }) {
  return (
    <div className="card card--glow overview__stat">
      <div className="overview__stat-value">{value}</div>
      <div className="overview__stat-label text-muted">{label}</div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${bytes} B`;
}
