// Assets page — import, inspect, and manage source media files.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react';
import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs';
import { useProjectStore } from '../store/project-store';
import type {
	Asset,
	CompatibilityAssessment,
	CompatibilityDetail,
	PropertyCheck,
} from '../types/project';
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
				Import video, audio, subtitle, or still-image files to get started. Spindle will inspect
				each file and check where it fits into DVD authoring.
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
	const isStillImageAsset = /\.(png|jpe?g|bmp|tiff?)$/i.test(asset.fileName);

	return (
		<div
			className={`assets__row card ${isSelected ? 'assets__row--selected' : ''}`}
			onClick={onSelect}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => e.key === 'Enter' && onSelect()}
		>
			<AssetThumbnail asset={asset} variant="row" />
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
				{isStillImageAsset && <span className="badge badge--neutral">image</span>}
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
			<div className="card__header assets__detail-header">
				<h3 className="card__title assets__detail-title">{asset.fileName}</h3>
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
					{asset.warnings.map((warning, index) => (
						<p key={warningKey(warning, index)} className="assets__detail-warning">
							{warning.message}
						</p>
					))}
				</div>
			)}

			<AssetThumbnail asset={asset} variant="detail" />

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
							{vs.title && <span className="text-muted assets__stream-descriptor">{vs.title}</span>}
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
							{as_.title && (
								<span className="text-muted assets__stream-descriptor">{as_.title}</span>
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
							{ss.title && <span className="text-muted assets__stream-descriptor">{ss.title}</span>}
						</div>
					))}
				</div>
			)}

			<div className="assets__detail-section">
				<h4 className="assets__detail-heading">Compatibility</h4>
				<CompatibilityBadge compat={asset.compatibility} />
				{asset.compatibilityDetail && (
					<CompatibilityDetailView detail={asset.compatibilityDetail} />
				)}
			</div>
		</div>
	);
}

function AssetThumbnail({ asset, variant }: { asset: Asset; variant: 'row' | 'detail' }) {
	const [loadFailed, setLoadFailed] = useState(false);
	const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
	const isStillImageAsset = /\.(png|jpe?g|bmp|tiff?)$/i.test(asset.fileName);

	useEffect(() => {
		setLoadFailed(false);
	}, [asset.id, asset.thumbnailPath, asset.thumbnailError]);

	useEffect(() => {
		let revokedUrl: string | null = null;
		let cancelled = false;

		async function loadThumbnail() {
			if (isStillImageAsset) {
				try {
					const bytes = await readFile(asset.sourcePath);
					if (cancelled) {
						return;
					}
					const blob = new Blob([bytes], { type: mimeTypeForImageAsset(asset.fileName) });
					const objectUrl = URL.createObjectURL(blob);
					revokedUrl = objectUrl;
					setThumbnailUrl(objectUrl);
					setLoadFailed(false);
				} catch {
					if (!cancelled) {
						setThumbnailUrl(asset.sourcePath);
						setLoadFailed(false);
					}
				}
				return;
			}

			if (!asset.thumbnailPath) {
				setThumbnailUrl(null);
				return;
			}

			const fileName = asset.thumbnailPath.split(/[/\\]/).pop();
			if (!fileName) {
				setThumbnailUrl(null);
				setLoadFailed(true);
				return;
			}

			for (let attempt = 0; attempt < 2; attempt += 1) {
				try {
					const bytes = await readFile(`thumbnails/${fileName}`, {
						baseDir: BaseDirectory.AppCache,
					});
					if (cancelled) {
						return;
					}
					const blob = new Blob([bytes], { type: 'image/jpeg' });
					const objectUrl = URL.createObjectURL(blob);
					revokedUrl = objectUrl;
					setThumbnailUrl(objectUrl);
					setLoadFailed(false);
					return;
				} catch {
					if (attempt === 0) {
						await new Promise((resolve) => window.setTimeout(resolve, 150));
						continue;
					}
					if (!cancelled) {
						setThumbnailUrl(null);
						setLoadFailed(true);
					}
				}
			}
		}

		void loadThumbnail();

		return () => {
			cancelled = true;
			if (revokedUrl) {
				URL.revokeObjectURL(revokedUrl);
			}
		};
	}, [asset.sourcePath, asset.thumbnailPath, isStillImageAsset]);

	const className = variant === 'row' ? 'assets__row-thumb' : 'assets__detail-thumb';
	const canShowImage = Boolean(thumbnailUrl) && !loadFailed;
	const fallbackLabel =
		asset.thumbnailError ?? (loadFailed ? 'Preview could not be loaded.' : 'No preview available.');

	if (canShowImage && thumbnailUrl) {
		return (
			<img
				className={className}
				src={thumbnailUrl}
				alt={variant === 'detail' ? `Thumbnail for ${asset.fileName}` : ''}
				onError={() => setLoadFailed(true)}
			/>
		);
	}

	if (variant === 'row') {
		return (
			<div className="assets__row-thumb assets__row-thumb--placeholder">
				<span>{asset.thumbnailError || loadFailed ? '!' : 'No preview'}</span>
			</div>
		);
	}

	return (
		<div className="assets__detail-thumb assets__detail-thumb--placeholder">
			<div className="assets__detail-thumb-copy">
				<strong>Preview unavailable</strong>
				<p>{fallbackLabel}</p>
			</div>
		</div>
	);
}

function mimeTypeForImageAsset(fileName: string): string {
	if (/\.png$/i.test(fileName)) return 'image/png';
	if (/\.jpe?g$/i.test(fileName)) return 'image/jpeg';
	if (/\.bmp$/i.test(fileName)) return 'image/bmp';
	if (/\.tiff?$/i.test(fileName)) return 'image/tiff';
	return 'application/octet-stream';
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

function CompatibilityDetailView({ detail }: { detail: CompatibilityDetail }) {
	const [expanded, setExpanded] = useState(false);

	if (!expanded) {
		return (
			<button className="btn btn--link assets__compat-toggle" onClick={() => setExpanded(true)}>
				Show details
			</button>
		);
	}

	const rows: { label: string; check: PropertyCheck }[] = [];
	if (detail.video) {
		rows.push({ label: 'Video codec', check: detail.video.codec });
		rows.push({ label: 'Resolution', check: detail.video.resolution });
		rows.push({ label: 'Frame rate', check: detail.video.frameRate });
	}
	for (const a of detail.audioStreams) {
		rows.push({ label: `Audio #${a.streamIndex}`, check: a.codec });
	}
	rows.push({ label: 'Container', check: detail.container.format });

	return (
		<div className="assets__compat-detail">
			<button className="btn btn--link assets__compat-toggle" onClick={() => setExpanded(false)}>
				Hide details
			</button>
			<table className="assets__compat-table">
				<thead>
					<tr>
						<th>Property</th>
						<th>Source</th>
						<th>DVD requires</th>
						<th>Action</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((r) => (
						<tr
							key={r.label}
							className={r.check.compatible ? '' : 'assets__compat-row--incompatible'}
						>
							<td>{r.label}</td>
							<td>{r.check.value}</td>
							<td>{r.check.dvdRequires}</td>
							<td>{r.check.action === 'none' ? '—' : r.check.action}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function warningKey(warning: Asset['warnings'][number], index: number): string {
	return `${warning.code}:${warning.message}:${index}`;
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
