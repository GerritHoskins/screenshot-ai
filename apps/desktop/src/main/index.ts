import { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeImage } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { captureScreenSelection } from "./capture";
import { getAnalysisService } from "./analysis";
import type { AIResponse, ScreenshotAnalysis } from "@types/ai-response";
import { getLogger } from "@logging";
import { mapCaptureError, mapProviderError } from "@errors";
import { registerSettingsHandlers } from "./settings";
import * as fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let lastImage: Buffer | null = null;
let isProcessing = false;
let lastFeedback: 'positive' | 'negative' | null = null;

// Initialize logger
const logger = getLogger({ minLevel: 0 }); // DEBUG level for development

// Helper to ensure error messages are strings
function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    if ('message' in error && typeof (error as any).message === 'string') {
      return (error as any).message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

// Initialize analysis service (will be updated from settings)
let analysisService = getAnalysisService({ provider: 'openai' });

// Load provider and workspace settings from settings on startup
function loadProviderFromSettings() {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      // Handle both old format (provider as string) and new schema format (provider as object)
      const provider = typeof settings.provider === 'object' && settings.provider?.selectedProvider
        ? settings.provider.selectedProvider
        : settings.provider;
      const model = typeof settings.provider === 'object' && settings.provider?.selectedModel
        ? settings.provider.selectedModel
        : settings.model;
      // Handle workspace context from both old and new schema
      const workspaceContextEnabled = settings.context?.enabled ?? settings.workspaceContextEnabled ?? true;
      const workspaceRoot = settings.context?.workspaceRoot ?? settings.workspaceRoot;

      if (provider) {
        analysisService = getAnalysisService({
          provider,
          model,
          workspaceContextEnabled: workspaceContextEnabled !== false,
          workspaceRoot,
        });
        logger.info('main', 'Provider loaded from settings', {
          provider,
          model,
          workspaceContextEnabled,
        });
      }
    }
  } catch (error) {
    logger.warn('main', 'Failed to load provider from settings', error instanceof Error ? error : undefined);
  }
}

/**
 * Load settings from file (helper function).
 * Normalizes both old and new schema formats to a consistent interface.
 */
function loadSettingsFromFile(): { provider?: string; model?: string; workspaceContextEnabled?: boolean; workspaceRoot?: string } {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      // Normalize provider from both old format (string) and new schema format (object)
      const provider = typeof raw.provider === 'object' && raw.provider?.selectedProvider
        ? raw.provider.selectedProvider
        : raw.provider;
      const model = typeof raw.provider === 'object' && raw.provider?.selectedModel
        ? raw.provider.selectedModel
        : raw.model;
      // Normalize workspace context from both old and new schema
      const workspaceContextEnabled = raw.context?.enabled ?? raw.workspaceContextEnabled;
      const workspaceRoot = raw.context?.workspaceRoot ?? raw.workspaceRoot;

      return { provider, model, workspaceContextEnabled, workspaceRoot };
    }
  } catch (error) {
    logger.warn('main', 'Failed to load settings', error instanceof Error ? error : undefined);
  }
  return {};
}

/**
 * Get workspace root from settings.
 * Returns undefined if not configured or if the configured path doesn't exist.
 */
function getWorkspaceRoot(): string | undefined {
  try {
    const settings = loadSettingsFromFile();
    if (settings.workspaceRoot && fs.existsSync(settings.workspaceRoot)) {
      // Validate it's a directory
      const stats = fs.statSync(settings.workspaceRoot);
      if (stats.isDirectory()) {
        return settings.workspaceRoot;
      }
    }
  } catch (error) {
    logger.warn('main', 'Failed to get workspace root from settings', error instanceof Error ? error : undefined);
  }
  
  // No workspace root configured - user must select one
  return undefined;
}

// Handle Windows display compatibility for screen capture
if (process.platform === 'win32') {
  // Try to use Windows Graphics Capture (WGC) API instead of DXGI
  // WGC is more compatible with HDR/10-bit displays
  app.commandLine.appendSwitch('enable-features', 'WinScreenCaptureKitMac');
  app.commandLine.appendSwitch('force-color-profile', 'srgb');

  // Disable GPU sandbox which can interfere with screen capture
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}

logger.info('main', 'Application starting', { platform: process.platform });

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "../preload/index.js")
    }
  });

  // In development, load from vite dev server; in production, load from file
  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    const indexPath = path.join(__dirname, "../renderer/index.html");
    await mainWindow.loadFile(indexPath);
  }
}

