import type { AIResponse, ScreenshotAnalysis } from "@shared-types/ai-response";
import { escapeHtml, formatAnswer, normalizeSeverity } from "./utils/formatting";

// Element references
let statusIcon: HTMLDivElement;
let statusText: HTMLSpanElement;
let confidenceBadge: HTMLDivElement;
let captureBtn: HTMLButtonElement;
let runAgainBtn: HTMLButtonElement;
let exportBtn: HTMLButtonElement;
let feedbackButtons: HTMLDivElement;
let feedbackPositiveBtn: HTMLButtonElement;
let feedbackNegativeBtn: HTMLButtonElement;
let screenshotPreview: HTMLDivElement;
let screenshotMetadata: HTMLDivElement;
let tabButtons: NodeListOf<HTMLButtonElement>;
let tabContents: NodeListOf<HTMLDivElement>;
let toastEl: HTMLDivElement;
let screenshotViewer: HTMLDivElement;
let viewerImage: HTMLImageElement;
let viewerContent: HTMLDivElement;
let viewerZoomLevel: HTMLSpanElement;
let viewerZoomInBtn: HTMLButtonElement;
let viewerZoomOutBtn: HTMLButtonElement;
let viewerResetBtn: HTMLButtonElement;
let viewerCloseBtn: HTMLButtonElement;
let viewerRegionsCanvas: HTMLCanvasElement;
let api: any;

// State
let lastResult: AIResponse<ScreenshotAnalysis> | null = null;
let feedbackSubmitted: 'positive' | 'negative' | null = null;
let activeTab: string = 'issues';
const sectionCopyData: Map<string, string> = new Map();
let allIssues: any[] = [];
let filteredIssues: any[] = [];
let filterSeverity: 'all' | 'high' | 'medium' | 'low' = 'all';
let sortMode: 'severity' | 'slide' | 'type' = 'severity';
let allExpanded: boolean = false;

// Initialize elements
function initializeElements() {
  statusIcon = document.getElementById("status-icon") as HTMLDivElement;
  statusText = document.getElementById("status-text") as HTMLSpanElement;
  confidenceBadge = document.getElementById("confidence-badge") as HTMLDivElement;
  captureBtn = document.getElementById("capture-btn") as HTMLButtonElement;
  runAgainBtn = document.getElementById("run-again-btn") as HTMLButtonElement;
  exportBtn = document.getElementById("export-btn") as HTMLButtonElement;
  feedbackButtons = document.getElementById("feedback-buttons") as HTMLDivElement;
  feedbackPositiveBtn = document.getElementById("feedback-positive") as HTMLButtonElement;
  feedbackNegativeBtn = document.getElementById("feedback-negative") as HTMLButtonElement;
  screenshotPreview = document.getElementById("screenshot-preview") as HTMLDivElement;
  screenshotMetadata = document.getElementById("screenshot-metadata") as HTMLDivElement;
  tabButtons = document.querySelectorAll('.findings-tab') as NodeListOf<HTMLButtonElement>;
  tabContents = document.querySelectorAll('.tab-content') as NodeListOf<HTMLDivElement>;
  toastEl = document.getElementById("toast") as HTMLDivElement;
  screenshotViewer = document.getElementById("screenshot-viewer") as HTMLDivElement;
  viewerImage = document.getElementById("viewer-image") as HTMLImageElement;
  viewerContent = document.getElementById("viewer-content") as HTMLDivElement;
  viewerZoomLevel = document.getElementById("viewer-zoom-level") as HTMLSpanElement;
  viewerZoomInBtn = document.getElementById("viewer-zoom-in") as HTMLButtonElement;
  viewerZoomOutBtn = document.getElementById("viewer-zoom-out") as HTMLButtonElement;
  viewerResetBtn = document.getElementById("viewer-reset") as HTMLButtonElement;
  viewerCloseBtn = document.getElementById("viewer-close") as HTMLButtonElement;
  viewerRegionsCanvas = document.getElementById("viewer-regions") as HTMLCanvasElement;

  // Use typed API from preload bridge
  if (!window.api) {
    console.error('API not available - preload script may not have loaded');
    updateStatus('error', 'Capture unavailable (preload not loaded)');
    return false;
  }
  api = window.api;
  
  if (!captureBtn) {
    console.error('Capture button not found');
    return false;
  }
  
  return true;
}

// Update status bar
function updateStatus(state: 'idle' | 'capturing' | 'analyzing' | 'success' | 'error', message?: string) {
  
  // Update icon
  statusIcon.className = `status-icon ${state}`;
  
  // Update text
  switch (state) {
    case 'idle':
      statusText.textContent = 'Ready';
      break;
    case 'capturing':
      statusText.textContent = 'Capturing screenshot...';
      break;
    case 'analyzing':
      statusText.textContent = 'Analyzing screenshot...';
      break;
    case 'success':
      statusText.textContent = message || 'Analysis complete';
      break;
    case 'error':
      statusText.textContent = message || 'Error occurred';
      break;
  }
  
  // Update button states
  runAgainBtn.disabled = state !== 'success';
  exportBtn.disabled = state !== 'success';
  
  // Show/hide feedback buttons
  if (state === 'success') {
    feedbackButtons.classList.remove('hidden');
    feedbackPositiveBtn.disabled = false;
    feedbackNegativeBtn.disabled = false;
  } else {
    feedbackButtons.classList.add('hidden');
    feedbackPositiveBtn.disabled = true;
    feedbackNegativeBtn.disabled = true;
  }
}

// Update confidence badge
function updateConfidence(confidence: number) {
  if (confidence === undefined || confidence === null) {
    confidenceBadge.classList.add('hidden');
    return;
  }
  
  const percent = Math.round(confidence * 100);
  let level: 'low' | 'medium' | 'high';
  
  if (percent >= 70) {
    level = 'high';
  } else if (percent >= 40) {
    level = 'medium';
  } else {
    level = 'low';
  }
  
  confidenceBadge.className = `confidence-badge ${level}`;
  confidenceBadge.textContent = `${level.charAt(0).toUpperCase() + level.slice(1)} (${percent}%)`;
  confidenceBadge.title = `Confidence: ${percent}%`;
  confidenceBadge.classList.remove('hidden');
}

// Switch tabs
function switchTab(tabName: string) {
  activeTab = tabName;
  
  // Update tab buttons
  tabButtons.forEach(btn => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
  
  // Update tab contents
  tabContents.forEach(content => {
    const contentTab = content.id.replace('content-', '');
    content.hidden = contentTab !== tabName;
  });
}

// Setup tab switching
function setupTabs() {
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      if (tabName) {
        switchTab(tabName);
      }
    });
  });
}

