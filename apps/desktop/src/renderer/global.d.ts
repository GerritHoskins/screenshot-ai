/**
 * Global Type Declarations for Renderer
 */

import type { ExposedAPI } from '../preload/index';

declare global {
  interface Window {
    api: ExposedAPI;
    overlayApi: {
      onImage: (cb: (dataUrl: string) => void) => void;
      sendSelection: (rect: { x: number; y: number; w: number; h: number }) => void;
      cancel: () => void;
    };
    chooserApi: {
      onList: (cb: (payload: { displays: { id: string; name: string }[]; thumbnails: string[] }) => void) => void;
      choose: (index: number) => void;
      cancel: () => void;
    };
  }
}

export {};
