import { escapeHtml } from "./utils/formatting";
/**
 * Settings UI - Phase 1: Tabbed Interface
 * Redesigned with tabs: Providers / API Keys / Context / Prompt / Diagnostics
 */

if (!window.api) {
  throw new Error('API not available - preload script may not have loaded');
}
const { api } = window;

// ============================================================================
// Tab Navigation
// ============================================================================

const navItems = document.querySelectorAll('.nav-item') as NodeListOf<HTMLAnchorElement>;
const tabContents = document.querySelectorAll('.tab-content') as NodeListOf<HTMLDivElement>;
const saveStatus = document.getElementById('save-status') as HTMLDivElement;

let saveTimeout: ReturnType<typeof setTimeout> | null = null;

function showTab(tabId: string) {
  // Update nav items
  navItems.forEach(item => {
    if (item.dataset.tab === tabId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Update tab contents
  tabContents.forEach(content => {
    if (content.id === `tab-${tabId}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
}

// Tab navigation
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const tabId = item.dataset.tab;
    if (tabId) {
      showTab(tabId);
    }
  });
});

function updateSaveStatus(message: string, isSaved: boolean = true) {
  saveStatus.textContent = message;
  saveStatus.classList.toggle('saved', isSaved);
  
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  
  if (isSaved) {
    saveTimeout = setTimeout(() => {
      saveStatus.textContent = 'All changes saved';
      saveStatus.classList.add('saved');
    }, 2000);
  }
}

// ============================================================================
// DOM Elements
// ============================================================================

const providerSelect = document.getElementById('provider-select') as HTMLSelectElement;
const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
const modelDescription = document.getElementById('model-description') as HTMLSpanElement;

// OpenAI elements
const openaiKeyInput = document.getElementById('openai-key') as HTMLInputElement;
const openaiRevealBtn = document.getElementById('openai-reveal') as HTMLButtonElement;
const openaiValidation = document.getElementById('openai-validation') as HTMLDivElement;
const openaiSaveBtn = document.getElementById('openai-save') as HTMLButtonElement;
const openaiDeleteBtn = document.getElementById('openai-delete') as HTMLButtonElement;
const openaiTestBtn = document.getElementById('openai-test') as HTMLButtonElement;
const openaiMessage = document.getElementById('openai-message') as HTMLDivElement;
const openaiMasked = document.getElementById('openai-masked') as HTMLSpanElement;
const openaiBadge = document.getElementById('openai-badge') as HTMLSpanElement;
const openaiTestInfo = document.getElementById('openai-test-info') as HTMLDivElement;

// Anthropic elements
const anthropicKeyInput = document.getElementById('anthropic-key') as HTMLInputElement;
const anthropicRevealBtn = document.getElementById('anthropic-reveal') as HTMLButtonElement;
const anthropicValidation = document.getElementById('anthropic-validation') as HTMLDivElement;
const anthropicSaveBtn = document.getElementById('anthropic-save') as HTMLButtonElement;
const anthropicDeleteBtn = document.getElementById('anthropic-delete') as HTMLButtonElement;
const anthropicTestBtn = document.getElementById('anthropic-test') as HTMLButtonElement;
const anthropicMessage = document.getElementById('anthropic-message') as HTMLDivElement;
const anthropicMasked = document.getElementById('anthropic-masked') as HTMLSpanElement;
const anthropicBadge = document.getElementById('anthropic-badge') as HTMLSpanElement;
const anthropicTestInfo = document.getElementById('anthropic-test-info') as HTMLDivElement;

// Workspace context elements
const workspaceEnabled = document.getElementById('workspace-enabled') as HTMLInputElement;
const workspaceRootRow = document.getElementById('workspace-root-row') as HTMLDivElement;
const contextOptionsRow = document.getElementById('context-options-row') as HTMLDivElement;
const excludesRow = document.getElementById('excludes-row') as HTMLDivElement;
const workspacePath = document.getElementById('workspace-path') as HTMLSpanElement;
const workspaceBadge = document.getElementById('workspace-badge') as HTMLSpanElement;
const workspaceBrowseBtn = document.getElementById('workspace-browse') as HTMLButtonElement;
const workspaceClearBtn = document.getElementById('workspace-clear') as HTMLButtonElement;
const workspaceMessage = document.getElementById('workspace-message') as HTMLDivElement;
const includeFileTree = document.getElementById('include-file-tree') as HTMLInputElement;
const includeFileContents = document.getElementById('include-file-contents') as HTMLInputElement;
const excludeList = document.getElementById('exclude-list') as HTMLDivElement;
const excludeInput = document.getElementById('exclude-input') as HTMLInputElement;
const excludeAddBtn = document.getElementById('exclude-add') as HTMLButtonElement;
const excludeResetBtn = document.getElementById('exclude-reset') as HTMLButtonElement;
const contextPreview = document.getElementById('context-preview') as HTMLDivElement;
const previewContent = document.getElementById('preview-content') as HTMLDivElement;
const fileContentsWarning = document.getElementById('file-contents-warning') as HTMLDivElement;

// Prompt elements
const promptEnabled = document.getElementById('prompt-enabled') as HTMLInputElement;
const promptEditorRow = document.getElementById('prompt-editor-row') as HTMLDivElement;
const promptText = document.getElementById('prompt-text') as HTMLTextAreaElement;
const promptStats = document.getElementById('prompt-stats') as HTMLSpanElement;
const promptResetBtn = document.getElementById('prompt-reset') as HTMLButtonElement;
const promptPreviewBtn = document.getElementById('prompt-preview') as HTMLButtonElement;
const promptImportBtn = document.getElementById('prompt-import') as HTMLButtonElement;
const promptExportBtn = document.getElementById('prompt-export') as HTMLButtonElement;
const promptMessage = (document.getElementById('prompt-message') as HTMLDivElement) || workspaceMessage; // Fallback if element doesn't exist
const promptModal = document.getElementById('prompt-modal') as HTMLDivElement;
const promptModalBody = document.getElementById('prompt-modal-body') as HTMLDivElement;
const promptModalClose = document.getElementById('prompt-modal-close') as HTMLButtonElement;

// Diagnostics elements
const appVersion = document.getElementById('app-version') as HTMLElement;
const appPlatform = document.getElementById('app-platform') as HTMLElement;
const settingsPath = document.getElementById('settings-path') as HTMLElement;
const copyDebugInfoBtn = document.getElementById('copy-debug-info') as HTMLButtonElement;
const openLogsBtn = document.getElementById('open-logs') as HTMLButtonElement;
const resetAllBtn = document.getElementById('reset-all') as HTMLButtonElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;

// Context sources elements
const contextSourcesList = document.getElementById('context-sources-list') as HTMLDivElement;
const addSourceBtn = document.getElementById('add-source-btn') as HTMLButtonElement;
const repoPickerModal = document.getElementById('repo-picker-modal') as HTMLDivElement;
const repoPickerModalClose = document.getElementById('repo-picker-modal-close') as HTMLButtonElement;
const repoProviderSelect = document.getElementById('repo-provider-select') as HTMLSelectElement;
const repoAuthStatusRow = document.getElementById('repo-auth-status-row') as HTMLDivElement;
const repoAuthStatusText = document.getElementById('repo-auth-status-text') as HTMLSpanElement;
const repoConnectBtn = document.getElementById('repo-connect-btn') as HTMLButtonElement;
const repoDisconnectBtn = document.getElementById('repo-disconnect-btn') as HTMLButtonElement;
const repoOAuthBtn = document.getElementById('repo-oauth-btn') as HTMLButtonElement;
const repoLocalRow = document.getElementById('repo-local-row') as HTMLDivElement;
const repoLocalPath = document.getElementById('repo-local-path') as HTMLInputElement;
const repoLocalBrowse = document.getElementById('repo-local-browse') as HTMLButtonElement;
const repoRemoteRow = document.getElementById('repo-remote-row') as HTMLDivElement;
const repoSearchInput = document.getElementById('repo-search-input') as HTMLInputElement;
const repoBranchInput = document.getElementById('repo-branch-input') as HTMLInputElement;
const repoPathScopeInput = document.getElementById('repo-path-scope-input') as HTMLInputElement;
const repoIncludeTree = document.getElementById('repo-include-tree') as HTMLInputElement;
const repoIncludeContents = document.getElementById('repo-include-contents') as HTMLInputElement;
const repoAddBtn = document.getElementById('repo-add-btn') as HTMLButtonElement;
const repoCancelBtn = document.getElementById('repo-cancel-btn') as HTMLButtonElement;

// Token input modal elements
const tokenInputModal = document.getElementById('token-input-modal') as HTMLDivElement;
const tokenInputModalClose = document.getElementById('token-input-modal-close') as HTMLButtonElement;
const tokenInputProviderName = document.getElementById('token-input-provider-name') as HTMLDivElement;
const tokenInputField = document.getElementById('token-input-field') as HTMLInputElement;
const tokenInputReveal = document.getElementById('token-input-reveal') as HTMLButtonElement;
const tokenInputHelpLink = document.getElementById('token-input-help-link') as HTMLDivElement;
const tokenInputCancelBtn = document.getElementById('token-input-cancel-btn') as HTMLButtonElement;
const tokenInputSubmitBtn = document.getElementById('token-input-submit-btn') as HTMLButtonElement;
let tokenInputProvider: 'github' | 'gitlab' | null = null;

// OAuth modal elements
const oauthModal = document.getElementById('oauth-modal') as HTMLDivElement;
const oauthModalClose = document.getElementById('oauth-modal-close') as HTMLButtonElement;
const oauthProviderName = document.getElementById('oauth-provider-name') as HTMLSpanElement;
const oauthStepInit = document.getElementById('oauth-step-init') as HTMLDivElement;
const oauthStepCode = document.getElementById('oauth-step-code') as HTMLDivElement;
const oauthStepSuccess = document.getElementById('oauth-step-success') as HTMLDivElement;
const oauthStepError = document.getElementById('oauth-step-error') as HTMLDivElement;
const oauthUserCode = document.getElementById('oauth-user-code') as HTMLDivElement;
const oauthVerificationUri = document.getElementById('oauth-verification-uri') as HTMLElement;
const oauthOpenLink = document.getElementById('oauth-open-link') as HTMLAnchorElement;
const oauthPollingStatus = document.getElementById('oauth-polling-status') as HTMLDivElement;
const oauthErrorMessage = document.getElementById('oauth-error-message') as HTMLDivElement;
const oauthCancelBtn = document.getElementById('oauth-cancel-btn') as HTMLButtonElement;

// OAuth state
let oauthPollingInterval: ReturnType<typeof setInterval> | null = null;
let oauthDeviceCode: string | null = null;
let oauthPollInterval: number = 5;

// ============================================================================
// Utility Functions
// ============================================================================

// Central toast system
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info', duration: number = 5000): void {
  if (!toastEl) return;
  
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`;
  toastEl.classList.add('show');
  
  setTimeout(() => {
    toastEl.classList.remove('show');
  }, duration);
}

function showMessage(element: HTMLDivElement, message: string, type: 'success' | 'error' | 'info'): void {
  element.textContent = message;
  element.className = `status ${type}`;
  setTimeout(() => {
    element.className = 'status';
  }, 5000);
  
  // Also show toast for important messages
  if (type === 'error' || type === 'success') {
    showToast(message, type);
  }
}

function updateApiKeyStatus(provider: 'openai' | 'anthropic', status: { hasKey: boolean; masked: string | null }): void {
  const maskedEl = provider === 'openai' ? openaiMasked : anthropicMasked;
  const badgeEl = provider === 'openai' ? openaiBadge : anthropicBadge;
  const deleteBtn = provider === 'openai' ? openaiDeleteBtn : anthropicDeleteBtn;

  if (status.hasKey && status.masked) {
    maskedEl.textContent = status.masked;
    badgeEl.textContent = 'Configured';
    badgeEl.className = 'status-badge configured';
    deleteBtn.disabled = false;
  } else {
    maskedEl.textContent = '';
    badgeEl.textContent = 'Not configured';
    badgeEl.className = 'status-badge not-configured';
    deleteBtn.disabled = true;
  }
}

function updateTestInfo(provider: 'openai' | 'anthropic', info: { lastTested?: number | null; lastTestStatus?: string | null; lastTestLatency?: number | null; lastTestError?: string | null }): void {
  const infoEl = provider === 'openai' ? openaiTestInfo : anthropicTestInfo;
  
  if (info.lastTested) {
    const status = info.lastTestStatus === 'success' ? '✓ Tested successfully' : '✗ Test failed';
    const latency = info.lastTestLatency ? ` (${info.lastTestLatency}ms)` : '';
    const error = info.lastTestError ? ` - ${info.lastTestError}` : '';
    const timeAgo = getTimeAgo(info.lastTested);
    
    // Build formatted message
    let message = `${status}${latency}`;
    if (error) {
      message += `\n${error}`;
    }
    message += ` • ${timeAgo}`;
    
    infoEl.textContent = message;
    infoEl.className = 'test-info';
    infoEl.style.color = info.lastTestStatus === 'success' ? '#2e7d32' : '#c62828';
    infoEl.style.backgroundColor = info.lastTestStatus === 'success' ? '#e8f5e9' : '#ffebee';
    infoEl.style.borderLeft = `3px solid ${info.lastTestStatus === 'success' ? '#2e7d32' : '#c62828'}`;
    infoEl.style.padding = '8px 12px';
    infoEl.style.whiteSpace = 'pre-line';
  } else {
    infoEl.textContent = '';
    infoEl.style.color = '';
    infoEl.style.backgroundColor = '';
    infoEl.style.borderLeft = '';
    infoEl.style.padding = '';
    infoEl.style.whiteSpace = '';
  }
}

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function updateWorkspacePath(workspaceRoot: string | null): void {
  if (workspaceRoot) {
    workspacePath.textContent = workspaceRoot;
    workspaceBadge.textContent = 'Configured';
    workspaceBadge.className = 'status-badge configured';
    workspaceClearBtn.disabled = false;
  } else {
    workspacePath.textContent = 'No folder selected';
    workspaceBadge.textContent = 'Not configured';
    workspaceBadge.className = 'status-badge not-configured';
    workspaceClearBtn.disabled = true;
  }
}

function updatePromptStats(text: string): void {
  const chars = text.length;
  // Rough token estimate: ~4 characters per token for English text
  const estimatedTokens = Math.ceil(chars / 4);
  promptStats.textContent = `${chars.toLocaleString()} characters, ~${estimatedTokens.toLocaleString()} tokens`;
}

// ============================================================================
// Password Reveal (Press and Hold)
// ============================================================================

function setupPasswordReveal(input: HTMLInputElement, revealBtn: HTMLButtonElement): void {
  let isRevealing = false;

  revealBtn.addEventListener('mousedown', () => {
    isRevealing = true;
    input.type = 'text';
    revealBtn.textContent = '👁️';
  });

  revealBtn.addEventListener('mouseup', () => {
    if (isRevealing) {
      input.type = 'password';
      revealBtn.textContent = '👁';
      isRevealing = false;
    }
  });

  revealBtn.addEventListener('mouseleave', () => {
    if (isRevealing) {
      input.type = 'password';
      revealBtn.textContent = '👁';
      isRevealing = false;
    }
  });

  // Touch support
  revealBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isRevealing = true;
    input.type = 'text';
    revealBtn.textContent = '👁️';
  });

  revealBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (isRevealing) {
      input.type = 'password';
      revealBtn.textContent = '👁';
      isRevealing = false;
    }
  });
}

// ============================================================================
// Inline Validation
// ============================================================================

async function validateApiKeyInput(
  provider: 'openai' | 'anthropic',
  input: HTMLInputElement,
  validationEl: HTMLDivElement
): Promise<boolean> {
  const value = input.value.trim();
  
  if (!value) {
    validationEl.className = 'validation-message';
    validationEl.textContent = '';
    return false;
  }

  const validation = await api.settings.validateApiKey(provider, value);
  
  if (validation.valid) {
    validationEl.className = 'validation-message valid';
    validationEl.textContent = 'Valid format';
    return true;
  } else {
    validationEl.className = 'validation-message invalid';
    const expectedPrefix = provider === 'openai' ? 'sk-' : 'sk-ant-';
    validationEl.textContent = `Invalid format. Expected prefix: ${expectedPrefix}`;
    return false;
  }
}

// ============================================================================
// Model Lists with Descriptions
// ============================================================================

interface ModelInfo {
  value: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

const MODEL_LISTS: Record<string, ModelInfo[]> = {
  openai: [
    { 
      value: 'gpt-5.2', 
      label: 'GPT-5.2', 
      description: 'The best model for coding and agentic tasks across industries',
      recommended: true 
    },
    { 
      value: 'gpt-5.2-pro', 
      label: 'GPT-5.2 Pro', 
      description: 'Version of GPT-5.2 that produces smarter and more precise responses' 
    },
    { 
      value: 'gpt-5-mini', 
      label: 'GPT-5 Mini', 
      description: 'A faster, cost-efficient version of GPT-5 for well-defined tasks' 
    },
    { 
      value: 'gpt-5-nano', 
      label: 'GPT-5 Nano', 
      description: 'Fastest, most cost-efficient version of GPT-5' 
    },
  ],
  anthropic: [
    { 
      value: 'claude-sonnet-4-5-20250929', 
      label: 'Claude Sonnet 4.5', 
      description: 'Balanced performance and speed, best for most tasks',
      recommended: true 
    },
    { 
      value: 'claude-haiku-4-5-20251001', 
      label: 'Claude Haiku 4.5', 
      description: 'Fastest model, good for simple tasks' 
    },
    { 
      value: 'claude-opus-4-5-20251101', 
      label: 'Claude Opus 4.5', 
      description: 'Most capable model, best for complex analysis' 
    },
  ],
};

// Store current model selection to preserve when switching providers
const lastSelectedModels: Record<string, string> = {};

function updateModelList(provider: 'openai' | 'anthropic', preserveSelection: boolean = true): void {
  const models = MODEL_LISTS[provider] || [];
  const currentValue = modelSelect.value;
  
  modelSelect.innerHTML = '';
  
  // Find recommended model (default)
  const recommendedModel = models.find(m => m.recommended);
  const defaultModel = recommendedModel?.value || models[0]?.value || '';
  
  // Try to preserve selection if switching providers
  let selectedValue = defaultModel;
  if (preserveSelection && lastSelectedModels[provider]) {
    // Check if last selected model exists in new list
    if (models.some(m => m.value === lastSelectedModels[provider])) {
      selectedValue = lastSelectedModels[provider];
    }
  }
  
  models.forEach(model => {
    const option = document.createElement('option');
    option.value = model.value;
    
    // Build label with recommended tag
    let label = model.label;
    if (model.recommended) {
      label += ' ⭐ Recommended';
    }
    if (model.description) {
      option.title = model.description;
    }
    
    option.textContent = label;
    option.selected = model.value === selectedValue;
    modelSelect.appendChild(option);
  });
  
  // Update last selected
  lastSelectedModels[provider] = selectedValue;
  
  modelSelect.disabled = false;
  
  // Update description for selected model
  updateModelDescription();
  
  // Trigger change event if value changed
  if (modelSelect.value !== currentValue) {
    modelSelect.dispatchEvent(new Event('change'));
  }
}

function updateModelDescription(): void {
  const provider = providerSelect.value as 'openai' | 'anthropic';
  const modelValue = modelSelect.value;
  const models = MODEL_LISTS[provider] || [];
  const selectedModel = models.find(m => m.value === modelValue);
  
  if (selectedModel?.description) {
    modelDescription.textContent = selectedModel.description;
  } else {
    modelDescription.textContent = 'Model selection depends on chosen provider';
  }
}

// ============================================================================
// Load Settings
// ============================================================================

async function loadSettings(): Promise<void> {
  // Load provider selection
  const provider = (await api.settings.get('provider')) as 'openai' | 'anthropic' || 'openai';
  providerSelect.value = provider;
  
  // Restore selections for both providers across application launches.
  Object.assign(lastSelectedModels, await api.settings.get('providerModels'));

  // Load model if set, otherwise use default
  const model = (await api.settings.get('model')) as string | undefined;
  if (model) {
    lastSelectedModels[provider] = model;
  }
  
  // Update model list (will use preserved selection or default)
  updateModelList(provider, false);
  
  // Set model if it exists in the list, otherwise use default
  if (model && MODEL_LISTS[provider]?.some(m => m.value === model)) {
    modelSelect.value = model;
  } else {
    // Use recommended/default model
    const recommended = MODEL_LISTS[provider]?.find(m => m.recommended);
    if (recommended) {
      modelSelect.value = recommended.value;
      // Save default model if none was set
      await api.settings.set('model', recommended.value);
    }
  }

  // Load API key statuses and test info
  const [openaiStatus, anthropicStatus, openaiTestStatus, anthropicTestStatus] = await Promise.all([
    api.settings.getApiKeyStatus('openai'),
    api.settings.getApiKeyStatus('anthropic'),
    api.settings.getApiKeyTestStatus('openai'),
    api.settings.getApiKeyTestStatus('anthropic'),
  ]);

  updateApiKeyStatus('openai', openaiStatus);
  updateApiKeyStatus('anthropic', anthropicStatus);
  updateTestInfo('openai', openaiTestStatus);
  updateTestInfo('anthropic', anthropicTestStatus);

  // Load workspace context settings
  const workspaceContext = await api.settings.getWorkspaceContext();
  workspaceEnabled.checked = workspaceContext.enabled;
  updateWorkspacePath(workspaceContext.workspaceRoot);
  workspaceRootRow.style.display = workspaceContext.enabled ? 'grid' : 'none';
  contextOptionsRow.style.display = workspaceContext.enabled ? 'grid' : 'none';
  excludesRow.style.display = workspaceContext.enabled ? 'grid' : 'none';
  
  // Load context options
  if (workspaceContext.includeFileTree !== undefined) {
    includeFileTree.checked = workspaceContext.includeFileTree;
  }
  if (workspaceContext.includeFileContents !== undefined) {
    includeFileContents.checked = workspaceContext.includeFileContents;
    // Show/hide warning based on state
    if (fileContentsWarning) {
      fileContentsWarning.style.display = workspaceContext.includeFileContents ? 'block' : 'none';
    }
  }
  
  // Load exclusions
  if (workspaceContext.excludes) {
    renderExcludeList(workspaceContext.excludes);
  } else {
    renderExcludeList([]);
  }
  
  // Update preview if workspace is enabled and root is set
  if (workspaceContext.enabled && workspaceContext.workspaceRoot) {
    await updateContextPreview(workspaceContext.workspaceRoot);
  }

  // Load prompt settings
  const promptStatusResp = await api.settings.getPromptStatus();
  promptEnabled.checked = promptStatusResp.enabled;
  promptEditorRow.style.display = promptEnabled.checked ? 'grid' : 'none';
  
  if (promptStatusResp.length > 0) {
    const promptTextResp = await api.settings.getPromptText();
    promptText.value = promptTextResp.text;
    updatePromptStats(promptTextResp.text);
  }

  // Load diagnostics
  appVersion.textContent = '1.0.0'; // TODO: Get from package.json
  appPlatform.textContent = navigator.platform;
  
  // Get settings path
  try {
    // For now, use a placeholder - we can enhance this later
    settingsPath.textContent = 'User Data Directory';
  } catch {
    settingsPath.textContent = 'User Data Directory';
  }
  
  // Set up keyboard navigation
  setupKeyboardNavigation();
}

// Keyboard navigation and focus order
function setupKeyboardNavigation(): void {
  // Tab navigation is handled by browser by default
  // Add keyboard shortcuts for common actions
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + S to save (if applicable)
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      // Focus on first save button if visible
      const firstSaveBtn = document.querySelector('.primary') as HTMLButtonElement;
      if (firstSaveBtn && !firstSaveBtn.disabled) {
        firstSaveBtn.focus();
        firstSaveBtn.click();
      }
    }
    
    // Escape to close modals
    if (e.key === 'Escape') {
      if (oauthModal.classList.contains('open')) {
        stopOAuthPolling();
        closeModal(oauthModal, repoPickerModal);
      } else if (tokenInputModal.classList.contains('open')) {
        tokenInputField.value = '';
        closeModal(tokenInputModal, repoPickerModal);
      } else if (repoPickerModal.classList.contains('open')) {
        closeAllModals();
      } else if (promptModal && promptModal.classList.contains('open')) {
        closeModal(promptModal);
      }
    }
  });
  
  // Ensure all interactive elements are keyboard accessible
  const interactiveElements = document.querySelectorAll('button, input, select, textarea, a');
  interactiveElements.forEach((el) => {
    if (!el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') {
      // Elements are naturally focusable, but ensure they have proper focus styles
      el.setAttribute('tabindex', '0');
    }
  });
}