// Update screenshot preview
function updateScreenshotPreview(dataUrl: string | null) {
  
  if (!dataUrl) {
    screenshotPreview.className = 'screenshot-preview empty';
    screenshotPreview.innerHTML = `
      <div class="empty-state-icon">📸</div>
      <div class="empty-state-title">No screenshot</div>
      <div class="empty-state-text">Capture a screenshot to see it here</div>
    `;
    screenshotMetadata.classList.add('hidden');
    return;
  }
  
  screenshotPreview.className = 'screenshot-preview';
  screenshotPreview.replaceChildren();
  const previewImage = document.createElement('img');
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) return;
  previewImage.src = dataUrl;
  previewImage.alt = 'Screenshot';
  previewImage.id = 'screenshot-img';
  screenshotPreview.appendChild(previewImage);
  
  // Make image clickable to open in modal viewer
  const img = screenshotPreview.querySelector('#screenshot-img') as HTMLImageElement;
  if (img) {
    img.addEventListener('click', () => {
      openScreenshotViewer(dataUrl);
    });
  }
  
  screenshotMetadata.classList.remove('hidden');
}

// Update screenshot metadata
function updateScreenshotMetadata(metadata: any) {
  if (!metadata) {
    screenshotMetadata.innerHTML = '';
    return;
  }
  
  let html = '';
  if (metadata.timestamp) {
    html += `<div class="metadata-item"><strong>Captured:</strong><span>${new Date(metadata.timestamp).toLocaleString()}</span></div>`;
  }
  if (metadata.width && metadata.height) {
    html += `<div class="metadata-item"><strong>Dimensions:</strong><span>${escapeHtml(metadata.width)} × ${escapeHtml(metadata.height)}</span></div>`;
  }
  if (metadata.size) {
    html += `<div class="metadata-item"><strong>Size:</strong><span>${formatBytes(metadata.size)}</span></div>`;
  }
  
  screenshotMetadata.innerHTML = html || '<div class="metadata-item"><span>No metadata available</span></div>';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Show toast notification
function showToast(message: string, type: 'success' | 'info' | 'error' = 'info') {
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`;
  toastEl.classList.add('show');
  
  setTimeout(() => {
    toastEl.classList.remove('show');
  }, 3000);
}

// Normalize issue data
function normalizeIssue(issue: any): any {
  const type = issue.type || issue.category || 'Issue';
  const severity = normalizeSeverity(issue?.severity);
  
  // Try to extract statement text from various possible fields
  let statement = issue.risk || issue.text || issue.message || issue.issue || issue.problem || issue.content;
  
  // If still no statement and it's an object, try to extract from object properties
  if (!statement && typeof issue === 'object' && issue !== null) {
    // Try common text-like properties
    const textFields = ['description', 'summary', 'note', 'comment', 'title', 'name', 'label'];
    for (const field of textFields) {
      if (issue[field] && typeof issue[field] === 'string') {
        statement = issue[field];
        break;
      }
    }
    
    // If still nothing, try to stringify the object in a meaningful way
    if (!statement) {
      const entries = Object.entries(issue).filter(([_, v]) => 
        v !== null && v !== undefined && typeof v === 'string' && v.length > 0
      );
      if (entries.length > 0) {
        statement = entries.map(([k, v]) => `${k}: ${v}`).join(', ');
      } else {
        statement = 'Issue detected';
      }
    }
  }
  
  // Fallback to string conversion only if it's not an object
  if (!statement) {
    statement = typeof issue === 'string' ? issue : 'Issue detected';
  }
  
  const title = statement.length > 80 ? statement.substring(0, 80) + '...' : statement;
  const details = issue.details || issue.description || issue.explanation || '';
  const evidence = issue.evidence || issue.proof || issue.location || '';
  const suggestion = issue.suggestion || issue.fix || issue.recommendation || issue.recommendedFix || '';
  const slide = issue.slide || issue.page || '';
  
  return {
    type,
    severity,
    statement,
    title,
    details,
    evidence,
    suggestion,
    slide,
    raw: issue
  };
}

// Filter issues
function filterIssues(issues: any[]): any[] {
  if (filterSeverity === 'all') {
    return issues;
  }
  return issues.filter(issue => issue.severity === filterSeverity);
}

// Sort issues
function sortIssues(issues: any[]): any[] {
  const sorted = [...issues];
  
  switch (sortMode) {
    case 'severity': {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      sorted.sort((a, b) => (severityOrder[b.severity as keyof typeof severityOrder] || 0) - (severityOrder[a.severity as keyof typeof severityOrder] || 0));
      break;
    }
    case 'slide':
      sorted.sort((a, b) => {
        const slideA = parseInt(a.slide) || 0;
        const slideB = parseInt(b.slide) || 0;
        return slideA - slideB;
      });
      break;
    case 'type':
      sorted.sort((a, b) => a.type.localeCompare(b.type));
      break;
  }
  
  return sorted;
}

// Render issue card
function renderIssueCard(issue: any, index: number): string {
  const hasCollapsible = issue.evidence || issue.suggestion;
  const isExpanded = allExpanded;
  
  let html = `
    <div class="issue-card" data-issue-index="${index}" data-severity="${issue.severity}">
      <div class="issue-header">
        <span class="issue-type-badge">${escapeHtml(issue.type)}</span>
        <span class="issue-severity-badge ${issue.severity}">${issue.severity}</span>
        ${issue.slide ? `<span class="issue-slide">— Slide ${escapeHtml(String(issue.slide))}</span>` : ''}
      </div>
      <div class="issue-title">${escapeHtml(issue.title)}</div>
      <div class="issue-statement">${escapeHtml(issue.statement)}</div>
      ${issue.details ? `<div class="issue-statement" style="margin-top: 8px; font-size: 13px; color: #888;">${escapeHtml(issue.details)}</div>` : ''}
  `;
  
  if (hasCollapsible) {
    html += `
      <div class="issue-collapsible ${isExpanded ? 'expanded' : ''}">
        ${issue.evidence ? `
          <div class="issue-collapsible-header" data-toggle="evidence-${index}">
            <span class="issue-collapsible-icon">▶</span>
            <span>Evidence</span>
          </div>
          <div class="issue-collapsible-content" id="evidence-${index}">
            <div class="issue-evidence">${escapeHtml(issue.evidence)}</div>
          </div>
        ` : ''}
        ${issue.suggestion ? `
          <div class="issue-collapsible-header" data-toggle="suggestion-${index}">
            <span class="issue-collapsible-icon">▶</span>
            <span>Suggested Fix</span>
          </div>
          <div class="issue-collapsible-content" id="suggestion-${index}">
            <div class="issue-suggestion">${escapeHtml(issue.suggestion)}</div>
          </div>
        ` : ''}
      </div>
    `;
  }
  
  // Actions
  html += `
      <div class="issue-actions">
        <button class="issue-action-btn copy" data-copy-issue="${index}" title="Copy issue">
          📋 Copy issue
        </button>
      </div>
    </div>
  `;
  
  return html;
}

// Detect if response is SDXL format
function isSDXLFormat(analysis: any): boolean {
  return !!(analysis.tags || analysis.booru_format || analysis.primary_tags);
}

// Render SDXL tags tab (replaces issues tab for SDXL responses)
function renderSDXLTagsTab(analysis: any) {
  const content = document.getElementById('content-issues') as HTMLDivElement;

  // Update tab label
  const tabBtn = document.getElementById('tab-issues');
  if (tabBtn) {
    tabBtn.innerHTML = 'Tags<span class="tab-badge" id="badge-issues">0</span>';
  }

  let html = '<div class="tab-content-scrollable">';

  // Primary tags - most important
  if (analysis.primary_tags && analysis.primary_tags.length > 0) {
    const badge = document.getElementById('badge-issues');
    if (badge) badge.textContent = String(analysis.primary_tags.length);

    html += `
      <div class="section sdxl-section">
        <div class="section-header">
          <h3>Primary Tags</h3>
          <button class="copy-section" data-copy="primary_tags">Copy</button>
        </div>
        <div class="sdxl-tags-grid">
          ${analysis.primary_tags.map((tag: string) => `<span class="sdxl-tag primary">${escapeHtml(tag)}</span>`).join('')}
        </div>
      </div>
    `;
    sectionCopyData.set('primary_tags', analysis.primary_tags.join(', '));
  }

  // Booru format - single line copy-friendly
  if (analysis.booru_format) {
    html += `
      <div class="section sdxl-section">
        <div class="section-header">
          <h3>Booru Format</h3>
          <button class="copy-section" data-copy="booru_format">Copy</button>
        </div>
        <div class="sdxl-booru-format">${escapeHtml(analysis.booru_format)}</div>
      </div>
    `;
    sectionCopyData.set('booru_format', analysis.booru_format);
  }

  // Tag categories
  if (analysis.tags && typeof analysis.tags === 'object') {
    const categories = ['subject', 'appearance', 'clothing', 'pose_action', 'expression',
                       'background', 'composition', 'lighting', 'style', 'quality', 'technical'];

    for (const category of categories) {
      const tags = analysis.tags[category];
      if (tags && Array.isArray(tags) && tags.length > 0) {
        const categoryLabel = category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        html += `
          <div class="section sdxl-section">
            <div class="section-header">
              <h3>${categoryLabel}</h3>
              <button class="copy-section" data-copy="tags_${category}">Copy</button>
            </div>
            <div class="sdxl-tags-grid">
              ${tags.map((tag: string) => `<span class="sdxl-tag">${escapeHtml(tag)}</span>`).join('')}
            </div>
          </div>
        `;
        sectionCopyData.set(`tags_${category}`, tags.join(', '));
      }
    }
  }

  // Negative tags
  if (analysis.negative_tags && analysis.negative_tags.length > 0) {
    html += `
      <div class="section sdxl-section">
        <div class="section-header">
          <h3>Negative Tags</h3>
          <button class="copy-section" data-copy="negative_tags">Copy</button>
        </div>
        <div class="sdxl-tags-grid">
          ${analysis.negative_tags.map((tag: string) => `<span class="sdxl-tag negative">${escapeHtml(tag)}</span>`).join('')}
        </div>
      </div>
    `;
    sectionCopyData.set('negative_tags', analysis.negative_tags.join(', '));
  }

  html += '</div>';
  content.innerHTML = html;

  // Wire up copy buttons
  wireSDXLCopyButtons();
}

// Wire SDXL copy buttons
function wireSDXLCopyButtons() {
  const copyButtons = document.querySelectorAll('.copy-section[data-copy]');
  copyButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-copy');
      if (key && sectionCopyData.has(key)) {
        navigator.clipboard.writeText(sectionCopyData.get(key) || '').then(() => {
          showToast('Copied to clipboard', 'success');
        });
      }
    });
  });
}

// Render issues tab
function renderIssuesTab(analysis: ScreenshotAnalysis) {
  const content = document.getElementById('content-issues') as HTMLDivElement;

  // Check if this is SDXL format
  if (isSDXLFormat(analysis)) {
    renderSDXLTagsTab(analysis);
    return;
  }

  // Reset tab label for non-SDXL
  const tabBtn = document.getElementById('tab-issues');
  if (tabBtn) {
    tabBtn.innerHTML = 'Issues<span class="tab-badge" id="badge-issues">0</span>';
  }

  const issues = analysis.issues || [];

  if (issues.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <div class="empty-state-title">No issues found</div>
        <div class="empty-state-text">Great! No issues were detected in this screenshot.</div>
      </div>
    `;
    return;
  }
  
  // Normalize and store issues
  allIssues = issues.map(normalizeIssue);
  
  // Filter and sort
  filteredIssues = sortIssues(filterIssues(allIssues));
  
  // Count by severity
  const counts = {
    all: allIssues.length,
    high: allIssues.filter(i => i.severity === 'high').length,
    medium: allIssues.filter(i => i.severity === 'medium').length,
    low: allIssues.filter(i => i.severity === 'low').length
  };
  
  // Update badge
  const badge = document.getElementById('badge-issues');
  if (badge) badge.textContent = String(allIssues.length);
  
  // Render toolbar
  const toolbarHtml = `
    <div class="issues-toolbar">
      <div class="issues-header">
        ${filteredIssues.length} issue${filteredIssues.length !== 1 ? 's' : ''} found
        ${counts.high > 0 ? ` • ${counts.high} high severity` : ''}
      </div>
      <div class="filter-chips">
        <button class="filter-chip ${filterSeverity === 'all' ? 'active' : ''}" data-filter="all">
          All (${counts.all})
        </button>
        <button class="filter-chip ${filterSeverity === 'high' ? 'active' : ''}" data-filter="high">
          High (${counts.high})
        </button>
        <button class="filter-chip ${filterSeverity === 'medium' ? 'active' : ''}" data-filter="medium">
          Medium (${counts.medium})
        </button>
        <button class="filter-chip ${filterSeverity === 'low' ? 'active' : ''}" data-filter="low">
          Low (${counts.low})
        </button>
      </div>
      <select class="sort-select" id="sort-select">
        <option value="severity" ${sortMode === 'severity' ? 'selected' : ''}>Severity (High → Low)</option>
        <option value="slide" ${sortMode === 'slide' ? 'selected' : ''}>Slide Order</option>
        <option value="type" ${sortMode === 'type' ? 'selected' : ''}>Type</option>
      </select>
      <button class="expand-toggle" id="expand-toggle">
        ${allExpanded ? 'Collapse All' : 'Expand All'}
      </button>
    </div>
  `;
  
  // Render issue cards
  let cardsHtml = '';
  filteredIssues.forEach((issue, index) => {
    cardsHtml += renderIssueCard(issue, index);
  });
  
  const listHtml = filteredIssues.length > 0 ? `<div class="tab-content-scrollable" id="issues-list">${cardsHtml}</div>` : `
    <div class="tab-content-scrollable">
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <div class="empty-state-title">No issues match filter</div>
        <div class="empty-state-text">Try selecting a different severity filter.</div>
      </div>
    </div>
  `;
  
  content.innerHTML = toolbarHtml + listHtml;
  
  // Wire up event listeners
  wireIssuesTabEvents();
}

