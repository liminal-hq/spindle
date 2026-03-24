// Settings page — project settings, build configuration, and toolchain status.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useProjectStore } from '../store/project-store';
import type { VideoStandard, CapacityTarget, AllocationStrategy } from '../types/project';
import { CAPACITY_LABELS } from '../types/project';
import './SettingsPage.css';

export function SettingsPage() {
	const project = useProjectStore((s) => s.project);
	const updateProject = useProjectStore((s) => s.updateProject);
	const toolchain = useProjectStore((s) => s.toolchain);
	const checkToolchain = useProjectStore((s) => s.checkToolchain);

	// Check toolchain on mount
	useEffect(() => {
		checkToolchain();
	}, [checkToolchain]);

	if (!project) {
		return (
			<div className="settings">
				<div className="page-header">
					<h1 className="page-title">Settings</h1>
				</div>
				<p className="text-muted">Open a project to configure settings.</p>
			</div>
		);
	}

	return (
		<div className="settings">
			<div className="page-header">
				<h1 className="page-title">Settings</h1>
			</div>

			{/* Project Settings */}
			<div className="card settings__section">
				<h3 className="card__title">Project</h3>
				<div className="settings__field">
					<label className="settings__label">Project Name</label>
					<input
						className="settings__input"
						value={project.project.name}
						onChange={(e) =>
							updateProject((p) => ({
								...p,
								project: { ...p.project, name: e.target.value },
							}))
						}
					/>
				</div>
			</div>

			{/* Disc Settings */}
			<div className="card settings__section">
				<h3 className="card__title">Disc Format</h3>
				<div className="settings__field">
					<label className="settings__label">Video Standard</label>
					<select
						className="settings__select"
						value={project.disc.standard}
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
				<div className="settings__field">
					<label className="settings__label">Capacity Target</label>
					<select
						className="settings__select"
						value={project.disc.capacityTarget}
						onChange={(e) =>
							updateProject((p) => ({
								...p,
								disc: {
									...p.disc,
									capacityTarget: e.target.value as CapacityTarget,
								},
							}))
						}
					>
						<option value="DVD5">{CAPACITY_LABELS.DVD5}</option>
						<option value="DVD9">{CAPACITY_LABELS.DVD9}</option>
					</select>
				</div>
			</div>

			{/* Build Settings */}
			<div className="card settings__section">
				<h3 className="card__title">Build</h3>
				<div className="settings__field">
					<label className="settings__label">Output Directory</label>
					<div className="settings__input-group">
						<input
							className="settings__input"
							value={project.buildSettings.outputDirectory ?? ''}
							placeholder="Not set (will prompt on build)"
							onChange={(e) =>
								updateProject((p) => ({
									...p,
									buildSettings: {
										...p.buildSettings,
										outputDirectory: e.target.value || null,
									},
								}))
							}
						/>
						<button
							className="btn btn--sm"
							onClick={async () => {
								const selected = await open({ directory: true });
								if (selected) {
									updateProject((p) => ({
										...p,
										buildSettings: {
											...p.buildSettings,
											outputDirectory: selected,
										},
									}));
								}
							}}
						>
							Browse…
						</button>
					</div>
				</div>
				<div className="settings__field">
					<label className="settings__label">Allocation Strategy</label>
					<select
						className="settings__select"
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
					<p className="settings__hint text-muted">
						How to distribute available bitrate across titles when re-encoding.
					</p>
				</div>
				<div className="settings__field">
					<label className="settings__label">
						Safety Margin ({(project.buildSettings.safetyMarginBytes / 1_000_000).toFixed(0)} MB)
					</label>
					<input
						type="range"
						className="settings__range"
						min={10_000_000}
						max={200_000_000}
						step={10_000_000}
						value={project.buildSettings.safetyMarginBytes}
						onChange={(e) =>
							updateProject((p) => ({
								...p,
								buildSettings: {
									...p.buildSettings,
									safetyMarginBytes: Number(e.target.value),
								},
							}))
						}
					/>
					<p className="settings__hint text-muted">
						Reserved space to account for filesystem overhead and rounding.
					</p>
				</div>
				<div className="settings__field settings__field--inline">
					<label className="settings__checkbox-label">
						<input
							type="checkbox"
							checked={project.buildSettings.generateIso}
							onChange={(e) =>
								updateProject((p) => ({
									...p,
									buildSettings: {
										...p.buildSettings,
										generateIso: e.target.checked,
									},
								}))
							}
						/>
						Generate ISO image
					</label>
					<p className="settings__hint text-muted">
						Create a disc image alongside the VIDEO_TS folder.
					</p>
				</div>
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

			{/* Project Info */}
			<div className="card settings__section">
				<h3 className="card__title">Info</h3>
				<dl className="settings__info-grid">
					<dt>Project ID</dt>
					<dd className="settings__mono">{project.project.id}</dd>
					<dt>Schema Version</dt>
					<dd>{project.schemaVersion}</dd>
					<dt>Created</dt>
					<dd>{new Date(project.project.createdAt).toLocaleString()}</dd>
					<dt>Last Modified</dt>
					<dd>{new Date(project.project.modifiedAt).toLocaleString()}</dd>
					<dt>Disc Family</dt>
					<dd>{project.disc.family === 'dvd-video' ? 'DVD-Video' : project.disc.family}</dd>
				</dl>
			</div>
		</div>
	);
}
