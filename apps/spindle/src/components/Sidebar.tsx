// Sidebar navigation with section grouping and active state tracking.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useProjectStore } from '../store/project-store';
import './Sidebar.css';

interface NavItem {
	id: string;
	label: string;
	icon: React.ReactNode;
	badge?: number;
}

interface NavSection {
	label: string;
	items: NavItem[];
}

interface SidebarProps {
	currentRoute: string;
	onNavigate: (route: string) => void;
}

const ICONS = {
	overview: (
		<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
			<rect x="2" y="2" width="12" height="12" rx="2" />
			<line x1="2" y1="6" x2="14" y2="6" />
			<line x1="6" y1="6" x2="6" y2="14" />
		</svg>
	),
	assets: (
		<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
			<rect x="2" y="3" width="12" height="10" rx="1.5" />
			<path d="M5 3V2M11 3V2" />
		</svg>
	),
	titles: (
		<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
			<rect x="2" y="2" width="12" height="12" rx="1" />
			<line x1="5" y1="6" x2="11" y2="6" />
			<line x1="5" y1="10" x2="9" y2="10" />
		</svg>
	),
	chapters: (
		<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
			<circle cx="8" cy="8" r="5.5" />
			<path d="M8 4v4l3 2" />
		</svg>
	),
	menus: (
		<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
			<rect x="2" y="2" width="12" height="12" rx="2" />
			<rect x="4" y="9" width="3" height="2" rx="0.5" />
			<rect x="9" y="9" width="3" height="2" rx="0.5" />
		</svg>
	),
	planner: (
		<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
			<circle cx="8" cy="8" r="6" />
			<circle cx="8" cy="8" r="2" />
		</svg>
	),
	build: (
		<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
			<path d="M4 14V8l4-6 4 6v6" />
			<line x1="4" y1="10" x2="12" y2="10" />
		</svg>
	),
	logs: (
		<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
			<path d="M2 12h12M2 8h8M2 4h5" />
		</svg>
	),
	settings: (
		<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
			<circle cx="8" cy="8" r="3" />
			<path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
		</svg>
	),
};

export function Sidebar({ currentRoute, onNavigate }: SidebarProps) {
	const project = useProjectStore((s) => s.project);

	const titleCount = project?.disc.titlesets.reduce((sum, ts) => sum + ts.titles.length, 0) ?? 0;
	const assetCount = project?.assets.length ?? 0;

	const sections: NavSection[] = [
		{
			label: 'Project',
			items: [
				{ id: '/', label: 'Overview', icon: ICONS.overview },
				{ id: '/assets', label: 'Assets', icon: ICONS.assets, badge: assetCount || undefined },
			],
		},
		{
			label: 'Authoring',
			items: [
				{ id: '/titles', label: 'Titles', icon: ICONS.titles, badge: titleCount || undefined },
				{ id: '/chapters', label: 'Chapters', icon: ICONS.chapters },
				{ id: '/menus', label: 'Menus', icon: ICONS.menus },
			],
		},
		{
			label: 'Output',
			items: [
				{ id: '/planner', label: 'Planner', icon: ICONS.planner },
				{ id: '/build', label: 'Build', icon: ICONS.build },
				{ id: '/logs', label: 'Logs', icon: ICONS.logs },
			],
		},
	];

	return (
		<nav className="sidebar">
			{sections.map((section) => (
				<div className="sidebar__section" key={section.label}>
					<div className="sidebar__label">{section.label}</div>
					{section.items.map((item) => (
						<button
							key={item.id}
							className={`sidebar__item ${currentRoute === item.id ? 'sidebar__item--active' : ''}`}
							onClick={() => onNavigate(item.id)}
						>
							<span className="sidebar__item__icon">{item.icon}</span>
							{item.label}
							{item.badge !== undefined && (
								<span className="sidebar__item__badge">{item.badge}</span>
							)}
						</button>
					))}
				</div>
			))}

			<div style={{ flex: 1 }} />
			<div className="sidebar__divider" />

			{project && (
				<button className="sidebar__build-btn" onClick={() => onNavigate('/build')}>
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
					>
						<polygon points="4,2 14,8 4,14" />
					</svg>
					Build Disc
				</button>
			)}

			<div className="sidebar__section" style={{ paddingBottom: 'var(--space-1)' }}>
				<button
					className={`sidebar__item ${currentRoute === '/settings' ? 'sidebar__item--active' : ''}`}
					onClick={() => onNavigate('/settings')}
				>
					<span className="sidebar__item__icon">{ICONS.settings}</span>
					Settings
				</button>
			</div>
		</nav>
	);
}
