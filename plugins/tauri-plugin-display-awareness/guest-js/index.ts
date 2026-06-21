import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/** Geometry for a single monitor, mirroring the plugin's `DisplayGeometry`. */
export interface DisplayGeometry {
	name: string;
	isPrimary: boolean;
	scale: number;
	physicalWidth: number;
	physicalHeight: number;
	logicalWidth: number;
	logicalHeight: number;
	positionX: number;
	positionY: number;
	/** Best-effort physical size in millimetres; null when unavailable. */
	widthMm: number | null;
	heightMm: number | null;
}

/** Event name emitted on scale-factor change (see the plugin's `DISPLAY_CHANGED_EVENT`). */
export const DISPLAY_CHANGED_EVENT = 'display://changed';

/** Enumerate all connected displays with logical + best-effort physical geometry. */
export async function getDisplays(): Promise<DisplayGeometry[]> {
	return await invoke('plugin:display-awareness|get_displays');
}

/**
 * Return the display the current window resides on, or null if the plugin is
 * unavailable (e.g. outside a Tauri context) or no displays were found.
 */
export async function getActiveDisplay(): Promise<DisplayGeometry | null> {
	return await invoke('plugin:display-awareness|get_active_display');
}

/** Subscribe to scale-factor-change notifications for the current window. */
export async function onDisplayChanged(handler: () => void): Promise<UnlistenFn> {
	return await listen(DISPLAY_CHANGED_EVENT, handler);
}
