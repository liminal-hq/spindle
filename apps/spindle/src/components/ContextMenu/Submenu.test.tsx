// Tests for the Submenu portal renderer.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Submenu } from './Submenu';
import type { MenuItem as MenuItemType } from './types';

const items: MenuItemType[] = [{ id: 'child-1', label: 'Child 1' }];

const parentRect = { top: 10, left: 10, right: 20, bottom: 20, width: 10, height: 10 } as DOMRect;

describe('Submenu', () => {
	it('renders items into a document.body portal', () => {
		render(
			<Submenu items={items} parentRect={parentRect} onItemClick={vi.fn()} onClose={vi.fn()} />,
		);

		const submenu = document.querySelector('.submenu');
		expect(submenu).not.toBeNull();
		expect(submenu?.parentElement).toBe(document.body);
		expect(screen.getByText('Child 1')).toBeInTheDocument();
	});

	it('calls onItemClick when a child item is clicked', () => {
		const onItemClick = vi.fn();

		render(
			<Submenu items={items} parentRect={parentRect} onItemClick={onItemClick} onClose={vi.fn()} />,
		);
		fireEvent.click(screen.getByText('Child 1'));

		expect(onItemClick).toHaveBeenCalledWith('child-1', undefined);
	});

	it('forwards onMouseEnter and onMouseLeave to the submenu container', () => {
		const onMouseEnter = vi.fn();
		const onMouseLeave = vi.fn();

		render(
			<Submenu
				items={items}
				parentRect={parentRect}
				onItemClick={vi.fn()}
				onClose={vi.fn()}
				onMouseEnter={onMouseEnter}
				onMouseLeave={onMouseLeave}
			/>,
		);
		const submenu = document.querySelector('.submenu') as HTMLElement;
		fireEvent.mouseEnter(submenu);
		fireEvent.mouseLeave(submenu);

		expect(onMouseEnter).toHaveBeenCalledTimes(1);
		expect(onMouseLeave).toHaveBeenCalledTimes(1);
	});

	it('stops propagation of mousedown so the parent menu does not treat it as outside-click', () => {
		const submenuMouseDown = vi.fn();
		const documentMouseDown = vi.fn();
		document.addEventListener('mousedown', documentMouseDown);

		render(
			<Submenu items={items} parentRect={parentRect} onItemClick={vi.fn()} onClose={vi.fn()} />,
		);
		const submenu = document.querySelector('.submenu') as HTMLElement;
		submenu.addEventListener('mousedown', submenuMouseDown);
		fireEvent.mouseDown(submenu);

		expect(submenuMouseDown).toHaveBeenCalledTimes(1);
		expect(documentMouseDown).not.toHaveBeenCalled();

		document.removeEventListener('mousedown', documentMouseDown);
	});
});