// Wire up issues tab event listeners
function wireIssuesTabEvents() {
  // Filter chips
  const filterChips = document.querySelectorAll('.filter-chip');
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const filter = chip.getAttribute('data-filter') as 'all' | 'high' | 'medium' | 'low';
      filterSeverity = filter;
      if (lastResult?.success && lastResult.data) {
        renderIssuesTab(lastResult.data);
      }
    });
  });
  
  // Sort select
  const sortSelect = document.getElementById('sort-select') as HTMLSelectElement;
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      sortMode = sortSelect.value as 'severity' | 'slide' | 'type';
      if (lastResult?.success && lastResult.data) {
        renderIssuesTab(lastResult.data);
      }
    });
  }
  
  // Expand/collapse toggle
  const expandToggle = document.getElementById('expand-toggle');
  if (expandToggle) {
    expandToggle.addEventListener('click', () => {
      allExpanded = !allExpanded;
      const cards = document.querySelectorAll('.issue-card');
      cards.forEach(card => {
        const collapsible = card.querySelector('.issue-collapsible');
        if (collapsible) {
          if (allExpanded) {
            collapsible.classList.add('expanded');
          } else {
            collapsible.classList.remove('expanded');
          }
        }
      });
      expandToggle.textContent = allExpanded ? 'Collapse All' : 'Expand All';
    });
  }
  
  // Collapsible headers
  const collapsibleHeaders = document.querySelectorAll('.issue-collapsible-header');
  collapsibleHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const toggleId = header.getAttribute('data-toggle');
      if (toggleId) {
        const content = document.getElementById(toggleId);
        const collapsible = header.closest('.issue-collapsible');
        if (content && collapsible) {
          const isExpanded = collapsible.classList.contains('expanded');
          if (isExpanded) {
            collapsible.classList.remove('expanded');
          } else {
            collapsible.classList.add('expanded');
          }
        }
      }
    });
  });
  
  // Copy issue buttons
  const copyButtons = document.querySelectorAll('[data-copy-issue]');
  copyButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.getAttribute('data-copy-issue') || '0');
      const issue = filteredIssues[index];
      if (issue) {
        let text = `[${issue.type}] ${issue.severity.toUpperCase()}`;
        if (issue.slide) text += ` - Slide ${issue.slide}`;
        text += `\n\n${issue.statement}`;
        if (issue.details) text += `\n\n${issue.details}`;
        if (issue.evidence) text += `\n\nEvidence: ${issue.evidence}`;
        if (issue.suggestion) text += `\n\nSuggested Fix: ${issue.suggestion}`;
        
        navigator.clipboard.writeText(text).then(() => {
          showToast(`Copied issue to clipboard`, 'success');
        }).catch(err => {
          console.error('Failed to copy:', err);
          showToast('Failed to copy to clipboard', 'error');
        });
      }
    });
  });
}

