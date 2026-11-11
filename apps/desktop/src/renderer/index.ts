import type { AIResponse, ScreenshotAnalysis } from "@shared-types/ai-response";
import {
  buildReportMarkdown,
  confidenceLevel,
  describeError,
  describeShield,
  type ShieldSummary,
  escapeHtml,
  extractAnswer,
  formatAnswer,
  formatAnswerParts,
  formatInline,
  formatIssueText,
  formatSeconds,
  formatTokens,
  icon,
  normalizeConfidence,
  normalizeIssue,
  normalizeNote,
  providerLabel,
  renderCodeBlock,
  resolveRetryAfter,
  summaryToText,
  type ErrorAction,
  type NormalizedIssue,
} from "./utils/formatting";

// ============================================================================
// API shape
// ============================================================================

type Provider = 'openai' | 'anthropic';
type FeedbackReason = 'too-verbose' | 'incorrect' | 'missing-context' | 'wrong-format' | 'other';
interface FeedbackDetails { reason?: FeedbackReason; comment?: string }
interface ProcessingPayload { stage: string; provider?: Provider; model?: string; screenshotDataUrl?: string; sent?: SentSummary }
/** What a request sent besides the image; null means nothing left the machine. */
interface SentSummary { contextFiles: number; files?: string[]; customPrompt: boolean }
interface ErrorPayload { code: string; message: string; retryable?: boolean; retryAfterSeconds?: number; metadata?: unknown; sent?: SentSummary | null }
type ResultPayload = AIResponse<ScreenshotAnalysis> & { sent?: SentSummary | null };
interface SaveResult { success: boolean; cancelled?: boolean; filePath?: string; error?: string }

/**
 * The renderer's view of window.api. W1 adds analysis.cancel(), provider/model
 * on the processing payload and feedback.submit(positive, details); until
 * global.d.ts carries them, this local shape is cast onto window.api.
 */
interface RendererApi {
  capture: { start(): void };
  files: {
    saveTextFile(params: { content: string; defaultFileName?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<SaveResult>;
  };
  analysis: {
    onProcessing(callback: (payload: ProcessingPayload) => void): void;
    onScreenshot(callback: (payload: { dataUrl: string; shield?: unknown }) => void): void;
    onResult(callback: (response: ResultPayload) => void): void;
    onError(callback: (payload: ErrorPayload) => void): void;
    retry(): void;
    cancel?(): void;
    submitFeedback?(positive: boolean): Promise<unknown>;
  };
  feedback?: { submit(positive: boolean, details?: FeedbackDetails): Promise<unknown> };
  settings: {
    get(key?: string): Promise<unknown>;
    getApiKeyStatus(provider: Provider): Promise<{ hasKey: boolean }>;
  };
}

let api: RendererApi;

// ============================================================================
// Elements
// ============================================================================

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const TABS = ['summary', 'issues', 'notes', 'raw'] as const;
type TabName = typeof TABS[number];

let captureBtn: HTMLButtonElement;
let statusIcon: HTMLElement;
let statusText: HTMLElement;
let runAgainBtn: HTMLButtonElement;
let exportBtn: HTMLButtonElement;
let statusDetail: HTMLElement | null;
let cancelBtn: HTMLButtonElement | null;
let confidenceBadge: HTMLElement | null;
let exportMenu: HTMLElement | null;
let feedbackButtons: HTMLElement | null;
let feedbackPositiveBtn: HTMLButtonElement | null;
let feedbackNegativeBtn: HTMLButtonElement | null;
let feedbackPopover: HTMLElement | null;
let feedbackSubmitBtn: HTMLButtonElement | null;
let feedbackOther: HTMLTextAreaElement | null;
let screenshotPreview: HTMLButtonElement | null;
let screenshotMetadata: HTMLElement | null;
let welcome: HTMLElement | null;
let errorPanel: HTMLElement | null;
let results: HTMLElement | null;
let toastEl: HTMLElement | null;
let screenshotViewer: HTMLElement | null;
let viewerImage: HTMLImageElement | null;
let viewerContent: HTMLElement | null;
let viewerZoomLevel: HTMLElement | null;
let previewEmptyNodes: Node[] = [];

function initializeElements(): boolean {
  captureBtn = byId<HTMLButtonElement>('capture-btn')!;
  statusIcon = byId('status-icon')!;
  statusText = byId('status-text')!;
  runAgainBtn = byId<HTMLButtonElement>('run-again-btn')!;
  exportBtn = byId<HTMLButtonElement>('export-btn')!;
  statusDetail = byId('status-detail');
  cancelBtn = byId<HTMLButtonElement>('cancel-btn');
  confidenceBadge = byId('confidence-badge');
  exportMenu = byId('export-menu-dropdown');
  feedbackButtons = byId('feedback-buttons');
  feedbackPositiveBtn = byId<HTMLButtonElement>('feedback-positive');
  feedbackNegativeBtn = byId<HTMLButtonElement>('feedback-negative');
  feedbackPopover = byId('feedback-popover');
  feedbackSubmitBtn = byId<HTMLButtonElement>('feedback-submit');
  feedbackOther = byId<HTMLTextAreaElement>('feedback-other');
  screenshotPreview = byId<HTMLButtonElement>('screenshot-preview');
  screenshotMetadata = byId('screenshot-metadata');
  welcome = byId('welcome');
  errorPanel = byId('error-panel');
  results = byId('results');
  toastEl = byId('toast');
  screenshotViewer = byId('screenshot-viewer');
  viewerImage = byId<HTMLImageElement>('viewer-image');
  viewerContent = byId('viewer-content');
  viewerZoomLevel = byId('viewer-zoom-level');
  previewEmptyNodes = screenshotPreview ? Array.from(screenshotPreview.childNodes, node => node.cloneNode(true)) : [];

  if (!captureBtn || !statusIcon || !statusText || !runAgainBtn || !exportBtn) {
    console.error('Main window markup is missing required elements');
    return false;
  }
  if (!window.api) {
    console.error('API not available - preload script may not have loaded');
    setStatus('error', 'Capture unavailable (preload not loaded)');
    return false;
  }
  api = window.api as unknown as RendererApi;
  return true;
}

// ============================================================================
// State
// ============================================================================

type Phase = 'idle' | 'capturing' | 'analyzing' | 'success' | 'error';
interface RunMeta {
  /** sending while the request runs; not-sent when it stopped before leaving the machine. */
  sendState?: 'sending' | 'sent' | 'not-sent';
  sent?: SentSummary | null;
  /** What the local secret check did to this capture (absent for agent captures). */
  shield?: ShieldSummary;
  provider?: string;
  model?: string;
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  width?: number;
  height?: number;
  capturedAt?: number;
}

let phase: Phase = 'idle';
let lastResult: ResultPayload | null = null;
let lastResultView: { screenshot: string | null; meta: RunMeta } | null = null;
let currentScreenshot: string | null = null;
let runMeta: RunMeta = {};
let settingsProvider: Provider | undefined;
let settingsModel: string | undefined;
let elapsedTimer: number | undefined;
let retryTimer: number | undefined;
/** Epoch ms before which a retry would be refused (rate limit). Both retry controls honor it. */
let retryReadyAt = 0;
/** True when the selected provider has no stored key; Capture then explains instead of capturing. */
let keyMissing = false;
let toastTimer: number | undefined;
let feedbackSubmitted: 'positive' | 'negative' | null = null;
let issues: NormalizedIssue[] = [];
let visibleIssues: NormalizedIssue[] = [];
let filterSeverity: 'all' | 'high' | 'medium' | 'low' = 'all';
let sortMode: 'severity' | 'type' = 'severity';
let allExpanded = false;
let popoverReturnFocus: HTMLElement | null = null;
let viewerReturnFocus: HTMLElement | null = null;

const SCREENSHOT_DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);

// ============================================================================
// Status bar
// ============================================================================

function setStatus(state: 'idle' | 'working' | 'success' | 'error', text: string, detail = '') {
  statusIcon.className = `status-dot is-${state}`;
  statusText.textContent = text;
  if (statusDetail) statusDetail.textContent = detail;
}

const joinDetail = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(' · ');

function startElapsed(model?: string) {
  stopElapsed();
  const started = performance.now();
  // The status text already names the provider; the detail adds the model and a live timer.
  const tick = () => { if (statusDetail) statusDetail.textContent = joinDetail(model, formatSeconds(performance.now() - started)); };
  tick();
  elapsedTimer = window.setInterval(tick, 100);
}

function stopElapsed() {
  if (elapsedTimer !== undefined) window.clearInterval(elapsedTimer);
  elapsedTimer = undefined;
}

const retryBlocked = () => Date.now() < retryReadyAt;

function updateControls() {
  const busy = phase === 'capturing' || phase === 'analyzing';
  const showingResult = phase === 'success' && !!lastResult;
  // One capture at a time: a second capture would race the request in flight.
  captureBtn.disabled = busy;
  // In the error view the panel owns the retry action, so the status-bar duplicate steps aside.
  if (phase === 'error' && document.activeElement === runAgainBtn) byId('error-title')?.focus();
  runAgainBtn.hidden = phase === 'error';
  runAgainBtn.disabled = busy || retryBlocked() || !(currentScreenshot || lastResult);
  // Say where Run again sends the image: it's the one action that leaves the machine without a new capture.
  const sendTarget = `Sends the same image again to ${providerLabel(settingsProvider ?? runMeta.provider) || 'your AI provider'}.`;
  runAgainBtn.title = sendTarget;
  const runAgainDesc = byId('run-again-desc');
  if (runAgainDesc) runAgainDesc.textContent = sendTarget;
  exportBtn.disabled = !showingResult;
  if (!showingResult) {
    closeExportMenu(false);
    closeFeedbackPopover(false);
  }
  if (feedbackButtons) feedbackButtons.hidden = !showingResult;
  if (cancelBtn) {
    const hide = phase !== 'analyzing';
    if (hide && document.activeElement === cancelBtn) (runAgainBtn.disabled ? captureBtn : runAgainBtn).focus();
    cancelBtn.hidden = hide;
  }
}

function updateConfidence(value: unknown) {
  if (!confidenceBadge) return;
  const confidence = normalizeConfidence(value);
  if (confidence === null) {
    confidenceBadge.hidden = true;
    return;
  }
  // The wording carries the caveat, so it doesn't depend on a hover-only tooltip.
  confidenceBadge.textContent = `Self-rated confidence ${Math.round(confidence * 100)}%`;
  confidenceBadge.title = 'How sure the model said it was. It is the model’s own estimate, not a check of the answer.';
  confidenceBadge.dataset.level = confidenceLevel(confidence);
  confidenceBadge.hidden = false;
}

function showToast(message: string) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { if (toastEl) toastEl.hidden = true; }, 3000);
}