async function runCapture() {
  if (isProcessing) {
    logger.debug('main', 'Analysis already in progress, skipping');
    return;
  }

  try {
    // Step 1: Capture screenshot
    logger.info('main', 'Starting capture');
    mainWindow?.webContents.send("analysis:processing", { stage: "capture" });
    
    let image: Buffer | null;
    try {
      image = await captureScreenSelection();
    } catch (captureError) {
      isProcessing = false;
      logger.error('main', 'Capture failed', captureError instanceof Error ? captureError : undefined);
      
      // Provide helpful error messages for common Windows issues
      let errorMessage = 'Capture failed';
      if (captureError instanceof Error) {
        if (captureError.message.includes('permission') || captureError.message.includes('No screen sources')) {
          errorMessage = 'Screen recording permission denied. Please enable screen recording in Windows Settings > Privacy > Screen recording.';
        } else if (captureError.message.includes('thumbnail') || captureError.message.includes('dimensions')) {
          errorMessage = 'Screen capture initialization failed. Please try again or restart the application.';
        } else {
          errorMessage = captureError.message;
        }
      }
      
      const errorResponse = mapCaptureError(captureError);
      mainWindow?.webContents.send("analysis:error", {
        code: errorResponse.error?.code || 'CAPTURE_ERROR',
        message: errorMessage,
        retryable: errorResponse.error?.retryable ?? true,
      });
      return;
    }
    
    if (!image) {
      // User cancelled capture
      logger.debug('main', 'Capture cancelled by user');
      mainWindow?.webContents.send("analysis:processing", { stage: "cancelled" });
      // Clear processing state
      isProcessing = false;
      return;
    }

    lastImage = image;
    logger.info('main', 'Capture successful', { imageSize: image.length });

    // Convert image buffer to data URL for preview
    const screenshotDataUrl = nativeImage.createFromBuffer(image).toDataURL();
    
    // Send screenshot preview to renderer immediately after capture
    mainWindow?.webContents.send("analysis:screenshot", { dataUrl: screenshotDataUrl });

    // Step 2: Analyze with AI (reload service to get latest provider from settings)
    isProcessing = true;
    lastFeedback = null; // Reset feedback on new capture
    logger.info('main', 'Starting AI analysis');
    mainWindow?.webContents.send("analysis:processing", { stage: "analyzing" });
    
    // Get fresh service instance to pick up any settings changes
    const settings = loadSettingsFromFile();
    const currentService = getAnalysisService({
      provider: settings.provider || 'openai',
      model: settings.model,
      workspaceContextEnabled: settings.workspaceContextEnabled !== false,
      workspaceRoot: settings.workspaceRoot,
    });
    const workspaceRoot = getWorkspaceRoot();
    const response = await currentService.analyzeScreenshot(image, undefined, workspaceRoot);
    
    isProcessing = false;

    // Log AI response
    if (response.success) {
      logger.logAIResponse(
        response.metadata.provider,
        true,
        response.metadata.latencyMs,
        {
          prompt: response.metadata.promptTokens,
          completion: response.metadata.completionTokens,
        }
      );
    } else {
      logger.error('main', 'AI analysis failed', undefined, {
        code: response.error?.code,
        message: response.error?.message,
        retryable: response.error?.retryable,
      });
    }

    // Step 3: Send result or error
    if (response.success && response.data) {
      console.log('[Main] Sending result to renderer:', {
        success: response.success,
        dataKeys: Object.keys(response.data),
        hasText: !!response.data.text,
        textPreview: response.data.text?.slice(0, 50),
      });
      mainWindow?.webContents.send("analysis:result", response);
    } else {
      mainWindow?.webContents.send("analysis:error", {
        code: response.error?.code || 'UNKNOWN_ERROR',
        message: getErrorMessage(response.error?.message) || 'Analysis failed',
        retryable: response.error?.retryable ?? false,
        metadata: response.metadata,
      });
    }
  } catch (err) {
    isProcessing = false;
    logger.error('main', 'Unexpected error in capture flow', err instanceof Error ? err : undefined);

    // Handle unhandled promise rejections (like Sharp errors)
    const errorMessage = getErrorMessage(err);
    const errorResponse = mapCaptureError(err);

    mainWindow?.webContents.send("analysis:error", {
      code: errorResponse.error?.code || 'UNKNOWN_ERROR',
      message: getErrorMessage(errorResponse.error?.message) || errorMessage || 'An unexpected error occurred',
      retryable: errorResponse.error?.retryable ?? true,
    });
  }
}

// Suppress some Electron console warnings
// Note: DXGI warnings may still appear but are usually harmless
app.commandLine.appendSwitch('disable-logging');
// Try to reduce DXGI noise (may not work in all cases)
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');

