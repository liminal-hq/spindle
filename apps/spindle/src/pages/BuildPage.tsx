// Build page — configure and trigger the DVD authoring pipeline.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState } from 'react';
import { useProjectStore } from '../store/project-store';
import './BuildPage.css';

type BuildStatus = 'idle' | 'validating' | 'building' | 'complete' | 'error';

export function BuildPage() {
	const project = useProjectStore((s) => s.project);
	const validationIssues = useProjectStore((s) => s.validationIssues);
	const validateProject = useProjectStore((s) => s.validateProject);
	const [buildStatus, setBuildStatus] = useState<BuildStatus>('idle');
	const [buildLog, setBuildLog] = useState<string[]>([]);

	if (!project) return null;

	const disc = project.disc;
	const titleCount = disc.titlesets.reduce((s, ts) => s + ts.titles.length, 0);
	const errorCount = validationIssues.filter((i) => i.severity === 'error').length;
	const canBuild = titleCount > 0 && errorCount === 0 && buildStatus === 'idle';

	const handleValidate = async () => {
		setBuildStatus('validating');
		setBuildLog((prev) => [...prev, 'Running validation checks…']);
		await validateProject();
		setBuildStatus('idle');
		setBuildLog((prev) => [...prev, 'Validation complete.']);
	};

	const handleBuild = async () => {
		setBuildStatus('building');
		setBuildLog([
			'Starting DVD-Video build…',
			`Target: ${disc.standard} ${disc.capacityTarget}`,
			`Titles: ${titleCount}`,
			`Output: ${project.buildSettings.outputDirectory ?? '(not set)'}`,
			'',
			'Build pipeline not yet connected.',
			'This will orchestrate FFmpeg and dvdauthor in a future release.',
		]);

		// Simulate build progress (actual build pipeline is Phase 8-9)
		await new Promise((r) => setTimeout(r, 1500));
		setBuildStatus('complete');
		setBuildLog((prev) => [...prev, '', 'Build pipeline placeholder complete.']);
	};

	return (
		<div className="build">
			<div className="page-header">
				<h1 className="page-title">Build</h1>
			</div>

			{/* Build controls */}
			<div className="card build__controls">
				<div className="card__header">
					<h3 className="card__title">Build DVD-Video</h3>
					<StatusBadge status={buildStatus} />
				</div>
				<div className="build__summary">
					<div className="build__summary-item">
						<span className="build__summary-label text-muted">Format</span>
						<span>
							{disc.standard} · {disc.capacityTarget}
						</span>
					</div>
					<div className="build__summary-item">
						<span className="build__summary-label text-muted">Titles</span>
						<span>{titleCount}</span>
					</div>
					<div className="build__summary-item">
						<span className="build__summary-label text-muted">ISO</span>
						<span>{project.buildSettings.generateIso ? 'Yes' : 'No'}</span>
					</div>
					<div className="build__summary-item">
						<span className="build__summary-label text-muted">Output</span>
						<span className="build__summary-path">
							{project.buildSettings.outputDirectory ?? 'Not set'}
						</span>
					</div>
				</div>
				<div className="build__actions">
					<button className="btn" onClick={handleValidate} disabled={buildStatus !== 'idle'}>
						Validate
					</button>
					<button className="btn btn--primary" onClick={handleBuild} disabled={!canBuild}>
						Build Disc
					</button>
				</div>
				{errorCount > 0 && (
					<p className="build__warning">
						{errorCount} validation error{errorCount === 1 ? '' : 's'} must be resolved before
						building.
					</p>
				)}
				{titleCount === 0 && (
					<p className="build__warning">Add at least one title to the project before building.</p>
				)}
			</div>

			{/* Build log */}
			{buildLog.length > 0 && (
				<div className="card build__log">
					<div className="card__header">
						<h3 className="card__title">Build Log</h3>
						<button
							className="btn btn--sm"
							onClick={() => {
								setBuildLog([]);
								setBuildStatus('idle');
							}}
						>
							Clear
						</button>
					</div>
					<pre className="build__log-output">{buildLog.join('\n')}</pre>
				</div>
			)}

			{/* Validation issues */}
			{validationIssues.length > 0 && (
				<div className="card build__validation">
					<div className="card__header">
						<h3 className="card__title">Validation Issues</h3>
					</div>
					<div className="build__issue-list">
						{validationIssues.map((issue, i) => (
							<div key={i} className={`build__issue build__issue--${issue.severity}`}>
								<span className="build__issue-dot" />
								<span className="build__issue-code">{issue.code}</span>
								<span>{issue.message}</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function StatusBadge({ status }: { status: BuildStatus }) {
	const classMap: Record<BuildStatus, string> = {
		idle: 'badge--neutral',
		validating: 'badge--light',
		building: 'badge--light',
		complete: 'badge--remux',
		error: 'badge--unsupported',
	};
	const labelMap: Record<BuildStatus, string> = {
		idle: 'Ready',
		validating: 'Validating…',
		building: 'Building…',
		complete: 'Complete',
		error: 'Error',
	};
	return <span className={`badge ${classMap[status]}`}>{labelMap[status]}</span>;
}