// ============================================================================
// Event Handlers
// ============================================================================

// Provider selection
providerSelect.addEventListener('change', async () => {
  const provider = providerSelect.value as 'openai' | 'anthropic';
  
  // Update model list, preserving selection if possible
  updateModelList(provider, true);
  
  // Save provider
  await api.settings.set('provider', provider);
  
  // Ensure model is valid for new provider
  const currentModel = modelSelect.value;
  const models = MODEL_LISTS[provider] || [];
  if (!models.some(m => m.value === currentModel)) {
    // Current model not available for new provider, use recommended/default
    const recommended = models.find(m => m.recommended);
    if (recommended) {
      modelSelect.value = recommended.value;
      await api.settings.set('model', recommended.value);
    }
  } else {
    // Model is valid, save it
    await api.settings.set('model', currentModel);
  }
  
  providerSelect.setAttribute('data-previous-provider', provider);
  updateSaveStatus('Provider updated');
});

// Model selection
modelSelect.addEventListener('change', async () => {
  const model = modelSelect.value;
  const provider = providerSelect.value as 'openai' | 'anthropic';
  
  // Update description
  updateModelDescription();
  
  // Validate model is available for current provider
  const models = MODEL_LISTS[provider] || [];
  if (!models.some(m => m.value === model)) {
    // Invalid model, reset to recommended
    const recommended = models.find(m => m.recommended);
    if (recommended) {
      modelSelect.value = recommended.value;
      updateModelDescription();
      await api.settings.set('model', recommended.value);
      showMessage(openaiMessage, `Invalid model, reset to ${recommended.label}`, 'info');
      return;
    }
  }
  
  // Save model and update last selected
  lastSelectedModels[provider] = model;
  await api.settings.set('model', model);
  updateSaveStatus('Model updated');
});