app.whenReady().then(async () => {
  // Register settings handlers
  registerSettingsHandlers();
  
  // Load provider from settings
  loadProviderFromSettings();

  // Log user data + preload path to help diagnose missing logs/preload issues
  const userDataPath = app.getPath('userData');
  const preloadPath = path.join(__dirname, "../preload/index.js");
  logger.info('main', 'Startup paths', {
    userDataPath,
    preloadPath,
    preloadExists: fs.existsSync(preloadPath),
  });
  
  await createMainWindow();

  globalShortcut.register("CommandOrControl+Shift+S", () => {
    runCapture().catch((err) => {
      isProcessing = false;
      mainWindow?.webContents.send("analysis:error", {
        code: 'CAPTURE_ERROR',
        message: err?.message ?? "Capture failed",
        retryable: true,
      });
    });
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

ipcMain.on("capture:start", async () => {
  logger.info('main', 'Capture button clicked');
  if (!isProcessing) {
    logger.info('main', 'Starting capture from button');
    runCapture().catch((err) => {
      isProcessing = false;
      logger.error('main', 'Capture failed from button', err instanceof Error ? err : undefined);
      mainWindow?.webContents.send("analysis:error", {
        code: 'CAPTURE_ERROR',
        message: err?.message ?? "Capture failed",
        retryable: true,
      });
    });
  } else {
    logger.debug('main', 'Capture button clicked but already processing');
  }
});

ipcMain.on("analysis:retry", async () => {
  if (!lastImage || isProcessing) {
    logger.debug('main', 'Retry skipped', { hasImage: !!lastImage, isProcessing });
    return;
  }

  try {
    isProcessing = true;
    
    // Log retry attempt with feedback context
    const feedbackContext = lastFeedback 
      ? `with ${lastFeedback} feedback` 
      : 'without feedback';
    logger.info('main', 'Retrying analysis', { 
      feedback: lastFeedback,
      feedbackContext,
      hasImage: !!lastImage,
      imageSize: lastImage?.length
    });
    
    mainWindow?.webContents.send("analysis:processing", { stage: "analyzing" });
    
    // Get fresh service instance to pick up any settings changes
    const settings = loadSettingsFromFile();
    const currentService = getAnalysisService({
      provider: settings.provider || 'openai',
      model: settings.model,
      workspaceContextEnabled: settings.workspaceContextEnabled !== false,
      workspaceRoot: settings.workspaceRoot,
    });
    const workspaceRoot = getWorkspaceRoot();
    
    // Pass feedback to analysis service for feedback-aware prompt generation
    const response = await currentService.analyzeScreenshot(lastImage, lastFeedback, workspaceRoot);
    
    isProcessing = false;

    if (response.success && response.data) {
      logger.info('main', 'Retry successful', { 
        feedback: lastFeedback,
        confidence: response.data.confidence,
        provider: response.metadata.provider
      });
      
      // Reset feedback after successful retry (user can provide new feedback)
      lastFeedback = null;
      
      mainWindow?.webContents.send("analysis:result", response);
    } else {
      logger.warn('main', 'Retry failed', {
        feedback: lastFeedback,
        code: response.error?.code,
        retryable: response.error?.retryable,
      });
      mainWindow?.webContents.send("analysis:error", {
        code: response.error?.code || 'UNKNOWN_ERROR',
        message: getErrorMessage(response.error?.message) || 'Analysis failed',
        retryable: response.error?.retryable ?? false,
        metadata: response.metadata,
      });
    }
  } catch (err) {
    isProcessing = false;
    logger.error('main', 'Retry error', err instanceof Error ? err : undefined, {
      feedback: lastFeedback
    });
    const errorResponse = mapProviderError(err, 'unknown');
    mainWindow?.webContents.send("analysis:error", {
      code: errorResponse.error?.code || 'UNKNOWN_ERROR',
      message: getErrorMessage(errorResponse.error?.message) || 'Retry failed',
      retryable: errorResponse.error?.retryable ?? true,
    });
  }
});

// Feedback handler
ipcMain.handle("feedback:submit", async (_event, payload: { positive: boolean }) => {
  const feedback = payload.positive ? 'positive' : 'negative';
  lastFeedback = feedback;
  
  logger.info('main', 'Feedback received', { 
    feedback,
    hasImage: !!lastImage,
    canRetry: !!lastImage && !isProcessing
  });
  
  // Log feedback for analytics
  logger.logAIRequest('feedback', 'user-feedback', 0);
  
  return { success: true };
});

ipcMain.handle(
  "file:saveText",
  async (
    event,
    params: {
      content: string;
      defaultFileName?: string;
      filters?: Array<{ name: string; extensions: string[] }>;
    },
  ) => {
    try {
      if (!params?.content) {
        return { success: false, error: 'No content to save' };
      }

      const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? undefined;
      const defaultPath = params.defaultFileName
        ? path.join(app.getPath('documents'), params.defaultFileName)
        : undefined;

      const saveResult = await dialog.showSaveDialog(ownerWindow, {
        title: 'Export File',
        defaultPath,
        filters: params.filters,
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, cancelled: true };
      }

      await fs.promises.writeFile(saveResult.filePath, params.content, 'utf8');
      return { success: true, filePath: saveResult.filePath };
    } catch (error) {
      logger.error('main', 'Failed to save exported file', error instanceof Error ? error : undefined);
      return { success: false, error: getErrorMessage(error) };
    }
  },
);
