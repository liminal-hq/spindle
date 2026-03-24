// Context menu portal component, adapted from liminal-notes.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { MenuModel, MenuPosition } from "./types";
import { MenuSection } from "./MenuSection";
import "./ContextMenu.css";

interface ContextMenuProps {
  model: MenuModel;
  position: MenuPosition;
  onClose: () => void;
  onItemClick: (itemId: string, action?: () => void) => void;
}

const SCROLLBAR_GUTTER_PX = 18;

export function ContextMenu({
  model,
  position,
  onClose,
  onItemClick,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuRef.current) return;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    let { x, y } = position;

    if (x + rect.width > viewport.width - SCROLLBAR_GUTTER_PX) {
      x = viewport.width - rect.width - SCROLLBAR_GUTTER_PX;
    }

    if (y + rect.height > viewport.height - SCROLLBAR_GUTTER_PX) {
      y = viewport.height - rect.height - SCROLLBAR_GUTTER_PX;
    }

    x = Math.max(8, x);
    y = Math.max(8, y);

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }, [position]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  useEffect(() => {
    window.addEventListener("blur", onClose);
    return () => window.removeEventListener("blur", onClose);
  }, [onClose]);

  function handleItemClick(itemId: string, action?: () => void) {
    onItemClick(itemId, action);
    onClose();
  }

  return createPortal(
    <div ref={menuRef} className="context-menu" role="menu">
      {model.sections.map((section, idx) => (
        <MenuSection key={idx} section={section} onItemClick={handleItemClick} />
      ))}
    </div>,
    document.body,
  );
}
