// Logs & Diagnostics page — view build logs, inspection results, and project reports.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useProjectStore } from "../store/project-store";
import "./LogsPage.css";

export function LogsPage() {
  const project = useProjectStore((s) => s.project);
  const validationIssues = useProjectStore((s) => s.validationIssues);
  const validateProject = useProjectStore((s) => s.validateProject);

  if (!project) return null;

  const disc = project.disc;
  const titleCount = disc.titlesets.reduce((s, ts) => s + ts.titles.length, 0);
  const chapterCount = disc.titlesets.reduce(
    (s, ts) => s + ts.titles.reduce((c, t) => c + t.chapters.length, 0),
    0,
  );
  const menuCount =
    disc.globalMenus.length +
    disc.titlesets.reduce((s, ts) => s + ts.menus.length, 0);
  const buttonCount =
    disc.globalMenus.reduce((s, m) => s + m.buttons.length, 0) +
    disc.titlesets.reduce(
      (s, ts) => s + ts.menus.reduce((c, m) => c + m.buttons.length, 0),
      0,
    );

  return (
    <div className="logs">
      <div className="page-header">
        <h1 className="page-title">Logs & Diagnostics</h1>
        <button className="btn" onClick={validateProject}>
          Run Validation
        </button>
      </div>

      {/* Project summary report */}
      <div className="card logs__report">
        <h3 className="card__title">Project Report</h3>
        <dl className="logs__report-grid">
          <dt>Project</dt>
          <dd>{project.project.name}</dd>
          <dt>Format</dt>
          <dd>
            {disc.family === "dvd-video" ? "DVD-Video" : disc.family} ·{" "}
            {disc.standard} · {disc.capacityTarget}
          </dd>
          <dt>Assets</dt>
          <dd>{project.assets.length}</dd>
          <dt>Titlesets</dt>
          <dd>{disc.titlesets.length}</dd>
          <dt>Titles</dt>
          <dd>{titleCount}</dd>
          <dt>Chapters</dt>
          <dd>{chapterCount}</dd>
          <dt>Menus</dt>
          <dd>{menuCount}</dd>
          <dt>Buttons</dt>
          <dd>{buttonCount}</dd>
          <dt>Schema Version</dt>
          <dd>{project.schemaVersion}</dd>
        </dl>
      </div>

      {/* Validation results */}
      <div className="card logs__validation">
        <div className="card__header">
          <h3 className="card__title">Validation Results</h3>
          <span className="badge badge--neutral">
            {validationIssues.length} issue{validationIssues.length === 1 ? "" : "s"}
          </span>
        </div>
        {validationIssues.length === 0 ? (
          <p className="text-muted">
            No validation issues. Run validation to check for problems.
          </p>
        ) : (
          <div className="logs__issue-list">
            {validationIssues.map((issue, i) => (
              <div
                key={i}
                className={`logs__issue logs__issue--${issue.severity}`}
              >
                <span className="logs__issue-dot" />
                <span className={`logs__issue-severity badge badge--${issue.severity === "error" ? "unsupported" : issue.severity === "warning" ? "reencode" : "neutral"}`}>
                  {issue.severity}
                </span>
                <span className="logs__issue-code">{issue.code}</span>
                <span className="logs__issue-message">{issue.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Asset diagnostics */}
      {project.assets.length > 0 && (
        <div className="card logs__assets">
          <h3 className="card__title">Asset Diagnostics</h3>
          <div className="logs__asset-list">
            {project.assets.map((asset) => (
              <div key={asset.id} className="logs__asset-row">
                <span className="logs__asset-name">{asset.fileName}</span>
                <span className="logs__asset-detail text-muted">
                  {asset.containerFormat ?? "?"} ·{" "}
                  {asset.videoStreams.length}v / {asset.audioStreams.length}a /{" "}
                  {asset.subtitleStreams.length}s
                </span>
                <span
                  className={`badge ${
                    asset.compatibility === "remux-compatible"
                      ? "badge--remux"
                      : asset.compatibility === "transform-compatible"
                        ? "badge--light"
                        : asset.compatibility === "re-encode-required"
                          ? "badge--reencode"
                          : asset.compatibility === "unsupported"
                            ? "badge--unsupported"
                            : "badge--neutral"
                  }`}
                >
                  {asset.compatibility ?? "Pending"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