// Setup password reveal for OpenAI
setupPasswordReveal(openaiKeyInput, openaiRevealBtn);

// OpenAI input validation (on input)
openaiKeyInput.addEventListener('input', async () => {
  // Trim whitespace automatically
  const trimmed = openaiKeyInput.value.trim();
  if (openaiKeyInput.value !== trimmed) {
    const cursorPos = openaiKeyInput.selectionStart || 0;
    openaiKeyInput.value = trimmed;
    openaiKeyInput.setSelectionRange(cursorPos, cursorPos);
  }
  
  await validateApiKeyInput('openai', openaiKeyInput, openaiValidation);
});

// OpenAI paste handler
openaiKeyInput.addEventListener('paste', async () => {
  // Wait for paste to complete, then validate
  setTimeout(async () => {
    await validateApiKeyInput('openai', openaiKeyInput, openaiValidation);
  }, 10);
});

// OpenAI handlers
openaiSaveBtn.addEventListener('click', async () => {
  const apiKey = openaiKeyInput.value.trim();
  if (!apiKey) {
    showMessage(openaiMessage, 'Please enter an API key', 'error');
    return;
  }

  const isValid = await validateApiKeyInput('openai', openaiKeyInput, openaiValidation);
  if (!isValid) {
    showMessage(openaiMessage, 'Invalid API key format. OpenAI keys start with sk-', 'error');
    return;
  }

  openaiSaveBtn.disabled = true;
  const result = await api.settings.storeApiKey('openai', apiKey);
  openaiSaveBtn.disabled = false;

  if (result.success) {
    openaiKeyInput.value = '';
    openaiValidation.className = 'validation-message';
    openaiValidation.textContent = '';
    const status = await api.settings.getApiKeyStatus('openai');
    updateApiKeyStatus('openai', status);
    showMessage(openaiMessage, 'API key saved successfully', 'success');
    updateSaveStatus('API key saved');
  } else {
    showMessage(openaiMessage, result.error || 'Failed to save API key', 'error');
  }
});

openaiDeleteBtn.addEventListener('click', async () => {
  const confirmed = confirm(
    'Are you sure you want to remove the OpenAI API key?\n\n' +
    'This action cannot be undone. You will need to enter your API key again to use OpenAI.'
  );
  
  if (!confirmed) {
    return;
  }

  openaiDeleteBtn.disabled = true;
  const result = await api.settings.deleteApiKey('openai');
  openaiDeleteBtn.disabled = false;

  if (result.success) {
    const status = await api.settings.getApiKeyStatus('openai');
    updateApiKeyStatus('openai', status);
    showMessage(openaiMessage, 'API key removed', 'success');
    updateSaveStatus('API key removed');
  } else {
    showMessage(openaiMessage, 'Failed to remove API key', 'error');
  }
});

