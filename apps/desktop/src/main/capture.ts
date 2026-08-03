import { BrowserWindow, desktopCapturer, ipcMain, screen, nativeImage, Display } from "electron";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import { logError, logInfo, logWarn } from "@logging";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type SelectionRect = { x: number; y: number; w: number; h: number };

type CaptureOptions = {
  displayIndex?: number;
  mainWindow?: BrowserWindow | null;
};

export async function captureScreenSelection(options: CaptureOptions = {}): Promise<Buffer | null> {
  try {
    logInfo('capture', 'Starting screen capture', {
      platform: process.platform,
      nodeVersion: process.versions.node,
      electronVersion: process.versions.electron
    });

    // Check if we can access screen API
    const displays = screen.getAllDisplays();
    logInfo('capture', 'Detected displays', { 
      count: displays.length,
      displays: displays.map(d => ({
        id: d.id,
        bounds: d.bounds,
        size: d.size,
        scaleFactor: d.scaleFactor,
        isPrimary: d.id === screen.getPrimaryDisplay().id
      }))
    });

    if (displays.length === 0) {
      throw new Error('No displays detected. Please ensure your display is connected and working.');
    }

    let sources: Electron.DesktopCapturerSource[] = [];
    let lastError: Error | null = null;

    // On Windows, try native capture FIRST (bypasses DXGI 10-bit issues)
    if (process.platform === 'win32') {
      logInfo('capture', 'Windows detected - trying native capture first');
      try {
        const nativeScreenshot = await captureScreenNative();
        if (nativeScreenshot && nativeScreenshot.length > 0) {
          const thumbnail = nativeImage.createFromBuffer(nativeScreenshot);
          if (!thumbnail.isEmpty()) {
            sources = [{
              id: 'native-capture',
              name: 'Screen (Native)',
              thumbnail,
              display_id: '',
              appIcon: null as any,
            }];
            logInfo('capture', 'Native Windows capture succeeded', {
              size: thumbnail.getSize(),
              bytes: nativeScreenshot.length
            });
          }
        }
      } catch (nativeError) {
        lastError = nativeError instanceof Error ? nativeError : new Error(String(nativeError));
        logWarn('capture', 'Native capture failed, will try desktopCapturer', lastError);
      }
    }

    // Fallback to desktopCapturer if native didn't work (or non-Windows)
    if (!sources || sources.length === 0) {
      // Strategy 1: Try without thumbnail size first (most reliable)
      try {
        logInfo('capture', 'Attempting desktopCapturer (no size specified)', {
          platform: process.platform
        });

        // On macOS, request larger thumbnail size for better quality
        const capturerOptions: Electron.SourcesOptions = {
          types: ["screen"]
        };
        
        if (process.platform === 'darwin') {
          const best = displays.reduce<Display | null>((acc, d) => {
            if (!acc) return d;
            const accArea = acc.size.width * acc.size.height;
            const dArea = d.size.width * d.size.height;
            return dArea > accArea ? d : acc;
          }, null);

          if (best) {
            const { width, height } = best.size;
            capturerOptions.thumbnailSize = { width, height };
            logInfo('capture', 'macOS: Requesting thumbnail size from largest display', {
              width,
              height,
              displayId: best.id,
            });
          }
        }

        sources = await Promise.race([
          desktopCapturer.getSources(capturerOptions),
          new Promise<never>((_, reject) => {
            const timeoutMsg = process.platform === 'darwin'
              ? 'Screen capture timed out. Please check:\n' +
                '1. Screen recording permissions (System Settings > Privacy & Security > Screen Recording)\n' +
                '2. Grant permission to this application\n' +
                '3. Try restarting the application'
              : 'Screen capture timed out. DXGI initialization may have failed. ' +
                'Please check:\n' +
                '1. Screen recording permissions (Windows Settings > Privacy > Screen recording)\n' +
                '2. Graphics drivers are up to date\n' +
                '3. Try restarting the application';
            setTimeout(() => reject(new Error(timeoutMsg)), 10000);
          })
        ]);
      
      if (sources && sources.length > 0) {
        logInfo('capture', 'Screen sources found (no size specified)', { 
          count: sources.length,
          sources: sources.map(s => ({
            id: s.id,
            name: s.name,
            display_id: s.display_id,
            thumbnailSize: s.thumbnail ? s.thumbnail.getSize() : null
          }))
        });
      } else {
        logWarn('capture', 'getSources returned empty array', { 
          sourcesLength: sources?.length ?? 0,
          sourcesType: typeof sources
        });
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logError('capture', 'Failed to get sources without size', lastError);
      
      // Strategy 2: Try with a smaller thumbnail size (may work if size was the issue)
      try {
        logInfo('capture', 'Attempting to get screen sources (small size)');
        sources = await Promise.race([
          desktopCapturer.getSources({ 
            types: ["screen"], 
            thumbnailSize: { width: 1280, height: 720 } // Smaller size
          }),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Screen capture timeout')), 10000)
          )
        ]);
        
        if (sources && sources.length > 0) {
          logInfo('capture', 'Screen sources found (small size)', { count: sources.length });
        }
      } catch (error2) {
        lastError = error2 instanceof Error ? error2 : new Error(String(error2));
        logError('capture', 'Failed to get sources with small size', lastError);
      }
    }
    } // Close the if (!sources) block for desktopCapturer fallback

    if (!sources || sources.length === 0) {
      const errorMsg = lastError
        ? `Screen capture failed: ${lastError.message}`
        : process.platform === 'darwin'
          ? `Screen capture failed: No screen sources available. This is often caused by:\n\n` +
            `1. Missing screen recording permissions\n` +
            `   → System Settings > Privacy & Security > Screen Recording\n` +
            `   → Enable permission for this application\n` +
            `   → Restart the application after granting permission\n\n` +
            `2. Application not in the list\n` +
            `   → If the app doesn't appear, try running it once, then check System Settings\n\n` +
            `3. macOS version compatibility\n` +
            `   → Requires macOS 10.15 (Catalina) or later`
          : `Screen capture failed: No screen sources available. This is often caused by:\n\n` +
            `1. Missing screen recording permissions\n` +
            `   → Windows Settings > Privacy & Security > Screen recording\n` +
            `   → Enable "Let desktop apps access your screen"\n\n` +
            `2. Outdated graphics drivers\n` +
            `   → Update your NVIDIA/AMD/Intel graphics drivers\n\n` +
            `3. Multiple display adapters\n` +
            `   → Try disconnecting external monitors temporarily\n\n` +
            `4. Windows version compatibility\n` +
            `   → Requires Windows 10 version 1803 or later`;

      logError('capture', 'No screen sources found after all attempts', {
        error: lastError,
        displaysCount: displays.length,
        platform: process.platform
      });
      throw new Error(errorMsg);
    }

    // Determine which display to use
    let displayIndex = options.displayIndex;
    let targetDisplay: Display | null = null;
    
    // If no display index specified, try to find the primary/active display
    if (displayIndex === undefined) {
      if (sources.length === 1) {
        // Only one display, use it
        displayIndex = 0;
        logInfo('capture', 'Single display detected, using index 0');
      } else {
        // Multiple displays - try to find the active display (where main window is)
        try {
          // First, try to get the display with the cursor (active monitor for most users)
          try {
            const cursorPoint = screen.getCursorScreenPoint();
            targetDisplay = screen.getDisplayNearestPoint(cursorPoint);
            logInfo('capture', 'Cursor display found', {
              cursorPoint,
              displayId: targetDisplay.id,
              displayBounds: targetDisplay.bounds,
              displaySize: targetDisplay.size,
              isPrimary: targetDisplay.id === screen.getPrimaryDisplay().id
            });
          } catch (error) {
            logWarn('capture', 'Failed to get cursor display', error instanceof Error ? error : undefined);
          }

          // Next, try to get the display that the main window is on
          
          if (!targetDisplay && options.mainWindow && !options.mainWindow.isDestroyed()) {
            try {
              const windowBounds = options.mainWindow.getBounds();
              const windowCenter = {
                x: windowBounds.x + windowBounds.width / 2,
                y: windowBounds.y + windowBounds.height / 2
              };
              
              targetDisplay = screen.getDisplayNearestPoint(windowCenter);
              logInfo('capture', 'Main window display found', {
                windowBounds,
                windowCenter,
                displayId: targetDisplay.id,
                displayBounds: targetDisplay.bounds,
                displaySize: targetDisplay.size,
                isPrimary: targetDisplay.id === screen.getPrimaryDisplay().id
              });
            } catch (error) {
              logWarn('capture', 'Failed to get main window display', error instanceof Error ? error : undefined);
            }
          }
          
          // On macOS, also check which display has the menu bar (the active display)
          // This is more reliable than primary display when MacBook lid is closed
          if (!targetDisplay && process.platform === 'darwin') {
            try {
              // On macOS, the primary display is the one with the menu bar
              // But if MacBook lid is closed, the external monitor becomes primary
              const primaryDisplay = screen.getPrimaryDisplay();
              
              // Check if primary display seems to be an external monitor (larger than typical MacBook screen)
              const isLikelyExternal = primaryDisplay.size.width >= 1920 || primaryDisplay.size.height >= 1080;
              
              if (isLikelyExternal) {
                targetDisplay = primaryDisplay;
                logInfo('capture', 'Using primary display (likely external monitor on macOS)', {
                  id: targetDisplay.id,
                  bounds: targetDisplay.bounds,
                  size: targetDisplay.size,
                  isLikelyExternal
                });
              } else {
                // Primary might be built-in, try to find external monitor
                const allDisplays = screen.getAllDisplays();
                const externalDisplay = allDisplays.find(d => 
                  d.size.width >= 1920 || d.size.height >= 1080
                );
                
                if (externalDisplay) {
                  targetDisplay = externalDisplay;
                  logInfo('capture', 'Found external monitor (not primary)', {
                    id: targetDisplay.id,
                    bounds: targetDisplay.bounds,
                    size: targetDisplay.size
                  });
                } else {
                  targetDisplay = primaryDisplay;
                  logInfo('capture', 'Using primary display (no external monitor found)', {
                    id: targetDisplay.id,
                    bounds: targetDisplay.bounds,
                    size: targetDisplay.size
                  });
                }
              }
            } catch (error) {
              logWarn('capture', 'Failed to determine macOS active display', error instanceof Error ? error : undefined);
            }
          }
          
          // Final fallback to primary display
          if (!targetDisplay) {
            targetDisplay = screen.getPrimaryDisplay();
            logInfo('capture', 'Using primary display as final fallback', {
              id: targetDisplay.id,
              bounds: targetDisplay.bounds,
              size: targetDisplay.size
            });
          }
          
          // Try to match the target display with a source
          // On macOS, matching can be tricky - try multiple strategies
          let matchedIndex = -1;
          
          logInfo('capture', 'Attempting to match target display with sources', {
            targetDisplayId: targetDisplay.id,
            targetDisplayBounds: targetDisplay.bounds,
            targetDisplaySize: targetDisplay.size,
            sourcesCount: sources.length,
            sourceDisplayIds: sources.map(s => s.display_id)
          });
          
          for (let i = 0; i < sources.length; i++) {
            const source = sources[i];
            
            // Strategy 1: Check if source has display_id that matches target display
            if (source.display_id) {
              // Try exact match
              const displayIdMatch = targetDisplay.id.toString() === source.display_id;
              
              // Also try matching with all displays to see if we can find a correlation
              const allDisplays = screen.getAllDisplays();
              for (const display of allDisplays) {
                if (display.id.toString() === source.display_id && display.id === targetDisplay.id) {
                  matchedIndex = i;
                  logInfo('capture', 'Matched display by display_id (exact match)', {
                    sourceIndex: i,
                    sourceName: source.name,
                    sourceDisplayId: source.display_id,
                    targetDisplayId: targetDisplay.id,
                    isPrimary: targetDisplay.id === screen.getPrimaryDisplay().id
                  });
                  break;
                }
              }
              
              if (matchedIndex >= 0) break;
            }
            
            // Strategy 2: Check if source thumbnail size matches target display size
            // This is less reliable but can work if display_id matching fails
            if (source.thumbnail && !source.thumbnail.isEmpty() && matchedIndex === -1) {
              const thumbSize = source.thumbnail.getSize();
              const targetSize = targetDisplay.size;
              
              // Calculate scale factor (macOS might scale thumbnails)
              const scaleFactor = targetDisplay.scaleFactor || 1;
              const scaledTargetWidth = targetSize.width * scaleFactor;
              const scaledTargetHeight = targetSize.height * scaleFactor;
              
              // Allow tolerance for size matching (thumbnails might be scaled or slightly different)
              const widthDiff = Math.abs(thumbSize.width - targetSize.width);
              const heightDiff = Math.abs(thumbSize.height - targetSize.height);
              const scaledWidthDiff = Math.abs(thumbSize.width - scaledTargetWidth);
              const scaledHeightDiff = Math.abs(thumbSize.height - scaledTargetHeight);
              
              // Match if size is close (within 100px) or matches scaled size
              const sizeMatch = (widthDiff < 100 && heightDiff < 100) || 
                               (scaledWidthDiff < 100 && scaledHeightDiff < 100);
              
              if (sizeMatch) {
                matchedIndex = i;
                logInfo('capture', 'Matched display by size', {
                  sourceIndex: i,
                  sourceName: source.name,
                  thumbSize,
                  targetSize,
                  scaleFactor,
                  scaledTargetSize: { width: scaledTargetWidth, height: scaledTargetHeight },
                  widthDiff,
                  heightDiff,
                  scaledWidthDiff,
                  scaledHeightDiff
                });
                break;
              }
            }
          }
          
          // Log all sources for debugging if no match found
          if (matchedIndex === -1) {
            logWarn('capture', 'No display match found, listing all sources for debugging', {
              sources: sources.map((s, idx) => ({
                index: idx,
                id: s.id,
                name: s.name,
                display_id: s.display_id,
                thumbnailSize: s.thumbnail ? s.thumbnail.getSize() : null
              })),
              targetDisplay: {
                id: targetDisplay.id,
                bounds: targetDisplay.bounds,
                size: targetDisplay.size,
                scaleFactor: targetDisplay.scaleFactor
              }
            });
          }
          
          // Strategy 3: If still no match, try to match by comparing all displays with all sources
          if (matchedIndex === -1) {
            const allDisplays = screen.getAllDisplays();
            
            for (let i = 0; i < sources.length; i++) {
              const source = sources[i];
              if (!source.thumbnail || source.thumbnail.isEmpty()) continue;
              
              const thumbSize = source.thumbnail.getSize();
              
              // Compare with all displays to find best match
              for (const display of allDisplays) {
                const displaySize = display.size;
                const scaleFactor = display.scaleFactor || 1;
                const scaledWidth = displaySize.width * scaleFactor;
                const scaledHeight = displaySize.height * scaleFactor;
                
                // Check if thumbnail size matches this display (with or without scaling)
                const widthMatch = Math.abs(thumbSize.width - displaySize.width) < 50 ||
                                  Math.abs(thumbSize.width - scaledWidth) < 50;
                const heightMatch = Math.abs(thumbSize.height - displaySize.height) < 50 ||
                                   Math.abs(thumbSize.height - scaledHeight) < 50;
                
                if (widthMatch && heightMatch && display.id === targetDisplay.id) {
                  matchedIndex = i;
                  logInfo('capture', 'Matched display by comparing all displays', {
                    sourceIndex: i,
                    sourceName: source.name,
                    displayId: display.id,
                    targetDisplayId: targetDisplay.id,
                    thumbSize,
                    displaySize,
                    scaleFactor
                  });
                  break;
                }
              }
              
              if (matchedIndex >= 0) break;
            }
          }
          
          // Strategy 4: If still no match and on macOS, prefer larger displays (external monitors)
          // MacBook built-in displays are typically smaller than external monitors
          if (matchedIndex === -1 && process.platform === 'darwin' && sources.length > 1) {
            // Check if target display is NOT built-in (external monitor)
            const targetIsBuiltIn = targetDisplay.bounds.width < 2000 && targetDisplay.bounds.height < 1500;
            
            let bestIndex = 0;
            let bestScore = -1;
            
            for (let i = 0; i < sources.length; i++) {
              const source = sources[i];
              if (source.thumbnail && !source.thumbnail.isEmpty()) {
                const size = source.thumbnail.getSize();
                const area = size.width * size.height;
                
                // Check if it's a built-in display
                const isBuiltIn = source.name.toLowerCase().includes('built-in') || 
                                  source.name.toLowerCase().includes('builtin') ||
                                  area < 2000000; // Less than ~1920x1080 area
                
                // Score: prefer non-built-in if target is external, prefer larger displays
                let score = area;
                if (!targetIsBuiltIn && !isBuiltIn) {
                  score += 10000000; // Bonus for external when target is external
                } else if (targetIsBuiltIn && isBuiltIn) {
                  score += 5000000; // Bonus for built-in when target is built-in
                }
                
                if (score > bestScore) {
                  bestScore = score;
                  bestIndex = i;
                }
              }
            }
            
            matchedIndex = bestIndex;
            logInfo('capture', 'Using best matching display as fallback', {
              sourceIndex: matchedIndex,
              sourceName: sources[matchedIndex].name,
              targetIsBuiltIn,
              bestScore
            });
          }
          
          if (matchedIndex >= 0) {
            displayIndex = matchedIndex;
            logInfo('capture', 'Using matched display', { displayIndex, sourceName: sources[displayIndex].name });
          } else {
            // Couldn't match target display, show chooser
            logWarn('capture', 'Could not match target display, showing chooser', {
              targetDisplayId: targetDisplay.id,
              sourcesCount: sources.length,
              sourceIds: sources.map(s => s.display_id)
            });
            const chosen = await chooseDisplay(
              sources.map(s => ({ id: s.id, name: s.name })),
              sources,
              targetDisplay.id
            );
            if (chosen === null) return null;
            displayIndex = Math.max(0, Math.min(chosen, sources.length - 1));
          }
        } catch (error) {
          logWarn('capture', 'Failed to get target display, showing chooser', error instanceof Error ? error : undefined);
          // Fallback to chooser if we can't determine target display
          let targetDisplayId: number | undefined;
          try {
            targetDisplayId = screen.getPrimaryDisplay().id;
          } catch {
            // Ignore if we can't get primary display
          }
          const chosen = await chooseDisplay(
            sources.map(s => ({ id: s.id, name: s.name })),
            sources,
            targetDisplayId
          );
          if (chosen === null) return null;
          displayIndex = Math.max(0, Math.min(chosen, sources.length - 1));
        }
      }
    } else {
      // Display index was explicitly provided
      displayIndex = Math.max(0, Math.min(displayIndex, sources.length - 1));
    }

    const source = sources[displayIndex];
    if (!source) {
      logWarn('capture', 'Selected source not found', { displayIndex });
      return null;
    }

    // Resolve target display for overlay positioning
    if (!targetDisplay) {
      try {
        if (source.display_id) {
          const allDisplays = screen.getAllDisplays();
          targetDisplay =
            allDisplays.find(d => d.id.toString() === source.display_id) || null;
        }
      } catch (error) {
        logWarn('capture', 'Failed to match target display from source', error instanceof Error ? error : undefined);
      }
    }

    if (!targetDisplay) {
      try {
        const cursorPoint = screen.getCursorScreenPoint();
        targetDisplay = screen.getDisplayNearestPoint(cursorPoint);
      } catch {
        targetDisplay = null;
      }
    }

    if (!targetDisplay) {
      try {
        targetDisplay = screen.getPrimaryDisplay();
      } catch {
        targetDisplay = null;
      }
    }
    
    // Validate source has a valid thumbnail
    if (!source.thumbnail) {
      logError('capture', 'Source has no thumbnail', undefined);
      throw new Error('Screen source has no thumbnail. Screen capture may not be properly initialized.');
    }
    
    if (source.thumbnail.isEmpty()) {
      logError('capture', 'Source thumbnail is empty', undefined);
      throw new Error('Screen source thumbnail is empty. Please try again or check screen recording permissions.');
    }
    
    const thumbnailSize = source.thumbnail.getSize();
    logInfo('capture', 'Using source', { 
      id: source.id, 
      name: source.name,
      thumbnailSize
    });
    
    // Validate thumbnail has valid dimensions
    if (thumbnailSize.width === 0 || thumbnailSize.height === 0) {
      logError('capture', 'Thumbnail has invalid dimensions', { thumbnailSize });
      throw new Error('Screen source has invalid dimensions. Please try again.');
    }

    const overlayBounds = targetDisplay?.bounds;

    const overlayOptions: Electron.BrowserWindowConstructorOptions = {
      fullscreen: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false, // Don't show until ready
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true, // Additional security
        preload: path.join(__dirname, "../preload/overlay.js"), // Compiled path
      },
    };

    // On Windows, use fullscreen mode for reliable overlay display
    // Windows has DPI scaling and multi-monitor issues with explicit bounds
    if (process.platform === 'win32') {
      overlayOptions.fullscreen = true;
      logInfo('capture', 'Windows: Using fullscreen overlay mode');
    } else if (overlayBounds) {
      // On macOS/Linux, use explicit bounds for multi-monitor support
      overlayOptions.x = overlayBounds.x;
      overlayOptions.y = overlayBounds.y;
      overlayOptions.width = overlayBounds.width;
      overlayOptions.height = overlayBounds.height;
    }

    const overlay = new BrowserWindow(overlayOptions);

    // In development, load from vite dev server; in production, load from file
    if (process.env.ELECTRON_RENDERER_URL) {
      await overlay.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay.html`);
    } else {
      await overlay.loadFile(path.join(__dirname, "../renderer/overlay.html"));
    }

    // Wait for the page to be ready before showing and sending image
    await overlay.webContents.executeJavaScript(`
      new Promise((resolve) => {
        if (document.readyState === 'complete') {
          resolve();
        } else {
          window.addEventListener('load', resolve);
        }
      });
    `);

    // Show and focus the overlay window
    overlay.show();
    overlay.focus();
    
    logInfo('capture', 'Overlay window created', {
      platform: process.platform,
      isVisible: overlay.isVisible(),
      isFocused: overlay.isFocused(),
      isDestroyed: overlay.isDestroyed()
    });
    
    // Platform-specific overlay configuration
    if (process.platform === 'darwin') {
      // On macOS, ensure the window is on top and can receive events
      overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      overlay.moveTop();
      // Ensure mouse events are captured (don't ignore mouse events)
      overlay.setIgnoreMouseEvents(false, { forward: false });
      logInfo('capture', 'macOS overlay window configured', {
        visibleOnAllWorkspaces: true,
        ignoreMouseEvents: false
      });
    } else if (process.platform === 'win32') {
      // On Windows, ensure overlay is on top and focusable
      overlay.setAlwaysOnTop(true, 'screen-saver');
      overlay.moveTop();
      logInfo('capture', 'Windows overlay window configured', {
        alwaysOnTop: true
      });
    }

    // Send the image after a brief delay to ensure the window is ready
    setTimeout(() => {
      if (!overlay.isDestroyed()) {
        overlay.webContents.send("capture:image", source.thumbnail.toDataURL());
        logInfo('capture', 'Image sent to overlay window');
      } else {
        logWarn('capture', 'Overlay window destroyed before image could be sent');
      }
    }, 100);

    return new Promise((resolve) => {
      const cleanup = () => {
        ipcMain.removeAllListeners("capture:selection");
        ipcMain.removeAllListeners("capture:cancel");
        if (!overlay.isDestroyed()) overlay.close();
      };

      ipcMain.once("capture:selection", async (_event, rect: SelectionRect) => {
        cleanup();
        if (rect.w < 2 || rect.h < 2) {
          resolve(null);
          return;
        }
        
        try {
          // Get the full screen image
          const pngBuffer = source.thumbnail.toPNG();
          
          // Validate buffer is not empty
          if (!pngBuffer || pngBuffer.length === 0) {
            logError('capture', 'Thumbnail buffer is empty', undefined);
            resolve(null);
            return;
          }
          
          const full = Buffer.from(pngBuffer);
          
          // Validate buffer before processing with sharp
          if (full.length === 0) {
            logError('capture', 'Converted buffer is empty', undefined);
            resolve(null);
            return;
          }
          
          // Get image dimensions to validate crop bounds
          const metadata = await sharp(full).metadata();
          if (!metadata.width || !metadata.height) {
            logError('capture', 'Failed to get image metadata', undefined);
            resolve(null);
            return;
          }
          
          // Validate crop bounds
          const cropLeft = Math.max(0, Math.min(rect.x, metadata.width - 1));
          const cropTop = Math.max(0, Math.min(rect.y, metadata.height - 1));
          const cropWidth = Math.min(rect.w, metadata.width - cropLeft);
          const cropHeight = Math.min(rect.h, metadata.height - cropTop);
          
          if (cropWidth < 2 || cropHeight < 2) {
            logWarn('capture', 'Crop area too small', { cropWidth, cropHeight });
            resolve(null);
            return;
          }
          
          const cropped = await sharp(full)
            .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
            .png()
            .toBuffer();
          
          logInfo('capture', 'Selection processed', { 
            originalSize: full.length, 
            croppedSize: cropped.length,
            cropBounds: { x: cropLeft, y: cropTop, w: cropWidth, h: cropHeight }
          });
          
          resolve(cropped);
        } catch (error) {
          logError('capture', 'Failed to process selection', error instanceof Error ? error : undefined);
          resolve(null);
        }
      });

      ipcMain.once("capture:cancel", () => {
        cleanup();
        resolve(null);
      });
    });
  } catch (error) {
    logError('capture', 'Capture failed', error instanceof Error ? error : undefined);
    return null;
  }
}

type DisplayChoice = { id: string; name: string };

async function chooseDisplay(displays: DisplayChoice[], sources: { thumbnail: Electron.NativeImage }[], primaryDisplayId?: number): Promise<number | null> {
  const chooser = new BrowserWindow({
    width: 480,
    height: 320,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true, // Additional security
      preload: path.join(__dirname, "../preload/chooser.js"), // Compiled path
    },
  });

  // In development, load from vite dev server; in production, load from file
  if (process.env.ELECTRON_RENDERER_URL) {
    await chooser.loadURL(`${process.env.ELECTRON_RENDERER_URL}/chooser.html`);
  } else {
    await chooser.loadFile(path.join(__dirname, "../renderer/chooser.html"));
  }
  const thumbnails = sources.map((s) => s.thumbnail.toDataURL());
  
  // Try to find which display index corresponds to the primary display
  let primaryIndex: number | undefined;
  if (primaryDisplayId !== undefined) {
    // Match by display_id if available
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i] as Electron.DesktopCapturerSource;
      if (source.display_id && primaryDisplayId.toString() === source.display_id) {
        primaryIndex = i;
        break;
      }
    }
  }
  
  chooser.webContents.send("display:list", { displays, thumbnails, primaryIndex });

  return new Promise((resolve) => {
    const cleanup = () => {
      ipcMain.removeAllListeners("display:choose");
      ipcMain.removeAllListeners("display:cancel");
      if (!chooser.isDestroyed()) chooser.close();
    };

    ipcMain.once("display:choose", (_event, index: number) => {
      cleanup();
      resolve(index);
    });

    ipcMain.once("display:cancel", () => {
      cleanup();
      resolve(null);
    });

    chooser.on("closed", () => {
      cleanup();
      resolve(null);
    });
  });
}

/**
 * Native Windows screen capture using PowerShell/.NET
 * Bypasses DXGI Desktop Duplication API issues with HDR/10-bit displays
 */
async function captureScreenNative(): Promise<Buffer | null> {
  if (process.platform !== 'win32') {
    return null;
  }

  const timestamp = Date.now();
  const tempFile = path.join(os.tmpdir(), `screenshot-ai-${timestamp}.png`);
  const tempScript = path.join(os.tmpdir(), `screenshot-ai-${timestamp}.ps1`);

  // PowerShell script to capture screen using .NET Graphics API
  const psScript = `
[void][System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms")
[void][System.Reflection.Assembly]::LoadWithPartialName("System.Drawing")

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bounds = $screen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)
$bitmap.Save("${tempFile.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Host "OK"
`;

  try {
    logInfo('capture', 'Running PowerShell screen capture');

    // Write script to temp file
    fs.writeFileSync(tempScript, psScript, 'utf8');

    // Execute using Windows PowerShell (not PowerShell Core)
    const result = execSync(
      `"${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tempScript}"`,
      {
        encoding: 'utf8',
        timeout: 15000,
        windowsHide: true,
      }
    );

    logInfo('capture', 'PowerShell result', { result: result.trim() });

    // Clean up script file
    try { fs.unlinkSync(tempScript); } catch {}

    // Read the captured image
    if (fs.existsSync(tempFile)) {
      const buffer = fs.readFileSync(tempFile);
      fs.unlinkSync(tempFile); // Clean up
      logInfo('capture', 'Native capture succeeded', { size: buffer.length });
      return buffer;
    } else {
      logError('capture', 'Temp file not created', undefined);
      return null;
    }
  } catch (error) {
    logError('capture', 'PowerShell capture failed', error instanceof Error ? error : undefined);
    // Clean up temp files
    try { if (fs.existsSync(tempScript)) fs.unlinkSync(tempScript); } catch {}
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
    return null;
  }
}
