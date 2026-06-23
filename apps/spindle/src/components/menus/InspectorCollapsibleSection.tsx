// Reusable collapsible wrapper with a chevron toggle, used throughout the inspector.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState } from 'react';

export function CollapsibleSection({
	title,
	defaultOpen = true,
	children,
}: {
	title: string;
	defaultOpen?: boolean;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<div
			className={`inspector-panel__section inspector-panel__collapsible ${open ? 'inspector-panel__collapsible--open' : ''}`}
		>
			<div
				className="inspector-panel__collapsible-header"
				onClick={() => setOpen(!open)}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)}
			>
				<svg
					className="inspector-panel__collapsible-chevron"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
				>
					<polyline points="6 9 12 15 18 9" />
				</svg>
				<span className="inspector-panel__section-heading" style={{ margin: 0 }}>
					{title}
				</span>
			</div>
			{open && <div className="inspector-panel__collapsible-body">{children}</div>}
		</div>
	);
}
