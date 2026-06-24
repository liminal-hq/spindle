// Tests for the NoProjectState shared empty-state component.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useProjectStore } from '../store/project-store';
import { NoProjectState } from './NoProjectState';

const initialState = useProjectStore.getState();

describe('NoProjectState', () => {
	afterEach(() => {
		useProjectStore.setState(initialState, true);
	});

	it('renders the title, description, and icon', () => {
		render(
			<NoProjectState
				title="No Assets"
				description="Open a project to manage assets."
				icon={<svg data-testid="icon" />}
			/>,
		);

		expect(screen.getByText('No Assets')).toBeInTheDocument();
		expect(screen.getByText('Open a project to manage assets.')).toBeInTheDocument();
		expect(screen.getByTestId('icon')).toBeInTheDocument();
	});

	it('calls createProject with default values when "New Project" is clicked', () => {
		const createProject = vi.fn().mockResolvedValue(undefined);
		useProjectStore.setState({ createProject });

		render(<NoProjectState title="t" description="d" icon={null} />);
		fireEvent.click(screen.getByText('New Project'));

		expect(createProject).toHaveBeenCalledWith({
			name: 'Untitled Project',
			standard: 'NTSC',
			capacityTarget: 'DVD5',
		});
	});

	it('calls openProject when "Open Project" is clicked', () => {
		const openProject = vi.fn().mockResolvedValue(undefined);
		useProjectStore.setState({ openProject });

		render(<NoProjectState title="t" description="d" icon={null} />);
		fireEvent.click(screen.getByText('Open Project'));

		expect(openProject).toHaveBeenCalledTimes(1);
	});
});
