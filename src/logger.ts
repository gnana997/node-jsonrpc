/**
 * Log levels
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger interface
 */
export interface Logger {
  trace(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

/**
 * Logger format
 */
export type LogFormat = 'pretty' | 'json';

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /**
   * Minimum log level to output
   * @default 'info'
   */
  level?: LogLevel;

  /**
   * Output format
   * @default 'pretty'
   */
  format?: LogFormat;

  /**
   * Custom prefix for all log messages
   * @default '[JSON-RPC]'
   */
  prefix?: string;

  /**
   * Whether to include timestamps
   * @default true
   */
  timestamp?: boolean;
}

/**
 * Create a logger with the specified configuration
 *
 * @param config - Logger configuration
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger({ level: 'debug', format: 'json' });
 * logger.debug('Request sent', { id: 1, method: 'test' });
 * ```
 */
export function createLogger(config: LoggerConfig = {}): Logger {
  const { level = 'info', format = 'pretty', prefix = '[JSON-RPC]', timestamp = true } = config;

  const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];
  const minLevelIndex = levels.indexOf(level);

  const shouldLog = (logLevel: LogLevel): boolean => {
    return levels.indexOf(logLevel) >= minLevelIndex;
  };

  const formatMessage = (logLevel: LogLevel, message: string, ...args: any[]): string | object => {
    if (format === 'json') {
      return {
        timestamp: timestamp ? new Date().toISOString() : undefined,
        level: logLevel,
        message,
        data: args.length > 0 ? args : undefined,
      };
    }

    // Pretty format
    const parts: string[] = [];

    if (timestamp) {
      parts.push(`[${new Date().toISOString()}]`);
    }

    parts.push(prefix);
    parts.push(`[${logLevel.toUpperCase()}]`);
    parts.push(message);

    return parts.join(' ');
  };

  const log = (
    logLevel: LogLevel,
    consoleFn: (...args: any[]) => void,
    message: string,
    ...args: any[]
  ): void => {
    if (!shouldLog(logLevel)) {
      return;
    }

    const formatted = formatMessage(logLevel, message, ...args);

    if (format === 'json') {
      consoleFn(JSON.stringify(formatted));
    } else {
      consoleFn(formatted, ...args);
    }
  };

  return {
    trace: (message: string, ...args: any[]) => {
      log('trace', console.log, message, ...args);
    },

    debug: (message: string, ...args: any[]) => {
      log('debug', console.log, message, ...args);
    },

    info: (message: string, ...args: any[]) => {
      log('info', console.log, message, ...args);
    },

    warn: (message: string, ...args: any[]) => {
      log('warn', console.warn, message, ...args);
    },

    error: (message: string, ...args: any[]) => {
      log('error', console.error, message, ...args);
    },
  };
}

/**
 * No-op logger that does nothing
 * Useful for disabling logging
 */
export const noopLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Default logger instance with info level and pretty format
 */
export const defaultLogger = createLogger();
