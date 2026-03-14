// ─────────────────────────────────────────────────────────────────────────────
//  Logger utility for the frontend
// ─────────────────────────────────────────────────────────────────────────────

const LOG_LEVEL = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// Check if we're in development mode via window location or import.meta
const isDev = import.meta.env.DEV || window.location.hostname === "localhost";
const currentLevel = isDev ? LOG_LEVEL.DEBUG : LOG_LEVEL.INFO;

function shouldLog(level: number): boolean {
  return level >= currentLevel;
}

function formatTime(): string {
  const now = new Date();
  return now.toISOString().slice(11, 23); // HH:MM:SS.mmm
}

function formatLog(level: string, module: string, message: string, data?: unknown): string {
  const time = formatTime();
  const prefix = `[${time}] ${level.padEnd(6)} [${module}]`;
  if (data === undefined) {
    return `${prefix} ${message}`;
  }
  return `${prefix} ${message} ${JSON.stringify(data)}`;
}

export const logger = {
  debug: (module: string, message: string, data?: unknown) => {
    if (shouldLog(LOG_LEVEL.DEBUG)) {
      console.log(`%c${formatLog("DEBUG", module, message, data)}`, "color: #666");
    }
  },

  info: (module: string, message: string, data?: unknown) => {
    if (shouldLog(LOG_LEVEL.INFO)) {
      console.log(`%c${formatLog("INFO", module, message, data)}`, "color: #0066cc");
    }
  },

  warn: (module: string, message: string, data?: unknown) => {
    if (shouldLog(LOG_LEVEL.WARN)) {
      console.warn(`%c${formatLog("WARN", module, message, data)}`, "color: #ff9900");
    }
  },

  error: (module: string, message: string, data?: unknown) => {
    if (shouldLog(LOG_LEVEL.ERROR)) {
      console.error(`%c${formatLog("ERROR", module, message, data)}`, "color: #cc0000");
    }
  },

  apiCall: (method: string, path: string, status: number, duration: number) => {
    const color = status >= 400 ? "color: #cc0000" : "color: #00aa00";
    console.log(
      `%c[${formatTime()}] API      ${method.padEnd(6)} ${path.padEnd(40)} ${status} (${duration}ms)`,
      color
    );
  },

  apiError: (method: string, path: string, error: unknown) => {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(
      `%c[${formatTime()}] API_ERR  ${method.padEnd(6)} ${path.padEnd(40)} ${msg}`,
      "color: #cc0000"
    );
  },
};
