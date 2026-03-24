// Context menu item with submenu support, adapted from liminal-notes.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

import { useState, useRef, useEffect } from "react";
import type { MenuItem as MenuItemType } from "./types";
import { Submenu } from "./Submenu";

interface MenuItemProps {
  item: MenuItemType;
  onItemClick: (id: string, action?: () => void) => void;
}

export function MenuItem({ item, onItemClick }: MenuItemProps) {
  const [showSubmenu, setShowSubmenu] = useState(false);
  const submenuTimerRef = useRef<number | null>(null);
  const itemRef = useRef<HTMLButtonElement>(null);

  const hasSubmenu = item.children && item.children.length > 0;
  const isCheckable = typeof item.checked === "boolean";

  useEffect(() => {
    return () => {
      if (submenuTimerRef.current !== null) {
        clearTimeout(submenuTimerRef.current);
      }
    };
  }, []);

  function handleClick(e: React.MouseEvent) {
    if (item.disabled) return;
    e.preventDefault();
    e.stopPropagation();

    if (hasSubmenu) {
      setShowSubmenu(true);
      return;
    }

    onItemClick(item.id, item.action);
  }

  function handleMouseEnter() {
    if (!hasSubmenu) return;
    if (submenuTimerRef.current !== null) {
      clearTimeout(submenuTimerRef.current);
      submenuTimerRef.current = null;
    }
    submenuTimerRef.current = window.setTimeout(() => {
      setShowSubmenu(true);
    }, 250);
  }

  function handleMouseLeave() {
    if (!hasSubmenu) return;
    if (submenuTimerRef.current !== null) {
      clearTimeout(submenuTimerRef.current);
      submenuTimerRef.current = null;
    }
    submenuTimerRef.current = window.setTimeout(() => {
      setShowSubmenu(false);
    }, 300);
  }

  const handleSubmenuEnter = () => {
    if (submenuTimerRef.current !== null) {
      clearTimeout(submenuTimerRef.current);
      submenuTimerRef.current = null;
    }
    setShowSubmenu(true);
  };

  const handleSubmenuLeave = () => {
    if (submenuTimerRef.current !== null) {
      clearTimeout(submenuTimerRef.current);
    }
    submenuTimerRef.current = window.setTimeout(() => {
      setShowSubmenu(false);
    }, 300);
  };

  return (
    <>
      <button
        ref={itemRef}
        className={[
          "menu-item",
          item.disabled ? "disabled" : "",
          hasSubmenu ? "has-submenu" : "",
          item.danger ? "danger" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        disabled={item.disabled}
        role="menuitem"
        aria-haspopup={hasSubmenu}
        aria-expanded={hasSubmenu ? showSubmenu : undefined}
      >
        <span className="menu-item-icon">
          {isCheckable ? (
            <span
              className={`menu-item-checkbox ${item.checked ? "checked" : ""}`}
              aria-hidden="true"
            />
          ) : (
            item.icon ?? null
          )}
        </span>
        <span className="menu-item-label">{item.label}</span>
        {item.shortcut && (
          <span className="menu-item-shortcut">{item.shortcut}</span>
        )}
        {hasSubmenu && <span className="menu-item-chevron">&rsaquo;</span>}
      </button>

      {hasSubmenu && showSubmenu && itemRef.current && (
        <Submenu
          items={item.children!}
          parentRect={itemRef.current.getBoundingClientRect()}
          onItemClick={onItemClick}
          onClose={() => setShowSubmenu(false)}
          onMouseEnter={handleSubmenuEnter}
          onMouseLeave={handleSubmenuLeave}
        />
      )}
    </>
  );
}
