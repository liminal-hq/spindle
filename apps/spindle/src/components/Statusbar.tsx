// Status bar showing disc info, capacity, and app version.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { useProjectStore } from '../store/project-store';
import { CAPACITY_LABELS } from '../types/project';
import './Statusbar.css';

export function Statusbar() {
	const [appVersion, setAppVersion] = useState('0.2.0-dev');
	const project = useProjectStore((s) => s.project);
	const isDirty = useProjectStore((s) => s.isDirty);
	const validationIssues = useProjectStore((s) => s.validationIssues);

	useEffect(() => {
		let isMounted = true;

		const loadVersion = async () => {
			try {
				const version = await getVersion();
				if (isMounted) {
					setAppVersion(version);
				}
			} catch {
				// Keep the fallback version when running outside the Tauri runtime.
			}
		};

		void loadVersion();

		return () => {
			isMounted = false;
		};
	}, []);

	const errorCount = validationIssues.filter((i) => i.severity === 'error').length;
	const warningCount = validationIssues.filter((i) => i.severity === 'warning').length;

	const dotClass =
		errorCount > 0 ? 'statusbar__dot--error' : warningCount > 0 ? 'statusbar__dot--warning' : '';

	if (!project) {
		return (
			<footer className="statusbar">
				<div className="statusbar__segment">No project open</div>
				<div style={{ flex: 1 }} />
				<div className="statusbar__segment">Spindle v{appVersion}</div>
			</footer>
		);
	}

	const titleCount = project.disc.titlesets.reduce((sum, ts) => sum + ts.titles.length, 0);
	const menuCount =
		project.disc.globalMenus.length +
		project.disc.titlesets.reduce((sum, ts) => sum + ts.menus.length, 0);

	return (
		<footer className="statusbar">
			<div className="statusbar__segment">
				<span className={`statusbar__dot ${dotClass}`} />
				DVD-Video &middot; {project.disc.standard}
			</div>
			<div className="statusbar__segment">{CAPACITY_LABELS[project.disc.capacityTarget]}</div>
			<div className="statusbar__segment">
				{titleCount} {titleCount === 1 ? 'title' : 'titles'} &middot; {menuCount}{' '}
				{menuCount === 1 ? 'menu' : 'menus'}
			</div>
			{isDirty && (
				<div className="statusbar__segment" style={{ color: 'var(--colour-warning)' }}>
					Unsaved changes
				</div>
			)}
			<div style={{ flex: 1 }} />
			<div className="statusbar__segment">Spindle v{appVersion}</div>
		</footer>
	);
}
