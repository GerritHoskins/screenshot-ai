/**
 * Overlay Type Declarations
 */

import type { OverlayAPI } from '../preload/overlay';

declare global {
  interface Window {
    overlay: OverlayAPI;
  }
}

export {};
