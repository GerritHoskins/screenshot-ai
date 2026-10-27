/**
 * Centralized Logging Module - Workstream G
 * Local file logging with rotation and redaction support.
 */

import * as fs from 'fs';
import * as path from 'path';
import { redactLogValue, redactSensitiveData } from '../security/redaction';

// ============================================================================
// Log Levels
// ============================================================================

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

// ============================================================================
// Log Entry
// ============================================================================

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  metadata?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

// ============================================================================
// Logger Configuration
// ============================================================================

export interface LoggerConfig {
  /** Minimum log level to write */
  minLevel: LogLevel;
  /** Enable redaction of sensitive data */
  redact: boolean;
  /** Maximum log file size in bytes */
  maxFileSize: number;
  /** Maximum number of log files to keep */
  maxFiles: number;
  /** Log directory path */
  logDir: string;
}

const DEFAULT_CONFIG: LoggerConfig = {
  minLevel: LogLevel.INFO,
  redact: true,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 7,
  logDir: '',
};

// ============================================================================
// Logger Implementation
// ============================================================================

export class Logger {
  private config: LoggerConfig;
  private logFilePath: string;
  private currentDate: string;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      logDir: this.getDefaultLogDir(),
      ...config,
    };
    
    this.currentDate = this.getCurrentDateString();
    this.logFilePath = path.join(this.config.logDir, `screenshot-ai-${this.currentDate}.log`);
    
    // Ensure log directory exists
    this.ensureLogDir();
  }

  /**
   * Get default log directory based on platform.
   */
  private getDefaultLogDir(): string {
    if (process.platform === 'darwin') {
      return path.join(process.env.HOME || '', 'Library', 'Logs', 'ScreenshotAI');
    } else if (process.platform === 'win32') {
      return path.join(process.env.APPDATA || '', 'ScreenshotAI', 'logs');
    } else {
      return path.join(process.env.HOME || '', '.local', 'share', 'ScreenshotAI', 'logs');
    }
  }

  /**
   * Ensure log directory exists.
   */
  private ensureLogDir(): void {
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }
  }

  /**
   * Get current date string (YYYY-MM-DD).
   */
  private getCurrentDateString(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Rotate logs if needed.
   */
  private rotateLogs(): void {
    const currentDate = this.getCurrentDateString();
    
    // If date changed, start new log file
    if (currentDate !== this.currentDate) {
      this.currentDate = currentDate;
      this.logFilePath = path.join(this.config.logDir, `screenshot-ai-${currentDate}.log`);
    }

    // Check if current file exceeds max size
    if (fs.existsSync(this.logFilePath)) {
      const stats = fs.statSync(this.logFilePath);
      if (stats.size >= this.config.maxFileSize) {
        // Archive current file
        const archivePath = `${this.logFilePath}.${Date.now()}`;
        fs.renameSync(this.logFilePath, archivePath);
      }
    }

    // Clean up old log files
    this.cleanupOldLogs();
  }

  /**
   * Remove old log files beyond maxFiles limit.
   */
  private cleanupOldLogs(): void {
    try {
      const files = fs.readdirSync(this.config.logDir)
        .filter(f => f.startsWith('screenshot-ai-') && f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(this.config.logDir, f),
          mtime: fs.statSync(path.join(this.config.logDir, f)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // Keep only maxFiles most recent
      if (files.length > this.config.maxFiles) {
        for (let i = this.config.maxFiles; i < files.length; i++) {
          fs.unlinkSync(files[i].path);
        }
      }
    } catch (error) {
      // Silently fail cleanup
      console.error('Failed to cleanup logs:', error);
    }
  }

  /**
   * Format log entry as string.
   */
  private formatEntry(entry: LogEntry): string {
    const timestamp = entry.timestamp;
    const level = LOG_LEVEL_NAMES[entry.level];
    const component = entry.component;
    let message = entry.message;

    // Redact sensitive data if enabled
    if (this.config.redact) {
      message = redactSensitiveData(message);
      if (entry.metadata) {
        try {
          const redactedMeta = redactLogValue(entry.metadata) as Record<string, unknown>;
          entry = { ...entry, metadata: redactedMeta };
        } catch {
          // If redaction produces non-JSON output, fall back to a string payload
          entry = {
            ...entry,
            metadata: { redacted: redactSensitiveData(JSON.stringify(entry.metadata)) },
          };
        }
      }
    }

    let line = `[${timestamp}] [${level}] [${component}] ${message}`;

    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      line += ` ${JSON.stringify(entry.metadata)}`;
    }

    if (entry.error) {
      const safeMessage = this.config.redact ? redactSensitiveData(entry.error.message) : entry.error.message;
      line += `\n  Error: ${entry.error.name}: ${safeMessage}`;
      if (entry.error.stack) {
        const stack = this.config.redact ? redactSensitiveData(entry.error.stack) : entry.error.stack;
        line += `\n  ${stack}`;
      }
    }

    return line;
  }

  /**
   * Write log entry to file.
   */
  private writeEntry(entry: LogEntry): void {
    if (entry.level < this.config.minLevel) {
      return;
    }

    this.rotateLogs();

    const line = this.formatEntry(entry) + '\n';

    try {
      fs.appendFileSync(this.logFilePath, line, 'utf8');
    } catch (error) {
      // Fallback to console if file write fails
      console.error('Failed to write log:', error);
      console.log(line);
    }
  }

  /**
   * Create log entry.
   */
  private createEntry(
    level: LogLevel,
    component: string,
    message: string,
    metadata?: Record<string, unknown>,
    error?: Error
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      metadata,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
    };
  }

  // Public logging methods

  debug(component: string, message: string, metadata?: Record<string, unknown>): void {
    this.writeEntry(this.createEntry(LogLevel.DEBUG, component, message, metadata));
  }

  info(component: string, message: string, metadata?: Record<string, unknown>): void {
    this.writeEntry(this.createEntry(LogLevel.INFO, component, message, metadata));
  }

  warn(component: string, message: string, details?: Record<string, unknown> | Error): void {
    this.writeEntry(this.createEntry(LogLevel.WARN, component, message,
      details instanceof Error ? undefined : details, details instanceof Error ? details : undefined));
  }

  error(component: string, message: string, details?: Error | Record<string, unknown>, metadata?: Record<string, unknown>): void {
    this.writeEntry(this.createEntry(LogLevel.ERROR, component, message,
      details instanceof Error ? metadata : details ?? metadata, details instanceof Error ? details : undefined));
  }

  /**
   * Log AI request/response for debugging.
   */
  logAIRequest(
    provider: string,
    model: string,
    promptLength: number,
    imageSize?: number
  ): void {
    this.debug('ai', 'Request sent', {
      provider,
      model,
      promptLength,
      imageSize,
    });
  }

  logAIResponse(
    provider: string,
    success: boolean,
    latencyMs: number,
    tokens?: { prompt: number; completion: number }
  ): void {
    this.info('ai', 'Response received', {
      provider,
      success,
      latencyMs,
      tokens,
    });
  }
}

// ============================================================================
// Default Logger Instance
// ============================================================================

let defaultLogger: Logger | null = null;

/**
 * Get or create the default logger instance.
 */
export function getLogger(config?: Partial<LoggerConfig>): Logger {
  if (!defaultLogger || config) {
    defaultLogger = new Logger(config);
  }
  return defaultLogger;
}

// ============================================================================
// Convenience Functions
// ============================================================================

export function logDebug(component: string, message: string, metadata?: Record<string, unknown>): void {
  getLogger().debug(component, message, metadata);
}

export function logInfo(component: string, message: string, metadata?: Record<string, unknown>): void {
  getLogger().info(component, message, metadata);
}

export function logWarn(component: string, message: string, details?: Record<string, unknown> | Error): void {
  getLogger().warn(component, message, details);
}

export function logError(component: string, message: string, details?: Error | Record<string, unknown>, metadata?: Record<string, unknown>): void {
  getLogger().error(component, message, details, metadata);
}
