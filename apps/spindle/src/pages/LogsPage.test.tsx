// Tests for the Logs & Diagnostics page.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useProjectStore } from '../store/project-store';
import {
	createDefaultProject,
	createDefaultMenuCompilePolicy,
	DEFAULT_HIGHLIGHT_COLOURS,
} from '../types/project';
import { LogsPage } from './LogsPage';

const initialState = useProjectStore.getState();

describe('LogsPage', () => {
	afterEach(() => {
		useProjectStore.setState(initialState, true);
	});

	it('shows the no-project state when no project is open', () => {
		useProjectStore.setState({ project: null });

		render(<LogsPage />);

		expect(screen.getByText('No Project Open')).toBeInTheDocument();
	});

	it('renders the project report with title/chapter/menu/button counts', () => {
		const project = createDefaultProject('My Disc');
		project.disc.globalMenus = [
			{
				id: 'menu-1',
				name: 'Menu',
				authoredDocument: {
					id: 'menu-1',
					name: 'Menu',
					domain: 'vmgm',
					scene: {
						designSize: { width: 720, height: 480, aspect: 'four-by-three' },
						background: { assetId: null, colour: null },
						nodes: [
							{ type: 'button', id: 'btn-1', label: 'Btn 1', x: 0, y: 0, width: 100, height: 40 },
							{ type: 'button', id: 'btn-2', label: 'Btn 2', x: 0, y: 60, width: 100, height: 40 },
						],
						guides: [],
					},
					interaction: { defaultFocusId: null, nodes: [], timeoutAction: null },
					timing: {
						introStartSecs: 0,
						introDurationSecs: 0,
						loopStartSecs: 0,
						loopDurationSecs: 0,
						loopCount: 0,
						audioAssetId: null,
					},
					highlightColours: DEFAULT_HIGHLIGHT_COLOURS,
					backgroundMode: 'still',
					themeRef: null,
					generationMeta: null,
					compilePolicy: createDefaultMenuCompilePolicy('four-by-three'),
				},
			},
		];

		useProjectStore.setState({ project, validationIssues: [] });

		render(<LogsPage />);

		expect(screen.getByText('My Disc')).toBeInTheDocument();
		expect(screen.getByText(/DVD-Video/)).toBeInTheDocument();
		expect(screen.getByText('Buttons').nextElementSibling).toHaveTextContent('2');
	});

	it('shows "No validation issues" when there are none', () => {
		useProjectStore.setState({ project: createDefaultProject(), validationIssues: [] });

		render(<LogsPage />);

		expect(
			screen.getByText('No validation issues. Run validation to check for problems.'),
		).toBeInTheDocument();
		expect(screen.getByText('0 issues')).toBeInTheDocument();
	});

	it('renders validation issues with severity, code, and message', () => {
		useProjectStore.setState({
			project: createDefaultProject(),
			validationIssues: [
				{ severity: 'error', code: 'E001', message: 'Bad reference' } as any,
				{ severity: 'warning', code: 'W001', message: 'Maybe fine' } as any,
			],
		});

		render(<LogsPage />);

		expect(screen.getByText('2 issues')).toBeInTheDocument();
		expect(screen.getByText('E001')).toBeInTheDocument();
		expect(screen.getByText('Bad reference')).toBeInTheDocument();
		expect(screen.getByText('W001')).toBeInTheDocument();
		expect(screen.getByText('Maybe fine')).toBeInTheDocument();
	});

	it('calls validateProject when "Run Validation" is clicked', () => {
		const validateProject = vi.fn();
		useProjectStore.setState({ project: createDefaultProject(), validateProject });

		render(<LogsPage />);
		fireEvent.click(screen.getByText('Run Validation'));

		expect(validateProject).toHaveBeenCalledTimes(1);
	});

	it('shows asset diagnostics only when assets exist', () => {
		const project = createDefaultProject();
		useProjectStore.setState({ project, validationIssues: [] });

		const { rerender } = render(<LogsPage />);
		expect(screen.queryByText('Asset Diagnostics')).not.toBeInTheDocument();

		project.assets = [
			{
				id: 'asset-1',
				fileName: 'movie.mkv',
				containerFormat: 'matroska',
				videoStreams: [],
				audioStreams: [],
				subtitleStreams: [],
				compatibility: 'remux-compatible',
			} as any,
		];
		useProjectStore.setState({ project: { ...project } });
		rerender(<LogsPage />);

		expect(screen.getByText('Asset Diagnostics')).toBeInTheDocument();
		expect(screen.getByText('movie.mkv')).toBeInTheDocument();
		expect(screen.getByText('remux-compatible')).toBeInTheDocument();
	});
});
