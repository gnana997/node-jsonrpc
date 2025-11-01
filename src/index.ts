/**
 * node-jsonrpc
 * Transport-agnostic JSON-RPC 2.0 client and server for TypeScript/Node.js
 *
 * @module node-jsonrpc
 */

// Core client
export { JSONRPCClient } from './client.js';

// Core server
export { JSONRPCServer } from './server.js';

// Transport interfaces
export type { Transport, TransportServer } from './transport.js';

// Types
export type {
  ClientEvents,
  Handler,
  JSONRPCClientConfig,
  JSONRPCError as IJSONRPCError,
  JSONRPCErrorResponse,
  JSONRPCMessage,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCServerConfig,
  Middleware,
  PendingRequest,
  RequestContext,
  RequestOptions,
  ServerEvents,
} from './types.js';

// Error class
export { JSONRPCError } from './error.js';

// Middleware
export {
  LoggingMiddleware,
  MetricsMiddleware,
  TransformMiddleware,
  ValidationMiddleware,
  executeMiddlewareChain,
} from './middleware.js';

// Logger
export { createLogger, defaultLogger, noopLogger, type Logger, type LogLevel } from './logger.js';

// Utilities
export { IDGenerator, defaultIDGenerator } from './utils/idGenerator.js';
export {
  isBatchRequest,
  isBatchResponse,
  isErrorResponse,
  isJSONRPCMessage,
  isNotification,
  isRequest,
  isResponse,
} from './utils/typeGuards.js';