// Render summary tab
function renderSummaryTab(analysis: ScreenshotAnalysis) {
  const content = document.getElementById('content-summary') as HTMLDivElement;
  let html = '';

  // Check if this is SDXL format - show caption and natural language
  if (isSDXLFormat(analysis)) {
    const sdxl = analysis as any;

    // Caption (BLIP-style single sentence)
    if (sdxl.caption) {
      html += `
        <div class="section sdxl-section">
          <div class="section-header">
            <h3>Caption</h3>
            <button class="copy-section" data-copy="caption">Copy</button>
          </div>
          <div class="sdxl-caption">${escapeHtml(sdxl.caption)}</div>
        </div>
      `;
      sectionCopyData.set('caption', sdxl.caption);
    }

    // Natural language description
    if (sdxl.natural_language) {
      html += `
        <div class="section sdxl-section">
          <div class="section-header">
            <h3>Natural Language Description</h3>
            <button class="copy-section" data-copy="natural_language">Copy</button>
          </div>
          <div class="sdxl-natural-language">${escapeHtml(sdxl.natural_language)}</div>
        </div>
      `;
      sectionCopyData.set('natural_language', sdxl.natural_language);
    }

    if (html) {
      content.innerHTML = `<div class="tab-content-scrollable">${html}</div>`;
      wireSDXLCopyButtons();
      return;
    }
  }

  // Check for answer object with detected question (from custom prompt)
  const answerObj = analysis.answer as any;
  if (answerObj && typeof answerObj === 'object' && answerObj.detected === true) {
    // Render prominent answer box
    html += `
      <div class="answer-highlight">
        <div class="answer-highlight-label">
          <span class="answer-checkmark">✓</span>
          Answer
        </div>
        <div class="answer-highlight-response">${formatAnswer(answerObj.response || '')}</div>
        ${answerObj.explanation ? `<div class="answer-highlight-explanation">${escapeHtml(answerObj.explanation)}</div>` : ''}
        ${answerObj.question ? `<div class="answer-highlight-question"><strong>Question:</strong> ${escapeHtml(answerObj.question)}</div>` : ''}
      </div>
    `;

    // Register for copy
    sectionCopyData.set('answer', answerObj.response || '');
  } else if (analysis.answer && typeof analysis.answer === 'string') {
    // Handle legacy string answer format
    html += `
      <div class="answer-highlight">
        <div class="answer-highlight-label">
          <span class="answer-checkmark">✓</span>
          Answer
        </div>
        <div class="answer-highlight-response">${formatAnswer(analysis.answer)}</div>
      </div>
    `;
    sectionCopyData.set('answer', analysis.answer);
  }

  // Render summary
  if (analysis.summary) {
    let summaryText: string;
    let isArray = false;
    
    if (typeof analysis.summary === 'string') {
      summaryText = analysis.summary.trim();
    } else if (Array.isArray(analysis.summary)) {
      // Handle array of bullets
      isArray = true;
      summaryText = analysis.summary.map(s => String(s).trim()).filter(s => s.length > 0).join('\n');
      
      html += `<div class="section summary-section">
        <div class="section-header"><h3>Summary</h3></div>
        <ul class="summary-list">`;
      analysis.summary.forEach((bullet: any) => {
        const bulletText = typeof bullet === 'string' ? bullet : 
                          (bullet?.text || bullet?.content || String(bullet));
        html += `<li>${escapeHtml(bulletText.trim())}</li>`;
      });
      html += `</ul></div>`;
      sectionCopyData.set('summary', summaryText);
    } else if (typeof analysis.summary === 'object' && analysis.summary !== null) {
      // Try to extract text from object
      summaryText = (analysis.summary as any).text || 
                   (analysis.summary as any).content || 
                   (analysis.summary as any).description || 
                   (analysis.summary as any).summary || '';
      
      // If still empty, try to stringify meaningful properties
      if (!summaryText) {
        const entries = Object.entries(analysis.summary).filter(([_k, v]) =>
          v !== null && v !== undefined && typeof v === 'string' && v.length > 0
        );
        if (entries.length > 0) {
          summaryText = entries.map(([k, v]) => `${k}: ${v}`).join('\n');
        } else {
          summaryText = JSON.stringify(analysis.summary);
        }
      }
      summaryText = summaryText.trim();
    } else {
      summaryText = String(analysis.summary).trim();
    }

    // Only render paragraph format if not already rendered as bullets
    if (!isArray && summaryText) {
      // Clean up the text - normalize whitespace but preserve intentional line breaks
      summaryText = summaryText
        .replace(/\r\n/g, '\n')  // Normalize line endings
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')  // Collapse multiple spaces/tabs
        .trim();
      
      // Split into paragraphs by double newlines first (preserves intentional paragraph breaks)
      let paragraphs = summaryText.split(/\n\s*\n+/).filter(p => p.trim().length > 0);
      
      // If no double newlines, check if it's a single long paragraph
      if (paragraphs.length === 1) {
        const text = paragraphs[0];
        
        // For very long text (>300 chars), try to split by sentences
        if (text.length > 300) {
          // Split by sentence endings followed by space and capital letter
          const sentences = text.split(/([.!?])\s+(?=[A-Z])/).filter(s => s && s.trim().length > 0);
          
          if (sentences.length > 1) {
            // Reconstruct sentences (the split includes punctuation as separate items)
            const reconstructed: string[] = [];
            for (let i = 0; i < sentences.length; i += 2) {
              const sentence = sentences[i] + (sentences[i + 1] || '');
              if (sentence.trim()) {
                reconstructed.push(sentence.trim());
              }
            }
            
            // Group into paragraphs of 2-3 sentences
            paragraphs = [];
            let currentPara = '';
            for (let i = 0; i < reconstructed.length; i++) {
              currentPara += (currentPara ? ' ' : '') + reconstructed[i];
              // Start new paragraph every 2-3 sentences
              if ((i + 1) % 3 === 0 || i === reconstructed.length - 1) {
                paragraphs.push(currentPara);
                currentPara = '';
              }
            }
          }
        }
      }

      // Format paragraphs with consistent styling
      const formattedSummary = paragraphs
        .map(p => p.trim())
        .filter(p => p.length > 0)
        .map(p => `<p class="summary-paragraph">${escapeHtml(p)}</p>`)
        .join('');

      html += `<div class="section summary-section">
        <div class="section-header"><h3>Summary</h3></div>
        <div class="summary-content">${formattedSummary}</div>
      </div>`;
      sectionCopyData.set('summary', summaryText);
    }
  }

  if (html) {
    content.innerHTML = `<div class="tab-content-scrollable">${html}</div>`;
  } else {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📄</div>
        <div class="empty-state-title">No summary available</div>
        <div class="empty-state-text">Summary will appear here after analysis</div>
      </div>
    `;
  }
}

// Render notes tab
function renderNotesTab(analysis: ScreenshotAnalysis) {
  const content = document.getElementById('content-notes') as HTMLDivElement;
  const notes = analysis.uxCritique || [];
  
  if (notes.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📝</div>
        <div class="empty-state-title">No notes available</div>
        <div class="empty-state-text">Notes will appear here after analysis</div>
      </div>
    `;
    return;
  }
  
  // Update badge
  const badge = document.getElementById('badge-notes');
  if (badge) badge.textContent = String(notes.length);
  
  let html = '';
  notes.forEach((item: any) => {
    if (typeof item === 'object' && item !== null) {
      const area = item.area || item.category || '';
      let issue = item.issue || item.problem || item.text || item.message || item.note || item.comment || '';
      
      // If no issue text found, try to extract from object properties
      if (!issue) {
        const textFields = ['description', 'summary', 'content', 'title', 'name', 'label'];
        for (const field of textFields) {
          if (item[field] && typeof item[field] === 'string') {
            issue = item[field];
            break;
          }
        }
        
        // If still nothing, try to stringify meaningful properties
        if (!issue) {
        const entries = Object.entries(item).filter(([k, v]) =>
            k !== 'area' && k !== 'category' && k !== 'suggestion' && k !== 'recommendation' &&
            v !== null && v !== undefined && typeof v === 'string' && v.length > 0
          );
          if (entries.length > 0) {
            issue = entries.map(([k, v]) => `${k}: ${v}`).join(', ');
          } else {
            issue = 'Note';
          }
        }
      }
      
      const suggestion = item.suggestion || item.recommendation || '';
      
      html += `
        <div class="section">
          ${area ? `<h3>${escapeHtml(area)}</h3>` : ''}
          <p>${escapeHtml(issue)}</p>
          ${suggestion ? `<div style="background: #e8f5e9; padding: 12px; border-radius: 6px; margin-top: 8px; border-left: 4px solid #4caf50;"><strong>💡 Suggestion:</strong> ${escapeHtml(suggestion)}</div>` : ''}
        </div>
      `;
    } else {
      html += `<div class="section"><p>${escapeHtml(String(item))}</p></div>`;
    }
  });
  
  content.innerHTML = html;
}