async function copyText(value: string, success: string) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(success);
  } catch (error) {
    console.error('Failed to copy:', error);
    showToast("Couldn't copy to the clipboard");
  }
}

// ============================================================================
// Screenshot preview and run metadata
// ============================================================================

function setPreview(dataUrl: string | null) {
  if (!screenshotPreview) return;
  if (!dataUrl) {
    screenshotPreview.replaceChildren(...previewEmptyNodes.map(node => node.cloneNode(true)));
    screenshotPreview.classList.add('is-empty');
    screenshotPreview.disabled = true;
    return;
  }
  const image = document.createElement('img');
  image.alt = 'Captured screenshot';
  image.addEventListener('load', () => {
    if (currentScreenshot !== dataUrl) return;
    runMeta.width = image.naturalWidth;
    runMeta.height = image.naturalHeight;
    renderRunMeta();
  }, { once: true });
  image.src = dataUrl;
  screenshotPreview.replaceChildren(image);
  screenshotPreview.classList.remove('is-empty');
  screenshotPreview.disabled = false;
}

const SHIELD_STATUSES = ['off', 'clean', 'covered', 'sent-uncovered', 'unchecked'];

function readShieldSummary(value: unknown): ShieldSummary | undefined {
  const s = value as Partial<ShieldSummary> | null | undefined;
  if (!s || !SHIELD_STATUSES.includes(String(s.status))) return undefined;
  const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);
  return { status: s.status as ShieldSummary['status'], found: count(s.found), covered: count(s.covered) };
}

function receiveScreenshot(dataUrl: string, shield?: unknown) {
  if (!SCREENSHOT_DATA_URL.test(dataUrl)) return;
  currentScreenshot = dataUrl;
  runMeta = { capturedAt: Date.now(), shield: readShieldSummary(shield) };
  setPreview(dataUrl);
  renderRunMeta();
  updateControls();
}

/** "Image + 12 context files + custom prompt": everything the provider received. */
function describeSent(sent: SentSummary): string {
  const parts = ['Image'];
  if (sent.contextFiles > 0) parts.push(`${sent.contextFiles} context ${sent.contextFiles === 1 ? 'file' : 'files'}`);
  if (sent.customPrompt) parts.push('custom prompt');
  return parts.join(' + ');
}

/** The Included summary, expandable to the exact context files so the user can audit what left the machine. */
function renderSentDetails(sent: SentSummary, summaryText: string): Node {
  const files = sent.files ?? [];
  if (!files.length) return document.createTextNode(summaryText);
  const details = document.createElement('details');
  details.className = 'sent-files';
  const summary = document.createElement('summary');
  summary.textContent = summaryText;
  const list = document.createElement('ul');
  list.setAttribute('aria-label', 'Context files sent');
  for (const file of files) {
    const item = document.createElement('li');
    item.className = 'mono';
    item.textContent = file;
    item.title = file;
    list.append(item);
  }
  details.append(summary, list);
  return details;
}

function renderRunMeta() {
  if (!screenshotMetadata) return;
  const meta = runMeta;
  const model = meta.model && meta.model !== 'unknown' ? meta.model : undefined;
  const hasTokens = typeof meta.promptTokens === 'number' && typeof meta.completionTokens === 'number' && meta.promptTokens + meta.completionTokens > 0;
  const sendLabel = meta.sendState === 'sending' ? 'Sending to' : meta.sendState === 'not-sent' ? 'Not sent to' : 'Sent to';
  const rows: Array<[string, string | undefined, boolean]> = [
    [sendLabel, providerLabel(meta.provider) || undefined, false],
    ['Included', (meta.sendState === 'sent' || meta.sendState === 'sending') && meta.sent ? describeSent(meta.sent) : undefined, false],
    ['Secret check', meta.shield ? describeShield(meta.shield) : undefined, false],
    ['Model', model, true],
    ['Duration', typeof meta.durationMs === 'number' && meta.durationMs > 0 ? formatSeconds(meta.durationMs) : undefined, true],
    ['Tokens', hasTokens ? formatTokens(meta.promptTokens!, meta.completionTokens!, 'en-US') : undefined, true],
    ['Image', meta.width && meta.height ? `${meta.width} × ${meta.height}` : undefined, true],
    ['Captured', meta.capturedAt ? new Date(meta.capturedAt).toLocaleTimeString() : undefined, false],
  ];
  screenshotMetadata.replaceChildren(...rows.filter(([, value]) => value).map(([label, value, mono]) => {
    const row = document.createElement('div');
    row.className = 'run-meta-row';
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    if (mono) description.className = 'mono';
    description.textContent = value!;
    if (label === 'Included' && meta.sent) description.replaceChildren(renderSentDetails(meta.sent, value!));
    row.append(term, description);
    return row;
  }));
}

