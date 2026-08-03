/**
 * Overlay Preload Bridge - Workstream D.1
 * Secure IPC bridge for overlay window (capture selection).
 */

import { contextBridge, ipcRenderer } from 'electron';

// ============================================================================
// Overlay API Interface
// ============================================================================

export interface OverlayAPI {
  /**
   * Send selection rectangle to main process.
   */
  submitSelection: (rect: { x: number; y: number; w: number; h: number }) => void;
  
  /**
   * Cancel capture selection.
   */
  cancel: () => void;
  
  /**
   * Receive image data for display in overlay.
   */
  onImage: (callback: (imageData: string) => void) => void;
}

// ============================================================================
// Expose Secure API
// ============================================================================

const overlayAPI: OverlayAPI = {
  submitSelection: (rect) => {
    // Validate rect before sending
    if (
      typeof rect.x === 'number' &&
      typeof rect.y === 'number' &&
      typeof rect.w === 'number' &&
      typeof rect.h === 'number' &&
      rect.w >= 0 &&
      rect.h >= 0
    ) {
      ipcRenderer.send('capture:selection', rect);
    } else {
      console.error('Invalid selection rect:', rect);
    }
  },
  
  cancel: () => {
    ipcRenderer.send('capture:cancel');
  },
  
  onImage: (callback) => {
    ipcRenderer.on('capture:image', (_event, imageData: string) => {
      if (typeof imageData === 'string') {
        callback(imageData);
      }
    });
  },
};

contextBridge.exposeInMainWorld('overlay', overlayAPI);

// Type declaration for overlay renderer
declare global {
  interface Window {
    overlay: OverlayAPI;
  }
}