// Render raw/JSON tab
function renderRawTab(response: AIResponse<ScreenshotAnalysis>) {
  const content = document.getElementById('content-raw') as HTMLDivElement;
  
  const jsonStr = JSON.stringify(response, null, 2);
  sectionCopyData.set('raw', jsonStr);
  
  content.innerHTML = `
    <div class="section">
      <div class="section-header">
        <h3>Raw JSON Response</h3>
        <div class="section-actions">
          <button class="copy-section" data-copy-id="raw">Copy JSON</button>
          <button class="copy-section" data-export-id="raw">Export JSON</button>
        </div>
      </div>
      <pre style="background: #f5f5f5; padding: 16px; border-radius: 6px; overflow-x: auto; font-size: 12px; line-height: 1.5;">${escapeHtml(jsonStr)}</pre>
    </div>
  `;
  
  // Wire copy button
  const copyBtn = content.querySelector('[data-copy-id="raw"]');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(jsonStr).then(() => {
        showToast('Copied JSON to clipboard', 'success');
      }).catch(err => {
        console.error('Failed to copy:', err);
        showToast('Failed to copy to clipboard', 'error');
      });
    });
  }

  const exportBtn = content.querySelector('[data-export-id="raw"]');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      await exportJSONFile();
    });
  }
}

