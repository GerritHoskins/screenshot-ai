import { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeImage } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { captureScreenSelection } from "./capture";
import { getAnalysisService } from "./analysis";
import { getLogger } from "@logging";
import { mapCaptureError, mapProviderError } from "@errors";
import { registerSettingsHandlers } from "./settings";
import { getApiKey } from "@security/keychain";
import * as fs from "fs";
import { hardenWindow, isTrustedIpcSender, validateDesktopIpcArgs, SECURE_WEB_PREFERENCES } from "@security/ipc-hardening";
import type { AIResponse, ScreenshotAnalysis } from "@shared-types/ai-response";
import { shieldCapture } from "./shield";
import { initAgentServer, stopAgentServer, McpToolError, AGENT_BUSY_MESSAGE, type AgentBridge } from "./mcp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rendererDirectory = path.join(__dirname, "../renderer");
let mainWindow: BrowserWindow | null = null;
let lastImage: Buffer | null = null;
let isProcessing = false;
let lastFeedback: 'positive' | 'negative' | null = null;
type FeedbackReason = 'too-verbose' | 'incorrect' | 'missing-context' | 'wrong-format' | 'other';
let lastFeedbackDetails: { reason?: FeedbackReason; comment?: string } | null = null;
/** Controller for the in-flight analysis request; null while idle or while selecting a region. */
let analysisController: AbortController | null = null;

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

/**
 * Load settings from file (helper function).
 * Normalizes both old and new schema formats to a consistent interface.
 */
function loadSettingsFromFile(): { provider?: 'openai' | 'anthropic'; model?: string; workspaceContextEnabled?: boolean; workspaceRoot?: string } {
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

      return { provider: provider === 'anthropic' ? 'anthropic' : 'openai', model, workspaceContextEnabled, workspaceRoot };
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

}

logger.info('main', 'Application starting', { platform: process.platform });

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: path.join(__dirname, "../preload/index.js")
    }
  });

  hardenWindow(mainWindow, rendererDirectory);

  // In development, load from vite dev server; in production, load from file
  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    const indexPath = path.join(__dirname, "../renderer/index.html");
    await mainWindow.loadFile(indexPath);
  }
}

/**
 * Analyze an image with the current settings. Owns isProcessing/analysisController
 * for the analysis phase. If the run is cancelled (or superseded), its late result
 * is discarded: the cancel handler has already reported CANCELLED and reset state.
 */
async function runAnalysis(image: Buffer, feedback: 'positive' | 'negative' | null, externalSignal?: AbortSignal): Promise<AIResponse<ScreenshotAnalysis> | null> {
  const controller = new AbortController();
  analysisController = controller;
  // An agent that disconnects cancels its analysis; reset the UI like the Cancel button does.
  externalSignal?.addEventListener('abort', () => {
    if (analysisController !== controller) return;
    [analysisController, isProcessing] = [null, false];
    controller.abort();
    mainWindow?.webContents.send("analysis:error", { code: 'CANCELLED', message: 'The agent cancelled the analysis.', retryable: true });
  }, { once: true });
  isProcessing = true;
  const isCurrent = () => analysisController === controller && !controller.signal.aborted;

  try {
    // Get fresh service instance to pick up any settings changes
    const settings = loadSettingsFromFile();
    const currentService = getAnalysisService({
      provider: settings.provider || 'openai',
      model: settings.model,
      workspaceContextEnabled: settings.workspaceContextEnabled === true,
      workspaceRoot: settings.workspaceRoot,
    });
    mainWindow?.webContents.send("analysis:processing", {
      stage: "analyzing",
      provider: currentService.providerType,
      model: currentService.model,
    });

    const workspaceRoot = getWorkspaceRoot();
    const response = await currentService.analyzeScreenshot(image, feedback, workspaceRoot, controller.signal, (sent) => {
      if (isCurrent()) mainWindow?.webContents.send("analysis:processing", { stage: "sending", sent });
    });

    if (!isCurrent()) {
      logger.debug('main', 'Discarding result of cancelled analysis');
      return null;
    }
    analysisController = null;
    isProcessing = false;

    if (response.success && response.data) {
      logger.logAIResponse(
        response.metadata.provider,
        true,
        response.metadata.latencyMs,
        {
          prompt: response.metadata.promptTokens,
          completion: response.metadata.completionTokens,
        }
      );
      if (feedback) {
        logger.info('main', 'Retry successful', { feedback, confidence: response.data.confidence });
        // Reset feedback after successful retry (user can provide new feedback)
        lastFeedback = null;
        lastFeedbackDetails = null;
      }
      mainWindow?.webContents.send("analysis:result", { ...response, sent: currentService.lastSent });
      return response;
    }

    logger.error('main', 'AI analysis failed', undefined, {
      code: response.error?.code,
      message: response.error?.message,
      retryable: response.error?.retryable,
      feedback,
    });
    const code = response.error?.details?.reason === 'privacy' ? 'PRIVACY_BLOCKED' : (response.error?.code || 'UNKNOWN_ERROR');
    mainWindow?.webContents.send("analysis:error", {
      code,
      message: getErrorMessage(response.error?.message) || 'Analysis failed',
      // A cancelled request can always be run again.
      retryable: code === 'CANCELLED' ? true : (response.error?.retryable ?? false),
      metadata: response.metadata,
      // Null when the request never left the machine (no key, privacy block).
      sent: currentService.lastSent,
    });
    return response;
  } catch (err) {
    if (!isCurrent()) return null;
    analysisController = null;
    isProcessing = false;
    logger.error('main', 'Analysis error', err instanceof Error ? err : undefined, { feedback });
    const errorResponse = mapProviderError(err, 'unknown');
    mainWindow?.webContents.send("analysis:error", {
      code: errorResponse.error?.code || 'UNKNOWN_ERROR',
      message: getErrorMessage(errorResponse.error?.message) || 'Analysis failed',
      retryable: errorResponse.error?.retryable ?? true,
      // The service catches provider failures itself, so reaching this path means nothing was sent.
      sent: null,
    });
    return errorResponse;
  } finally {
    if (analysisController === controller) {
      analysisController = null;
      isProcessing = false;
    }
  }
}

