// Assets page — import, inspect, and manage source media files.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useProjectStore } from '../store/project-store';
import type { Asset, CompatibilityAssessment } from '../types/project';
import './AssetsPage.css';

export function AssetsPage() {
	const project = useProjectStore((s) => s.project);
	const importAssets = useProjectStore((s) => s.importAssets);
	const removeAsset = useProjectStore((s) => s.removeAsset);
	const relinkAsset = useProjectStore((s) => s.relinkAsset);
	const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

	if (!project) return null;

	const assets = project.assets;
	const selectedAsset = assets.find((a) => a.id === selectedAssetId) ?? null;

	return (
		<div className="assets">
			<div className="page-header">
				<h1 className="page-title">Assets</h1>
				<button className="btn btn--primary" onClick={importAssets}>
					Import Media
				</button>
			</div>

			{assets.length === 0 ? (
				<EmptyAssetsView onImport={importAssets} />
			) : (
				<div className="assets__layout">
					<div className="assets__list">
						{assets.map((asset) => (
							<AssetRow
								key={asset.id}
								asset={asset}
								isSelected={asset.id === selectedAssetId}
								onSelect={() => setSelectedAssetId(asset.id)}
							/>
						))}
					</div>
					{selectedAsset && (
						<AssetDetail
							asset={selectedAsset}
							onRemove={() => {
								removeAsset(selectedAsset.id);
								setSelectedAssetId(null);
							}}
							onRelink={() => relinkAsset(selectedAsset.id)}
						/>
					)}
				</div>
			)}
		</div>
	);
}

// ── Sub-components ──────────────────────────────────────────────────────────

function EmptyAssetsView({ onImport }: { onImport: () => void }) {
	return (
		<div className="assets__empty">
			<svg
				className="assets__empty-icon"
				viewBox="0 0 64 64"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
			>
				<rect x="8" y="12" width="48" height="40" rx="4" />
				<path d="M20 12V8M44 12V8" />
				<circle cx="24" cy="32" r="6" />
				<path d="M36 28h12M36 36h8" />
			</svg>
			<h2>No assets imported</h2>
			<p className="text-muted">
				Import video, audio, or subtitle files to get started. Spindle will inspect each file and
				check DVD compatibility.
			</p>
			<button className="btn btn--primary" onClick={onImport}>
				Import Media
			</button>
		</div>
	);
}

function AssetRow({
	asset,
	isSelected,
	onSelect,
}: {
	asset: Asset;
	isSelected: boolean;
	onSelect: () => void;
}) {
	return (
		<div
			className={`assets__row card ${isSelected ? 'assets__row--selected' : ''}`}
			onClick={onSelect}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => e.key === 'Enter' && onSelect()}
		>
			{asset.thumbnailPath ? (
				<img className="assets__row-thumb" src={convertFileSrc(asset.thumbnailPath)} alt="" />
			) : (
				<div className="assets__row-thumb assets__row-thumb--placeholder" />
			)}
			<div className="assets__row-main">
				<span className="assets__row-name">{asset.fileName}</span>
				<div className="assets__row-meta text-muted">
					{asset.durationSecs != null && <span>{formatDuration(asset.durationSecs)}</span>}
					{asset.containerFormat && <span>{asset.containerFormat}</span>}
					{asset.fileSizeBytes != null && <span>{formatBytes(asset.fileSizeBytes)}</span>}
				</div>
				{asset.warnings.length > 0 && (
					<div className="assets__row-warning">{asset.warnings[0].message}</div>
				)}
			</div>
			<div className="assets__row-badges">
				{asset.videoStreams.length > 0 && (
					<span className="badge badge--neutral">{asset.videoStreams.length} video</span>
				)}
				{asset.audioStreams.length > 0 && (
					<span className="badge badge--neutral">{asset.audioStreams.length} audio</span>
				)}
				{asset.subtitleStreams.length > 0 && (
					<span className="badge badge--neutral">{asset.subtitleStreams.length} sub</span>
				)}
				<CompatibilityBadge compat={asset.compatibility} />
				{asset.warnings.length > 0 && <span className="badge badge--reencode">Warning</span>}
			</div>
		</div>
	);
}

