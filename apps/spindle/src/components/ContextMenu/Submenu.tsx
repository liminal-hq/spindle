// Submenu portal renderer, adapted from liminal-notes.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MenuItem as MenuItemType } from "./types";
import { MenuItem } from "./MenuItem";

interface SubmenuProps {
  items: MenuItemType[];
  parentRect: DOMRect;
  onItemClick: (itemId: string, action?: () => void) => void;
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const SCROLLBAR_GUTTER_PX = 18;

export function Submenu({
  items,
  parentRect,
  onItemClick,
  onClose: _onClose,
  onMouseEnter,
  onMouseLeave,
}: SubmenuProps) {
  const submenuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!submenuRef.current) return;

    const menu = submenuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    let x = parentRect.right - 4;
    let y = parentRect.top - 4;

    if (x + rect.width > viewport.width - SCROLLBAR_GUTTER_PX) {
      x = parentRect.left - rect.width + 4;
    }

    if (y + rect.height > viewport.height - SCROLLBAR_GUTTER_PX) {
      y = Math.max(8, viewport.height - rect.height - 8);
    }

    x = Math.max(8, x);
    y = Math.max(8, y);

    setPosition({ x, y });
  }, [parentRect]);

  return createPortal(
    <div
      ref={submenuRef}
      className="submenu"
      style={{
        position: "fixed",
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      role="menu"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <MenuItem key={item.id} item={item} onItemClick={onItemClick} />
      ))}
    </div>,
    document.body,
  );
}
