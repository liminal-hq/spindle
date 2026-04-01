// Settings page — application-level preferences and toolchain status.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect } from 'react';
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { confirm, save } from '@tauri-apps/plugin-dialog';
import { useProjectStore } from '../store/project-store';
import { useAppSettingsStore } from '../store/app-settings-store';
import './SettingsPage.css';

interface ThumbnailCacheStatus {
	path: string;
	sizeBytes: number;
	fileCount: number;
}

export function SettingsPage() {
	const project = useProjectStore((s) => s.project);
	const validationIssues = useProjectStore((s) => s.validationIssues);
	const buildLog = useProjectStore((s) => s.buildLog);
	const toolchain = useProjectStore((s) => s.toolchain);
	const checkToolchain = useProjectStore((s) => s.checkToolchain);
	const devSkipSidecar = useAppSettingsStore((s) => s.devSkipSidecar);
	const setDevSkipSidecar = useAppSettingsStore((s) => s.setDevSkipSidecar);
	const devSkipUnsupportedStreams = useAppSettingsStore((s) => s.devSkipUnsupportedStreams);
	const setDevSkipUnsupportedStreams = useAppSettingsStore((s) => s.setDevSkipUnsupportedStreams);
	const [thumbnailCache, setThumbnailCache] = useState<ThumbnailCacheStatus | null>(null);
	const [isCacheLoading, setIsCacheLoading] = useState(false);
	const [cacheError, setCacheError] = useState<string | null>(null);

	// Check toolchain on mount
	useEffect(() => {
		checkToolchain();
	}, [checkToolchain]);

	const refreshThumbnailCache = async () => {
		setIsCacheLoading(true);
		setCacheError(null);
		try {
			const status = await invoke<ThumbnailCacheStatus>('get_thumbnail_cache_status');
			setThumbnailCache(status);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: `Failed to inspect thumbnail cache: ${String(error)}`;
			setCacheError(message);
		} finally {
			setIsCacheLoading(false);
		}
	};

	useEffect(() => {
		void refreshThumbnailCache();
	}, []);

	const handleExportDiagnostics = async () => {
		try {
			const json = await invoke<string>('plugin:spindle-project|export_diagnostics', {
				project: project ?? null,
				buildLog,
				validationIssues,
				skipSidecar: devSkipSidecar,
				skipUnsupportedStreams: devSkipUnsupportedStreams,
			});

			const path = await save({
				filters: [{ name: 'JSON', extensions: ['json'] }],
				defaultPath: 'spindle-diagnostics.json',
			});
			if (!path) return;

			await invoke('write_text_file', { path, contents: json });
		} catch {
			// Best-effort export
		}
	};

	const handleClearThumbnailCache = async () => {
		const approved = await confirm(
			'Clear cached thumbnails? They will be regenerated the next time assets need previews.',
		);
		if (!approved) return;

		setIsCacheLoading(true);
		setCacheError(null);
		try {
			await invoke('clear_thumbnail_cache');
			await refreshThumbnailCache();
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: `Failed to clear thumbnail cache: ${String(error)}`;
			setCacheError(message);
			setIsCacheLoading(false);
		}
	};

	return (
		<div className="settings">
			<div className="page-header">
				<h1 className="page-title">Settings</h1>
			</div>

			{/* Toolchain Status */}
			<div className="card settings__section">
				<div className="card__header">
					<h3 className="card__title">Toolchain</h3>
					<button className="btn btn--sm" onClick={checkToolchain}>
						Refresh
					</button>
				</div>
				<p className="settings__hint text-muted">
					External tools required for DVD authoring. Install missing tools to enable building.
				</p>
				{toolchain.length === 0 ? (
					<p className="text-muted">Checking toolchain…</p>
				) : (
					<div className="settings__toolchain">
						{toolchain.map((tool) => (
							<div key={tool.name} className="settings__tool-row">
								<span
									className={`settings__tool-status ${tool.available ? 'settings__tool-status--ok' : 'settings__tool-status--missing'}`}
								>
									{tool.available ? '\u2713' : '\u2717'}
								</span>
								<span className="settings__tool-name">{tool.name}</span>
								<span className="settings__tool-purpose text-muted">{tool.purpose}</span>
								{tool.version && (
									<span className="settings__tool-version text-muted">{tool.version}</span>
								)}
							</div>
						))}
					</div>
				)}
			</div>

			<div className="card settings__section">
				<div className="card__header">
					<h3 className="card__title">Thumbnail Cache</h3>
					<button className="btn btn--sm" onClick={() => void refreshThumbnailCache()}>
						Refresh
					</button>
				</div>
				<p className="settings__hint text-muted">
					Generated media previews are stored in the app cache so assets reopen quickly across
					sessions.
				</p>
				{cacheError ? (
					<p className="settings__warning">{cacheError}</p>
				) : (
					<dl className="settings__info-grid settings__cache-grid">
						<dt>Items</dt>
						<dd>{thumbnailCache ? thumbnailCache.fileCount : isCacheLoading ? 'Loading…' : '0'}</dd>
						<dt>Size</dt>
						<dd>
							{thumbnailCache
								? formatBytes(thumbnailCache.sizeBytes)
								: isCacheLoading
									? 'Loading…'
									: '0 B'}
						</dd>
						<dt>Location</dt>
						<dd className="settings__path">
							{thumbnailCache ? thumbnailCache.path : isCacheLoading ? 'Loading…' : 'Unavailable'}
						</dd>
					</dl>
				)}
				<div className="settings__cache-actions">
					<button
						className="btn btn--sm"
						onClick={() => void handleClearThumbnailCache()}
						disabled={isCacheLoading || (thumbnailCache?.fileCount ?? 0) === 0}
					>
						Clear Thumbnail Cache
					</button>
				</div>
			</div>

			{/* Diagnostics */}
			<div className="card settings__section">
				<div className="card__header">
					<h3 className="card__title">Diagnostics</h3>
				</div>
				<p className="settings__hint text-muted">
					Export a diagnostics bundle for troubleshooting. Includes toolchain status, validation
					results, build log, project summary, and active developer options (no media files).
				</p>
				<button
					className="btn btn--sm"
					style={{ marginTop: 'var(--space-3)' }}
					onClick={handleExportDiagnostics}
				>
					Export Diagnostics…
				</button>
			</div>

			{/* Developer */}
			<div className="card settings__section">
				<div className="card__header">
					<h3 className="card__title">Developer</h3>
				</div>
				<p className="settings__hint text-muted">
					Options for local development and testing. Not needed for normal use.
				</p>
				<div className="settings__dev-options">
					<label className="settings__toggle-row">
						<div className="settings__toggle-text">
							<span className="settings__toggle-label">Skip bundled sidecars</span>
							<span className="settings__toggle-desc text-muted">
								Use host PATH tools instead of binaries bundled alongside the app. Enable this when
								testing a locally-built binary that has stub sidecars.
							</span>
						</div>
						<input
							type="checkbox"
							className="settings__toggle"
							checked={devSkipSidecar}
							onChange={(e) => {
								setDevSkipSidecar(e.target.checked);
								checkToolchain();
							}}
						/>
					</label>
					<label className="settings__toggle-row">
						<div className="settings__toggle-text">
							<span className="settings__toggle-label">Skip unsupported streams</span>
							<span className="settings__toggle-desc text-muted">
								Automatically strip text-based subtitle mappings during build instead of blocking.
								Useful when sources only have text subtitles and you want to author without them.
							</span>
						</div>
						<input
							type="checkbox"
							className="settings__toggle"
							checked={devSkipUnsupportedStreams}
							onChange={(e) => setDevSkipUnsupportedStreams(e.target.checked)}
						/>
					</label>
				</div>
			</div>

			{/* About */}
			<div className="card settings__section">
				<h3 className="card__title">About</h3>
				<dl className="settings__info-grid">
					<dt>Application</dt>
					<dd>Spindle</dd>
					<dt>Purpose</dt>
					<dd>DVD-Video authoring</dd>
				</dl>
			</div>
		</div>
	);
}

function formatBytes(bytes: number): string {
	if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
	if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
	if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
	return `${bytes} B`;
}
