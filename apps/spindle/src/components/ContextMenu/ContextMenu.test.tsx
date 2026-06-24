// Tests for the ContextMenu portal component.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ContextMenu } from './ContextMenu';
import type { MenuModel } from './types';

const model: MenuModel = {
	sections: [{ items: [{ id: 'item-1', label: 'Item 1' }] }],
};

describe('ContextMenu', () => {
	it('renders menu sections into a document.body portal', () => {
		render(
			<ContextMenu
				model={model}
				position={{ x: 0, y: 0 }}
				onClose={vi.fn()}
				onItemClick={vi.fn()}
			/>,
		);

		const menu = document.querySelector('.context-menu');
		expect(menu).not.toBeNull();
		expect(menu?.parentElement).toBe(document.body);
		expect(screen.getByText('Item 1')).toBeInTheDocument();
	});

	it('calls onItemClick and onClose when an item is clicked', () => {
		const onItemClick = vi.fn();
		const onClose = vi.fn();

		render(
			<ContextMenu
				model={model}
				position={{ x: 0, y: 0 }}
				onClose={onClose}
				onItemClick={onItemClick}
			/>,
		);
		fireEvent.click(screen.getByText('Item 1'));

		expect(onItemClick).toHaveBeenCalledWith('item-1', undefined);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('calls onClose when clicking outside the menu', () => {
		const onClose = vi.fn();

		render(
			<ContextMenu
				model={model}
				position={{ x: 0, y: 0 }}
				onClose={onClose}
				onItemClick={vi.fn()}
			/>,
		);
		fireEvent.mouseDown(document.body);

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('does not call onClose when clicking inside the menu', () => {
		const onClose = vi.fn();

		render(
			<ContextMenu
				model={model}
				position={{ x: 0, y: 0 }}
				onClose={onClose}
				onItemClick={vi.fn()}
			/>,
		);
		fireEvent.mouseDown(screen.getByText('Item 1'));

		expect(onClose).not.toHaveBeenCalled();
	});

	it('calls onClose on Escape key', () => {
		const onClose = vi.fn();

		render(
			<ContextMenu
				model={model}
				position={{ x: 0, y: 0 }}
				onClose={onClose}
				onItemClick={vi.fn()}
			/>,
		);
		fireEvent.keyDown(document, { key: 'Escape' });

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('calls onClose on window blur', () => {
		const onClose = vi.fn();

		render(
			<ContextMenu
				model={model}
				position={{ x: 0, y: 0 }}
				onClose={onClose}
				onItemClick={vi.fn()}
			/>,
		);
		fireEvent(window, new Event('blur'));

		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
