// Disc Planner page — capacity budgeting and bitrate allocation.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useProjectStore } from "../store/project-store";
import { CAPACITY_LABELS, CAPACITY_BYTES } from "../types/project";
import type { Title, Asset } from "../types/project";
import "./PlannerPage.css";

// DVD-Video spec limits (ISO/IEC 13818-1)
const DVD_MAX_MUX_RATE_BPS = 10_080_000;   // 10.08 Mbps total mux rate
const DVD_MAX_VIDEO_RATE_BPS = 9_800_000;   // 9.8 Mbps max video ES

export function PlannerPage() {
  const project = useProjectStore((s) => s.project);

  if (!project) return null;

  const disc = project.disc;
  const capacityBytes = CAPACITY_BYTES[disc.capacityTarget];

  // Gather all titles with their assets
  const titlesWithAssets: { title: Title; asset: Asset | null }[] =
    disc.titlesets.flatMap((ts) =>
      ts.titles.map((t) => ({
        title: t,
        asset: project.assets.find((a) => a.id === t.sourceAssetId) ?? null,
      })),
    );

  // Calculate total content size estimate
  const totalDurationSecs = titlesWithAssets.reduce(
    (sum, { asset }) => sum + (asset?.durationSecs ?? 0),
    0,
  );

  const totalSourceBytes = titlesWithAssets.reduce(
    (sum, { asset }) => sum + (asset?.fileSizeBytes ?? 0),
    0,
  );

  // Safety margin and overhead
  const safetyMarginBytes = project.buildSettings.safetyMarginBytes;
  const estimatedOverheadBytes = 50_000_000; // ~50 MB for IFOs, menus, NAV packs
  const usableBytes = capacityBytes - safetyMarginBytes - estimatedOverheadBytes;
  const usagePct = totalSourceBytes > 0 ? (totalSourceBytes / capacityBytes) * 100 : 0;
  const isOverCapacity = totalSourceBytes > usableBytes;

  // Per-title bitrate budget — capped to DVD spec limits
  const rawBitsPerSecond =
    totalDurationSecs > 0 ? ((usableBytes * 8) / totalDurationSecs) : 0;
  const maxVideoBitrate = Math.min(rawBitsPerSecond, DVD_MAX_VIDEO_RATE_BPS);
  const availableBitsPerSecond = maxVideoBitrate;
  const isCapacityConstrained = rawBitsPerSecond < DVD_MAX_VIDEO_RATE_BPS;

  // Estimated output size at the budgeted rate
  const estimatedOutputBytes =
    totalDurationSecs > 0
      ? (Math.min(rawBitsPerSecond, DVD_MAX_MUX_RATE_BPS) * totalDurationSecs) / 8
      : 0;

  return (
    <div className="planner">
      <div className="page-header">
        <h1 className="page-title">Disc Planner</h1>
        <span className="badge badge--neutral">
          {CAPACITY_LABELS[disc.capacityTarget]}
        </span>
      </div>

      {titlesWithAssets.length === 0 ? (
        <div className="planner__empty">
          <h2>No titles to plan</h2>
          <p className="text-muted">
            Add titles in the Titles page, then return here to plan disc capacity.
          </p>
        </div>
      ) : (
        <>
          {/* Capacity overview */}
          <div className="card planner__capacity">
            <div className="card__header">
              <h3 className="card__title">Capacity Overview</h3>
              {isOverCapacity && (
                <span className="badge badge--unsupported">Over capacity</span>
              )}
            </div>
            <div className="capacity-bar">
              <div
                className="capacity-bar__segment"
                style={{
                  width: `${Math.min(usagePct, 100)}%`,
                  background: isOverCapacity
                    ? "var(--colour-error)"
                    : "var(--brand-gradient)",
                }}
              />
            </div>
            <div className="planner__capacity-stats">
              <div className="planner__stat">
                <span className="planner__stat-value">
                  {formatBytes(totalSourceBytes)}
                </span>
                <span className="planner__stat-label text-muted">
                  Source size
                </span>
              </div>
              <div className="planner__stat">
                <span className="planner__stat-value">
                  {formatBytes(usableBytes)}
                </span>
                <span className="planner__stat-label text-muted">
                  Usable capacity
                </span>
              </div>
              <div className="planner__stat">
                <span className="planner__stat-value">
                  {usagePct.toFixed(1)}%
                </span>
                <span className="planner__stat-label text-muted">
                  Disc usage
                </span>
              </div>
              <div className="planner__stat">
                <span className="planner__stat-value">
                  {formatDuration(totalDurationSecs)}
                </span>
                <span className="planner__stat-label text-muted">
                  Total duration
                </span>
              </div>
            </div>
          </div>

          {/* Bitrate budget */}
          <div className="card planner__budget">
            <div className="card__header">
              <h3 className="card__title">Bitrate Budget</h3>
              <span className="text-muted">
                {project.buildSettings.allocationStrategy.replace("-", " ")}
              </span>
            </div>
            {availableBitsPerSecond > 0 ? (
              <div className="planner__budget-details">
                <div className="planner__budget-row">
                  <span>Max video bitrate (DVD spec)</span>
                  <span>{formatBitrate(DVD_MAX_VIDEO_RATE_BPS)}</span>
                </div>
                <div className="planner__budget-row">
                  <span>Available average video bitrate</span>
                  <span className={isCapacityConstrained ? "planner__budget-constrained" : ""}>
                    {formatBitrate(availableBitsPerSecond)}
                  </span>
                </div>
                <div className="planner__budget-row">
                  <span>Constraint</span>
                  <span className="text-muted">
                    {isCapacityConstrained ? "Disc capacity" : "DVD spec limit"}
                  </span>
                </div>
                <div className="planner__budget-row">
                  <span>Est. output size at budgeted rate</span>
                  <span>{formatBytes(estimatedOutputBytes)}</span>
                </div>
              </div>
            ) : (
              <p className="text-muted">
                Add assets with known durations to calculate bitrate budgets.
              </p>
            )}
          </div>

          {/* Per-title breakdown */}
          <div className="card planner__titles">
            <div className="card__header">
              <h3 className="card__title">Title Breakdown</h3>
            </div>
            <div className="planner__title-list">
              {titlesWithAssets.map(({ title, asset }) => {
                const duration = asset?.durationSecs ?? 0;
                const sourceSize = asset?.fileSizeBytes ?? 0;
                const durationPct =
                  totalDurationSecs > 0
                    ? (duration / totalDurationSecs) * 100
                    : 0;

                return (
                  <div key={title.id} className="planner__title-row">
                    <div className="planner__title-info">
                      <span className="planner__title-name">{title.name}</span>
                      <span className="planner__title-meta text-muted">
                        {asset ? asset.fileName : "No asset"}
                      </span>
                    </div>
                    <div className="planner__title-stats">
                      <span>{formatDuration(duration)}</span>
                      <span>{formatBytes(sourceSize)}</span>
                      <span className="text-muted">
                        {durationPct.toFixed(1)}% of disc
                      </span>
                    </div>
                    <div className="planner__title-bar">
                      <div
                        className="planner__title-bar-fill"
                        style={{ width: `${durationPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Overhead breakdown */}
          <div className="card planner__overhead">
            <div className="card__header">
              <h3 className="card__title">Disc Overhead</h3>
            </div>
            <dl className="planner__overhead-grid">
              <dt>Safety margin</dt>
              <dd>{formatBytes(safetyMarginBytes)}</dd>
              <dt>IFO/NAV/menu overhead (est.)</dt>
              <dd>{formatBytes(estimatedOverheadBytes)}</dd>
              <dt>Total reserved</dt>
              <dd>{formatBytes(safetyMarginBytes + estimatedOverheadBytes)}</dd>
            </dl>
          </div>
        </>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBitrate(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1_000_000)
    return `${(bitsPerSecond / 1_000_000).toFixed(2)} Mbps`;
  if (bitsPerSecond >= 1_000) return `${(bitsPerSecond / 1_000).toFixed(0)} kbps`;
  return `${bitsPerSecond.toFixed(0)} bps`;
}
