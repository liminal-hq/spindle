// Settings page — application-level preferences and toolchain status.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { useProjectStore } from '../store/project-store';
import { useAppSettingsStore } from '../store/app-settings-store';
import './SettingsPage.css';

export function SettingsPage() {
	const project = useProjectStore((s) => s.project);
	const validationIssues = useProjectStore((s) => s.validationIssues);
	const buildLog = useProjectStore((s) => s.buildLog);
	const toolchain = useProjectStore((s) => s.toolchain);
	const checkToolchain = useProjectStore((s) => s.checkToolchain);
	const devSkipSidecar = useAppSettingsStore((s) => s.devSkipSidecar);
	const setDevSkipSidecar = useAppSettingsStore((s) => s.setDevSkipSidecar);

	// Check toolchain on mount
	useEffect(() => {
		checkToolchain();
	}, [checkToolchain]);

	const handleExportDiagnostics = async () => {
		try {
			const json = await invoke<string>('plugin:spindle-project|export_diagnostics', {
				project: project ?? null,
				buildLog,
				validationIssues,
				skipSidecar: devSkipSidecar,
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

			{/* Diagnostics */}
			<div className="card settings__section">
				<div className="card__header">
					<h3 className="card__title">Diagnostics</h3>
				</div>
				<p className="settings__hint text-muted">
					Export a diagnostics bundle for troubleshooting. Includes toolchain status, validation
					results, build log, and project summary (no media files).
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
