export type LogLevel = 0 | 1 | 2 | 3;

export type Logger = {
  debug: (scope: string, message: string, meta?: unknown) => void;
  info: (scope: string, message: string, meta?: unknown) => void;
  warn: (scope: string, message: string, meta?: unknown) => void;
  error: (scope: string, message: string, err?: Error, meta?: unknown) => void;
  logAIResponse: (provider: string, success: boolean, latencyMs: number, tokens: { prompt: number; completion: number }) => void;
};

export function getLogger(opts?: { minLevel?: LogLevel }): Logger {
  const minLevel = opts?.minLevel ?? 1;

  const log = (level: LogLevel, label: string, scope: string, message: string, meta?: unknown) => {
    if (level < minLevel) return;
    const prefix = `[${label}] [${scope}]`;
    if (meta !== undefined) {
      console.log(prefix, message, meta);
    } else {
      console.log(prefix, message);
    }
  };

  return {
    debug: (scope, message, meta) => log(0, "DEBUG", scope, message, meta),
    info: (scope, message, meta) => log(1, "INFO", scope, message, meta),
    warn: (scope, message, meta) => log(2, "WARN", scope, message, meta),
    error: (scope, message, err, meta) => {
      if (err) {
        log(3, "ERROR", scope, message, { error: err.message, stack: err.stack, meta });
      } else {
        log(3, "ERROR", scope, message, meta);
      }
    },
    logAIResponse: (provider, success, latencyMs, tokens) => {
      log(1, "AI", "analysis", `${provider} ${success ? "success" : "fail"}`, { latencyMs, tokens });
    }
  };
}
