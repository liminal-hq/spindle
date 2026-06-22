// Renders the Spindle desktop workspace shell.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onBuildProgress } from 'tauri-plugin-spindle-project-api';
import { useProjectStore } from './store/project-store';
import { useAppSettingsStore } from './store/app-settings-store';
import { Topbar } from './components/Topbar';
import { Sidebar } from './components/Sidebar';
import { Statusbar } from './components/Statusbar';
import { OverviewPage } from './pages/OverviewPage';
import { AssetsPage } from './pages/AssetsPage';
import { TitlesPage } from './pages/TitlesPage';
import { ChaptersPage } from './pages/ChaptersPage';
import { PlannerPage } from './pages/PlannerPage';
import { BuildPage } from './pages/BuildPage';
import { MenusPage } from './pages/MenusPage';
import { LogsPage } from './pages/LogsPage';
import { SettingsPage } from './pages/SettingsPage';
import './design-system.css';
import './App.css';

/** Navigation context for cross-page entity selection from validation issues. */
export interface NavigationTarget {
	route: string;
	entityId?: string;
}

const NavigationContext = createContext<{
	navigateTo: (target: NavigationTarget) => void;
	consumePendingEntityId: () => string | null;
}>({
	navigateTo: () => {},
	consumePendingEntityId: () => null,
});

export function useNavigation() {
	return useContext(NavigationContext);
}

const ROUTES: Record<string, () => React.ReactNode> = {
	'/': () => <OverviewPage />,
	'/assets': () => <AssetsPage />,
	'/titles': () => <TitlesPage />,
	'/chapters': () => <ChaptersPage />,
	'/menus': () => <MenusPage />,
	'/planner': () => <PlannerPage />,
	'/build': () => <BuildPage />,
	'/logs': () => <LogsPage />,
	'/settings': () => <SettingsPage />,
};

function App() {
	const [currentRoute, setCurrentRoute] = useState('/');
	const [pendingEntityId, setPendingEntityId] = useState<string | null>(null);
	const saveProject = useProjectStore((s) => s.saveProject);
	const loadSettings = useAppSettingsStore((s) => s.loadSettings);

	useEffect(() => {
		loadSettings();
	}, [loadSettings]);

	const handleNavigate = useCallback((route: string) => {
		setCurrentRoute(route);
	}, []);

	const navigateTo = useCallback((target: NavigationTarget) => {
		setPendingEntityId(target.entityId ?? null);
		setCurrentRoute(target.route);
	}, []);

	const consumePendingEntityId = useCallback(() => {
		const id = pendingEntityId;
		setPendingEntityId(null);
		return id;
	}, [pendingEntityId]);

	// Keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 's') {
				e.preventDefault();
				saveProject();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [saveProject]);

	// Build progress event listener
	useEffect(() => {
		const unlisten = onBuildProgress((progress) => {
			useProjectStore.setState({
				buildProgress: progress,
				buildLog:
					progress.output != null
						? [...useProjectStore.getState().buildLog, progress.output]
						: useProjectStore.getState().buildLog,
			});
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	const PageComponent = ROUTES[currentRoute] ?? ROUTES['/'];

	return (
		<NavigationContext.Provider value={{ navigateTo, consumePendingEntityId }}>
			<div className="app-shell">
				<Topbar />
				<Sidebar currentRoute={currentRoute} onNavigate={handleNavigate} />
				<main className="main-content">{PageComponent!()}</main>
				<Statusbar />
			</div>
		</NavigationContext.Provider>
	);
}

export default App;
