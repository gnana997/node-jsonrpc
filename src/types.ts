import type { Transport, TransportServer } from './transport.js';

/**
 * JSON-RPC 2.0 Types
 */

/** JSON-RPC 2.0 Request */
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id: string | number;
}

/** JSON-RPC 2.0 Response (success) */
export interface JSONRPCResponse {
  jsonrpc: '2.0';
  result: any;
  error?: never;
  id: string | number;
}

/** JSON-RPC 2.0 Error object */
export interface JSONRPCError {
  code: number;
  message: string;
  data?: any;
}

/** JSON-RPC 2.0 Response (error) */
export interface JSONRPCErrorResponse {
  jsonrpc: '2.0';
  result?: never;
  error: JSONRPCError;
  id: string | number | null;
}

/** JSON-RPC 2.0 Notification (no response expected) */
export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id?: never;
}

/** Union of all possible JSON-RPC messages */
export type JSONRPCMessage =
  | JSONRPCRequest
  | JSONRPCResponse
  | JSONRPCErrorResponse
  | JSONRPCNotification;

/**
 * Pending Request
 * Tracks an in-flight request waiting for a response
 */
export interface PendingRequest {
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Request Options
 * Options that can be passed when making a request
 */
export interface RequestOptions {
  /**
   * Request timeout in milliseconds
   * Overrides the client's default timeout
   */
  timeout?: number;

  /**
   * AbortSignal for request cancellation
   * When aborted, the request will be rejected
   */
  signal?: AbortSignal;
}

/**
 * Middleware Interface
 * Allows intercepting and modifying requests, responses, errors, and notifications
 */
export interface Middleware {
  /**
   * Called before a request is sent
   * Can modify the request or throw to prevent sending
   */
  onRequest?(request: JSONRPCRequest): JSONRPCRequest | Promise<JSONRPCRequest>;

  /**
   * Called after a response is received
   * Can modify the response before it's returned to the caller
   */
  onResponse?(response: JSONRPCResponse): JSONRPCResponse | Promise<JSONRPCResponse>;

  /**
   * Called when an error response is received
   * Can modify the error before it's thrown
   */
  onError?(error: JSONRPCError): JSONRPCError | Promise<JSONRPCError>;

  /**
   * Called when a notification is received (client) or sent (server)
   * Cannot modify the notification, but can perform side effects
   */
  onNotification?(notification: JSONRPCNotification): void | Promise<void>;
}

/**
 * JSONRPCClient Configuration
 */
export interface JSONRPCClientConfig {
  /**
   * Transport implementation for sending/receiving messages
   */
  transport: Transport;

  /**
   * Default request timeout in milliseconds
   * Can be overridden per-request
   * @default 30000 (30 seconds)
   */
  requestTimeout?: number;

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;

  /**
   * Middleware to apply to all requests/responses
   * Middleware is executed in order: first registered = outermost wrapper
   */
  middleware?: Middleware[];
}

/**
 * JSONRPCServer Configuration
 */
export interface JSONRPCServerConfig {
  /**
   * Transport server for accepting connections
   */
  transportServer: TransportServer;

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;

  /**
   * Middleware to apply to all requests/responses
   * Middleware is executed in order: first registered = outermost wrapper
   */
  middleware?: Middleware[];

  /**
   * Called when a new client connects
   * @param transport - The transport for this client connection
   */
  onConnection?: (transport: Transport) => void;

  /**
   * Called when a client disconnects
   * @param transport - The transport that was disconnected
   */
  onDisconnection?: (transport: Transport) => void;
}

/**
 * Request Handler
 * Function that handles a JSON-RPC request on the server
 */
export type Handler = (params: any, context: RequestContext) => any | Promise<any>;

/**
 * Request Context
 * Contextual information available to request handlers
 */
export interface RequestContext {
  /**
   * The method name being called
   */
  method: string;

  /**
   * The request ID
   */
  requestId: string | number;

  /**
   * The transport for this client connection
   * Can be used to send notifications back to this specific client
   */
  transport: Transport;
}

/**
 * Client Events
 * Events emitted by JSONRPCClient
 */
export interface ClientEvents {
  /** Fired when connected to the server */
  connected: [];

  /** Fired when disconnected from the server */
  disconnected: [];

  /** Fired when a transport error occurs */
  error: [error: Error];

  /** Fired when a notification is received from the server */
  notification: [method: string, params: any];
}

/**
 * Server Events
 * Events emitted by JSONRPCServer
 */
export interface ServerEvents {
  /** Fired when a notification is received from a client */
  notification: [method: string, params: any, transport: Transport];

  /** Fired when a transport error occurs */
  error: [error: Error];
}
