// Project Overview dashboard showing disc health, capacity, and activity.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useProjectStore } from '../store/project-store';
import { useNavigation } from '../App';
import { NoProjectState } from '../components/NoProjectState';
import { CAPACITY_LABELS } from '../types/project';
import { formatBytes, useDiscCapacityEstimate } from '../utils/capacity';
import type {
	VideoStandard,
	CapacityTarget,
	AllocationStrategy,
	PlaybackAction,
	ValidationIssue,
} from '../types/project';
import './OverviewPage.css';

export function OverviewPage() {
	const project = useProjectStore((s) => s.project);
	const updateProject = useProjectStore((s) => s.updateProject);
	const validationIssues = useProjectStore((s) => s.validationIssues);
	const capacity = useDiscCapacityEstimate(project);

	if (!project) {
		return (
			<NoProjectState
				title="Welcome to Spindle"
				description="Optical-disc authoring studio for DVD-Video projects."
				icon={
					<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.5">
						<circle cx="32" cy="32" r="28" />
						<circle cx="32" cy="32" r="12" />
						<circle cx="32" cy="32" r="3" />
					</svg>
				}
			/>
		);
	}

	const disc = project.disc;
	const titleCount = disc.titlesets.reduce((s, ts) => s + ts.titles.length, 0);
	const assetCount = project.assets.length;
	const menuCount =
		disc.globalMenus.length + disc.titlesets.reduce((s, ts) => s + ts.menus.length, 0);
	const chapterCount = disc.titlesets.reduce(
		(s, ts) => s + ts.titles.reduce((c, t) => c + t.chapters.length, 0),
		0,
	);

	const errorCount = validationIssues.filter((i) => i.severity === 'error').length;
	const warningCount = validationIssues.filter((i) => i.severity === 'warning').length;

	// Same budget-aware estimate the Planner page and the build pipeline use,
	// so none of them disagree about whether a project fits on its target disc.
	const barPct = capacity ? `${Math.min(capacity.usagePct, 100).toFixed(1)}%` : '0%';
	const barClass = !capacity
		? ''
		: capacity.isOverCapacity
			? 'capacity-bar__segment--danger'
			: capacity.usagePct > 80
				? 'capacity-bar__segment--warn'
				: '';

	return (
		<div className="overview">
			<div className="page-header">
				<input
					className="page-title page-title--editable"
					value={project.project.name}
					onChange={(e) =>
						updateProject((p) => ({
							...p,
							project: { ...p.project, name: e.target.value },
						}))
					}
				/>
				<span className="badge badge--neutral">
					{disc.family === 'dvd-video' ? 'DVD-Video' : disc.family} &middot; {disc.standard}
				</span>
			</div>

			{/* Stats grid */}
			<div className="overview__stats">
				<StatCard label="Titles" value={titleCount} icon="titles" />
				<StatCard label="Assets" value={assetCount} icon="assets" />
				<StatCard label="Menus" value={menuCount} icon="menus" />
				<StatCard label="Chapters" value={chapterCount} icon="chapters" />
			</div>

			{/* Capacity card */}
			<div className="card overview__capacity">
				<div className="card__header">
					<h3 className="card__title">Disc Capacity</h3>
					<span className="text-muted">{CAPACITY_LABELS[disc.capacityTarget]}</span>
				</div>
				<div className="capacity-bar">
					<div
						className={`capacity-bar__segment ${barClass}`}
						style={{
							width: barPct,
							background: 'var(--brand-gradient)',
						}}
					/>
				</div>
				<div className="overview__capacity-legend">
					{!capacity ? (
						<span className="text-muted">Calculating&hellip;</span>
					) : titleCount === 0 ? (
						<span className="text-muted">
							No titles added yet &middot; {formatBytes(capacity.capacityBytes)} available
						</span>
					) : (
						<span className="text-muted">
							~{formatBytes(capacity.estimatedOutputBytes)} estimated &middot;{' '}
							{formatBytes(capacity.usableBytes - capacity.estimatedOutputBytes)} remaining
						</span>
					)}
				</div>
			</div>

			{/* Validation summary */}
			<div className="card overview__health">
				<div className="card__header">
					<h3 className="card__title">Project Health</h3>
				</div>
				{errorCount === 0 && warningCount === 0 && titleCount === 0 && (
					<p className="text-muted">Add titles and assets to see validation results here.</p>
				)}
				{errorCount === 0 && warningCount === 0 && titleCount > 0 && (
					<p style={{ color: 'var(--colour-success)' }}>
						No issues found. Project looks ready to build.
					</p>
				)}
				{(errorCount > 0 || warningCount > 0) && (
					<div className="overview__issues">
						{validationIssues.map((issue, i) => (
							<ValidationIssueRow key={i} issue={issue} />
						))}
					</div>
				)}
			</div>

			{/* Project settings */}
			<div className="card overview__settings">
				<div className="card__header">
					<h3 className="card__title">Project Settings</h3>
					<span className="text-muted">
						Created {new Date(project.project.createdAt).toLocaleDateString()}
					</span>
				</div>
				<div className="overview__settings-grid">
					<div className="overview__setting">
						<label className="overview__setting-label">Video Standard</label>
						<select
							className="overview__setting-select"
							value={disc.standard}
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
					<div className="overview__setting">
						<label className="overview__setting-label">Capacity Target</label>
						<select
							className="overview__setting-select"
							value={disc.capacityTarget}
							onChange={(e) =>
								updateProject((p) => ({
									...p,
									disc: { ...p.disc, capacityTarget: e.target.value as CapacityTarget },
								}))
							}
						>
							<option value="DVD5">{CAPACITY_LABELS.DVD5}</option>
							<option value="DVD9">{CAPACITY_LABELS.DVD9}</option>
						</select>
					</div>
					<div className="overview__setting">
						<label className="overview__setting-label">Allocation</label>
						<select
							className="overview__setting-select"
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
					</div>
					<div className="overview__setting">
						<label className="overview__setting-label">ISO Output</label>
						<label className="overview__setting-checkbox">
							<input
								type="checkbox"
								checked={project.buildSettings.generateIso}
								onChange={(e) =>
									updateProject((p) => ({
										...p,
										buildSettings: { ...p.buildSettings, generateIso: e.target.checked },
									}))
								}
							/>
							Generate ISO image
						</label>
					</div>
					<div className="overview__setting">
						<label className="overview__setting-label">First Play</label>
						<select
							className="overview__setting-select"
							value={firstPlayToString(disc.firstPlayAction)}
							onChange={(e) =>
								updateProject((p) => ({
									...p,
									disc: {
										...p.disc,
										firstPlayAction: stringToFirstPlay(e.target.value),
									},
								}))
							}
						>
							<option value="">None</option>
							<optgroup label="Play Title">
								{disc.titlesets
									.flatMap((ts) => ts.titles)
									.map((t) => (
										<option key={t.id} value={`playTitle:${t.id}`}>
											{t.name}
										</option>
									))}
							</optgroup>
							<optgroup label="Show Menu">
								{[...disc.globalMenus, ...disc.titlesets.flatMap((ts) => ts.menus)].map((m) => (
									<option key={m.id} value={`showMenu:${m.id}`}>
										{m.name}
									</option>
								))}
							</optgroup>
						</select>
					</div>
				</div>
			</div>
		</div>
	);
}