// ============================================================================
// Views: welcome, error, results
// ============================================================================

function showView(view: 'welcome' | 'error' | 'results') {
  if (welcome) welcome.hidden = view !== 'welcome';
  if (errorPanel) errorPanel.hidden = view !== 'error';
  if (results) results.hidden = view !== 'results';
}

function syncShortcutLabels() {
  const label = isMac ? '⌘⇧S' : 'Ctrl+Shift+S';
  const capture = byId('capture-shortcut');
  if (capture) capture.textContent = label;
  const runAgain = byId('run-again-shortcut');
  if (runAgain) runAgain.textContent = isMac ? '⌘↵' : 'Ctrl+Enter';
  document.querySelectorAll<HTMLElement>('kbd[data-shortcut]').forEach(kbd => { kbd.textContent = label; });
}

async function loadWelcome() {
  syncShortcutLabels();
  try {
    const [provider, model] = await Promise.all([api.settings.get('provider'), api.settings.get('model')]);
    settingsProvider = provider === 'openai' || provider === 'anthropic' ? provider : undefined;
    settingsModel = typeof model === 'string' && model ? model : undefined;
  } catch (error) {
    console.error('Failed to read provider settings:', error);
  }
  // Settings default to OpenAI, so an unreadable or unset provider still gets a key check.
  const provider: Provider = settingsProvider ?? 'openai';
  const label = providerLabel(provider);
  const welcomeProvider = byId('welcome-provider');
  if (welcomeProvider) welcomeProvider.textContent = settingsModel ? `${label} (${settingsModel})` : label;
  try {
    const status = await api.settings.getApiKeyStatus(provider);
    keyMissing = status?.hasKey === false;
  } catch (error) {
    console.error('Failed to read API key status:', error);
  }
  try {
    const contextOn = (await api.settings.get('workspaceContextEnabled')) === true;
    const context = byId('welcome-context');
    if (context) context.hidden = !contextOn;
    // Persistent, so the context state is visible on every screen, not only before the first capture.
    const chip = byId('context-chip');
    if (chip) chip.hidden = !contextOn;
    // The secret shield is on unless explicitly turned off (main/shield.ts readShieldSettings).
    const shield = await api.settings.get('shield') as { enabled?: unknown } | undefined;
    const shieldOff = shield?.enabled === false;
    const on = byId('welcome-shield-on');
    const off = byId('welcome-shield-off');
    if (on) on.hidden = shieldOff;
    if (off) off.hidden = !shieldOff;
  } catch (error) {
    console.error('Failed to read context setting:', error);
  }
  const keyProvider = byId('welcome-key-provider');
  if (keyProvider) keyProvider.textContent = label;
  const warning = byId('welcome-key-warning');
  if (warning) warning.hidden = !keyMissing;
  // Persistent on every screen, so a result view never hides that the next capture can't be sent.
  const keyChip = byId('key-chip');
  if (keyChip) keyChip.hidden = !keyMissing;
  if (phase === 'idle' && welcome && !welcome.hidden) setStatus('idle', keyMissing ? 'Not ready' : 'Ready');
  updateControls();
}

/** With no key stored, Capture explains what is missing instead of opening the overlay. */
function showMissingKey() {
  const label = providerLabel(settingsProvider ?? 'openai');
  showError({ code: 'AUTH_ERROR', message: `No API key is stored for ${label}. Add one in Settings > API Keys.`, retryable: false, sent: null });
}

function clearRetryCountdown() {
  if (retryTimer !== undefined) window.clearInterval(retryTimer);
  retryTimer = undefined;
  retryReadyAt = 0;
}

function runErrorAction(action: ErrorAction) {
  if (action.kind === 'retry') {
    if (!retryBlocked()) api.analysis.retry();
  } else if (action.kind === 'capture') {
    startCapture();
  }
}

/**
 * Rate-limit countdown. The button stays focusable (aria-disabled, not disabled) so keyboard and
 * screen-reader users keep their place; the live status line announces only start and end.
 */
function startRetryCountdown(button: HTMLButtonElement, seconds: number) {
  retryReadyAt = Date.now() + seconds * 1000;
  const render = () => {
    const remaining = Math.max(0, Math.ceil((retryReadyAt - Date.now()) / 1000));
    button.setAttribute('aria-disabled', String(remaining > 0));
    button.textContent = remaining > 0 ? `Run again in ${remaining}s` : 'Run again';
    return remaining;
  };
  render();
  // Announced once; the button carries the live count, so this line never goes stale.
  setStatus('error', `Rate limited · wait ${seconds}s`);
  retryTimer = window.setInterval(() => {
    if (render() > 0) return;
    window.clearInterval(retryTimer);
    retryTimer = undefined;
    retryReadyAt = 0;
    setStatus('error', 'Ready to run again');
    updateControls();
  }, 1000);
}

