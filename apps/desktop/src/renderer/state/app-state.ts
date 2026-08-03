/**
 * Centralized Application State Management
 * 
 * This module provides a centralized state object and update functions
 * for the ScreenshotAI renderer application.
 */

import type { AIResponse, ScreenshotAnalysis } from "@types/ai-response";

export interface AppState {
  // Analysis state
  analysisRun: {
    id: string | null;
    status: 'idle' | 'capturing' | 'analyzing' | 'success' | 'error';
    confidence: number | null;
    timestamp: number | null;
    screenshotId: string | null;
    screenshotDataUrl: string | null;
    findings: ScreenshotAnalysis | null;
    rawPayload: AIResponse<ScreenshotAnalysis> | null;
  };
  
  // UI state
  uiState: {
    activeTab: 'issues' | 'summary' | 'notes' | 'raw' | 'logs';
    filterSeverity: 'all' | 'high' | 'medium' | 'low';
    sortMode: 'severity' | 'slide' | 'type';
    expandedIssues: Set<number>;
    selectedIssueId: number | null;
    allExpanded: boolean;
  };
  
  // Viewer state
  viewerState: {
    isOpen: boolean;
    zoom: number;
    panX: number;
    panY: number;
    highlightedRegions: Array<{ x: number; y: number; width: number; height: number }>;
  };
  
  // Feedback state
  feedbackState: {
    submitted: 'positive' | 'negative' | null;
    reason: string | null;
    otherText: string;
  };
}

// Initial state
export const initialState: AppState = {
  analysisRun: {
    id: null,
    status: 'idle',
    confidence: null,
    timestamp: null,
    screenshotId: null,
    screenshotDataUrl: null,
    findings: null,
    rawPayload: null,
  },
  uiState: {
    activeTab: 'issues',
    filterSeverity: 'all',
    sortMode: 'severity',
    expandedIssues: new Set(),
    selectedIssueId: null,
    allExpanded: false,
  },
  viewerState: {
    isOpen: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    highlightedRegions: [],
  },
  feedbackState: {
    submitted: null,
    reason: null,
    otherText: '',
  },
};

// Current state instance
let currentState: AppState = { ...initialState };

// State change listeners
type StateChangeListener = (state: AppState) => void;
const listeners: Set<StateChangeListener> = new Set();

/**
 * Get current state (read-only)
 */
export function getState(): Readonly<AppState> {
  return { ...currentState };
}

/**
 * Update state and notify listeners
 */
export function updateState(updates: Partial<AppState>): void {
  currentState = {
    ...currentState,
    ...updates,
    // Deep merge nested objects
    analysisRun: { ...currentState.analysisRun, ...(updates.analysisRun || {}) },
    uiState: { ...currentState.uiState, ...(updates.uiState || {}) },
    viewerState: { ...currentState.viewerState, ...(updates.viewerState || {}) },
    feedbackState: { ...currentState.feedbackState, ...(updates.feedbackState || {}) },
  };
  
  // Notify all listeners
  listeners.forEach(listener => listener(currentState));
}

/**
 * Subscribe to state changes
 */
export function subscribe(listener: StateChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Reset state to initial
 */
export function resetState(): void {
  currentState = { ...initialState };
  listeners.forEach(listener => listener(currentState));
}