// ── Sub-components ──────────────────────────────────────────────────────────

function issueRoute(issue: ValidationIssue): string | null {
	const type = issue.entityType;
	if (!type) return null;
	switch (type) {
		case 'title':
			return '/titles';
		case 'menu':
			return '/menus';
		case 'titleset':
			return '/titles';
		case 'disc':
			return '/';
		case 'build':
			return '/build';
		default:
			return null;
	}
}

function ValidationIssueRow({ issue }: { issue: ValidationIssue }) {
	const { navigateTo } = useNavigation();
	const route = issueRoute(issue);
	const isClickable = route != null && route !== '/';

	const handleClick = () => {
		if (!route || route === '/') return;
		navigateTo({ route, entityId: issue.context ?? undefined });
	};

	return (
		<div
			className={`overview__issue overview__issue--${issue.severity} ${isClickable ? 'overview__issue--clickable' : ''}`}
			onClick={isClickable ? handleClick : undefined}
			role={isClickable ? 'button' : undefined}
			tabIndex={isClickable ? 0 : undefined}
			onKeyDown={isClickable ? (e) => e.key === 'Enter' && handleClick() : undefined}
		>
			<span className="overview__issue-dot" />
			<div className="overview__issue-body">
				<span>{issue.message}</span>
				{issue.suggestedFix && (
					<span className="overview__issue-fix text-muted">{issue.suggestedFix}</span>
				)}
			</div>
		</div>
	);
}

function StatCard({ label, value }: { label: string; value: number; icon: string }) {
	return (
		<div className="card card--glow overview__stat">
			<div className="overview__stat-value">{value}</div>
			<div className="overview__stat-label text-muted">{label}</div>
		</div>
	);
}

function firstPlayToString(action: PlaybackAction | null): string {
	if (!action) return '';
	switch (action.type) {
		case 'playTitle':
			return `playTitle:${action.titleId}`;
		case 'showMenu':
			return `showMenu:${action.menuId}`;
		default:
			return '';
	}
}

function stringToFirstPlay(str: string): PlaybackAction | null {
	if (!str) return null;
	const [type, id] = str.split(':');
	if (type === 'playTitle' && id) return { type: 'playTitle', titleId: id };
	if (type === 'showMenu' && id) return { type: 'showMenu', menuId: id };
	return null;
}