openaiTestBtn.addEventListener('click', async () => {
  const apiKey = openaiKeyInput.value.trim();
  if (!apiKey) {
    showMessage(openaiMessage, 'Please enter an API key to test', 'error');
    return;
  }

  // Disable all controls during test
  openaiTestBtn.disabled = true;
  openaiSaveBtn.disabled = true;
  openaiDeleteBtn.disabled = true;
  openaiKeyInput.disabled = true;
  openaiTestBtn.innerHTML = '<span class="spinner"></span> Testing...';
  
  const result = await api.settings.testApiKey('openai', apiKey);
  
  // Re-enable controls
  openaiTestBtn.disabled = false;
  openaiSaveBtn.disabled = false;
  openaiDeleteBtn.disabled = false;
  openaiKeyInput.disabled = false;
  openaiTestBtn.textContent = 'Test';

  // Reload test status to get saved info
  const testStatus = await api.settings.getApiKeyTestStatus('openai');
  updateTestInfo('openai', testStatus);

  if (result.success) {
    const latency = result.latency || 0;
    showMessage(openaiMessage, `API key is valid! (${latency}ms)`, 'success');
    updateSaveStatus('API key tested successfully');
  } else {
    // Show actionable error message based on error code
    let errorMessage = result.error || 'API key test failed';
    if (result.errorCode === 'invalid_key') {
      errorMessage = 'Invalid API key. Please check that your key is correct and starts with "sk-".';
    } else if (result.errorCode === 'rate_limited') {
      errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
    } else if (result.errorCode === 'network') {
      errorMessage = 'Network error. Please check your internet connection and try again.';
    } else if (result.errorCode === 'timeout') {
      errorMessage = 'Connection timeout. Please check your internet connection and try again.';
    }
    showMessage(openaiMessage, errorMessage, 'error');
    updateSaveStatus('API key test failed');
  }
});

// Setup password reveal for Anthropic
setupPasswordReveal(anthropicKeyInput, anthropicRevealBtn);

// Anthropic input validation (on input)
anthropicKeyInput.addEventListener('input', async () => {
  // Trim whitespace automatically
  const trimmed = anthropicKeyInput.value.trim();
  if (anthropicKeyInput.value !== trimmed) {
    const cursorPos = anthropicKeyInput.selectionStart || 0;
    anthropicKeyInput.value = trimmed;
    anthropicKeyInput.setSelectionRange(cursorPos, cursorPos);
  }
  
  await validateApiKeyInput('anthropic', anthropicKeyInput, anthropicValidation);
});

// Anthropic paste handler
anthropicKeyInput.addEventListener('paste', async () => {
  // Wait for paste to complete, then validate
  setTimeout(async () => {
    await validateApiKeyInput('anthropic', anthropicKeyInput, anthropicValidation);
  }, 10);
});

// Anthropic handlers
anthropicSaveBtn.addEventListener('click', async () => {
  const apiKey = anthropicKeyInput.value.trim();
  if (!apiKey) {
    showMessage(anthropicMessage, 'Please enter an API key', 'error');
    return;
  }

  const isValid = await validateApiKeyInput('anthropic', anthropicKeyInput, anthropicValidation);
  if (!isValid) {
    showMessage(anthropicMessage, 'Invalid API key format. Anthropic keys start with sk-ant-', 'error');
    return;
  }

  anthropicSaveBtn.disabled = true;
  const result = await api.settings.storeApiKey('anthropic', apiKey);
  anthropicSaveBtn.disabled = false;

  if (result.success) {
    anthropicKeyInput.value = '';
    anthropicValidation.className = 'validation-message';
    anthropicValidation.textContent = '';
    const status = await api.settings.getApiKeyStatus('anthropic');
    updateApiKeyStatus('anthropic', status);
    showMessage(anthropicMessage, 'API key saved successfully', 'success');
    updateSaveStatus('API key saved');
  } else {
    showMessage(anthropicMessage, result.error || 'Failed to save API key', 'error');
  }
});

anthropicDeleteBtn.addEventListener('click', async () => {
  const confirmed = confirm(
    'Are you sure you want to remove the Anthropic API key?\n\n' +
    'This action cannot be undone. You will need to enter your API key again to use Anthropic.'
  );
  
  if (!confirmed) {
    return;
  }

  anthropicDeleteBtn.disabled = true;
  const result = await api.settings.deleteApiKey('anthropic');
  anthropicDeleteBtn.disabled = false;

  if (result.success) {
    const status = await api.settings.getApiKeyStatus('anthropic');
    updateApiKeyStatus('anthropic', status);
    showMessage(anthropicMessage, 'API key removed', 'success');
    updateSaveStatus('API key removed');
  } else {
    showMessage(anthropicMessage, 'Failed to remove API key', 'error');
  }
});

anthropicTestBtn.addEventListener('click', async () => {
  const apiKey = anthropicKeyInput.value.trim();
  if (!apiKey) {
    showMessage(anthropicMessage, 'Please enter an API key to test', 'error');
    return;
  }

  // Disable all controls during test
  anthropicTestBtn.disabled = true;
  anthropicSaveBtn.disabled = true;
  anthropicDeleteBtn.disabled = true;
  anthropicKeyInput.disabled = true;
  anthropicTestBtn.innerHTML = '<span class="spinner"></span> Testing...';
  
  const result = await api.settings.testApiKey('anthropic', apiKey);
  
  // Re-enable controls
  anthropicTestBtn.disabled = false;
  anthropicSaveBtn.disabled = false;
  anthropicDeleteBtn.disabled = false;
  anthropicKeyInput.disabled = false;
  anthropicTestBtn.textContent = 'Test';

  // Reload test status to get saved info
  const testStatus = await api.settings.getApiKeyTestStatus('anthropic');
  updateTestInfo('anthropic', testStatus);

  if (result.success) {
    const latency = result.latency || 0;
    showMessage(anthropicMessage, `API key is valid! (${latency}ms)`, 'success');
    updateSaveStatus('API key tested successfully');
  } else {
    // Show actionable error message based on error code
    let errorMessage = result.error || 'API key test failed';
    if (result.errorCode === 'invalid_key') {
      errorMessage = 'Invalid API key. Please check that your key is correct and starts with "sk-ant-".';
    } else if (result.errorCode === 'rate_limited') {
      errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
    } else if (result.errorCode === 'network') {
      errorMessage = 'Network error. Please check your internet connection and try again.';
    } else if (result.errorCode === 'timeout') {
      errorMessage = 'Connection timeout. Please check your internet connection and try again.';
    }
    showMessage(anthropicMessage, errorMessage, 'error');
    updateSaveStatus('API key test failed');
  }
});

// Workspace context handlers
workspaceEnabled.addEventListener('change', async () => {
  const enabled = workspaceEnabled.checked;
  
  // Update workspace UI visibility based on remote sources
  const sources = await api.settings.listContextSources();
  updateWorkspaceUIVisibility(sources);
  
  // Update other rows based on enabled state
  contextOptionsRow.style.display = enabled ? 'grid' : 'none';
  excludesRow.style.display = enabled ? 'grid' : 'none';
  
  const workspaceRoot = enabled ? (await api.settings.getWorkspaceContext()).workspaceRoot : undefined;
  const result = await api.settings.setWorkspaceContext(enabled, workspaceRoot ?? undefined);
  if (result.success) {
    updateSaveStatus(enabled ? 'Workspace context enabled' : 'Workspace context disabled');
  }
});

workspaceBrowseBtn.addEventListener('click', async () => {
  workspaceBrowseBtn.disabled = true;
  workspaceBrowseBtn.textContent = 'Selecting...';
  
  try {
    const result = await api.settings.pickWorkspaceFolder();
    workspaceBrowseBtn.disabled = false;
    workspaceBrowseBtn.textContent = 'Select Folder';
    
    if (result.cancelled) {
      return;
    }
    
    if (result.success && result.workspaceRoot) {
      updateWorkspacePath(result.workspaceRoot);
      workspaceEnabled.checked = true;
      
      // Update workspace UI visibility based on remote sources
      const sources = await api.settings.listContextSources();
      updateWorkspaceUIVisibility(sources);
      
      contextOptionsRow.style.display = 'grid';
      excludesRow.style.display = 'grid';
      await api.settings.setWorkspaceContext(true, result.workspaceRoot);
      await updateContextPreview(result.workspaceRoot);
      showMessage(workspaceMessage, 'Workspace folder selected', 'success');
      updateSaveStatus('Workspace folder selected');
    } else {
      showMessage(workspaceMessage, result.error || 'Failed to select workspace folder', 'error');
    }
  } catch {
    workspaceBrowseBtn.disabled = false;
    workspaceBrowseBtn.textContent = 'Select Folder';
    showMessage(workspaceMessage, 'Failed to open folder picker', 'error');
  }
});

workspaceClearBtn.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to clear the workspace folder? Analysis will not include workspace context.')) {
    return;
  }
  
  workspaceClearBtn.disabled = true;
  const enabled = workspaceEnabled.checked;
  const result = await api.settings.setWorkspaceContext(enabled, '');
  workspaceClearBtn.disabled = false;
  
  if (result.success) {
    updateWorkspacePath(null);
    contextPreview.style.display = 'none';
    showMessage(workspaceMessage, 'Workspace folder cleared', 'success');
    updateSaveStatus('Workspace folder cleared');
  } else {
    showMessage(workspaceMessage, 'Failed to clear workspace folder', 'error');
  }
});

// Context options handlers
includeFileTree.addEventListener('change', async () => {
  const options = await api.settings.getContextOptions();
  await api.settings.setContextOptions({
    includeFileTree: includeFileTree.checked,
    includeFileContents: options.includeFileContents,
    excludes: options.excludes,
  });
  updateSaveStatus('Context options updated');
  if (workspaceEnabled.checked && workspacePath.textContent !== 'No folder selected') {
    await updateContextPreview(workspacePath.textContent);
  }
});

includeFileContents.addEventListener('change', async () => {
  const options = await api.settings.getContextOptions();
  await api.settings.setContextOptions({
    includeFileTree: options.includeFileTree,
    includeFileContents: includeFileContents.checked,
    excludes: options.excludes,
  });
  updateSaveStatus('Context options updated');
  
  // Show/hide warning based on state
  if (includeFileContents.checked) {
    fileContentsWarning.style.display = 'block';
  } else {
    fileContentsWarning.style.display = 'none';
  }
  
  if (workspaceEnabled.checked && workspacePath.textContent !== 'No folder selected') {
    await updateContextPreview(workspacePath.textContent);
  }
});

