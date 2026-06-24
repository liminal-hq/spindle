// Tests for the MenuItem context-menu component.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MenuItem } from './MenuItem';
import type { MenuItem as MenuItemType } from './types';

describe('MenuItem', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('renders the label and calls onItemClick with id and action when clicked', () => {
		const action = vi.fn();
		const onItemClick = vi.fn();
		const item: MenuItemType = { id: 'item-1', label: 'Do Thing', action };

		render(<MenuItem item={item} onItemClick={onItemClick} />);
		fireEvent.click(screen.getByText('Do Thing'));

		expect(onItemClick).toHaveBeenCalledWith('item-1', action);
	});

	it('does not call onItemClick when the item is disabled', () => {
		const onItemClick = vi.fn();
		const item: MenuItemType = { id: 'item-1', label: 'Do Thing', disabled: true };

		render(<MenuItem item={item} onItemClick={onItemClick} />);
		fireEvent.click(screen.getByText('Do Thing'));

		expect(onItemClick).not.toHaveBeenCalled();
	});

	it('renders the shortcut when provided', () => {
		const item: MenuItemType = { id: 'item-1', label: 'Save', shortcut: 'Ctrl+S' };

		render(<MenuItem item={item} onItemClick={vi.fn()} />);

		expect(screen.getByText('Ctrl+S')).toBeInTheDocument();
	});

	it('renders a checkbox indicator when checked is a boolean', () => {
		const item: MenuItemType = { id: 'item-1', label: 'Toggle', checked: true };

		const { container } = render(<MenuItem item={item} onItemClick={vi.fn()} />);

		expect(container.querySelector('.menu-item-checkbox.checked')).not.toBeNull();
	});

	it('opens the submenu on click instead of firing onItemClick when children exist', () => {
		const onItemClick = vi.fn();
		const item: MenuItemType = {
			id: 'parent',
			label: 'More',
			children: [{ id: 'child-1', label: 'Child' }],
		};

		render(<MenuItem item={item} onItemClick={onItemClick} />);
		fireEvent.click(screen.getByText('More'));

		expect(onItemClick).not.toHaveBeenCalled();
		expect(screen.getByText('Child')).toBeInTheDocument();
	});

	it('applies the danger class for danger items', () => {
		const item: MenuItemType = { id: 'item-1', label: 'Delete', danger: true };

		render(<MenuItem item={item} onItemClick={vi.fn()} />);

		expect(screen.getByText('Delete').closest('button')).toHaveClass('danger');
	});

	it('opens the submenu after a hover delay', () => {
		const item: MenuItemType = {
			id: 'parent',
			label: 'More',
			children: [{ id: 'child-1', label: 'Child' }],
		};

		render(<MenuItem item={item} onItemClick={vi.fn()} />);
		fireEvent.mouseEnter(screen.getByText('More'));

		expect(screen.queryByText('Child')).not.toBeInTheDocument();
		act(() => vi.advanceTimersByTime(250));
		expect(screen.getByText('Child')).toBeInTheDocument();
	});

	it('does not open the submenu if the mouse leaves before the hover delay elapses', () => {
		const item: MenuItemType = {
			id: 'parent',
			label: 'More',
			children: [{ id: 'child-1', label: 'Child' }],
		};

		render(<MenuItem item={item} onItemClick={vi.fn()} />);
		fireEvent.mouseEnter(screen.getByText('More'));
		act(() => vi.advanceTimersByTime(100));
		fireEvent.mouseLeave(screen.getByText('More'));
		act(() => vi.advanceTimersByTime(300));

		expect(screen.queryByText('Child')).not.toBeInTheDocument();
	});

	it('closes an open submenu after a leave delay', () => {
		const item: MenuItemType = {
			id: 'parent',
			label: 'More',
			children: [{ id: 'child-1', label: 'Child' }],
		};

		render(<MenuItem item={item} onItemClick={vi.fn()} />);
		fireEvent.mouseEnter(screen.getByText('More'));
		act(() => vi.advanceTimersByTime(250));
		expect(screen.getByText('Child')).toBeInTheDocument();

		fireEvent.mouseLeave(screen.getByText('More'));
		act(() => vi.advanceTimersByTime(299));
		expect(screen.getByText('Child')).toBeInTheDocument();

		act(() => vi.advanceTimersByTime(1));
		expect(screen.queryByText('Child')).not.toBeInTheDocument();
	});

	it('items without children ignore hover events', () => {
		const item: MenuItemType = { id: 'item-1', label: 'Do Thing' };

		render(<MenuItem item={item} onItemClick={vi.fn()} />);
		fireEvent.mouseEnter(screen.getByText('Do Thing'));
		act(() => vi.advanceTimersByTime(1000));

		expect(screen.queryByText('Child')).not.toBeInTheDocument();
	});
});
