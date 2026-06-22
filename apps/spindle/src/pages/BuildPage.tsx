// Build page — configure, preview, and execute the DVD authoring pipeline.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect } from 'react';
import { useProjectStore } from '../store/project-store';
import { useNavigation } from '../App';
import { NoProjectState } from '../components/NoProjectState';
import type { BuildJob, ValidationIssue } from '../types/project';
import './BuildPage.css';

export function BuildPage() {
	const project = useProjectStore((s) => s.project);
	const validationIssues = useProjectStore((s) => s.validationIssues);
	const validateProject = useProjectStore((s) => s.validateProject);
	const buildPlan = useProjectStore((s) => s.buildPlan);
	const buildStatus = useProjectStore((s) => s.buildStatus);
	const buildResult = useProjectStore((s) => s.buildResult);
	const buildLog = useProjectStore((s) => s.buildLog);
	const buildProgress = useProjectStore((s) => s.buildProgress);
	const generateBuildPlan = useProjectStore((s) => s.generateBuildPlan);
	const executeBuild = useProjectStore((s) => s.executeBuild);
	const cancelBuild = useProjectStore((s) => s.cancelBuild);
	const clearBuild = useProjectStore((s) => s.clearBuild);
	const browseOutputDir = useProjectStore((s) => s.browseOutputDir);

	// Auto-validate on mount
	useEffect(() => {
		if (project) validateProject();
	}, [project, validateProject]);

	if (!project) {
		return (
			<NoProjectState
				title="No Project Open"
				description="Open or create a project to configure build settings and export."
				icon={
					<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
						<path d="M16 56V32l16-24 16 24v24" />
						<line x1="16" y1="40" x2="48" y2="40" />
					</svg>
				}
			/>
		);
	}

	const disc = project.disc;
	const titleCount = disc.titlesets.reduce((s, ts) => s + ts.titles.length, 0);
	const errorCount = validationIssues.filter((i) => i.severity === 'error').length;
	const dolbyVisionAssets = project.assets.filter((asset) =>
		asset.videoStreams.some((stream) => stream.dolbyVisionProfile != null),
	);
	const canBuild = titleCount > 0 && errorCount === 0 && buildStatus === 'idle';
	const isBuilding = buildStatus === 'building';

	const handleValidate = async () => {
		await validateProject();
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
							{disc.standard} &middot; {disc.capacityTarget}
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
						<button
							className="btn btn--sm"
							onClick={browseOutputDir}
							disabled={isBuilding}
							title="Choose output directory"
						>
							Browse…
						</button>
					</div>
				</div>
				<div className="build__actions">
					<button className="btn" onClick={handleValidate} disabled={isBuilding}>
						Validate
					</button>
					<button className="btn" onClick={generateBuildPlan} disabled={!canBuild || isBuilding}>
						Preview Plan
					</button>
					<button
						className="btn btn--primary"
						onClick={executeBuild}
						disabled={!canBuild || isBuilding}
					>
						{isBuilding ? 'Building…' : 'Build Disc'}
					</button>
					{isBuilding && (
						<button className="btn btn--sm btn--danger" onClick={cancelBuild}>
							Cancel
						</button>
					)}
					{(buildStatus === 'complete' || buildStatus === 'error') && (
						<button className="btn btn--sm" onClick={clearBuild}>
							Clear
						</button>
					)}
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
				{dolbyVisionAssets.length > 0 && (
					<div className="build__warning-banner">
						<p className="build__warning">
							Dolby Vision source detected. SDR DVD output may have incorrect colours for{' '}
							{dolbyVisionAssets.length} asset{dolbyVisionAssets.length === 1 ? '' : 's'}.
						</p>
					</div>
				)}
			</div>

			{/* QA Scorecard */}
			<QaScorecard project={project} validationIssues={validationIssues} />

			{/* Build progress */}
			{isBuilding && buildProgress && (
				<div className="card build__progress">
					<div className="card__header">
						<h3 className="card__title">Progress</h3>
						<span className="text-muted">
							Step {buildProgress.jobIndex + 1} of {buildProgress.totalJobs}
						</span>
					</div>
					<div className="build__progress-bar">
						<div
							className="build__progress-fill"
							style={{
								width: `${((buildProgress.jobIndex + (buildProgress.status === 'complete' ? 1 : 0.5)) / buildProgress.totalJobs) * 100}%`,
							}}
						/>
					</div>
					<p className="build__progress-label text-muted">{buildProgress.currentLabel}</p>

					{/* Step-level progress bar (e.g. FFmpeg transcode) */}
					{buildProgress.stepPercent != null && (
						<div className="build__step-progress">
							<div className="build__progress-bar build__progress-bar--step">
								<div
									className="build__progress-fill build__progress-fill--step"
									style={{
										width: `${Math.min(100, Math.max(0, buildProgress.stepPercent))}%`,
									}}
								/>
							</div>
							<div className="build__step-meta">
								{buildProgress.stepLabel && (
									<span className="build__step-label text-muted">{buildProgress.stepLabel}</span>
								)}
								{buildProgress.stepDetail && (
									<span className="build__step-detail text-muted">{buildProgress.stepDetail}</span>
								)}
							</div>
						</div>
					)}
				</div>
			)}

			{/* Build result */}
			{buildResult && (
				<div
					className={`card build__result ${buildResult.success ? 'build__result--success' : 'build__result--error'}`}
				>
					<div className="card__header">
						<h3 className="card__title">
							{buildResult.success ? 'Build Successful' : 'Build Failed'}
						</h3>
					</div>
					<dl className="build__result-details">
						<dt>Output</dt>
						<dd className="build__summary-path">{buildResult.outputDirectory}</dd>
						{buildResult.isoPath && (
							<>
								<dt>ISO</dt>
								<dd className="build__summary-path">{buildResult.isoPath}</dd>
							</>
						)}
						{buildResult.errorMessage && (
							<>
								<dt>Error</dt>
								<dd className="build__error-msg">{buildResult.errorMessage}</dd>
							</>
						)}
					</dl>
				</div>
			)}

			{/* Build plan preview */}
			{buildPlan && (
				<div className="card build__plan">
					<div className="card__header">
						<h3 className="card__title">Build Plan</h3>
						<span className="badge badge--neutral">
							{buildPlan.summary.totalJobs} step{buildPlan.summary.totalJobs === 1 ? '' : 's'}
						</span>
					</div>
					<div className="build__plan-summary">
						<span>
							{buildPlan.summary.transcodeJobs} transcode job
							{buildPlan.summary.transcodeJobs === 1 ? '' : 's'}
						</span>
						<span>&middot;</span>
						<span>
							{buildPlan.summary.titlesCount} title{buildPlan.summary.titlesCount === 1 ? '' : 's'}
						</span>
						{buildPlan.summary.generateIso && (
							<>
								<span>&middot;</span>
								<span>ISO generation</span>
							</>
						)}
					</div>
					<div className="build__plan-jobs">
						{buildPlan.jobs.map((job, i) => (
							<BuildJobRow key={i} job={job} index={i} />
						))}
					</div>

					{/* dvdauthor XML preview */}
					<details className="build__xml-preview">
						<summary>dvdauthor XML</summary>
						<pre className="build__xml-content">{buildPlan.dvdauthorXml}</pre>
					</details>

					{/* Command preview */}
					{buildPlan.summary.estimatedCommands.length > 0 && (
						<details className="build__xml-preview">
							<summary>Commands ({buildPlan.summary.estimatedCommands.length})</summary>
							<pre className="build__xml-content">
								{buildPlan.summary.estimatedCommands.join('\n\n')}
							</pre>
						</details>
					)}
				</div>
			)}

			{/* Build log */}
			{buildLog.length > 0 && (
				<div className="card build__log">
					<div className="card__header">
						<h3 className="card__title">Build Log</h3>
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
							<BuildIssueRow key={i} issue={issue} />
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function buildIssueRoute(issue: ValidationIssue): string | null {
	switch (issue.entityType) {
		case 'title':
			return '/titles';
		case 'menu':
			return '/menus';
		case 'titleset':
			return '/titles';
		case 'disc':
			return '/';
		case 'build':
			return null; // already on build page
		default:
			return null;
	}
}

function BuildIssueRow({ issue }: { issue: ValidationIssue }) {
	const { navigateTo } = useNavigation();
	const route = buildIssueRoute(issue);
	const isClickable = route != null;

	const handleClick = () => {
		if (!route) return;
		navigateTo({ route, entityId: issue.context ?? undefined });
	};

	return (
		<div
			className={`build__issue build__issue--${issue.severity} ${isClickable ? 'build__issue--clickable' : ''}`}
			onClick={isClickable ? handleClick : undefined}
			role={isClickable ? 'button' : undefined}
			tabIndex={isClickable ? 0 : undefined}
			onKeyDown={isClickable ? (e) => e.key === 'Enter' && handleClick() : undefined}
		>
			<span className="build__issue-dot" />
			<span className="build__issue-code">{issue.code}</span>
			<div className="build__issue-body">
				<span>{issue.message}</span>
				{issue.suggestedFix && (
					<span className="build__issue-fix text-muted">{issue.suggestedFix}</span>
				)}
			</div>
		</div>
	);
}

function BuildJobRow({ job, index }: { job: BuildJob; index: number }) {
	const label = getJobLabel(job);
	const icon = getJobIcon(job);

	return (
		<div className="build__job-row">
			<span className="build__job-index">{index + 1}</span>
			<span className="build__job-icon">{icon}</span>
			<span className="build__job-label">{label}</span>
			{'command' in job && job.command && (
				<span className="build__job-cmd text-muted">{job.command[0]}</span>
			)}
		</div>
	);
}

function getJobLabel(job: BuildJob): string {
	if (job.type === 'prepareWorkspace') return 'Prepare workspace';
	return job.label;
}

function getJobIcon(job: BuildJob): string {
	switch (job.type) {
		case 'prepareWorkspace':
			return '\u{1F4C1}';
		case 'transcodeTitle':
			return '\u{1F3AC}';
		case 'renderMenu':
			return '\u{1F5BC}';
		case 'composeMenuHighlights':
			return '\u{2728}';
		case 'linkTitle':
			return '\u{1F517}';
		case 'extractSubtitles':
			return '\u{1F4DD}';
		case 'renderTextSubtitles':
			return '\u{1F5E8}';
		case 'authorDvd':
			return '\u{1F4BF}';
		case 'createIso':
			return '\u{1F4C0}';
	}
}

function QaScorecard({
	project,
	validationIssues,
}: {
	project: import('../types/project').SpindleProjectFile;
	validationIssues: ValidationIssue[];
}) {
	const disc = project.disc;
	const titleCount = disc.titlesets.reduce((s, ts) => s + ts.titles.length, 0);
	const menuCount =
		disc.globalMenus.length + disc.titlesets.reduce((s, ts) => s + ts.menus.length, 0);
	const errors = validationIssues.filter((i) => i.severity === 'error').length;
	const warnings = validationIssues.filter((i) => i.severity === 'warning').length;

	const checks = [
		{ label: 'Has titles', pass: titleCount > 0 },
		{
			label: 'All titles have sources',
			pass: !validationIssues.some((i) => i.code === 'title.no-source'),
		},
		{
			label: 'All titles have video mapping',
			pass: !validationIssues.some((i) => i.code === 'title.no-video-mapping'),
		},
		{
			label: 'All titles have output profile',
			pass: !validationIssues.some((i) => i.code === 'title.no-output-profile'),
		},
		{ label: 'First-play action set', pass: disc.firstPlayAction != null },
		{
			label: 'Menus have buttons',
			pass: menuCount === 0 || !validationIssues.some((i) => i.code === 'menu.no-buttons'),
		},
		{
			label: 'No dangling references',
			pass: !validationIssues.some((i) => i.code.includes('dangling')),
		},
		{ label: 'Output directory set', pass: project.buildSettings.outputDirectory != null },
		{
			label: 'Dolby Vision sources warned',
			pass: project.assets.every(
				(asset) =>
					asset.videoStreams.every((stream) => stream.dolbyVisionProfile == null) ||
					asset.warnings.some((warning) => warning.code === 'video.dolby-vision'),
			),
		},
	];

	const passCount = checks.filter((c) => c.pass).length;

	return (
		<div className="card build__scorecard">
			<div className="card__header">
				<h3 className="card__title">QA Scorecard</h3>
				<span
					className={`badge ${passCount === checks.length ? 'badge--remux' : errors > 0 ? 'badge--unsupported' : 'badge--light'}`}
				>
					{passCount}/{checks.length}
				</span>
			</div>
			<div className="build__scorecard-grid">
				{checks.map((check) => (
					<div key={check.label} className="build__scorecard-item">
						<span
							className={`build__scorecard-icon ${check.pass ? 'build__scorecard-icon--pass' : 'build__scorecard-icon--fail'}`}
						>
							{check.pass ? '\u2713' : '\u2717'}
						</span>
						<span>{check.label}</span>
					</div>
				))}
			</div>
			{(errors > 0 || warnings > 0) && (
				<p className="build__scorecard-summary text-muted">
					{errors > 0 && (
						<span>
							{errors} error{errors !== 1 ? 's' : ''}
						</span>
					)}
					{errors > 0 && warnings > 0 && <span> · </span>}
					{warnings > 0 && (
						<span>
							{warnings} warning{warnings !== 1 ? 's' : ''}
						</span>
					)}
				</p>
			)}
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	const classMap: Record<string, string> = {
		idle: 'badge--neutral',
		planning: 'badge--light',
		building: 'badge--light',
		complete: 'badge--remux',
		error: 'badge--unsupported',
	};
	const labelMap: Record<string, string> = {
		idle: 'Ready',
		planning: 'Planning…',
		building: 'Building…',
		complete: 'Complete',
		error: 'Error',
	};
	return (
		<span className={`badge ${classMap[status] ?? 'badge--neutral'}`}>
			{labelMap[status] ?? status}
		</span>
	);
}