// Render logs tab (placeholder)
function renderLogsTab() {
  const content = document.getElementById('content-logs') as HTMLDivElement;
  content.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">📜</div>
      <div class="empty-state-title">Logs</div>
      <div class="empty-state-text">
        <button id="open-logs-btn" class="status-btn primary" style="margin-top: 16px;">Open Logs Folder</button>
      </div>
    </div>
  `;
  
  const openLogsBtn = content.querySelector('#open-logs-btn');
  if (openLogsBtn) {
    openLogsBtn.addEventListener('click', async () => {
      try {
        const result = await api.settings.openLogsFolder();
        if (result?.success) {
          showToast('Opened logs folder', 'success');
        } else {
          showToast(result?.error || 'Failed to open logs folder', 'error');
        }
      } catch (error) {
        console.error('Failed to open logs folder:', error);
        showToast('Failed to open logs folder', 'error');
      }
    });
  }
}

// Export menu handlers
function setupExportMenu() {
  const exportBtn = document.getElementById('export-btn') as HTMLButtonElement | null;
  const exportDropdown = document.getElementById('export-menu-dropdown');
  
  if (!exportBtn || !exportDropdown) return;
  
  // Toggle dropdown
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (exportBtn.disabled) return;
    exportDropdown.classList.toggle('show');
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    exportDropdown.classList.remove('show');
  });
  
  // Handle export menu items
  const exportItems = exportDropdown.querySelectorAll('.export-menu-item');
  exportItems.forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const exportType = item.getAttribute('data-export');
      if (exportType) {
        await handleExport(exportType);
        exportDropdown.classList.remove('show');
      }
    });
  });
}

async function handleExport(exportType: string) {
  if (!lastResult || !lastResult.success || !lastResult.data) {
    showToast('No data to export', 'error');
    return;
  }
  
  const analysis = lastResult.data;
  
  try {
    switch (exportType) {
      case 'report-markdown':
        await copyReportMarkdown(analysis);
        break;
      case 'summary':
        await copySummary(analysis);
        break;
      case 'issues':
        await copyIssues(analysis);
        break;
      case 'json':
        await copyJSON();
        break;
      case 'export-json':
        await exportJSONFile();
        break;
      case 'export-markdown':
        await exportMarkdownFile(analysis);
        break;
    }
  } catch (err) {
    console.error('Export failed:', err);
    showToast('Export failed', 'error');
  }
}

async function copyReportMarkdown(analysis: ScreenshotAnalysis) {
  let markdown = '# Screenshot Analysis Report\n\n';
  
  if (analysis.summary) {
    markdown += `## Summary\n\n${analysis.summary}\n\n`;
  }
  
  if (analysis.issues && analysis.issues.length > 0) {
    markdown += `## Issues (${analysis.issues.length})\n\n`;
    analysis.issues.forEach((issue: any, index: number) => {
      const severity = issue.severity || 'medium';
      const text = issue.risk || issue.text || issue.message || issue.issue || String(issue);
      markdown += `### ${index + 1}. [${severity.toUpperCase()}] ${text}\n\n`;
      if (issue.details) markdown += `${issue.details}\n\n`;
      if (issue.suggestion) markdown += `**Suggested Fix:** ${issue.suggestion}\n\n`;
    });
  }
  
  if (analysis.uxCritique && analysis.uxCritique.length > 0) {
    markdown += `## Notes (${analysis.uxCritique.length})\n\n`;
    analysis.uxCritique.forEach((item: any) => {
      if (typeof item === 'object') {
        const area = item.area || item.category || '';
        const issue = item.issue || item.problem || '';
        const suggestion = item.suggestion || item.recommendation || '';
        markdown += `### ${area}\n\n${issue}\n\n`;
        if (suggestion) markdown += `**Suggestion:** ${suggestion}\n\n`;
      } else {
        markdown += `- ${item}\n\n`;
      }
    });
  }
  
  await navigator.clipboard.writeText(markdown);
  showToast(`Copied report (${analysis.issues?.length || 0} issues) as Markdown`, 'success');
}

async function copySummary(analysis: ScreenshotAnalysis) {
  const summary = analysis.summary || analysis.answer || 'No summary available';
  await navigator.clipboard.writeText(String(summary));
  showToast('Copied summary', 'success');
}

async function copyIssues(analysis: ScreenshotAnalysis) {
  if (!analysis.issues || analysis.issues.length === 0) {
    showToast('No issues to copy', 'info');
    return;
  }
  
  let markdown = `Issues (${analysis.issues.length}):\n\n`;
  analysis.issues.forEach((issue: any, index: number) => {
    const severity = issue.severity || 'medium';
    const issueText = issue.risk || issue.text || issue.message || issue.issue || String(issue);
    markdown += `${index + 1}. [${severity.toUpperCase()}] ${issueText}\n`;
    if (issue.details) markdown += `   ${issue.details}\n`;
    if (issue.suggestion) markdown += `   Suggested Fix: ${issue.suggestion}\n`;
    markdown += '\n';
  });
  
  await navigator.clipboard.writeText(markdown);
  showToast(`Copied ${analysis.issues.length} issue(s)`, 'success');
}

async function copyJSON() {
  const jsonStr = JSON.stringify(lastResult, null, 2);
  await navigator.clipboard.writeText(jsonStr);
  showToast('Copied JSON', 'success');
}

function getExportTimestamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

async function exportJSONFile() {
  if (!lastResult) {
    showToast('No JSON to export', 'error');
    return;
  }

  const jsonStr = JSON.stringify(lastResult, null, 2);

  try {
    const result = await api.files.saveTextFile({
      content: jsonStr,
      defaultFileName: `screenshot-analysis-${getExportTimestamp()}.json`,
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
      ],
    });

    if (result?.success) {
      showToast('Exported JSON file', 'success');
      return;
    }

    if (result?.cancelled) {
      showToast('Export cancelled', 'info');
      return;
    }

    showToast(result?.error || 'Failed to export JSON file', 'error');
  } catch (error) {
    console.error('Failed to export JSON file:', error);
    showToast('Failed to export JSON file', 'error');
  }
}

async function exportMarkdownFile(analysis: ScreenshotAnalysis) {
  // TODO: Use Electron's dialog to save file
  // For now, just copy to clipboard
  await copyReportMarkdown(analysis);
  showToast('File export coming soon. Report copied to clipboard.', 'info');
}