function showError(payload: ErrorPayload) {
  const code = String(payload?.code ?? 'UNKNOWN_ERROR');
  const message = String(payload?.message ?? '');
  if (code === 'CANCELLED') {
    restorePreviousView('Cancelled');
    return;
  }
  const metadata = (payload?.metadata ?? {}) as { provider?: string; model?: string };
  const notSent = payload?.sent === null;
  // A request that never left names the provider it was about to use, not the previous run's.
  const provider = notSent ? (metadata.provider ?? settingsProvider) : (runMeta.provider ?? metadata.provider ?? settingsProvider);
  const model = notSent ? (metadata.model ?? settingsModel) : (runMeta.model ?? metadata.model ?? settingsModel);
  const wasAnalyzing = phase === 'analyzing';
  const copy = describeError(code, message, { provider, model, retryAfterSeconds: resolveRetryAfter(payload ?? {}) })!;

  stopElapsed();
  clearRetryCountdown();
  phase = 'error';
  if (notSent && wasAnalyzing) {
    // This capture stopped before sending: describe it, not the previous run.
    runMeta = { capturedAt: runMeta.capturedAt, width: runMeta.width, height: runMeta.height, shield: runMeta.shield, sendState: 'not-sent', sent: null, provider, model };
  } else if (!notSent && payload && 'sent' in payload) {
    runMeta.sendState = 'sent';
    runMeta.sent = payload.sent;
  } else if (runMeta.sendState === 'sending') {
    runMeta.sendState = 'sent';
  }
  // Blocked before any capture (no key): the side pane still describes the last result, so leave it.
  renderRunMeta();
  byId('error-title')!.textContent = copy.title;
  const body = byId('error-body');
  if (body) body.textContent = copy.body;
  const raw = byId('error-raw');
  if (raw) raw.textContent = message ? `${code}: ${message}` : code;
  const actions = byId('error-actions');
  actions?.replaceChildren(...copy.actions.map((action, index) => {
    const className = `btn ${index === 0 ? 'btn-primary' : 'btn-secondary'}`;
    if (action.kind === 'link') {
      const link = document.createElement('a');
      link.className = className;
      link.href = action.href;
      link.textContent = action.label;
      return link;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.action = action.kind;
    button.textContent = action.label;
    button.addEventListener('click', () => runErrorAction(action));
    return button;
  }) ?? []);
  // An error never costs the user their last good result.
  if (lastResult && lastResultView) {
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn btn-ghost';
    back.textContent = 'Back to last result';
    back.addEventListener('click', () => restorePreviousView('Showing the last result'));
    actions?.append(back);
  }
  showView('error');
  updateConfidence(null);
  // Terse: the focused panel title is what gets read out, so the status bar doesn't repeat it.
  setStatus('error', copy.status);
  const retryButton = actions?.querySelector<HTMLButtonElement>('[data-action="retry"]');
  if (retryButton && copy.retryAfterSeconds) startRetryCountdown(retryButton, copy.retryAfterSeconds);
  updateControls();
  // Move focus to the error so keyboard and screen-reader users land on it.
  const title = byId('error-title');
  if (title) {
    title.tabIndex = -1;
    title.focus();
  }
}

/** After a cancel: show the previous result if there is one, otherwise the welcome state. */
function restorePreviousView(status: string) {
  stopElapsed();
  if (lastResult && lastResultView) {
    currentScreenshot = lastResultView.screenshot;
    setPreview(currentScreenshot);
    runMeta = { ...lastResultView.meta };
    renderResult(lastResult, status);
    return;
  }
  // No earlier result: drop the abandoned capture too, so the welcome state isn't paired with it.
  phase = 'idle';
  currentScreenshot = null;
  runMeta = {};
  setPreview(null);
  renderRunMeta();
  showView('welcome');
  setStatus('idle', status);
  updateControls();
}

function onProcessing(payload: ProcessingPayload) {
  const stage = payload?.stage;
  if (stage === 'cancelled') {
    restorePreviousView('Ready');
    return;
  }
  if (stage === 'sending') {
    if (phase !== 'analyzing') return;
    runMeta.sent = payload.sent ?? null;
    renderRunMeta();
    return;
  }
  if (welcome) welcome.hidden = true;
  if (stage === 'capture') {
    phase = 'capturing';
    clearRetryCountdown();
    setStatus('working', 'Select a region…');
    updateControls();
    return;
  }
  if (stage !== 'analyzing') return;

  phase = 'analyzing';
  clearRetryCountdown();
  if (payload.screenshotDataUrl) receiveScreenshot(payload.screenshotDataUrl);
  const provider = payload.provider ?? settingsProvider;
  const model = payload.model ?? settingsModel;
  runMeta = { ...runMeta, sendState: 'sending', sent: undefined, provider, model, durationMs: undefined, promptTokens: undefined, completionTokens: undefined };
  renderRunMeta();
  resetResultPanels();
  showView('results');
  switchTab('summary');
  updateConfidence(null);
  resetFeedback();
  setStatus('working', `Analyzing with ${providerLabel(provider) || 'your AI provider'}`);
  startElapsed(model);
  if (cancelBtn) cancelBtn.disabled = false;
  updateControls();
}

function resetResultPanels() {
  // Every panel shows the same in-progress state, so no tab is a blank focus stop while analyzing.
  for (const tab of TABS) {
    const panel = byId(`content-${tab}`);
    if (panel) panel.innerHTML = '<div class="loading-state"><div class="spinner" aria-hidden="true"></div><p class="loading-text">Analyzing the selected region…</p></div>';
  }
  for (const badge of ['badge-issues', 'badge-notes']) {
    const element = byId(badge);
    if (element) element.textContent = '';
  }
}

function onResult(response: ResultPayload) {
  if (!response?.success || !response.data) {
    showError({
      code: response?.error?.code ?? 'UNKNOWN_ERROR',
      message: response?.error?.message ?? 'Analysis failed',
      retryAfterSeconds: response?.error?.retryAfterSeconds,
      metadata: response?.metadata,
      sent: response?.sent,
    });
    return;
  }
  renderResult(response);
}

function renderResult(response: ResultPayload, statusOverride?: string) {
  const data = response.data!;
  const meta = response.metadata;
  stopElapsed();
  clearRetryCountdown();
  phase = 'success';
  lastResult = response;
  runMeta = {
    ...runMeta,
    sendState: 'sent',
    sent: response.sent ?? runMeta.sent,
    provider: meta?.provider ?? runMeta.provider,
    model: meta?.model ?? runMeta.model,
    durationMs: meta?.latencyMs,
    promptTokens: meta?.promptTokens,
    completionTokens: meta?.completionTokens,
  };
  lastResultView = { screenshot: currentScreenshot, meta: { ...runMeta } };
  renderRunMeta();

  filterSeverity = 'all';
  allExpanded = false;
  renderSummaryTab(data);
  renderIssuesTab(data);
  renderNotesTab(data);
  renderRawTab(response);
  showView('results');
  switchTab(landingTab());
  updateConfidence(data.confidence);
  resetFeedback();
  // Provider, model and duration live in the side pane; the status line summarizes the outcome.
  const issueCount = data.issues?.length ?? 0;
  const outcome = issueCount ? `Analysis complete · ${issueCount} issue${issueCount === 1 ? '' : 's'}` : 'Analysis complete';
  setStatus(statusOverride ? 'idle' : 'success', statusOverride ?? outcome);
  updateControls();
}

// ============================================================================
// Tabs (APG tabs pattern with automatic activation)
// ============================================================================

function switchTab(name: TabName, focus = false) {
  for (const tab of TABS) {
    const selected = tab === name;
    const button = byId(`tab-${tab}`);
    if (button) {
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    }
    const panel = byId(`content-${tab}`);
    if (panel) panel.hidden = !selected;
  }
}

const TAB_PREF_KEY = 'screenshot-ai.result-tab';
const isTabName = (value: unknown): value is TabName => TABS.includes(value as TabName);

/** The result view the user last picked by hand; the next result opens on it when it has content. */
let preferredTab: TabName | null = (() => {
  try {
    const stored = localStorage.getItem(TAB_PREF_KEY);
    return isTabName(stored) ? stored : null;
  } catch {
    return null;
  }
})();

/** A user's explicit tab choice: switch and remember it. */
function chooseTab(name: TabName, focus = false) {
  preferredTab = name;
  try { localStorage.setItem(TAB_PREF_KEY, name); } catch { /* storage unavailable: in-memory only */ }
  switchTab(name, focus);
}

/** A panel has content unless it rendered only its empty state. */
function tabHasContent(name: TabName): boolean {
  const panel = byId(`content-${name}`);
  return !!panel && !!panel.firstElementChild && !panel.firstElementChild.classList.contains('empty-state');
}

/** Where a fresh result opens: the remembered tab if it has content, else Issues for high severity, else Answer. */
function landingTab(): TabName {
  if (preferredTab && tabHasContent(preferredTab)) return preferredTab;
  if (issues.some(issue => issue.severity === 'high')) return 'issues';
  return 'summary';
}

function setupTabs() {
  TABS.forEach(tab => byId(`tab-${tab}`)?.addEventListener('click', () => chooseTab(tab)));
  byId('tab-summary')?.closest('[role="tablist"]')?.addEventListener('keydown', event => {
    const keyEvent = event as KeyboardEvent;
    const current = TABS.findIndex(tab => byId(`tab-${tab}`) === document.activeElement);
    if (current < 0) return;
    const next = ({
      ArrowRight: (current + 1) % TABS.length,
      ArrowLeft: (current - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    } as Record<string, number>)[keyEvent.key];
    if (next === undefined) return;
    keyEvent.preventDefault();
    chooseTab(TABS[next], true);
  });
}

function setBadge(id: string, count: number) {
  const badge = byId(id);
  if (badge) badge.textContent = String(count);
}

function emptyState(iconName: string, title: string, text: string): string {
  return `<div class="empty-state"><div class="empty-state-icon">${icon(iconName)}</div><p class="empty-state-title">${escapeHtml(title)}</p><p class="empty-state-text">${escapeHtml(text)}</p></div>`;
}

// ============================================================================
// Answer tab
// ============================================================================

function renderSummaryTab(analysis: ScreenshotAnalysis) {
  const content = byId('content-summary');
  if (!content) return;
  const answer = extractAnswer(analysis.answer);
  const summary = summaryToText(analysis.summary);
  const primary = answer.response || summary;
  let html = '';

  if (primary) {
    const parts = formatAnswerParts(primary);
    html += '<div class="answer">';
    if (answer.question) html += `<div class="answer-question"><span class="answer-label">Question</span> ${escapeHtml(answer.question)}</div>`;
    if (parts.lead) html += `<p class="answer-lead">${parts.lead}</p>`;
    if (parts.body) html += `<div class="answer-body prose">${parts.body}</div>`;
    if (answer.response && answer.explanation) html += `<div class="prose">${wrapProse(formatAnswer(answer.explanation))}</div>`;
    if (answer.response && summary) html += `<h3 class="section-title">Summary</h3><div class="prose">${wrapProse(formatAnswer(summary))}</div>`;
    html += '</div>';
  }

  if (primary) html += '<div class="answer-actions"><button type="button" class="btn btn-secondary btn-sm" id="copy-answer">Copy answer</button></div>';

  const extracted = typeof analysis.text === 'string' ? analysis.text.trim() : '';
  if (extracted) html += `<section class="extracted"><h3 class="section-title">Extracted text</h3>${renderCodeBlock(extracted)}</section>`;

  const codeBlocks = (analysis.codeBlocks ?? []).filter(block => block && typeof block.code === 'string' && block.code.trim());
  if (codeBlocks.length) {
    html += `<section class="extracted"><h3 class="section-title">Code</h3>${codeBlocks.map(block => renderCodeBlock(block.code, /^[\w+#.-]+$/.test(block.language ?? '') ? block.language : '')).join('')}</section>`;
  }

  content.innerHTML = html || emptyState('file-text', 'No answer in this result', 'The model returned no answer, summary or extracted text. The JSON tab shows the full response.');
  addCodeCopyButtons(content);
}

/** Each code block gets its own Copy button, labelled by language when there is one. */
function addCodeCopyButtons(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('div.code-block').forEach(block => {
    if (block.querySelector('.code-copy')) return;
    const lang = block.querySelector('.code-lang')?.textContent?.trim();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-ghost btn-sm code-copy';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', lang ? `Copy ${lang} code` : 'Copy code');
    block.classList.add('has-copy');
    block.append(button);
  });
}

function setupSummaryTab() {
  byId('content-summary')?.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const codeCopy = target.closest('.code-copy');
    if (codeCopy) {
      const code = codeCopy.closest('.code-block')?.querySelector('pre')?.textContent ?? '';
      void copyText(code, 'Copied code');
      return;
    }
    if (target.closest('#copy-answer') && lastResult?.data) {
      const answer = extractAnswer(lastResult.data.answer);
      const text = answer.response || summaryToText(lastResult.data.summary);
      if (text) void copyText(text, 'Copied answer');
    }
  });
}