// Exclude list handlers
function renderExcludeList(excludes: string[]): void {
  excludeList.innerHTML = '';
  if (excludes.length === 0) {
    excludeList.innerHTML = '<div style="color: #999; font-style: italic; padding: 8px;">No exclusions</div>';
    return;
  }
  
  excludes.forEach((pattern, index) => {
    const item = document.createElement('div');
    item.className = 'exclude-item';
    item.innerHTML = `
      <span>${escapeHtml(pattern)}</span>
      <button class="exclude-remove" data-index="${index}" style="background: #ffebee; color: #c62828; border: 1px solid #ef9a9a; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer;">Remove</button>
    `;
    excludeList.appendChild(item);
  });
  
  // Add remove handlers
  excludeList.querySelectorAll('.exclude-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const index = parseInt((btn as HTMLButtonElement).dataset.index || '0');
      const options = await api.settings.getContextOptions();
      const newExcludes = [...options.excludes];
      newExcludes.splice(index, 1);
      await api.settings.setContextOptions({
        includeFileTree: options.includeFileTree,
        includeFileContents: options.includeFileContents,
        excludes: newExcludes,
      });
      renderExcludeList(newExcludes);
      updateSaveStatus('Exclusion removed');
      if (workspaceEnabled.checked && workspacePath.textContent !== 'No folder selected') {
        await updateContextPreview(workspacePath.textContent);
      }
    });
  });
}



excludeAddBtn.addEventListener('click', async () => {
  const pattern = excludeInput.value.trim();
  if (!pattern) {
    showMessage(workspaceMessage, 'Please enter a pattern', 'error');
    return;
  }
  
  // Check for risky patterns
  const riskyPatterns = ['.env', 'secrets', '*.key', '*.pem', '*.p12', '*.p8', '*.pfx'];
  const isRisky = riskyPatterns.some(rp => pattern.includes(rp) || pattern === rp);
  
  if (isRisky && !confirm(`Warning: Pattern "${pattern}" matches sensitive file patterns. Are you sure you want to exclude it?`)) {
    return;
  }
  
  const options = await api.settings.getContextOptions();
  if (options.excludes.includes(pattern)) {
    showMessage(workspaceMessage, 'Pattern already exists', 'error');
    return;
  }
  
  const newExcludes = [...options.excludes, pattern];
  await api.settings.setContextOptions({
    includeFileTree: options.includeFileTree,
    includeFileContents: options.includeFileContents,
    excludes: newExcludes,
  });
  
  excludeInput.value = '';
  renderExcludeList(newExcludes);
  updateSaveStatus('Exclusion added');
  if (workspaceEnabled.checked && workspacePath.textContent !== 'No folder selected') {
    await updateContextPreview(workspacePath.textContent);
  }
});

excludeInput.addEventListener('keypress', async (e) => {
  if (e.key === 'Enter') {
    excludeAddBtn.click();
  }
});

excludeResetBtn.addEventListener('click', async () => {
  if (!confirm('Reset exclusions to defaults? This will replace your current exclusions.')) {
    return;
  }
  
  const defaultExcludes = [
    '.env',
    'node_modules',
    'dist',
    'build',
    'out',
    '.git',
    'secrets.*',
    '*.key',
    '*.pem',
    '*.p12',
  ];
  
  const options = await api.settings.getContextOptions();
  await api.settings.setContextOptions({
    includeFileTree: options.includeFileTree,
    includeFileContents: options.includeFileContents,
    excludes: defaultExcludes,
  });
  
  renderExcludeList(defaultExcludes);
  updateSaveStatus('Exclusions reset to defaults');
  if (workspaceEnabled.checked && workspacePath.textContent !== 'No folder selected') {
    await updateContextPreview(workspacePath.textContent);
  }
});

async function updateContextPreview(workspaceRoot: string | null): Promise<void> {
  // Check if we have any enabled sources (for unified context)
  const hasEnabledSources = await checkEnabledSources();
  
  if (!workspaceRoot || workspaceRoot === 'No folder selected') {
    if (!hasEnabledSources) {
      contextPreview.style.display = 'none';
      return;
    }
    // Continue with unified context even without workspace root
  }
  
  try {
    const preview = await api.settings.getContextPreview(workspaceRoot || undefined);
    if (preview.success && preview.fileCount !== undefined) {
      contextPreview.style.display = 'block';
      const sizeKB = Math.round((preview.totalSize || 0) / 1024);
      const sizeMB = (preview.totalSize || 0) / (1024 * 1024);
      const sizeDisplay = sizeMB >= 1 ? `${sizeMB.toFixed(1)} MB` : `${sizeKB} KB`;
      
      const topFilesList = preview.topFiles?.slice(0, 5).map(f => {
        const fileSizeKB = Math.round(f.size / 1024);
        return `  • ${escapeHtml(f.path)} (${fileSizeKB} KB)`;
      }).join('\n') || '';
      
      // Sources info
      const sourcesInfo = preview.sources && preview.sources.length > 0
        ? preview.sources.map(s => `  • ${escapeHtml(s.type)}: ${s.fileCount} files (${Math.round(s.size / 1024)} KB)`).join('\n')
        : '';
      
      // Secrets warning
      let secretsWarning = '';
      if (preview.secrets && preview.secrets.hasSecrets) {
        const riskColor = preview.secrets.riskLevel === 'high' ? '#c62828' : 
                          preview.secrets.riskLevel === 'medium' ? '#f57c00' : '#f9a825';
        const riskIcon = preview.secrets.riskLevel === 'high' ? '🔴' : 
                         preview.secrets.riskLevel === 'medium' ? '🟠' : '🟡';
        secretsWarning = `
          <div style="margin-top: 12px; padding: 10px; background: #fff3cd; border-left: 3px solid ${riskColor}; border-radius: 4px; font-size: 12px;">
            <div style="font-weight: 600; color: ${riskColor}; margin-bottom: 4px;">
              ${riskIcon} Security Warning: ${preview.secrets.matches.length} potential secret(s) detected
            </div>
            <div style="color: #856404; margin-bottom: 4px;">
              Risk level: <strong>${preview.secrets.riskLevel.toUpperCase()}</strong>
            </div>
            <div style="color: #856404; font-size: 11px;">
              • High risk: ${preview.secrets.summary.high}<br>
              • Medium risk: ${preview.secrets.summary.medium}<br>
              • Low risk: ${preview.secrets.summary.low}
            </div>
            ${preview.secrets.matches.length > 0 ? `
              <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #ffc107; color: #856404; font-size: 11px;">
                <strong>Top matches:</strong><br>
                ${preview.secrets.matches.slice(0, 3).map(m => 
                  `• ${escapeHtml(m.file)}:${m.line} - ${escapeHtml(m.description)}`
                ).join('<br>')}
                ${preview.secrets.matches.length > 3 ? `<br>... and ${preview.secrets.matches.length - 3} more` : ''}
              </div>
            ` : ''}
            <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #ffc107; color: #856404; font-size: 11px;">
              <strong>⚠️ Review your exclusions</strong> to ensure sensitive files are not included.
            </div>
          </div>
        `;
      }
      
      previewContent.innerHTML = `
        <div style="margin-bottom: 8px;">
          <strong>Files:</strong> ${preview.fileCount} files, ~${sizeDisplay} total
        </div>
        ${preview.treeEntryCount ? `<div style="margin-bottom: 8px;"><strong>Tree entries:</strong> ${preview.treeEntryCount}</div>` : ''}
        ${sourcesInfo ? `<div style="margin-bottom: 8px; font-size: 11px; color: #666;"><strong>Sources:</strong><pre style="margin: 4px 0 0 0; font-size: 11px;">${sourcesInfo}</pre></div>` : ''}
        ${topFilesList ? `<div style="margin-top: 8px; font-size: 11px; color: #666;"><strong>Top files:</strong><pre style="margin: 4px 0 0 0; font-size: 11px;">${topFilesList}</pre></div>` : ''}
        ${secretsWarning}
      `;
    } else {
      contextPreview.style.display = 'none';
    }
  } catch (error) {
    console.error('Failed to update context preview:', error);
    contextPreview.style.display = 'block';
    previewContent.innerHTML = `
      <div style="padding: 10px; background: #ffebee; border-left: 3px solid #c62828; border-radius: 4px; font-size: 12px; color: #c62828;">
        <div style="font-weight: 600; margin-bottom: 4px;">⚠️ Failed to load preview</div>
        <div style="color: #c62828;">
          ${error instanceof Error ? escapeHtml(error.message) : 'Unknown error occurred'}
        </div>
        <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #ef9a9a; color: #c62828; font-size: 11px;">
          Check your source configuration and try again.
        </div>
      </div>
    `;
  }
}

async function checkEnabledSources(): Promise<boolean> {
  try {
    const sources = await api.settings.listContextSources();
    return sources.some(s => s.enabled);
  } catch {
    return false;
  }
}

// Prompt handlers
promptEnabled.addEventListener('change', async () => {
  const enabled = promptEnabled.checked;
  promptEditorRow.style.display = enabled ? 'grid' : 'none';
  await api.settings.setPromptEnabled(enabled);
  if (enabled) {
    // Load prompt text if not already loaded
    if (!promptText.value.trim()) {
      const promptData = await api.settings.getPromptText();
      promptText.value = promptData.text || '';
      updatePromptStats(promptText.value);
    }
    updateSaveStatus('Custom prompt enabled');
  } else {
    updateSaveStatus('Custom prompt disabled (using default)');
  }
});

promptText.addEventListener('input', () => {
  updatePromptStats(promptText.value);
});

promptText.addEventListener('blur', async () => {
  if (promptText.value.trim()) {
    const result = await api.settings.importPrompt(promptText.value);
    if (result.success) {
      updateSaveStatus('Prompt saved');
    }
  }
});

promptResetBtn.addEventListener('click', async () => {
  if (confirm('Reset prompt to default?\n\nThis will:\n• Clear your custom prompt\n• Disable custom prompt\n• Use the default prompt\n\nThis cannot be undone.')) {
    promptText.value = '';
    updatePromptStats('');
    await api.settings.clearPrompt();
    promptEnabled.checked = false;
    promptEditorRow.style.display = 'none';
    updateSaveStatus('Prompt reset to default');
  }
});

