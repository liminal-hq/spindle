// Context menu section renderer, adapted from liminal-notes.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import type { MenuSection as MenuSectionType } from './types';
import { MenuItem } from './MenuItem';

interface MenuSectionProps {
	section: MenuSectionType;
	onItemClick: (itemId: string, action?: () => void) => void;
}

export function MenuSection({ section, onItemClick }: MenuSectionProps) {
	return (
		<div className="menu-section">
			{section.title && <div className="menu-section-title">{section.title}</div>}
			{section.items.map((item, idx) => {
				if ('type' in item && item.type === 'separator') {
					return <div key={idx} className="menu-separator" />;
				}
				const menuItem = item as import('./types').MenuItem;
				return <MenuItem key={menuItem.id} item={menuItem} onItemClick={onItemClick} />;
			})}
		</div>
	);
}
