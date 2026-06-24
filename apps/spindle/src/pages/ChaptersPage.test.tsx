// Tests for the Chapters page.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useProjectStore } from '../store/project-store';
import { createDefaultProject } from '../types/project';
import type { Title } from 'tauri-plugin-spindle-project-api';
import { ChaptersPage } from './ChaptersPage';

function buildTitle(overrides: Partial<Title> = {}): Title {
	return {
		id: 'title-1',
		name: 'Feature',
		sourceAssetId: null,
		videoMapping: null,
		videoOutputProfile: null,
		audioMappings: [],
		subtitleMappings: [],
		chapters: [],
		endAction: null,
		orderIndex: 0,
		bitrateWeight: 1,
		bitrateFloorBps: null,
		bitrateCeilingBps: null,
		pinnedBitrateBps: null,
		...overrides,
	};
}

const initialState = useProjectStore.getState();

describe('ChaptersPage', () => {
	beforeEach(() => {
		window.confirm = vi.fn().mockReturnValue(true);
	});

	afterEach(() => {
		useProjectStore.setState(initialState, true);
		vi.restoreAllMocks();
	});

	it('shows the no-project state when no project is open', () => {
		useProjectStore.setState({ project: null });

		render(<ChaptersPage />);

		expect(screen.getByText('No Project Open')).toBeInTheDocument();
	});

	it('shows "No titles available" when the project has no titles', () => {
		useProjectStore.setState({ project: createDefaultProject() });

		render(<ChaptersPage />);

		expect(screen.getByText('No titles available')).toBeInTheDocument();
	});

	it('lists titles with chapter-count badges', () => {
		const project = createDefaultProject();
		project.disc.titlesets[0].titles = [
			buildTitle({ id: 't1', name: 'Feature', chapters: [{ id: 'c1' } as any] }),
		];
		useProjectStore.setState({ project });

		render(<ChaptersPage />);

		expect(screen.getByText('Feature')).toBeInTheDocument();
		expect(screen.getByText('1 ch')).toBeInTheDocument();
	});

	it('prompts to select a title before showing the editor', () => {
		const project = createDefaultProject();
		project.disc.titlesets[0].titles = [buildTitle()];
		useProjectStore.setState({ project });

		render(<ChaptersPage />);

		expect(screen.getByText('Select a title to manage its chapters.')).toBeInTheDocument();
	});

	it('shows "Add First Chapter" when a title with no chapters is selected', () => {
		const project = createDefaultProject();
		project.disc.titlesets[0].titles = [buildTitle()];
		useProjectStore.setState({ project });

		render(<ChaptersPage />);
		fireEvent.click(screen.getByText('Feature'));

		expect(screen.getByText('No chapters for "Feature" yet.')).toBeInTheDocument();
		expect(screen.getByText('Add First Chapter')).toBeInTheDocument();
	});

	it('adds a chapter when "Add Chapter" is clicked', () => {
		const project = createDefaultProject();
		project.disc.titlesets[0].titles = [buildTitle()];
		useProjectStore.setState({ project });

		render(<ChaptersPage />);
		fireEvent.click(screen.getByText('Feature'));
		fireEvent.click(screen.getByText('Add First Chapter'));

		const updatedTitle = useProjectStore.getState().project!.disc.titlesets[0].titles[0];
		expect(updatedTitle.chapters).toHaveLength(1);
		expect(updatedTitle.chapters[0].name).toBe('Chapter 1');
		expect(updatedTitle.chapters[0].timestampSecs).toBe(0);
	});

	it('appends a new chapter 60 seconds after the last one via the header Add Chapter button', () => {
		const project = createDefaultProject();
		project.disc.titlesets[0].titles = [
			buildTitle({
				chapters: [{ id: 'c1', name: 'Chapter 1', timestampSecs: 120, orderIndex: 0 }],
			}),
		];
		useProjectStore.setState({ project });

		render(<ChaptersPage />);
		fireEvent.click(screen.getByText('Feature'));
		fireEvent.click(screen.getByText('Add Chapter'));

		const updatedTitle = useProjectStore.getState().project!.disc.titlesets[0].titles[0];
		expect(updatedTitle.chapters).toHaveLength(2);
		expect(updatedTitle.chapters[1].timestampSecs).toBe(180);
	});

	it('renders existing chapters with name and formatted timestamp inputs', () => {
		const project = createDefaultProject();
		project.disc.titlesets[0].titles = [
			buildTitle({
				chapters: [{ id: 'c1', name: 'Intro', timestampSecs: 65, orderIndex: 0 }],
			}),
		];
		useProjectStore.setState({ project });

		render(<ChaptersPage />);
		fireEvent.click(screen.getByText('Feature'));

		expect(screen.getByDisplayValue('Intro')).toBeInTheDocument();
		expect(screen.getByDisplayValue('0:01:05')).toBeInTheDocument();
	});

	it('renames a chapter when its name input changes', () => {
		const project = createDefaultProject();
		project.disc.titlesets[0].titles = [
			buildTitle({
				chapters: [{ id: 'c1', name: 'Intro', timestampSecs: 0, orderIndex: 0 }],
			}),
		];
		useProjectStore.setState({ project });

		render(<ChaptersPage />);
		fireEvent.click(screen.getByText('Feature'));
		fireEvent.change(screen.getByDisplayValue('Intro'), { target: { value: 'Opening' } });

		const updatedTitle = useProjectStore.getState().project!.disc.titlesets[0].titles[0];
		expect(updatedTitle.chapters[0].name).toBe('Opening');
	});

	it('re-sorts chapters by timestamp when a chapter time is edited', () => {
		const project = createDefaultProject();
		project.disc.titlesets[0].titles = [
			buildTitle({
				chapters: [
					{ id: 'c1', name: 'First', timestampSecs: 0, orderIndex: 0 },
					{ id: 'c2', name: 'Second', timestampSecs: 60, orderIndex: 1 },
				],
			}),
		];
		useProjectStore.setState({ project });

		render(<ChaptersPage />);
		fireEvent.click(screen.getByText('Feature'));
		fireEvent.change(screen.getByDisplayValue('0:00:00'), { target: { value: '0:02:00' } });

		const updatedTitle = useProjectStore.getState().project!.disc.titlesets[0].titles[0];
		expect(updatedTitle.chapters.map((c: any) => c.name)).toEqual(['Second', 'First']);
		expect(updatedTitle.chapters[1].orderIndex).toBe(1);
	});

	it('ignores an unparseable timestamp edit', () => {
		const project = createDefaultProject();
		project.disc.titlesets[0].titles = [
			buildTitle({
				chapters: [{ id: 'c1', name: 'Intro', timestampSecs: 30, orderIndex: 0 }],
			}),
		];
		useProjectStore.setState({ project });

		render(<ChaptersPage />);
		fireEvent.click(screen.getByText('Feature'));
		fireEvent.change(screen.getByDisplayValue('0:00:30'), { target: { value: 'garbage' } });

		const updatedTitle = useProjectStore.getState().project!.disc.titlesets[0].titles[0];
		expect(updatedTitle.chapters[0].timestampSecs).toBe(30);
	});

	it('removes a chapter and re-indexes the rest', () => {
		const project = createDefaultProject();
		project.disc.titlesets[0].titles = [
			buildTitle({
				chapters: [
					{ id: 'c1', name: 'First', timestampSecs: 0, orderIndex: 0 },
					{ id: 'c2', name: 'Second', timestampSecs: 60, orderIndex: 1 },
				],
			}),
		];
		useProjectStore.setState({ project });

		render(<ChaptersPage />);
		fireEvent.click(screen.getByText('Feature'));
		fireEvent.click(screen.getAllByTitle('Remove chapter')[0]);

		const updatedTitle = useProjectStore.getState().project!.disc.titlesets[0].titles[0];
		expect(updatedTitle.chapters).toHaveLength(1);
		expect(updatedTitle.chapters[0].name).toBe('Second');
		expect(updatedTitle.chapters[0].orderIndex).toBe(0);
	});

	it('does not show "Seed from Source" when the asset has no source chapters', () => {
		const project = createDefaultProject();
		project.assets = [{ id: 'asset-1', sourceChapters: [] } as any];
		project.disc.titlesets[0].titles = [buildTitle({ sourceAssetId: 'asset-1' })];
		useProjectStore.setState({ project });

		render(<ChaptersPage />);
		fireEvent.click(screen.getByText('Feature'));

		expect(screen.queryByText('Seed from Source')).not.toBeInTheDocument();
	});

	it('seeds chapters from the source asset when "Seed from Source" is clicked', () => {
		const project = createDefaultProject();
		project.assets = [
			{
				id: 'asset-1',
				sourceChapters: [
					{ startSecs: 0, endSecs: 60, title: 'Opening' },
					{ startSecs: 60, endSecs: 120, title: null },
				],
			} as any,
		];
		project.disc.titlesets[0].titles = [buildTitle({ sourceAssetId: 'asset-1' })];
		useProjectStore.setState({ project });

		render(<ChaptersPage />);
		fireEvent.click(screen.getByText('Feature'));
		fireEvent.click(screen.getByText('Seed from Source'));

		const updatedTitle = useProjectStore.getState().project!.disc.titlesets[0].titles[0];
		expect(updatedTitle.chapters).toHaveLength(2);
		expect(updatedTitle.chapters[0].name).toBe('Opening');
		expect(updatedTitle.chapters[1].name).toBe('Chapter 2');
	});

	it('asks for confirmation before replacing existing chapters via seed-from-source', () => {
		window.confirm = vi.fn().mockReturnValue(false);
		const project = createDefaultProject();
		project.assets = [
			{ id: 'asset-1', sourceChapters: [{ startSecs: 0, endSecs: 60, title: 'Opening' }] } as any,
		];
		project.disc.titlesets[0].titles = [
			buildTitle({
				sourceAssetId: 'asset-1',
				chapters: [{ id: 'c1', name: 'Existing', timestampSecs: 0, orderIndex: 0 }],
			}),
		];
		useProjectStore.setState({ project });

		render(<ChaptersPage />);
		fireEvent.click(screen.getByText('Feature'));
		fireEvent.click(screen.getByText('Seed from Source'));

		const updatedTitle = useProjectStore.getState().project!.disc.titlesets[0].titles[0];
		expect(updatedTitle.chapters).toHaveLength(1);
		expect(updatedTitle.chapters[0].name).toBe('Existing');
	});

	it('renders a chapter timeline mark when the source asset has a known duration', () => {
		const project = createDefaultProject();
		project.assets = [{ id: 'asset-1', durationSecs: 600 } as any];
		project.disc.titlesets[0].titles = [
			buildTitle({
				sourceAssetId: 'asset-1',
				chapters: [{ id: 'c1', name: 'Mid', timestampSecs: 300, orderIndex: 0 }],
			}),
		];
		useProjectStore.setState({ project });

		const { container } = render(<ChaptersPage />);
		fireEvent.click(screen.getByText('Feature'));

		expect(container.querySelector('.chapters__timeline-mark')).not.toBeNull();
	});
});