promptImportBtn.addEventListener('click', async () => {
  // Create a file input element
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.md';
  input.style.display = 'none';
  
  input.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      if (!text.trim()) {
        showMessage(promptMessage, 'File is empty', 'error');
        return;
      }
      
      promptText.value = text;
      updatePromptStats(text);
      await api.settings.importPrompt(text);
      promptEnabled.checked = true;
      promptEditorRow.style.display = 'grid';
      updateSaveStatus('Prompt imported successfully');
      showMessage(promptMessage, `Prompt imported from ${file.name}`, 'success');
    } catch (error) {
      showMessage(promptMessage, 'Failed to import prompt file', 'error');
      console.error('Failed to import prompt:', error);
    } finally {
      document.body.removeChild(input);
    }
  });
  
  document.body.appendChild(input);
  input.click();
});

promptExportBtn.addEventListener('click', async () => {
  const text = promptText.value.trim();
  if (!text) {
    showMessage(promptMessage, 'No prompt to export', 'error');
    return;
  }
  
  try {
    // Create a blob and download link
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'custom-prompt.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    updateSaveStatus('Prompt exported');
    showMessage(promptMessage, 'Prompt exported to custom-prompt.txt', 'success');
  } catch (error) {
    showMessage(promptMessage, 'Failed to export prompt', 'error');
    console.error('Failed to export prompt:', error);
  }
});

promptPreviewBtn.addEventListener('click', async () => {
  const text = promptText.value || (await api.settings.getPromptText()).text;
  promptModalBody.textContent = text || 'No prompt saved.';
  openModal(promptModal);
});

promptModalClose.addEventListener('click', () => {
  closeModal(promptModal);
});

promptModal.addEventListener('click', (e) => {
  if (e.target === promptModal) {
    closeModal(promptModal);
  }
});

// Diagnostics handlers
copyDebugInfoBtn.addEventListener('click', async () => {
  try {
    const workspaceContext = await api.settings.getWorkspaceContext();
    const contextOptions = await api.settings.getContextOptions();
    
    const debugInfo = {
      version: appVersion.textContent,
      platform: appPlatform.textContent,
      settingsPath: settingsPath.textContent,
      provider: await api.settings.get('provider'),
      model: await api.settings.get('model'),
      workspaceEnabled: workspaceContext.enabled,
      workspaceRoot: workspaceContext.workspaceRoot ? 'Set' : 'Not set',
      includeFileTree: contextOptions.includeFileTree,
      includeFileContents: contextOptions.includeFileContents,
      excludeCount: contextOptions.excludes.length,
      // Explicitly exclude any API keys or sensitive data
      apiKeys: {
        openai: (await api.settings.getApiKeyStatus('openai')).hasKey ? 'Stored' : 'Not stored',
        anthropic: (await api.settings.getApiKeyStatus('anthropic')).hasKey ? 'Stored' : 'Not stored',
      },
      timestamp: new Date().toISOString(),
    };
    
    const text = JSON.stringify(debugInfo, null, 2);
    await navigator.clipboard.writeText(text);
    showToast('Debug info copied to clipboard (no secrets included)', 'success');
    updateSaveStatus('Debug info copied');
  } catch (error) {
    showToast('Failed to copy debug info', 'error');
    console.error('Failed to copy debug info:', error);
  }
});

openLogsBtn.addEventListener('click', async () => {
  try {
    const result = await api.settings.openLogsFolder();
    if (result.success) {
      showToast('Logs folder opened', 'success');
    } else {
      showToast(result.error || 'Failed to open logs folder', 'error');
    }
  } catch (error) {
    showToast('Failed to open logs folder', 'error');
    console.error('Failed to open logs folder:', error);
  }
});

resetAllBtn.addEventListener('click', async () => {
  const confirmed = confirm(
    'Are you sure you want to reset ALL settings?\n\n' +
    'This will:\n' +
    '• Clear all API keys\n' +
    '• Reset provider and model to defaults\n' +
    '• Clear workspace context\n' +
    '• Clear custom prompt\n' +
    '• Reset all preferences\n\n' +
    'This cannot be undone!'
  );
  
  if (!confirmed) return;
  
  try {
    const result = await api.settings.resetAllSettings();
    if (result.success) {
      showToast('All settings reset successfully', 'success');
      updateSaveStatus('Settings reset');
      // Reload settings to reflect changes
      await loadSettings();
    } else {
      showToast(result.error || 'Failed to reset settings', 'error');
    }
  } catch (error) {
    showToast('Failed to reset settings', 'error');
    console.error('Failed to reset settings:', error);
  }
});

// ============================================================================
// Context Sources UI
// ============================================================================

function updateWorkspaceUIVisibility(sources: any[]): void {
  // Check if there are any enabled GitHub/GitLab sources
  const hasEnabledRemoteSource = sources.some(
    source => source.enabled && (source.type === 'github' || source.type === 'gitlab')
  );
  
  // Hide/disable workspace UI when GitHub/GitLab sources are enabled
  if (hasEnabledRemoteSource) {
    workspaceRootRow.style.display = 'none';
    workspaceEnabled.disabled = false; // Keep checkbox enabled so user can still toggle context on/off
    workspaceBrowseBtn.disabled = true;
    workspaceClearBtn.disabled = true;
  } else {
    // Show workspace UI when no remote sources are enabled
    workspaceRootRow.style.display = workspaceEnabled.checked ? 'grid' : 'none';
    workspaceBrowseBtn.disabled = false;
    workspaceClearBtn.disabled = false;
  }
}

let loadContextSources = async function (): Promise<void> {
  try {
    const sources = await api.settings.listContextSources();
    
    // Update workspace UI visibility based on remote sources
    updateWorkspaceUIVisibility(sources);
    
    if (sources.length === 0) {
      contextSourcesList.innerHTML = '<div style="color: #999; font-style: italic; padding: 8px;">No sources added yet</div>';
      return;
    }
    
    contextSourcesList.innerHTML = '';
    sources.forEach(source => {
      const sourceEl = document.createElement('div');
      sourceEl.className = 'source-item';
      sourceEl.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 12px; background: white; border: 1px solid #e0e0e0; border-radius: 6px; margin-bottom: 8px;';
      
      const info = document.createElement('div');
      info.style.cssText = 'flex: 1;';
      
      const title = document.createElement('div');
      title.style.cssText = 'font-weight: 600; margin-bottom: 4px;';
      title.textContent = getSourceDisplayName(source);
      
      const details = document.createElement('div');
      details.style.cssText = 'font-size: 12px; color: #666;';
      details.textContent = getSourceDetails(source);
      
      info.appendChild(title);
      info.appendChild(details);
      
      const actions = document.createElement('div');
      actions.style.cssText = 'display: flex; gap: 8px; align-items: center;';
      
      const enabledCheckbox = document.createElement('input');
      enabledCheckbox.type = 'checkbox';
      enabledCheckbox.checked = source.enabled;
      enabledCheckbox.addEventListener('change', async () => {
        await api.settings.updateContextSource(source.id, { enabled: enabledCheckbox.checked });
        updateSaveStatus('Source updated');
        
        // Reload sources to update UI visibility
        await loadContextSources();
        
        // Update preview
        if (workspaceEnabled.checked) {
          await updateContextPreview(workspacePath.textContent || null);
        }
      });
      
      const removeBtn = document.createElement('button');
      removeBtn.className = 'danger';
      removeBtn.textContent = 'Remove';
      removeBtn.style.cssText = 'padding: 4px 8px; font-size: 12px;';
      removeBtn.addEventListener('click', async () => {
        if (confirm(`Remove source "${getSourceDisplayName(source)}"?`)) {
          await api.settings.removeContextSource(source.id);
          await loadContextSources();
          updateSaveStatus('Source removed');
          // Update preview
          if (workspaceEnabled.checked) {
            await updateContextPreview(workspacePath.textContent || null);
          }
        }
      });
      
      actions.appendChild(enabledCheckbox);
      actions.appendChild(removeBtn);
      
      sourceEl.appendChild(info);
      sourceEl.appendChild(actions);
      contextSourcesList.appendChild(sourceEl);
    });
  } catch (error) {
    console.error('Failed to load context sources:', error);
    contextSourcesList.innerHTML = '<div style="color: #c62828; padding: 8px;">Failed to load sources</div>';
    // Still try to update UI visibility even on error
    updateWorkspaceUIVisibility([]);
  }
}

function getSourceDisplayName(source: any): string {
  if (source.type === 'local' && source.scope?.path) {
    return `Local: ${source.scope.path}`;
  }
  if ((source.type === 'github' || source.type === 'gitlab') && source.scope?.owner && source.scope?.repo) {
    return `${source.type === 'github' ? 'GitHub' : 'GitLab'}: ${source.scope.owner}/${source.scope.repo}`;
  }
  return `${source.type} source`;
}

function getSourceDetails(source: any): string {
  const parts: string[] = [];
  if (source.scope?.defaultBranch) {
    parts.push(`branch: ${source.scope.defaultBranch}`);
  }
  if (source.scope?.pathScope) {
    parts.push(`path: ${source.scope.pathScope}`);
  }
  if (source.enabled) {
    parts.push('enabled');
  } else {
    parts.push('disabled');
  }
  return parts.join(' • ');
}

// Repo picker modal handlers
addSourceBtn.addEventListener('click', () => {
  openModal(repoPickerModal);
  repoProviderSelect.value = 'local';
  updateRepoPickerUI();
});

repoPickerModalClose.addEventListener('click', () => {
  closeAllModals();
});

repoCancelBtn.addEventListener('click', () => {
  closeAllModals();
});

repoPickerModal.addEventListener('click', (e) => {
  if (e.target === repoPickerModal) {
    closeAllModals();
  }
});

repoProviderSelect.addEventListener('change', () => {
  updateRepoPickerUI();
});