// Setup event listeners
function setupEventListeners() {
  // Set up API event listeners
  api.analysis.onProcessing((payload: { stage: string; screenshotDataUrl?: string }) => {
    if (payload.stage === 'cancelled') {
      updateStatus('idle');
      updateScreenshotPreview(null);
      switchTab('issues');
      feedbackSubmitted = null;
      return;
    }
    
    if (payload.stage === 'capture') {
      updateStatus('capturing');
    } else if (payload.stage === 'analyzing') {
      updateStatus('analyzing');
      // Update screenshot preview if provided
      if (payload.screenshotDataUrl) {
        updateScreenshotPreview(payload.screenshotDataUrl);
      }
    }
    
    // Clear tabs
    tabContents.forEach(content => {
      if (!content.hidden) {
        content.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-title">Processing...</div></div>';
      }
    });
    
    feedbackSubmitted = null;
  });

  // Listen for screenshot events
  api.analysis.onScreenshot((payload: { dataUrl: string }) => {
    updateScreenshotPreview(payload.dataUrl);
  });

  api.analysis.onResult((response: AIResponse<ScreenshotAnalysis>) => {

    
    lastResult = response;

    if (response.success && response.data) {
      const analysis = response.data;
      const confidence = analysis.confidence || 0;
      
      updateStatus('success', `Analysis complete`);
      updateConfidence(confidence);
      
      // Update screenshot preview if we have it
      // Note: Screenshot data URL should be stored during capture process
      // For now, we'll use a placeholder - this should be connected to the capture API
      
      // Update metadata
      updateScreenshotMetadata(response.metadata);
      
      // Render tabs
      renderIssuesTab(analysis);
      renderSummaryTab(analysis);
      renderNotesTab(analysis);
      renderRawTab(response);
      renderLogsTab();
      
      // Switch to appropriate tab
      if (analysis.issues && analysis.issues.length > 0) {
        switchTab('issues');
      } else {
        switchTab('summary');
      }
      
      // Reset feedback UI
      feedbackPositiveBtn.classList.remove('active', 'positive');
      feedbackNegativeBtn.classList.remove('active', 'negative');
      feedbackSubmitted = null;
    } else {
      updateStatus('error', 'Analysis failed');
      switchTab('issues');
      const content = document.getElementById('content-issues') as HTMLDivElement;
      content.innerHTML = `<div class="section"><p style="color: #c62828;">Error: ${escapeHtml(response.error?.message || "Unknown error")}</p></div>`;
    }
  });

  api.analysis.onError((payload: { code: string; message: string; retryable: boolean; metadata?: unknown }) => {
    updateStatus('error', `Error: ${payload.code}`);
    switchTab('issues');
    const content = document.getElementById('content-issues') as HTMLDivElement;
    content.innerHTML = `<div class="section"><p style="color: #c62828;">${escapeHtml(payload.message)}</p></div>`;
  });

  // Capture button
  captureBtn.addEventListener("click", () => {
    console.log('Capture button clicked');
    try {
      if (api && api.capture && api.capture.start) {
        api.capture.start();
      } else {
        console.error('Capture API not available:', { api, capture: api?.capture });
        showToast('Capture feature not available. Please restart the application.', 'error');
      }
    } catch (error) {
      console.error('Error starting capture:', error);
      showToast('Failed to start capture', 'error');
    }
  });

  // Run again button
  runAgainBtn.addEventListener("click", () => {
    api.analysis.retry();
  });

  // Export menu is set up in setupExportMenu()

  // Feedback buttons
  feedbackPositiveBtn.addEventListener("click", async () => {
    if (!lastResult || feedbackSubmitted === 'positive') return;
    
    try {
      feedbackPositiveBtn.disabled = true;
      feedbackNegativeBtn.disabled = true;
      
      await api.analysis.submitFeedback(true);
      feedbackSubmitted = 'positive';
      feedbackPositiveBtn.classList.add('active', 'positive');
      feedbackNegativeBtn.classList.remove('active', 'negative');
      
      showToast('Thank you for your feedback!', 'success');
    } catch (err) {
      console.error("Failed to submit feedback:", err);
      feedbackPositiveBtn.disabled = false;
      feedbackNegativeBtn.disabled = false;
    }
  });

  feedbackNegativeBtn.addEventListener("click", async () => {
    if (!lastResult || feedbackSubmitted === 'negative') return;
    
    // Show feedback popover with proper positioning
    const popover = document.getElementById('feedback-popover');
    if (popover) {
      // Calculate position relative to the feedback button
      const buttonRect = feedbackNegativeBtn.getBoundingClientRect();
      const popoverHeight = 400; // max-height from CSS
      const spaceAbove = buttonRect.top;
      const spaceBelow = window.innerHeight - buttonRect.bottom;
      
      // Position horizontally
      popover.style.right = `${window.innerWidth - buttonRect.right}px`;
      
      // Position vertically - prefer above, but flip below if not enough space
      if (spaceAbove >= popoverHeight || spaceAbove > spaceBelow) {
        // Position above button
        popover.style.bottom = `${window.innerHeight - buttonRect.top + 8}px`;
        popover.style.top = 'auto';
      } else {
        // Position below button
        popover.style.top = `${buttonRect.bottom + 8}px`;
        popover.style.bottom = 'auto';
      }
      
      popover.classList.add('show');
    }
  });
  
  // Setup feedback popover
  setupFeedbackPopover();
}

// Setup feedback popover
function setupFeedbackPopover() {
  const popover = document.getElementById('feedback-popover');
  const submitBtn = document.getElementById('feedback-submit') as HTMLButtonElement | null;
  const otherTextarea = document.getElementById('feedback-other') as HTMLTextAreaElement;
  const options = popover?.querySelectorAll('.feedback-option');
  let selectedReason: string | null = null;
  
  if (!popover || !submitBtn) return;
  
  // Handle option clicks
  options?.forEach(option => {
    option.addEventListener('click', () => {
      selectedReason = option.getAttribute('data-feedback-reason');
      options.forEach(opt => opt.classList.remove('active'));
      option.classList.add('active');
    });
  });
  
  // Submit feedback
  submitBtn.addEventListener('click', async () => {
    if (!lastResult || !selectedReason) {
      showToast('Please select a reason', 'error');
      return;
    }
    
    try {
      feedbackPositiveBtn.disabled = true;
      feedbackNegativeBtn.disabled = true;
      submitBtn.disabled = true;
      
      // TODO: Send structured feedback to API
      await api.analysis.submitFeedback(false);
      
      feedbackSubmitted = 'negative';
      feedbackNegativeBtn.classList.add('active', 'negative');
      feedbackPositiveBtn.classList.remove('active', 'positive');
      popover.classList.remove('show');
      
      showToast('Thank you for your feedback!', 'success');
      
      // Reset popover
      selectedReason = null;
      options?.forEach(opt => opt.classList.remove('active'));
      if (otherTextarea) otherTextarea.value = '';
      
      feedbackPositiveBtn.disabled = false;
      feedbackNegativeBtn.disabled = false;
      submitBtn.disabled = false;
    } catch (err) {
      console.error("Failed to submit feedback:", err);
      showToast('Failed to submit feedback', 'error');
      feedbackPositiveBtn.disabled = false;
      feedbackNegativeBtn.disabled = false;
      submitBtn.disabled = false;
    }
  });
  
  // Close popover when clicking outside
  document.addEventListener('click', (e) => {
    if (popover && !popover.contains(e.target as Node) && 
        e.target !== feedbackNegativeBtn && 
        !feedbackNegativeBtn.contains(e.target as Node)) {
      popover.classList.remove('show');
    }
  });
  
  // Reposition popover on window resize
  window.addEventListener('resize', () => {
    if (popover && popover.classList.contains('show')) {
      const buttonRect = feedbackNegativeBtn.getBoundingClientRect();
      const popoverHeight = 400;
      const spaceAbove = buttonRect.top;
      const spaceBelow = window.innerHeight - buttonRect.bottom;
      
      popover.style.right = `${window.innerWidth - buttonRect.right}px`;
      
      if (spaceAbove >= popoverHeight || spaceAbove > spaceBelow) {
        popover.style.bottom = `${window.innerHeight - buttonRect.top + 8}px`;
        popover.style.top = 'auto';
      } else {
        popover.style.top = `${buttonRect.bottom + 8}px`;
        popover.style.bottom = 'auto';
      }
    }
  });
}

// Screenshot viewer state
let viewerZoom = 1;
let viewerPanX = 0;
let viewerPanY = 0;
let viewerIsDragging = false;
let viewerDragStartX = 0;
let viewerDragStartY = 0;
let viewerDragStartPanX = 0;
let viewerDragStartPanY = 0;
let highlightedRegions: Array<{ x: number; y: number; width: number; height: number }> = [];

// Open screenshot viewer
function openScreenshotViewer(dataUrl: string) {
  if (!screenshotViewer || !viewerImage) return;
  
  viewerImage.src = dataUrl;
  viewerZoom = 1;
  viewerPanX = 0;
  viewerPanY = 0;
  highlightedRegions = [];
  
  screenshotViewer.hidden = false;
  viewerImage.onload = () => {
    updateViewerTransform();
    drawRegions();
  };
  
  // Focus the close button for accessibility
  viewerCloseBtn.focus();
  
  // Trap focus within modal
  trapFocus(screenshotViewer);
}