function AssetDetail({
	asset,
	onRemove,
	onRelink,
}: {
	asset: Asset;
	onRemove: () => void;
	onRelink: () => void;
}) {
	return (
		<div className="assets__detail card">
			<div className="card__header">
				<h3 className="card__title">{asset.fileName}</h3>
				<div className="assets__detail-actions">
					<button className="btn btn--sm" onClick={onRelink}>
						Relink…
					</button>
					<button className="btn btn--sm btn--danger" onClick={onRemove}>
						Remove
					</button>
				</div>
			</div>

			{asset.warnings.length > 0 && (
				<div className="assets__detail-warnings">
					{asset.warnings.map((warning) => (
						<p key={warning.code} className="assets__detail-warning">
							{warning.message}
						</p>
					))}
				</div>
			)}

			{asset.thumbnailPath && (
				<img
					className="assets__detail-thumb"
					src={convertFileSrc(asset.thumbnailPath)}
					alt={`Thumbnail for ${asset.fileName}`}
				/>
			)}

			<div className="assets__detail-section">
				<h4 className="assets__detail-heading">File Info</h4>
				<dl className="assets__detail-grid">
					<dt>Path</dt>
					<dd className="assets__detail-path">{asset.sourcePath}</dd>
					<dt>Size</dt>
					<dd>{asset.fileSizeBytes != null ? formatBytes(asset.fileSizeBytes) : 'Unknown'}</dd>
					<dt>Duration</dt>
					<dd>{asset.durationSecs != null ? formatDuration(asset.durationSecs) : 'Unknown'}</dd>
					<dt>Container</dt>
					<dd>{asset.containerFormat ?? 'Unknown'}</dd>
					{asset.fingerprint && (
						<>
							<dt>Fingerprint</dt>
							<dd className="assets__detail-mono">{asset.fingerprint.substring(0, 16)}…</dd>
						</>
					)}
				</dl>
			</div>

			{asset.videoStreams.length > 0 && (
				<div className="assets__detail-section">
					<h4 className="assets__detail-heading">Video Streams</h4>
					{asset.videoStreams.map((vs) => (
						<div key={vs.index} className="assets__stream-item">
							<span className="assets__stream-index">#{vs.index}</span>
							<span>
								{vs.codec} · {vs.width}×{vs.height}
							</span>
							{vs.frameRate && <span className="text-muted">{vs.frameRate.toFixed(2)} fps</span>}
							{vs.aspectRatio && <span className="text-muted">{vs.aspectRatio}</span>}
							{vs.scanType && <span className="text-muted">{vs.scanType}</span>}
						</div>
					))}
				</div>
			)}

			{asset.audioStreams.length > 0 && (
				<div className="assets__detail-section">
					<h4 className="assets__detail-heading">Audio Streams</h4>
					{asset.audioStreams.map((as_) => (
						<div key={as_.index} className="assets__stream-item">
							<span className="assets__stream-index">#{as_.index}</span>
							<span>
								{as_.codec} · {as_.channels}ch · {as_.sampleRate} Hz
							</span>
							{as_.language && <span className="text-muted">{as_.language}</span>}
							{as_.bitrateBps && (
								<span className="text-muted">{(as_.bitrateBps / 1000).toFixed(0)} kbps</span>
							)}
						</div>
					))}
				</div>
			)}

			{asset.subtitleStreams.length > 0 && (
				<div className="assets__detail-section">
					<h4 className="assets__detail-heading">Subtitle Streams</h4>
					{asset.subtitleStreams.map((ss) => (
						<div key={ss.index} className="assets__stream-item">
							<span className="assets__stream-index">#{ss.index}</span>
							<span>
								{ss.codec} · {ss.subtitleType}
							</span>
							{ss.language && <span className="text-muted">{ss.language}</span>}
						</div>
					))}
				</div>
			)}

			<div className="assets__detail-section">
				<h4 className="assets__detail-heading">Compatibility</h4>
				<CompatibilityBadge compat={asset.compatibility} />
			</div>
		</div>
	);
}

function CompatibilityBadge({ compat }: { compat: CompatibilityAssessment | null }) {
	if (!compat) return <span className="badge badge--neutral">Pending</span>;

	const classMap: Record<CompatibilityAssessment, string> = {
		'remux-compatible': 'badge--remux',
		'transform-compatible': 'badge--light',
		're-encode-required': 'badge--reencode',
		unsupported: 'badge--unsupported',
	};

	const labelMap: Record<CompatibilityAssessment, string> = {
		'remux-compatible': 'Remux OK',
		'transform-compatible': 'Transform',
		're-encode-required': 'Re-encode',
		unsupported: 'Unsupported',
	};

	return <span className={`badge ${classMap[compat]}`}>{labelMap[compat]}</span>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
	if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
	if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
	if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
	return `${bytes} B`;
}