async function updateRepoPickerUI(): Promise<void> {
  const provider = repoProviderSelect.value;
  
  // Show/hide rows based on provider
  repoLocalRow.style.display = provider === 'local' ? 'block' : 'none';
  repoRemoteRow.style.display = (provider === 'github' || provider === 'gitlab') ? 'block' : 'none';
  repoAuthStatusRow.style.display = (provider === 'github' || provider === 'gitlab') ? 'block' : 'none';
  
  // Update auth status for GitHub/GitLab
  if (provider === 'github' || provider === 'gitlab') {
    await updateRepoAuthStatus(provider);
  }
  
  // Validate form
  validateRepoPickerForm();
}

async function updateRepoAuthStatus(provider: 'github' | 'gitlab'): Promise<void> {
  try {
    const status = await api.settings.getRepoAuthStatus(provider);
    
    if (status.authenticated) {
      repoAuthStatusText.textContent = `✓ Authenticated as ${status.username || 'user'}`;
      repoAuthStatusText.parentElement!.style.background = '#e8f5e9';
      repoAuthStatusText.parentElement!.style.color = '#2e7d32';
      repoConnectBtn.style.display = 'none';
      repoDisconnectBtn.style.display = 'inline-block';
      repoOAuthBtn.style.display = 'none';
    } else {
      repoAuthStatusText.textContent = '✗ Not authenticated';
      repoAuthStatusText.parentElement!.style.background = '#ffebee';
      repoAuthStatusText.parentElement!.style.color = '#c62828';
      repoConnectBtn.style.display = 'inline-block';
      repoDisconnectBtn.style.display = 'none';
      repoOAuthBtn.style.display = 'inline-block';
    }
  } catch {
    repoAuthStatusText.textContent = 'Error checking auth status';
    repoAuthStatusText.parentElement!.style.background = '#fff3cd';
    repoAuthStatusText.parentElement!.style.color = '#856404';
  }
}

function validateRepoPickerForm(): void {
  const provider = repoProviderSelect.value;
  let valid = false;
  
  if (provider === 'local') {
    valid = !!repoLocalPath.value.trim();
  } else if (provider === 'github' || provider === 'gitlab') {
    const repoMatch = repoSearchInput.value.trim().match(/^([^/]+)\/([^/]+)$/);
    valid = !!repoMatch;
  }
  
  repoAddBtn.disabled = !valid;
}

repoLocalBrowse.addEventListener('click', async () => {
  const result = await api.settings.pickWorkspaceFolder();
  if (result.success && result.workspaceRoot) {
    repoLocalPath.value = result.workspaceRoot;
    validateRepoPickerForm();
  }
});

repoSearchInput.addEventListener('input', () => {
  validateRepoPickerForm();
});

repoConnectBtn.addEventListener('click', async () => {
  const provider = repoProviderSelect.value as 'github' | 'gitlab';
  closeModal(repoPickerModal);
  setTimeout(() => {
    showTokenInputModal(provider);
  }, 100);
});

// Modal management
function closeAllModals(): void {
  repoPickerModal.classList.remove('open');
  tokenInputModal.classList.remove('open');
  oauthModal.classList.remove('open');
  if (promptModal) {
    promptModal.classList.remove('open');
  }
}

function openModal(modal: HTMLElement): void {
  // Close all modals first
  closeAllModals();
  // Small delay to ensure smooth transition
  setTimeout(() => {
    modal.classList.add('open');
  }, 50);
}

function closeModal(modal: HTMLElement, returnTo?: HTMLElement): void {
  modal.classList.remove('open');
  if (returnTo) {
    setTimeout(() => {
      returnTo.classList.add('open');
    }, 100);
  }
}

// Token input modal handlers
tokenInputModalClose.addEventListener('click', () => {
  tokenInputField.value = '';
  closeModal(tokenInputModal, repoPickerModal);
});

tokenInputCancelBtn.addEventListener('click', () => {
  tokenInputField.value = '';
  closeModal(tokenInputModal, repoPickerModal);
});

tokenInputModal.addEventListener('click', (e) => {
  if (e.target === tokenInputModal) {
    tokenInputField.value = '';
    closeModal(tokenInputModal, repoPickerModal);
  }
});

tokenInputSubmitBtn.addEventListener('click', async () => {
  if (!tokenInputProvider) return;
  
  const token = tokenInputField.value.trim();
  if (!token) {
    showToast('Please enter a token', 'error');
    return;
  }
  
  tokenInputSubmitBtn.disabled = true;
  tokenInputSubmitBtn.textContent = 'Connecting...';
  
  const result = await api.settings.connectRepoProvider(tokenInputProvider, token);
  
  tokenInputSubmitBtn.disabled = false;
  tokenInputSubmitBtn.textContent = 'Connect';
  
  if (result.success) {
    tokenInputField.value = '';
    showToast(`Connected to ${tokenInputProvider} as ${result.username}`, 'success');
    await updateRepoAuthStatus(tokenInputProvider);
    
    // Check if we have pending source data to add
    const repoMatch = repoSearchInput.value.trim().match(/^([^/]+)\/([^/]+)$/);
    if (repoMatch && tokenInputProvider) {
      // Auto-add the source after successful auth
      const source: any = {
        type: tokenInputProvider,
        enabled: true,
        scope: {
          provider: tokenInputProvider,
          owner: repoMatch[1],
          repo: repoMatch[2],
          defaultBranch: repoBranchInput.value.trim() || 'main',
          includeFileTree: repoIncludeTree.checked,
          includeFileContents: repoIncludeContents.checked,
        },
        authRef: `${tokenInputProvider}:user:${result.username}`,
      };
      
      if (repoPathScopeInput.value.trim()) {
        source.scope.pathScope = repoPathScopeInput.value.trim();
      }
      
      const addResult = await api.settings.addContextSource(source);
      if (addResult.success) {
        closeModal(tokenInputModal);
        closeModal(repoPickerModal);
        await loadContextSources();
        updateSaveStatus('Source added');
        showToast('Repository source added successfully', 'success');
        
        // Reset form
        repoProviderSelect.value = 'local';
        repoLocalPath.value = '';
        repoSearchInput.value = '';
        repoBranchInput.value = 'main';
        repoPathScopeInput.value = '';
        repoIncludeTree.checked = true;
        repoIncludeContents.checked = true;
        
        // Update preview
        if (workspaceEnabled.checked) {
          await updateContextPreview(workspacePath.textContent || null);
        }
        return;
      }
    }
    
    // Otherwise just return to repo picker
    closeModal(tokenInputModal, repoPickerModal);
  } else {
    showToast(result.error || 'Failed to connect', 'error');
  }
});

tokenInputField.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    tokenInputSubmitBtn.click();
  }
});

// Password reveal for token input
tokenInputReveal.addEventListener('mousedown', () => {
  tokenInputField.type = 'text';
  tokenInputReveal.textContent = '👁️';
});
tokenInputReveal.addEventListener('mouseup', () => {
  tokenInputField.type = 'password';
  tokenInputReveal.textContent = '👁';
});
tokenInputReveal.addEventListener('mouseleave', () => {
  tokenInputField.type = 'password';
  tokenInputReveal.textContent = '👁';
});

async function showTokenInputModal(provider: 'github' | 'gitlab'): Promise<void> {
  tokenInputProvider = provider;
  tokenInputProviderName.textContent = provider === 'github' ? 'GitHub' : 'GitLab';
  tokenInputField.value = '';
  
  // Set help link
  const helpUrl = provider === 'github' 
    ? 'https://github.com/settings/tokens'
    : 'https://gitlab.com/-/user_settings/personal_access_tokens';
  tokenInputHelpLink.innerHTML = `
    <a href="${helpUrl}" target="_blank" style="color: #1976d2; text-decoration: none;">
      ${provider === 'github' ? 'github.com/settings/tokens' : 'gitlab.com/-/user_settings/personal_access_tokens'}
    </a>
  `;
  
  openModal(tokenInputModal);
  // Focus after modal is visible
  setTimeout(() => {
    tokenInputField.focus();
  }, 150);
}

repoDisconnectBtn.addEventListener('click', async () => {
  const provider = repoProviderSelect.value as 'github' | 'gitlab';
  if (confirm(`Disconnect from ${provider}?`)) {
    const result = await api.settings.disconnectRepoProvider(provider);
    if (result.success) {
      showToast(`Disconnected from ${provider}`, 'success');
      await updateRepoAuthStatus(provider);
    } else {
      showToast(result.error || 'Failed to disconnect', 'error');
    }
  }
});

repoOAuthBtn.addEventListener('click', async () => {
  const provider = repoProviderSelect.value as 'github' | 'gitlab';
  closeModal(repoPickerModal);
  setTimeout(() => {
    startOAuthFlow(provider);
  }, 100);
});

// OAuth flow handlers
oauthModalClose.addEventListener('click', () => {
  stopOAuthPolling();
  closeModal(oauthModal, repoPickerModal);
});

oauthCancelBtn.addEventListener('click', () => {
  stopOAuthPolling();
  closeModal(oauthModal, repoPickerModal);
});

oauthModal.addEventListener('click', (e) => {
  if (e.target === oauthModal) {
    stopOAuthPolling();
    closeModal(oauthModal, repoPickerModal);
  }
});

async function startOAuthFlow(provider: 'github' | 'gitlab'): Promise<void> {
  
  // Reset UI
  oauthStepInit.style.display = 'block';
  oauthStepCode.style.display = 'none';
  oauthStepSuccess.style.display = 'none';
  oauthStepError.style.display = 'none';
  oauthProviderName.textContent = provider === 'github' ? 'GitHub' : 'GitLab';
  
  openModal(oauthModal);
  
  try {
    // Start OAuth device flow
    const flowResult = await api.settings.startOAuthFlow(provider);
    
    if (!flowResult.success || !flowResult.deviceCode) {
      showOAuthError(flowResult.error || 'Failed to start OAuth flow');
      return;
    }
    
    // Store device code and interval
    oauthDeviceCode = flowResult.deviceCode;
    oauthPollInterval = flowResult.interval || 5;
    
    // Show code step
    oauthStepInit.style.display = 'none';
    oauthStepCode.style.display = 'block';
    
    // Display user code
    oauthUserCode.textContent = flowResult.userCode || '';
    
    // Display verification URI
    const verificationUri = flowResult.verificationUri || '';
    oauthVerificationUri.textContent = verificationUri;
    const verificationLink = new URL(flowResult.verificationUriComplete || verificationUri);
    const expectedHost = provider === 'github' ? 'github.com' : 'gitlab.com';
    if (verificationLink.protocol !== 'https:' || verificationLink.hostname !== expectedHost || verificationLink.username || verificationLink.password) {
      throw new Error('Invalid provider verification URL');
    }
    oauthOpenLink.href = verificationLink.href;
    
    // Start polling for token
    startOAuthPolling(provider, oauthDeviceCode, oauthPollInterval);
    
  } catch (error) {
    showOAuthError(error instanceof Error ? error.message : 'Failed to start OAuth flow');
  }
}

