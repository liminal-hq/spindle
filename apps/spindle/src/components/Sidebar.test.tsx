// Tests for the Sidebar navigation component.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useProjectStore } from '../store/project-store';
import { createDefaultProject } from '../types/project';
import { Sidebar } from './Sidebar';

const initialState = useProjectStore.getState();

describe('Sidebar', () => {
	afterEach(() => {
		useProjectStore.setState(initialState, true);
	});

	it('renders all nav sections and items', () => {
		useProjectStore.setState({ project: null });

		render(<Sidebar currentRoute="/" onNavigate={vi.fn()} />);

		expect(screen.getByText('Overview')).toBeInTheDocument();
		expect(screen.getByText('Assets')).toBeInTheDocument();
		expect(screen.getByText('Chapters')).toBeInTheDocument();
		expect(screen.getByText('Menus')).toBeInTheDocument();
		expect(screen.getByText('Planner')).toBeInTheDocument();
		expect(screen.getByText('Build')).toBeInTheDocument();
		expect(screen.getByText('Logs')).toBeInTheDocument();
		expect(screen.getByText('Settings')).toBeInTheDocument();
	});

	it('marks the current route item as active', () => {
		useProjectStore.setState({ project: null });

		render(<Sidebar currentRoute="/assets" onNavigate={vi.fn()} />);

		expect(screen.getByText('Assets').closest('button')).toHaveClass('sidebar__item--active');
		expect(screen.getByText('Overview').closest('button')).not.toHaveClass('sidebar__item--active');
	});

	it('greys out items that require a project when none is open', () => {
		useProjectStore.setState({ project: null });

		render(<Sidebar currentRoute="/" onNavigate={vi.fn()} />);

		expect(screen.getByText('Chapters').closest('button')).toHaveClass('sidebar__item--inactive');
		expect(screen.getByText('Overview').closest('button')).not.toHaveClass(
			'sidebar__item--inactive',
		);
	});

	it('does not grey out project-requiring items when a project is open', () => {
		useProjectStore.setState({ project: createDefaultProject() });

		render(<Sidebar currentRoute="/" onNavigate={vi.fn()} />);

		expect(screen.getByText('Chapters').closest('button')).not.toHaveClass(
			'sidebar__item--inactive',
		);
	});

	it('calls onNavigate with the route id when a nav item is clicked', () => {
		useProjectStore.setState({ project: null });
		const onNavigate = vi.fn();

		render(<Sidebar currentRoute="/" onNavigate={onNavigate} />);
		fireEvent.click(screen.getByText('Settings'));

		expect(onNavigate).toHaveBeenCalledWith('/settings');
	});

	it('shows a title count badge when titles exist', () => {
		const project = createDefaultProject();
		project.disc.titlesets[0].titles = [{ id: 't1' } as any];
		useProjectStore.setState({ project });

		render(<Sidebar currentRoute="/" onNavigate={vi.fn()} />);

		expect(screen.getByText('Titles').parentElement?.textContent).toContain('1');
	});

	it('shows no Build Disc button when no project is open', () => {
		useProjectStore.setState({ project: null });

		render(<Sidebar currentRoute="/" onNavigate={vi.fn()} />);

		expect(screen.queryByText('Build Disc')).not.toBeInTheDocument();
	});

	it('shows the Build Disc button and navigates to /build when a project is open', () => {
		useProjectStore.setState({ project: createDefaultProject() });
		const onNavigate = vi.fn();

		render(<Sidebar currentRoute="/" onNavigate={onNavigate} />);
		fireEvent.click(screen.getByText('Build Disc'));

		expect(onNavigate).toHaveBeenCalledWith('/build');
	});
});
