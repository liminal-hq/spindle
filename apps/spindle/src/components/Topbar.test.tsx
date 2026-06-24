// Tests for the Topbar component.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useProjectStore } from '../store/project-store';
import { createDefaultProject } from '../types/project';
import { Topbar } from './Topbar';

const {
	mockMinimize,
	mockToggleMaximize,
	mockClose,
	mockIsMaximized,
	mockStartDragging,
	mockListen,
} = vi.hoisted(() => ({
	mockMinimize: vi.fn(),
	mockToggleMaximize: vi.fn(),
	mockClose: vi.fn(),
	mockIsMaximized: vi.fn().mockResolvedValue(false),
	mockStartDragging: vi.fn(),
	mockListen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: () => ({
		minimize: mockMinimize,
		toggleMaximize: mockToggleMaximize,
		close: mockClose,
		isMaximized: mockIsMaximized,
		startDragging: mockStartDragging,
		listen: mockListen,
	}),
}));

const { mockPlatform } = vi.hoisted(() => ({ mockPlatform: vi.fn().mockReturnValue('linux') }));

vi.mock('@tauri-apps/plugin-os', () => ({
	platform: mockPlatform,
}));

const initialState = useProjectStore.getState();

describe('Topbar', () => {
	beforeEach(() => {
		mockIsMaximized.mockResolvedValue(false);
		mockPlatform.mockReturnValue('linux');
	});

	afterEach(() => {
		useProjectStore.setState(initialState, true);
		vi.clearAllMocks();
	});

	it('does not render the project selector or save button when no project is open', async () => {
		useProjectStore.setState({ project: null });

		render(<Topbar />);

		await waitFor(() => {
			expect(mockIsMaximized).toHaveBeenCalled();
		});
		expect(document.querySelector('.project-selector')).toBeNull();
		expect(screen.queryByTitle('Save (Ctrl+S)')).not.toBeInTheDocument();
	});

	it('shows the project name and a dirty marker when a project is open and dirty', async () => {
		useProjectStore.setState({ project: createDefaultProject('My Disc'), isDirty: true });

		render(<Topbar />);

		await waitFor(() => {
			expect(screen.getByText('My Disc *')).toBeInTheDocument();
		});
	});

	it('does not show a dirty marker when the project is clean', async () => {
		useProjectStore.setState({ project: createDefaultProject('My Disc'), isDirty: false });

		render(<Topbar />);

		await waitFor(() => {
			expect(screen.getByText('My Disc')).toBeInTheDocument();
		});
	});

	it('calls saveProject when the save button is clicked', async () => {
		const saveProject = vi.fn().mockResolvedValue(undefined);
		useProjectStore.setState({ project: createDefaultProject('My Disc'), saveProject });

		render(<Topbar />);
		await waitFor(() => screen.getByTitle('Save (Ctrl+S)'));
		fireEvent.click(screen.getByTitle('Save (Ctrl+S)'));

		expect(saveProject).toHaveBeenCalledTimes(1);
	});

	it('renders Linux window controls with minimize/maximize/close handlers', async () => {
		mockPlatform.mockReturnValue('linux');
		useProjectStore.setState({ project: null });

		render(<Topbar />);
		await waitFor(() => expect(document.querySelector('.window-controls.linux')).not.toBeNull());

		fireEvent.click(document.querySelector('.linux-minimize')!);
		expect(mockMinimize).toHaveBeenCalledTimes(1);

		fireEvent.click(document.querySelector('.linux-close')!);
		expect(mockClose).toHaveBeenCalledTimes(1);
	});

	it('renders Mac window controls when platform is macos', async () => {
		mockPlatform.mockReturnValue('macos');
		useProjectStore.setState({ project: null });

		render(<Topbar />);

		await waitFor(() => expect(document.querySelector('.window-controls.mac')).not.toBeNull());
	});

	it('renders Windows window controls when platform is windows', async () => {
		mockPlatform.mockReturnValue('windows');
		useProjectStore.setState({ project: null });

		render(<Topbar />);

		await waitFor(() => expect(document.querySelector('.window-controls.win')).not.toBeNull());
	});

	it('opens a context menu on right-click and toggles maximise via the menu item', async () => {
		useProjectStore.setState({ project: null });

		render(<Topbar />);
		await waitFor(() => expect(mockIsMaximized).toHaveBeenCalled());

		fireEvent.contextMenu(document.querySelector('.topbar')!);

		await waitFor(() => {
			expect(screen.getByText('Maximise')).toBeInTheDocument();
		});

		fireEvent.click(screen.getByText('Maximise'));
		expect(mockToggleMaximize).toHaveBeenCalledTimes(1);
	});
});