function startOAuthPolling(provider: 'github' | 'gitlab', deviceCode: string, initialInterval: number): void {
  // Stop any existing polling
  stopOAuthPolling();
  
  let currentInterval = initialInterval;
  oauthPollInterval = initialInterval;
  
  // Update status
  oauthPollingStatus.innerHTML = `
    <div class="spinner" style="display: inline-block; margin-right: 8px;"></div>
    <span>Waiting for authorization...</span>
  `;
  
  // Poll for token
  const poll = async () => {
    try {
      const result = await api.settings.pollOAuthToken(provider, deviceCode, currentInterval);
      
      if (result.success && result.accessToken) {
        // Token received!
        stopOAuthPolling();
        
        // Update polling status
        oauthPollingStatus.innerHTML = `
          <div style="color: #2e7d32;">✓ Token received! Storing...</div>
        `;
        
        // Store the token (username will be fetched during validation)
        const connectResult = await api.settings.connectRepoProvider(provider, result.accessToken);
        
        if (connectResult.success) {
          // Show success
          oauthStepCode.style.display = 'none';
          oauthStepSuccess.style.display = 'block';
          
          // Update auth status
          await updateRepoAuthStatus(provider);
          
          // If we have pending source data, try to add it now
          const repoMatch = repoSearchInput.value.trim().match(/^([^/]+)\/([^/]+)$/);
          if (repoMatch) {
            // Auto-add the source after successful auth
            const source: any = {
              type: provider,
              enabled: true,
              scope: {
                provider: provider,
                owner: repoMatch[1],
                repo: repoMatch[2],
                defaultBranch: repoBranchInput.value.trim() || 'main',
                includeFileTree: repoIncludeTree.checked,
                includeFileContents: repoIncludeContents.checked,
              },
              authRef: `${provider}:user:${connectResult.username || 'user'}`,
            };
            
            if (repoPathScopeInput.value.trim()) {
              source.scope.pathScope = repoPathScopeInput.value.trim();
            }
            
            const addResult = await api.settings.addContextSource(source);
            if (addResult.success) {
              // Close modal after 2 seconds
              setTimeout(async () => {
                closeModal(oauthModal);
                closeModal(repoPickerModal);
                await loadContextSources();
                updateSaveStatus('Source added');
                showToast(`Repository source added successfully`, 'success');
                
                // Reset form
                repoProviderSelect.value = 'local';
                repoLocalPath.value = '';
                repoSearchInput.value = '';
                repoBranchInput.value = 'main';
                repoPathScopeInput.value = '';
                repoIncludeTree.checked = true;
                repoIncludeContents.checked = true;
                
                // Update preview
                if (workspaceEnabled.checked) {
                  await updateContextPreview(workspacePath.textContent || null);
                }
              }, 2000);
              return;
            } else {
              // If adding source failed, just return to repo picker
              setTimeout(() => {
                closeModal(oauthModal, repoPickerModal);
                showToast(`Authenticated but failed to add source: ${addResult.error}`, 'error');
              }, 2000);
              return;
            }
          }
          
          // Otherwise just return to repo picker
          setTimeout(() => {
            closeModal(oauthModal, repoPickerModal);
            showToast(`Successfully authenticated with ${provider} as ${connectResult.username || 'user'}`, 'success');
          }, 2000);
        } else {
          showOAuthError(connectResult.error || 'Failed to store authentication token');
        }
      } else {
        // Handle errors
        if (result.errorCode === 'expired_token') {
          stopOAuthPolling();
          showOAuthError('Device code expired. Please try again.');
        } else if (result.errorCode === 'access_denied') {
          stopOAuthPolling();
          showOAuthError('Access was denied. Please try again.');
        } else if (result.errorCode === 'authorization_pending') {
          // Continue polling
          oauthPollingStatus.innerHTML = `
            <div class="spinner" style="display: inline-block; margin-right: 8px;"></div>
            <span>Waiting for authorization...</span>
          `;
        } else if (result.errorCode === 'slow_down') {
          // Increase interval and restart polling with new interval
          currentInterval += 5;
          oauthPollInterval = currentInterval;
          oauthPollingStatus.innerHTML = `
            <div class="spinner" style="display: inline-block; margin-right: 8px;"></div>
            <span>Waiting for authorization (slowed down)...</span>
          `;
          // Restart polling with new interval
          stopOAuthPolling();
          setTimeout(() => {
            startOAuthPolling(provider, deviceCode, currentInterval);
          }, currentInterval * 1000);
        } else {
          // Network or other error - continue polling but show warning
          oauthPollingStatus.innerHTML = `
            <div style="color: #f57c00; margin-bottom: 4px;">⚠️ ${escapeHtml(result.error || 'Polling error')}</div>
            <div class="spinner" style="display: inline-block; margin-right: 8px;"></div>
            <span style="font-size: 12px;">Retrying...</span>
          `;
        }
      }
    } catch (error) {
      // Only stop on fatal errors
      if (error instanceof Error && (error.message.includes('expired') || error.message.includes('denied'))) {
        stopOAuthPolling();
        showOAuthError(error.message);
      } else {
        // Network error - continue polling
        oauthPollingStatus.innerHTML = `
          <div style="color: #f57c00; margin-bottom: 4px;">⚠️ ${escapeHtml(error instanceof Error ? error.message : 'Network error')}</div>
          <div class="spinner" style="display: inline-block; margin-right: 8px;"></div>
          <span style="font-size: 12px;">Retrying...</span>
        `;
      }
    }
  };
  
  // Poll immediately, then at intervals
  poll();
  oauthPollingInterval = setInterval(poll, currentInterval * 1000) as any;
}

function stopOAuthPolling(): void {
  if (oauthPollingInterval) {
    clearInterval(oauthPollingInterval);
    oauthPollingInterval = null;
  }
  oauthDeviceCode = null;
}

function showOAuthError(message: string): void {
  oauthStepInit.style.display = 'none';
  oauthStepCode.style.display = 'none';
  oauthStepSuccess.style.display = 'none';
  oauthStepError.style.display = 'block';
  oauthErrorMessage.textContent = message;
  stopOAuthPolling();
}

repoAddBtn.addEventListener('click', async () => {
  const provider = repoProviderSelect.value;
  const source: any = {
    type: provider,
    enabled: true,
    scope: {},
  };
  
  if (provider === 'local') {
    source.scope.path = repoLocalPath.value.trim();
  } else if (provider === 'github' || provider === 'gitlab') {
    const repoMatch = repoSearchInput.value.trim().match(/^([^/]+)\/([^/]+)$/);
    if (!repoMatch) {
      showToast('Invalid repository format. Use owner/repo', 'error');
      return;
    }
    
    source.scope.provider = provider;
    source.scope.owner = repoMatch[1];
    source.scope.repo = repoMatch[2];
    source.scope.defaultBranch = repoBranchInput.value.trim() || 'main';
    if (repoPathScopeInput.value.trim()) {
      source.scope.pathScope = repoPathScopeInput.value.trim();
    }
    
    // Check auth status - if not authenticated, open token input modal
    const authStatus = await api.settings.getRepoAuthStatus(provider);
    if (!authStatus.authenticated) {
      // Close repo picker modal and open token input modal
      // The token input modal will auto-add the source after successful auth
      closeModal(repoPickerModal);
      setTimeout(() => {
        showTokenInputModal(provider);
      }, 100);
      showToast(`Please authenticate with ${provider} to add this repository`, 'info');
      return;
    }
    source.authRef = `${provider}:user:${authStatus.username}`;
  }
  
  source.scope.includeFileTree = repoIncludeTree.checked;
  source.scope.includeFileContents = repoIncludeContents.checked;
  
  const result = await api.settings.addContextSource(source);
  
  if (result.success) {
    showToast('Source added successfully', 'success');
    closeModal(repoPickerModal);
    await loadContextSources();
    updateSaveStatus('Source added');
    
    // Update preview
    if (workspaceEnabled.checked) {
      await updateContextPreview(workspacePath.textContent || null);
    }
    
    // Reset form
    repoProviderSelect.value = 'local';
    repoLocalPath.value = '';
    repoSearchInput.value = '';
    repoBranchInput.value = 'main';
    repoPathScopeInput.value = '';
    repoIncludeTree.checked = true;
    repoIncludeContents.checked = true;
  } else {
    // Show error with action hint if available
    const errorMsg = result.error || 'Failed to add source';
    const actionHint = (result as any).actionHint;
    const fullMessage = actionHint ? `${errorMsg}\n\n${actionHint}` : errorMsg;
    showToast(fullMessage, 'error');
    
    // If auth required, highlight the connect button
    if ((result as any).errorCode === 'auth_required') {
      repoOAuthBtn.style.display = 'inline-block';
      repoConnectBtn.style.display = 'inline-block';
    }
  }
});

// Initialize
loadSettings().catch(error => {
  console.error('Failed to load settings:', error);
});

// Load context sources on startup
loadContextSources().catch(error => {
  console.error('Failed to load context sources:', error);
});

// Update preview when sources change
const originalLoadContextSources = loadContextSources;
loadContextSources = async () => {
  await originalLoadContextSources();
  // Update preview if context is enabled
  if (workspaceEnabled.checked) {
    await updateContextPreview(workspacePath.textContent || null);
  }
};