/** MCP bridge: agents share the busy flag, UI and Cancel button with normal captures (approval lives in ./mcp). */
const agentBridge: AgentBridge = {
  getMainWindow: () => mainWindow,
  async captureForAgent() {
    if (isProcessing) throw new McpToolError(AGENT_BUSY_MESSAGE);
    isProcessing = true;
    try { return await captureScreenSelection(); } finally { isProcessing = false; }
  },
  async analyzeForAgent(image, signal) {
    if (isProcessing) throw new McpToolError(AGENT_BUSY_MESSAGE);
    [lastImage, lastFeedback, lastFeedbackDetails] = [image, null, null];
    mainWindow?.webContents.send("analysis:screenshot", { dataUrl: nativeImage.createFromBuffer(image).toDataURL() });
    return runAnalysis(image, null, signal);
  },
};

async function runCapture() {
  if (isProcessing) {
    logger.debug('main', 'Analysis already in progress, skipping');
    return;
  }

  // Claimed before the key lookup's await, so a double press can't open two overlays.
  isProcessing = true;
  // Every entry point (button, C, global hotkey) checks the key before the user selects a region.
  const provider = loadSettingsFromFile().provider === 'anthropic' ? 'anthropic' : 'openai';
  if (!(await getApiKey(provider).catch(() => null))) {
    isProcessing = false;
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    mainWindow?.webContents.send("analysis:error", {
      code: 'AUTH_ERROR', retryable: false, sent: null, metadata: { provider },
      message: `No API key is stored for ${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}. Add one in Settings > API Keys.`,
    });
    return;
  }
  try {
    logger.info('main', 'Starting capture');
    mainWindow?.webContents.send("analysis:processing", { stage: "capture" });
    
    let image: Buffer | null;
    try {
      image = await captureScreenSelection();
      if (image) image = await shieldCapture(image, { parent: mainWindow }); // null = user cancelled the review
    } catch (captureError) {
      isProcessing = false;
      // A failed capture supersedes the previous image: Retry should capture again.
      lastImage = null;
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
    lastFeedback = null; // Reset feedback on new capture
    lastFeedbackDetails = null;
    logger.info('main', 'Starting AI analysis');
    await runAnalysis(image, null);
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

/** Start a capture from any entry point and report an unexpected failure to the window. */
function startCapture(source: 'hotkey' | 'button' | 'retry') {
  runCapture().catch((err) => {
    isProcessing = false;
    logger.error('main', `Capture failed from ${source}`, err instanceof Error ? err : undefined);
    mainWindow?.webContents.send("analysis:error", { code: 'CAPTURE_ERROR', message: err?.message ?? "Capture failed", retryable: true });
  });
}

// Reduce Electron/DXGI console noise (some warnings may still appear and are harmless).
app.commandLine.appendSwitch('disable-logging');
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');

app.whenReady().then(async () => {
  // Register settings handlers
  registerSettingsHandlers(rendererDirectory);
  

  // Log user data + preload path to help diagnose missing logs/preload issues
  const userDataPath = app.getPath('userData');
  const preloadPath = path.join(__dirname, "../preload/index.js");
  logger.info('main', 'Startup paths', {
    userDataPath,
    preloadPath,
    preloadExists: fs.existsSync(preloadPath),
  });
  
  await createMainWindow();

  globalShortcut.register("CommandOrControl+Shift+S", () => startCapture('hotkey'));

  await initAgentServer(agentBridge);
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  void stopAgentServer();
});

ipcMain.on("capture:start", async (event, ...args) => {
  if (!mainWindow || !isTrustedIpcSender(event, rendererDirectory, undefined, mainWindow) || !validateDesktopIpcArgs('capture:start', args)) return;
  logger.info('main', 'Capture button clicked');
  if (!isProcessing) {
    logger.info('main', 'Starting capture from button');
    startCapture('button');
  } else {
    logger.debug('main', 'Capture button clicked but already processing');
  }
});

ipcMain.on("analysis:retry", async (event, ...args) => {
  if (!mainWindow || !isTrustedIpcSender(event, rendererDirectory, undefined, mainWindow) || !validateDesktopIpcArgs('analysis:retry', args)) return;
  if (isProcessing) {
    logger.debug('main', 'Retry skipped, already processing', { hasImage: !!lastImage });
    return;
  }

  if (!lastImage) {
    // Nothing to re-analyze (e.g. the capture itself failed): start a new capture.
    logger.info('main', 'Retry without a previous image, starting a new capture');
    startCapture('retry');
    return;
  }

  logger.info('main', 'Retrying analysis', {
    feedback: lastFeedback,
    feedbackReason: lastFeedbackDetails?.reason,
    hasImage: true,
    imageSize: lastImage.length,
  });
  await runAnalysis(lastImage, lastFeedback);
});

ipcMain.on("analysis:cancel", (event, ...args) => {
  if (!mainWindow || !isTrustedIpcSender(event, rendererDirectory, undefined, mainWindow) || !validateDesktopIpcArgs('analysis:cancel', args)) return;
  const controller = analysisController;
  if (!controller) {
    // Idle, or a capture/region selection is active: nothing to cancel.
    logger.debug('main', 'Cancel ignored, no analysis in flight', { isProcessing });
    return;
  }
  logger.info('main', 'Cancelling analysis');
  analysisController = null;
  isProcessing = false;
  controller.abort();
  mainWindow.webContents.send("analysis:error", {
    code: 'CANCELLED',
    message: 'Analysis cancelled.',
    retryable: true,
  });
});

// Feedback handler
ipcMain.handle("feedback:submit", async (_event, ...args: unknown[]) => {
  if (!mainWindow || !isTrustedIpcSender(_event, rendererDirectory, undefined, mainWindow) || !validateDesktopIpcArgs('feedback:submit', args)) throw new Error('Invalid or untrusted IPC request');
  const payload = args[0] as { positive: boolean; reason?: FeedbackReason; comment?: string };
  const feedback = payload.positive ? 'positive' : 'negative';
  const comment = payload.comment?.trim() || undefined;
  lastFeedback = feedback;
  lastFeedbackDetails = payload.reason || comment ? { reason: payload.reason, comment } : null;

  // Never log the comment text itself.
  logger.info('main', 'Feedback received', {
    feedback,
    reason: payload.reason,
    hasComment: !!comment,
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
      if (!mainWindow || !isTrustedIpcSender(event, rendererDirectory, undefined, mainWindow) || !validateDesktopIpcArgs('file:saveText', [params])) return { success: false, error: 'Invalid or untrusted IPC request' };
      if (!params?.content) {
        return { success: false, error: 'No content to save' };
      }

      const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? undefined;
      const defaultPath = params.defaultFileName
        ? path.join(app.getPath('documents'), params.defaultFileName)
        : undefined;

      const saveOptions = {
        title: 'Export File',
        defaultPath,
        filters: params.filters,
      };
      const saveResult = ownerWindow ? await dialog.showSaveDialog(ownerWindow, saveOptions) : await dialog.showSaveDialog(saveOptions);

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
