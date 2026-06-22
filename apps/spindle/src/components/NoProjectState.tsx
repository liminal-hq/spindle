// Shared empty state shown on authoring pages when no project is open.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useProjectStore } from '../store/project-store';
import './NoProjectState.css';

interface NoProjectStateProps {
	title: string;
	description: string;
	icon: React.ReactNode;
}

/** Guard fallback for pages that need an open project, shown instead of a blank page. */
export function NoProjectState({ title, description, icon }: NoProjectStateProps) {
	const createProject = useProjectStore((s) => s.createProject);
	const openProject = useProjectStore((s) => s.openProject);

	const handleNew = () =>
		createProject({ name: 'Untitled Project', standard: 'NTSC', capacityTarget: 'DVD5' });

	return (
		<div className="no-project-state">
			<div className="no-project-state__icon">{icon}</div>
			<h2>{title}</h2>
			<p className="text-muted">{description}</p>
			<div className="no-project-state__actions">
				<button className="btn btn--primary" onClick={handleNew}>
					New Project
				</button>
				<button className="btn" onClick={openProject}>
					Open Project
				</button>
			</div>
		</div>
	);
}