// Close screenshot viewer
function closeScreenshotViewer() {
  if (!screenshotViewer) return;
  screenshotViewer.hidden = true;
  viewerZoom = 1;
  viewerPanX = 0;
  viewerPanY = 0;
  highlightedRegions = [];
  updateViewerTransform();
}

// Update viewer zoom and pan transform
function updateViewerTransform() {
  if (!viewerImage || !viewerContent) return;
  
  const scale = viewerZoom;
  const translateX = viewerPanX;
  const translateY = viewerPanY;
  
  viewerImage.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  viewerZoomLevel.textContent = `${Math.round(scale * 100)}%`;
  
  // Update canvas for regions
  if (viewerRegionsCanvas && viewerImage.complete) {
    drawRegions();
  }
}

// Draw highlighted regions on canvas
function drawRegions() {
  if (!viewerRegionsCanvas || !viewerImage || highlightedRegions.length === 0) {
    viewerRegionsCanvas.width = 0;
    viewerRegionsCanvas.height = 0;
    return;
  }
  
  const rect = viewerContent.getBoundingClientRect();
  const imgRect = viewerImage.getBoundingClientRect();
  
  viewerRegionsCanvas.width = rect.width;
  viewerRegionsCanvas.height = rect.height;
  
  const ctx = viewerRegionsCanvas.getContext('2d');
  if (!ctx) return;
  
  ctx.clearRect(0, 0, rect.width, rect.height);
  
  // Calculate scale and offset
  const scaleX = imgRect.width / viewerImage.naturalWidth;
  const scaleY = imgRect.height / viewerImage.naturalHeight;
  const offsetX = (rect.width - imgRect.width) / 2 + imgRect.left - rect.left;
  const offsetY = (rect.height - imgRect.height) / 2 + imgRect.top - rect.top;
  
  highlightedRegions.forEach(region => {
    const x = offsetX + (region.x * scaleX);
    const y = offsetY + (region.y * scaleY);
    const width = region.width * scaleX;
    const height = region.height * scaleY;
    
    // Draw highlight rectangle
    ctx.strokeStyle = '#1976d2';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(x, y, width, height);
    
    // Draw semi-transparent fill
    ctx.fillStyle = 'rgba(25, 118, 210, 0.1)';
    ctx.fillRect(x, y, width, height);
  });
}

// Zoom in
function zoomIn() {
  viewerZoom = Math.min(viewerZoom * 1.2, 5);
  updateViewerTransform();
}

// Zoom out
function zoomOut() {
  viewerZoom = Math.max(viewerZoom / 1.2, 0.5);
  updateViewerTransform();
}

// Reset zoom and pan
function resetViewer() {
  viewerZoom = 1;
  viewerPanX = 0;
  viewerPanY = 0;
  updateViewerTransform();
}

// Setup screenshot viewer
function setupScreenshotViewer() {
  if (!screenshotViewer || !viewerImage || !viewerContent) return;
  
  // Zoom controls
  viewerZoomInBtn.addEventListener('click', zoomIn);
  viewerZoomOutBtn.addEventListener('click', zoomOut);
  viewerResetBtn.addEventListener('click', resetViewer);
  viewerCloseBtn.addEventListener('click', closeScreenshotViewer);
  
  // Mouse wheel zoom
  viewerContent.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    viewerZoom = Math.max(0.5, Math.min(5, viewerZoom * delta));
    updateViewerTransform();
  }, { passive: false });
  
  // Pan with mouse drag
  viewerContent.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Only left mouse button
    viewerIsDragging = true;
    viewerDragStartX = e.clientX;
    viewerDragStartY = e.clientY;
    viewerDragStartPanX = viewerPanX;
    viewerDragStartPanY = viewerPanY;
    viewerContent.classList.add('dragging');
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!viewerIsDragging) return;
    const deltaX = e.clientX - viewerDragStartX;
    const deltaY = e.clientY - viewerDragStartY;
    viewerPanX = viewerDragStartPanX + deltaX;
    viewerPanY = viewerDragStartPanY + deltaY;
    updateViewerTransform();
  });
  
  document.addEventListener('mouseup', () => {
    if (viewerIsDragging) {
      viewerIsDragging = false;
      viewerContent.classList.remove('dragging');
    }
  });
  
  // Close on overlay click
  const overlay = screenshotViewer.querySelector('.screenshot-viewer-overlay');
  overlay?.addEventListener('click', closeScreenshotViewer);
  
  // Prevent closing when clicking on container
  const container = screenshotViewer.querySelector('.screenshot-viewer-container');
  container?.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

// Trap focus within modal
function trapFocus(modal: HTMLElement) {
  const focusableElements = modal.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  ) as NodeListOf<HTMLElement>;
  
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  
  modal.addEventListener('keydown', function trapFocusHandler(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    
    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  });
}

// Setup keyboard shortcuts
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in inputs/textareas
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }
    
    // Handle viewer shortcuts when viewer is open
    if (!screenshotViewer.hidden) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeScreenshotViewer();
        return;
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
        return;
      }
      if (e.key === '-') {
        e.preventDefault();
        zoomOut();
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        resetViewer();
        return;
      }
      // Don't process other shortcuts when viewer is open
      return;
    }
    
    // R - Run again
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (!runAgainBtn.disabled) {
        runAgainBtn.click();
      }
    }
    
    // C - Capture
    if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (!captureBtn.disabled) {
        captureBtn.click();
      }
    }
    
    // E - Export menu
    if (e.key === 'e' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (!exportBtn.disabled) {
        exportBtn.click();
      }
    }
    
    // / - Focus filter/search (when on issues tab)
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (activeTab === 'issues') {
        const firstFilterChip = document.querySelector('.filter-chip') as HTMLElement;
        if (firstFilterChip) {
          firstFilterChip.focus();
        }
      }
    }
    
    // Escape - Close modals/popovers
    if (e.key === 'Escape') {
      const exportDropdown = document.getElementById('export-menu-dropdown');
      const feedbackPopover = document.getElementById('feedback-popover');
      if (exportDropdown?.classList.contains('show')) {
        exportDropdown.classList.remove('show');
      }
      if (feedbackPopover?.classList.contains('show')) {
        feedbackPopover.classList.remove('show');
      }
    }
    
    // Number keys 1-5 - Switch tabs
    if (e.key >= '1' && e.key <= '5' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      const tabIndex = parseInt(e.key) - 1;
      const tabs = ['issues', 'summary', 'notes', 'raw', 'logs'];
      if (tabs[tabIndex]) {
        e.preventDefault();
        switchTab(tabs[tabIndex]);
        const tabBtn = document.querySelector(`[data-tab="${tabs[tabIndex]}"]`) as HTMLElement;
        if (tabBtn) tabBtn.focus();
      }
    }
  });
}

// Initialize when DOM is ready
function initialize() {
  if (!initializeElements()) {
    console.error('Failed to initialize elements');
    return;
  }
  
  setupTabs();
  setupExportMenu();
  setupScreenshotViewer();
  setupKeyboardShortcuts();
  setupEventListeners();
  
  // Initialize UI
  updateStatus('idle');
  switchTab('issues');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