/** formatAnswer returns a lone paragraph as inline HTML; give it a <p> inside block containers. */
function wrapProse(html: string): string {
  return /^<(p|ul|ol|div)[\s>]/.test(html) ? html : `<p>${html}</p>`;
}

// ============================================================================
// Issues tab
// ============================================================================

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };
const SEVERITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
/** Below this many issues the severity filter chips add nothing; the summary line covers it. */
const ISSUE_FILTER_MIN = 5;

function renderIssuesTab(analysis: ScreenshotAnalysis) {
  issues = (analysis.issues ?? []).map(normalizeIssue);
  setBadge('badge-issues', issues.length);
  renderIssueList();
}

function renderIssueList(focusFilter?: string) {
  const content = byId('content-issues');
  if (!content) return;
  if (!issues.length) {
    content.innerHTML = emptyState('check-circle', 'No issues found', 'Nothing in this capture was flagged.');
    return;
  }
  const counts = {
    all: issues.length,
    high: issues.filter(issue => issue.severity === 'high').length,
    medium: issues.filter(issue => issue.severity === 'medium').length,
    low: issues.filter(issue => issue.severity === 'low').length,
  };
  const showChips = issues.length >= ISSUE_FILTER_MIN;
  if (filterSeverity !== 'all' && (!showChips || counts[filterSeverity] === 0)) filterSeverity = 'all';
  visibleIssues = issues.filter(issue => filterSeverity === 'all' || issue.severity === filterSeverity);
  visibleIssues.sort(sortMode === 'type'
    ? (a, b) => a.type.localeCompare(b.type)
    : (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);

  const summary = `${issues.length} issue${issues.length === 1 ? '' : 's'}${counts.high ? ` · ${counts.high} high` : ''}`;
  const chips = showChips
    ? `<div class="chip-group" role="group" aria-label="Filter by severity">${(['all', 'high', 'medium', 'low'] as const)
      .filter(key => counts[key] > 0)
      .map(key => `<button type="button" class="chip" data-filter="${key}" aria-pressed="${filterSeverity === key}">${key === 'all' ? 'All' : SEVERITY_LABEL[key]} (${counts[key]})</button>`)
      .join('')}</div>`
    : '';
  // The fix is always shown inline; only evidence sits behind a disclosure.
  const hasDisclosures = issues.some(issue => issue.evidence);
  const toolbar = `<div class="issues-toolbar"><span class="issues-count">${summary}</span>`
    + `<span class="issues-sort"><label class="issues-sort-label" for="issues-sort">Sort</label>`
    + `<select id="issues-sort" class="select" aria-label="Sort issues"><option value="severity"${sortMode === 'severity' ? ' selected' : ''}>Severity</option><option value="type"${sortMode === 'type' ? ' selected' : ''}>Type</option></select></span>`
    + (hasDisclosures ? `<button type="button" id="expand-all" class="btn btn-ghost btn-sm">${allExpanded ? 'Collapse all' : 'Expand all'}</button>` : '')
    + (visibleIssues.some(issue => issue.suggestion) ? '<button type="button" id="copy-all-fixes" class="btn btn-ghost btn-sm">Copy all fixes</button>' : '')
    + `${chips}</div>`;

  content.innerHTML = `${toolbar}<div class="issue-list">${visibleIssues.map(renderIssueCard).join('')}</div>`;
  if (focusFilter) content.querySelector<HTMLElement>(`[data-filter="${focusFilter}"]`)?.focus();
}

function renderDisclosure(id: string, label: string, text: string): string {
  return `<div class="disclosure"><button type="button" class="disclosure-toggle" aria-expanded="${allExpanded}" aria-controls="${id}">${label}${icon('chevron-right', 'disclosure-chevron')}</button>`
    + `<div class="disclosure-panel" id="${id}"${allExpanded ? '' : ' hidden'}><div class="disclosure-body"><p>${escapeHtml(text)}</p></div></div></div>`;
}

function renderIssueCard(issue: NormalizedIssue, index: number): string {
  // Screen readers get the title without markdown marks.
  const plainTitle = issue.title.replace(/[`*]/g, '');
  return `<article class="issue-card" data-severity="${issue.severity}">`
    + `<header class="issue-head"><span class="sev sev-${issue.severity}">${SEVERITY_LABEL[issue.severity]}</span>`
    + `<span class="issue-type">${escapeHtml(issue.type)}</span>`
    // One copy control per card: it copies the whole issue, fix included.
    + `<button type="button" class="btn btn-ghost btn-sm copy-issue" data-issue-index="${index}" aria-label="Copy issue: ${escapeHtml(plainTitle)}">Copy</button>`
    + `<h3 class="issue-title">${formatInline(issue.title)}</h3></header>`
    + (issue.statement !== issue.title ? `<p class="issue-statement">${formatInline(issue.statement)}</p>` : '')
    + (issue.details ? `<p class="issue-details">${escapeHtml(issue.details)}</p>` : '')
    + (issue.suggestion ? `<div class="issue-fix"><div class="issue-fix-label">Fix</div><p class="issue-fix-text">${formatInline(issue.suggestion)}</p></div>` : '')
    + (issue.evidence ? renderDisclosure(`issue-${index}-evidence`, 'Evidence', issue.evidence) : '')
    + '</article>';
}

function setDisclosure(toggle: HTMLElement, expanded: boolean) {
  toggle.setAttribute('aria-expanded', String(expanded));
  const panel = byId(toggle.getAttribute('aria-controls') ?? '');
  if (panel) panel.hidden = !expanded;
}

function setupIssuesTab() {
  const content = byId('content-issues');
  if (!content) return;
  content.addEventListener('click', event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('button');
    if (!target || !content.contains(target)) return;
    if (target.dataset.filter) {
      filterSeverity = target.dataset.filter as typeof filterSeverity;
      renderIssueList(target.dataset.filter);
    } else if (target.classList.contains('disclosure-toggle')) {
      setDisclosure(target, target.getAttribute('aria-expanded') !== 'true');
      // Keep the bulk toggle honest: it reads "Collapse all" only while every disclosure is open.
      const toggles = Array.from(content.querySelectorAll<HTMLElement>('.disclosure-toggle'));
      allExpanded = toggles.every(toggle => toggle.getAttribute('aria-expanded') === 'true');
      const expandAll = byId('expand-all');
      if (expandAll) expandAll.textContent = allExpanded ? 'Collapse all' : 'Expand all';
    } else if (target.id === 'expand-all') {
      allExpanded = !allExpanded;
      content.querySelectorAll<HTMLElement>('.disclosure-toggle').forEach(toggle => setDisclosure(toggle, allExpanded));
      target.textContent = allExpanded ? 'Collapse all' : 'Expand all';
    } else if (target.id === 'copy-all-fixes') {
      const fixes = visibleIssues.filter(issue => issue.suggestion);
      if (fixes.length) {
        const markdown = fixes.map(issue => `- **${issue.title}**: ${issue.suggestion}`).join('\n');
        void copyText(markdown, `Copied ${fixes.length} fix${fixes.length === 1 ? '' : 'es'}`);
      }
    } else if (target.classList.contains('copy-issue')) {
      const issue = visibleIssues[Number(target.dataset.issueIndex)];
      if (issue) void copyText(formatIssueText(issue), 'Copied issue');
    }
  });
  content.addEventListener('change', event => {
    const select = event.target as HTMLSelectElement;
    if (select.id !== 'issues-sort') return;
    sortMode = select.value === 'type' ? 'type' : 'severity';
    renderIssueList();
    byId('issues-sort')?.focus();
  });
}

// ============================================================================
// Notes and JSON tabs
// ============================================================================

function renderNotesTab(analysis: ScreenshotAnalysis) {
  const content = byId('content-notes');
  const notes = (analysis.uxCritique ?? []).map(normalizeNote).filter(note => note.issue.trim());
  setBadge('badge-notes', notes.length);
  if (!content) return;
  if (!notes.length) {
    content.innerHTML = emptyState('sticky-note', 'No suggestions', 'The model had no suggestions for this capture.');
    return;
  }
  content.innerHTML = notes.map(note => '<article class="note">'
    + (note.area ? `<h3 class="note-area">${escapeHtml(note.area)}</h3>` : '')
    + `<p class="note-issue">${escapeHtml(note.issue)}</p>`
    + (note.suggestion ? `<p class="note-suggestion"><span class="note-label">Suggestion</span> ${escapeHtml(note.suggestion)}</p>` : '')
    + '</article>').join('');
}

function renderRawTab(response: AIResponse<ScreenshotAnalysis>) {
  const content = byId('content-raw');
  if (!content) return;
  // Copy and save live in the Export menu; the tab is a read-only view of the full response.
  content.innerHTML = `<pre class="code-block raw-json"><code>${escapeHtml(JSON.stringify(response, null, 2))}</code></pre>`;
}

// ============================================================================
// Export menu (APG menu button)
// ============================================================================

const menuItems = () => Array.from(exportMenu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
const isExportMenuOpen = () => !!exportMenu && !exportMenu.hidden;

function openExportMenu(focusLast = false) {
  if (!exportMenu || exportBtn.disabled) return;
  exportMenu.hidden = false;
  exportBtn.setAttribute('aria-expanded', 'true');
  const items = menuItems();
  items[focusLast ? items.length - 1 : 0]?.focus();
}

function closeExportMenu(restoreFocus: boolean) {
  if (!exportMenu || exportMenu.hidden) return;
  exportMenu.hidden = true;
  exportBtn.setAttribute('aria-expanded', 'false');
  if (restoreFocus) exportBtn.focus();
}

function setupExportMenu() {
  if (!exportMenu) return;
  menuItems().forEach(item => { item.tabIndex = -1; });
  exportBtn.addEventListener('click', () => (isExportMenuOpen() ? closeExportMenu(true) : openExportMenu()));
  exportBtn.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openExportMenu(event.key === 'ArrowUp');
    }
  });
  exportMenu.addEventListener('keydown', event => {
    const items = menuItems();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = ({
      ArrowDown: (index + 1) % items.length,
      ArrowUp: (index - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    } as Record<string, number>)[event.key];
    if (next !== undefined) {
      event.preventDefault();
      items[next]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeExportMenu(true);
    } else if (event.key === 'Tab') {
      closeExportMenu(false);
    }
  });
  exportMenu.addEventListener('click', event => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('[data-export]');
    if (!item) return;
    closeExportMenu(true);
    void handleExport(item.dataset.export ?? '');
  });
  document.addEventListener('click', event => {
    const target = event.target as Node;
    if (isExportMenuOpen() && !exportMenu!.contains(target) && !exportBtn.contains(target)) closeExportMenu(false);
  });
}

function exportTimestamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

async function saveFile(content: string, extension: 'json' | 'md', label: string) {
  try {
    const result = await api.files.saveTextFile({
      content,
      defaultFileName: `screenshot-analysis-${exportTimestamp()}.${extension}`,
      filters: [{ name: extension === 'json' ? 'JSON files' : 'Markdown files', extensions: [extension] }],
    });
    if (result?.success) showToast(`Saved ${label} file`);
    else if (result?.cancelled) showToast('Save cancelled');
    else showToast(result?.error || `Couldn't save the ${label} file`);
  } catch (error) {
    console.error(`Failed to save ${label} file:`, error);
    showToast(`Couldn't save the ${label} file`);
  }
}

async function handleExport(kind: string) {
  if (!lastResult?.success || !lastResult.data) {
    showToast('Nothing to export yet');
    return;
  }
  const json = JSON.stringify(lastResult, null, 2);
  switch (kind) {
    case 'report-markdown': return copyText(buildReportMarkdown(lastResult), 'Copied report as Markdown');
    case 'json': return copyText(json, 'Copied JSON');
    case 'export-markdown': return saveFile(buildReportMarkdown(lastResult), 'md', 'Markdown');
    case 'export-json': return saveFile(json, 'json', 'JSON');
  }
}

// ============================================================================
// Feedback
// ============================================================================

const feedbackChips = () => Array.from(feedbackPopover?.querySelectorAll<HTMLButtonElement>('[data-feedback-reason]') ?? []);
const selectedReason = () => feedbackChips().find(chip => chip.getAttribute('aria-pressed') === 'true')?.dataset.feedbackReason as FeedbackReason | undefined;

function updateFeedbackSubmit() {
  if (feedbackSubmitBtn) feedbackSubmitBtn.disabled = !selectedReason() && !feedbackOther?.value.trim();
}

function resetFeedbackForm() {
  feedbackChips().forEach(chip => chip.setAttribute('aria-pressed', 'false'));
  if (feedbackOther) feedbackOther.value = '';
  updateFeedbackSubmit();
}

function resetFeedback() {
  feedbackSubmitted = null;
  feedbackPositiveBtn?.setAttribute('aria-pressed', 'false');
  feedbackNegativeBtn?.setAttribute('aria-pressed', 'false');
  if (feedbackPositiveBtn) feedbackPositiveBtn.disabled = false;
  if (feedbackNegativeBtn) feedbackNegativeBtn.disabled = false;
  closeFeedbackPopover(false);
  resetFeedbackForm();
}

function openFeedbackPopover() {
  if (!feedbackPopover) return;
  popoverReturnFocus = feedbackNegativeBtn;
  feedbackPopover.hidden = false;
  (feedbackChips()[0] ?? feedbackOther)?.focus();
}

function closeFeedbackPopover(restoreFocus: boolean) {
  if (!feedbackPopover || feedbackPopover.hidden) return;
  feedbackPopover.hidden = true;
  if (restoreFocus) popoverReturnFocus?.focus();
}

async function sendFeedback(positive: boolean, details?: FeedbackDetails) {
  if (api.feedback?.submit) await api.feedback.submit(positive, details);
  else await api.analysis.submitFeedback?.(positive);
}

function markFeedback(kind: 'positive' | 'negative') {
  feedbackSubmitted = kind;
  feedbackPositiveBtn?.setAttribute('aria-pressed', String(kind === 'positive'));
  feedbackNegativeBtn?.setAttribute('aria-pressed', String(kind === 'negative'));
}

function setupFeedback() {
  feedbackPositiveBtn?.addEventListener('click', async () => {
    if (!lastResult || feedbackSubmitted === 'positive') return;
    closeFeedbackPopover(false);
    try {
      await sendFeedback(true);
      markFeedback('positive');
      showToast('Rating saved on this device');
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      showToast("Couldn't save the rating");
    }
  });
  feedbackNegativeBtn?.addEventListener('click', () => {
    if (!lastResult) return;
    if (feedbackPopover?.hidden === false) closeFeedbackPopover(true);
    else openFeedbackPopover();
  });
  feedbackChips().forEach(chip => chip.addEventListener('click', () => {
    const pressed = chip.getAttribute('aria-pressed') === 'true';
    feedbackChips().forEach(other => other.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', String(!pressed));
    updateFeedbackSubmit();
  }));
  feedbackOther?.addEventListener('input', updateFeedbackSubmit);
  byId('feedback-cancel')?.addEventListener('click', () => closeFeedbackPopover(true));
  feedbackPopover?.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    closeFeedbackPopover(true);
  });
  feedbackSubmitBtn?.addEventListener('click', async () => {
    const reason = selectedReason();
    const comment = feedbackOther?.value.trim().slice(0, 500) ?? '';
    if (!lastResult || (!reason && !comment) || !feedbackSubmitBtn) return;
    const details: FeedbackDetails = {};
    if (reason) details.reason = reason;
    if (comment) details.comment = comment;
    feedbackSubmitBtn.disabled = true;
    try {
      await sendFeedback(false, details);
      markFeedback('negative');
      closeFeedbackPopover(true);
      resetFeedbackForm();
      showToast('Feedback saved. Run again to use it.');
    } catch (error) {
      console.error('Failed to submit feedback:', error);
      showToast("Couldn't save the feedback");
      updateFeedbackSubmit();
    }
  });
  document.addEventListener('click', event => {
    const target = event.target as Node;
    if (feedbackPopover && !feedbackPopover.hidden && !feedbackPopover.contains(target) && !feedbackNegativeBtn?.contains(target)) {
      closeFeedbackPopover(false);
    }
  });
}

// ============================================================================
// Screenshot viewer
// ============================================================================

let viewerZoom = 1;
let viewerPanX = 0;
let viewerPanY = 0;
let viewerDrag: { x: number; y: number; panX: number; panY: number } | null = null;

function updateViewerTransform() {
  if (!viewerImage) return;
  // CSSOM property (not markup): pan and zoom are continuous values.
  viewerImage.style.transform = `translate(${viewerPanX}px, ${viewerPanY}px) scale(${viewerZoom})`;
  if (viewerZoomLevel) viewerZoomLevel.textContent = `${Math.round(viewerZoom * 100)}%`;
}

function setZoom(zoom: number) {
  viewerZoom = Math.max(0.5, Math.min(5, zoom));
  updateViewerTransform();
}

function resetViewer() {
  viewerZoom = 1;
  viewerPanX = 0;
  viewerPanY = 0;
  updateViewerTransform();
}

function openScreenshotViewer() {
  if (!screenshotViewer || !viewerImage || !currentScreenshot) return;
  viewerReturnFocus = document.activeElement as HTMLElement | null;
  viewerImage.src = currentScreenshot;
  resetViewer();
  screenshotViewer.hidden = false;
  byId('viewer-close')?.focus();
}

function closeScreenshotViewer() {
  if (!screenshotViewer || screenshotViewer.hidden) return;
  screenshotViewer.hidden = true;
  resetViewer();
  (viewerReturnFocus?.isConnected ? viewerReturnFocus : screenshotPreview)?.focus();
  viewerReturnFocus = null;
}

function setupScreenshotViewer() {
  screenshotPreview?.addEventListener('click', openScreenshotViewer);
  if (!screenshotViewer || !viewerContent) return;
  byId('viewer-zoom-in')?.addEventListener('click', () => setZoom(viewerZoom * 1.2));
  byId('viewer-zoom-out')?.addEventListener('click', () => setZoom(viewerZoom / 1.2));
  byId('viewer-reset')?.addEventListener('click', resetViewer);
  byId('viewer-close')?.addEventListener('click', closeScreenshotViewer);
  screenshotViewer.querySelector('.screenshot-viewer-overlay')?.addEventListener('click', closeScreenshotViewer);

  viewerContent.addEventListener('wheel', event => {
    event.preventDefault();
    setZoom(viewerZoom * (event.deltaY > 0 ? 0.9 : 1.1));
  }, { passive: false });
  viewerContent.addEventListener('mousedown', event => {
    if (event.button !== 0) return;
    viewerDrag = { x: event.clientX, y: event.clientY, panX: viewerPanX, panY: viewerPanY };
    viewerContent!.classList.add('dragging');
  });
  document.addEventListener('mousemove', event => {
    if (!viewerDrag) return;
    viewerPanX = viewerDrag.panX + event.clientX - viewerDrag.x;
    viewerPanY = viewerDrag.panY + event.clientY - viewerDrag.y;
    updateViewerTransform();
  });
  document.addEventListener('mouseup', () => {
    if (!viewerDrag) return;
    viewerDrag = null;
    viewerContent!.classList.remove('dragging');
  });

  // Focus trap: registered once; the focusable set is read on every Tab.
  screenshotViewer.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(screenshotViewer!.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

// ============================================================================
// Keyboard shortcuts
// ============================================================================

/**
 * Shortcuts yield only where letters and digits mean something else: text entry, selects
 * (type-ahead), and open menus or dialogs. A focused button doesn't use letter keys, so it
 * doesn't block them.
 */
function isShortcutExempt(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    || target.isContentEditable
    || !!target.closest('[role="menu"], [role="dialog"]');
}

/** Retry from the keyboard: in the error view this is the panel's own retry action. */
function retryFromShortcut() {
  if (phase === 'error') {
    const retry = byId('error-actions')?.querySelector<HTMLButtonElement>('[data-action="retry"], [data-action="capture"]');
    if (retry && retry.getAttribute('aria-disabled') !== 'true') retry.click();
    return;
  }
  if (!runAgainBtn.disabled) runAgainBtn.click();
}

function startCapture() {
  if (keyMissing) {
    showMissingKey();
    return;
  }
  try {
    api.capture.start();
  } catch (error) {
    console.error('Error starting capture:', error);
    showToast("Couldn't start a capture. Restart the app and try again.");
  }
}

/** Settings `singleKeyShortcuts` (WCAG 2.1.4). On until the setting reads an explicit false. */
let singleKeyShortcuts = true;

async function loadShortcutSetting() {
  try {
    singleKeyShortcuts = (await api.settings.get('singleKeyShortcuts')) !== false;
  } catch (error) {
    console.error('Failed to read shortcut setting:', error);
  }
  document.querySelectorAll<HTMLElement>('.welcome-note').forEach(note => { note.hidden = !singleKeyShortcuts; });
  // Hide the single-key hints and drop them from aria-keyshortcuts; the chord shortcut stays.
  document.body.classList.toggle('single-keys-off', !singleKeyShortcuts);
  captureBtn.setAttribute('aria-keyshortcuts', `Control+Shift+S Meta+Shift+S${singleKeyShortcuts ? ' C' : ''}`);
  // Tabs carry their digit in a tooltip only; an inline digit read as a second count ("Issues 4 2").
  const setSingleKey = (element: HTMLElement | null, key: string) => {
    if (!element) return;
    if (singleKeyShortcuts) {
      element.setAttribute('aria-keyshortcuts', key);
      element.title = `Shortcut: ${key}`;
    } else {
      element.removeAttribute('aria-keyshortcuts');
      element.removeAttribute('title');
    }
  };
  TABS.forEach((tab, index) => setSingleKey(byId(`tab-${tab}`), String(index + 1)));
}

/** Esc stops an analysis in flight, through the same path as the Cancel button. */
function cancelFromShortcut(event: KeyboardEvent): boolean {
  if (event.key !== 'Escape' || phase !== 'analyzing' || event.defaultPrevented) return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || isShortcutExempt(event.target)) return false;
  // An open menu or popover owns Escape even when focus has wandered outside it.
  if (isExportMenuOpen() || (feedbackPopover && !feedbackPopover.hidden)) return false;
  if (!cancelBtn || cancelBtn.hidden || cancelBtn.disabled) return false;
  event.preventDefault();
  cancelBtn.click();
  return true;
}

function setupKeyboardShortcuts() {
  void loadShortcutSetting();
  window.addEventListener('focus', () => { void loadShortcutSetting(); });
  document.addEventListener('keydown', event => {
    if (screenshotViewer && !screenshotViewer.hidden) {
      const actions: Record<string, () => void> = {
        Escape: closeScreenshotViewer,
        '+': () => setZoom(viewerZoom * 1.2),
        '=': () => setZoom(viewerZoom * 1.2),
        '-': () => setZoom(viewerZoom / 1.2),
        '0': resetViewer,
      };
      const action = actions[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
      return;
    }
    // Esc is not a single-character key, so it works whatever singleKeyShortcuts says.
    if (cancelFromShortcut(event)) return;
    // Run again sends data off the machine, so it takes a chord, never a single stray key.
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && !isShortcutExempt(event.target)) {
      event.preventDefault();
      retryFromShortcut();
      return;
    }
    if (!singleKeyShortcuts || event.ctrlKey || event.metaKey || event.altKey || isShortcutExempt(event.target)) return;

    const key = event.key.toLowerCase();
    if (key === 'c' && !captureBtn.disabled) {
      event.preventDefault();
      captureBtn.click();
    } else if (key === 'e' && !exportBtn.disabled) {
      event.preventDefault();
      openExportMenu();
    } else if (/^[1-4]$/.test(key) && results && !results.hidden) {
      event.preventDefault();
      chooseTab(TABS[Number(key) - 1], true);
    }
  });
}

// ============================================================================
// Wiring
// ============================================================================

function setupEventListeners() {
  api.analysis.onProcessing(onProcessing);
  api.analysis.onScreenshot(payload => receiveScreenshot(payload?.dataUrl ?? '', payload?.shield));
  api.analysis.onResult(onResult);
  api.analysis.onError(showError);

  captureBtn.addEventListener('click', startCapture);
  runAgainBtn.addEventListener('click', () => { if (!retryBlocked()) api.analysis.retry(); });
  cancelBtn?.addEventListener('click', () => {
    if (phase !== 'analyzing') return;
    cancelBtn!.disabled = true;
    setStatus('working', 'Cancelling…', statusDetail?.textContent ?? '');
    api.analysis.cancel?.();
  });
}

function initialize() {
  if (!initializeElements()) {
    console.error('Failed to initialize elements');
    return;
  }
  setupTabs();
  setupSummaryTab();
  setupIssuesTab();
  setupExportMenu();
  setupFeedback();
  setupScreenshotViewer();
  setupKeyboardShortcuts();
  setupEventListeners();

  setStatus('idle', 'Ready');
  showView('welcome');
  switchTab('summary');
  updateControls();
  void loadWelcome();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
