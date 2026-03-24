// Settings page — application-level preferences and toolchain status.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect } from 'react';
import { useProjectStore } from '../store/project-store';
import './SettingsPage.css';

export function SettingsPage() {
	const toolchain = useProjectStore((s) => s.toolchain);
	const checkToolchain = useProjectStore((s) => s.checkToolchain);

	// Check toolchain on mount
	useEffect(() => {
		checkToolchain();
	}, [checkToolchain]);

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
