// Tests for the MenuSection context-menu renderer.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MenuSection } from './MenuSection';
import type { MenuSection as MenuSectionType } from './types';

describe('MenuSection', () => {
	it('renders the section title when provided', () => {
		const section: MenuSectionType = {
			title: 'Window',
			items: [{ id: 'item-1', label: 'Item 1' }],
		};

		render(<MenuSection section={section} onItemClick={vi.fn()} />);

		expect(screen.getByText('Window')).toBeInTheDocument();
	});

	it('renders no title element when title is omitted', () => {
		const section: MenuSectionType = { items: [{ id: 'item-1', label: 'Item 1' }] };

		const { container } = render(<MenuSection section={section} onItemClick={vi.fn()} />);

		expect(container.querySelector('.menu-section-title')).toBeNull();
	});

	it('renders all menu items', () => {
		const section: MenuSectionType = {
			items: [
				{ id: 'item-1', label: 'Item 1' },
				{ id: 'item-2', label: 'Item 2' },
			],
		};

		render(<MenuSection section={section} onItemClick={vi.fn()} />);

		expect(screen.getByText('Item 1')).toBeInTheDocument();
		expect(screen.getByText('Item 2')).toBeInTheDocument();
	});

	it('renders a separator for separator entries', () => {
		const section: MenuSectionType = {
			items: [{ id: 'item-1', label: 'Item 1' }, { type: 'separator' }],
		};

		const { container } = render(<MenuSection section={section} onItemClick={vi.fn()} />);

		expect(container.querySelector('.menu-separator')).not.toBeNull();
	});
});
