// Context menu type definitions, adapted from liminal-notes.
//
// (c) Copyright 2026 Liminal HQ, Scott Morris
// SPDX-License-Identifier: MIT

export interface MenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  action?: () => void;
  children?: MenuItem[];
}

export interface MenuSeparator {
  type: "separator";
}

export interface MenuSection {
  title?: string;
  items: (MenuItem | MenuSeparator)[];
}

export interface MenuModel {
  sections: MenuSection[];
}

export interface MenuPosition {
  x: number;
  y: number;
}
