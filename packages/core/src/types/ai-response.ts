export type AIResponse<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  metadata: {
    provider: string;
    model: string;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    attemptNumber: number;
  };
};

export type ScreenshotAnalysis = {
  answer?: string;
  summary?: string;
  issues?: Array<{ severity?: string; text?: string }>;
  uxCritique?: Array<string | { area?: string; issue?: string; suggestion?: string; recommendation?: string; category?: string; problem?: string }>;
  nextSteps?: Array<string | { action?: string; task?: string; description?: string; text?: string; step?: string; owner?: string; assignee?: string; priority?: string; dueDate?: string; due?: string; deadline?: string }>;
  text?: string;
  codeBlocks?: Array<{ language?: string; code: string; startLine?: number; endLine?: number }>;
  structuredData?: Record<string, unknown>;
  confidence: number; // 0..1
};
