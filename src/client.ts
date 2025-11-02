import { EventEmitter } from 'node:events';
import { BatchRequest } from './batch.js';
import { JSONRPCError } from './error.js';
import { type Logger, createLogger, noopLogger } from './logger.js';
import { executeMiddlewareChain } from './middleware.js';
import type { Transport } from './transport.js';
import type {
  JSONRPCBatchResponse,
  JSONRPCClientConfig,
  JSONRPCMessage,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
  Middleware,
  PendingRequest,
  RequestOptions,
} from './types.js';
import { IDGenerator } from './utils/idGenerator.js';
import {
  isBatchResponse,
  isErrorResponse,
  isNotification,
  isResponse,
} from './utils/typeGuards.js';

/**
 * JSON-RPC 2.0 Client
 *
 * A transport-agnostic client for making JSON-RPC 2.0 requests.
 * The client handles:
 * - Request/response ID matching
 * - Request timeouts
 * - Notification handling
 * - Middleware execution
 * - Request cancellation (AbortSignal)
 * - Batch requests
 *
 * The client does NOT handle:
 * - Connection management (delegate to Transport)
 * - Message buffering/framing (delegate to Transport)
 * - Auto-reconnection (Transport or wrapper's responsibility)
 *
 * @example
 * ```typescript
 * import { JSONRPCClient } from 'node-jsonrpc';
 * import { MyTransport } from './my-transport';
 *
 * const client = new JSONRPCClient({
 *   transport: new MyTransport(),
 * });
 *
 * await client.connect();
 *
 * const result = await client.request('subtract', { minuend: 42, subtrahend: 23 });
 * console.log(result); // 19
 *
 * client.on('notification', (method, params) => {
 *   console.log('Server notification:', method, params);
 * });
 * ```
 *
 * @fires connected - When transport connects
 * @fires disconnected - When transport disconnects
 * @fires error - When a transport error occurs
 * @fires notification - When a notification is received (method, params)
 */
export class JSONRPCClient extends EventEmitter {
  private transport: Transport;
  private pendingRequests = new Map<string | number, PendingRequest>();
  private idGenerator = new IDGenerator();
  private config: Required<Omit<JSONRPCClientConfig, 'transport' | 'middleware'>> & {
    middleware: JSONRPCClientConfig['middleware'];
  };
  private logger: Logger;

  /**
   * Create a new JSON-RPC client
   *
   * @param config - Client configuration
   */
  constructor(config: JSONRPCClientConfig) {
    super();

    this.transport = config.transport;

    // Apply defaults
    this.config = {
      requestTimeout: 30000,
      debug: false,
      middleware: [],
      ...config,
    };

    this.logger = this.config.debug ? createLogger({ level: 'debug' }) : noopLogger;

    this.setupTransportListeners();
  }

  /**
   * Setup listeners for transport events
   * @private
   */
  private setupTransportListeners(): void {
    // Handle messages from transport
    this.transport.on('message', (message: string) => {
      this.handleRawMessage(message);
    });

    // Forward connection events
    this.transport.on('connect', () => {
      this.logger.debug('Transport connected');
      this.emit('connected');
    });

    // Handle disconnect - cleanup pending requests
    this.transport.on('disconnect', () => {
      this.logger.debug('Transport disconnected');
      this.cleanupPendingRequests();
      this.emit('disconnected');
    });

    // Forward transport errors
    this.transport.on('error', (error: Error) => {
      this.logger.error('Transport error:', error.message);
      this.emit('error', error);
    });
  }

  /**
   * Connect to the remote endpoint
   * Delegates to the transport
   *
   * @returns Promise that resolves when connected
   */
  async connect(): Promise<void> {
    return this.transport.connect();
  }

  /**
   * Disconnect from the remote endpoint
   * Delegates to the transport
   *
   * @returns Promise that resolves when disconnected
   */
  async disconnect(): Promise<void> {
    return this.transport.disconnect();
  }

  /**
   * Check if connected
   * Delegates to the transport
   *
   * @returns true if connected, false otherwise
   */
  isConnected(): boolean {
    return this.transport.isConnected();
  }

  /**
   * Make a JSON-RPC request and wait for the response
   *
   * @param method - Method name to call
   * @param params - Method parameters
   * @param options - Request options (timeout, signal)
   * @returns Promise that resolves with the result
   * @throws JSONRPCError if server returns an error
   * @throws Error if request times out or is aborted
   *
   * @example
   * ```typescript
   * const result = await client.request('subtract', { minuend: 42, subtrahend: 23 });
   * ```
   *
   * @example With timeout
   * ```typescript
   * const result = await client.request('slowMethod', {}, { timeout: 5000 });
   * ```
   *
   * @example With cancellation
   * ```typescript
   * const controller = new AbortController();
   * const promise = client.request('longOperation', {}, { signal: controller.signal });
   *
   * // Cancel the request
   * controller.abort();
   * ```
   */
  async request<TResult = any>(
    method: string,
    params?: any,
    options?: RequestOptions
  ): Promise<TResult> {
    if (!this.isConnected()) {
      throw new Error('Client not connected');
    }

    const id = this.idGenerator.next();

    let request: JSONRPCRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    // Apply request middleware
    if (this.config.middleware && this.config.middleware.length > 0) {
      request = await executeMiddlewareChain(this.config.middleware, 'onRequest', request);
    }

    this.logger.debug('Sending request:', { id, method, params });

    // Send via transport (transport handles framing)
    const messageStr = JSON.stringify(request);
    this.transport.send(messageStr);

    // Track pending request and return promise
    return this.trackPendingRequest<TResult>(
      id,
      options?.timeout ?? this.config.requestTimeout,
      options?.signal
    );
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   *
   * @param method - Method name
   * @param params - Method parameters
   *
   * @example
   * ```typescript
   * client.notify('update', { status: 'ready' });
   * ```
   */
  notify(method: string, params?: any): void {
    if (!this.isConnected()) {
      throw new Error('Client not connected');
    }

    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.logger.debug('Sending notification:', { method, params });

    const messageStr = JSON.stringify(notification);
    this.transport.send(messageStr);
  }

  /**
   * Add middleware to the client
   * Middleware is executed in the order it's added
   *
   * @param middleware - Middleware to add
   *
   * @example
   * ```typescript
   * import { LoggingMiddleware } from 'node-jsonrpc';
   *
   * client.use(new LoggingMiddleware());
   * ```
   */
  use(middleware: Middleware): void {
    if (!this.config.middleware) {
      this.config.middleware = [];
    }
    this.config.middleware.push(middleware);
  }

  /**
   * Create a batch request
   * Returns a BatchRequest object that can be used to send multiple requests at once
   *
   * @returns BatchRequest builder instance
   *
   * @example
   * ```typescript
   * const batch = client.batch();
   * batch.add('add', { a: 1, b: 2 });
   * batch.add('subtract', { minuend: 10, subtrahend: 5 });
   *
   * // Execute in parallel (default)
   * const [sum, difference] = await batch.execute();
   * console.log(sum, difference); // 3, 5
   *
   * // Execute sequentially
   * const results = await batch.execute({ mode: 'sequential' });
   * ```
   */
  batch(): BatchRequest {
    return new BatchRequest(
      this.transport,
      this.idGenerator,
      this.pendingRequests,
      this.config.middleware,
      this.config.requestTimeout
    );
  }

  /**
   * Handle raw message string from transport
   * @private
   */
  private async handleRawMessage(messageStr: string): Promise<void> {
    let message: JSONRPCMessage | JSONRPCBatchResponse;

    try {
      message = JSON.parse(messageStr);
    } catch (error) {
      this.logger.error('Failed to parse message:', messageStr);
      this.emit('error', new Error('Invalid JSON received'));
      return;
    }

    // Handle batch response
    if (isBatchResponse(message)) {
      await this.handleBatchResponse(message);
      return;
    }

    // Handle single message
    if (isResponse(message) || isErrorResponse(message)) {
      await this.handleResponse(message);
    } else if (isNotification(message)) {
      await this.handleNotification(message);
    } else {
      this.logger.warn('Received unknown message type:', message);
    }
  }

  /**
   * Handle a response or error response
   * @private
   */
  private async handleResponse(
    response: JSONRPCResponse | { jsonrpc: '2.0'; error: any; id: string | number | null }
  ): Promise<void> {
    const pending = this.pendingRequests.get(response.id!);

    if (!pending) {
      this.logger.warn('Received response for unknown request:', response.id);
      return;
    }

    // Remove from pending and clear timeout
    this.pendingRequests.delete(response.id!);
    clearTimeout(pending.timeout);

    // Handle error response
    if (isErrorResponse(response)) {
      let error = new JSONRPCError(response.error);

      // Apply error middleware
      if (this.config.middleware && this.config.middleware.length > 0) {
        const modifiedError = await executeMiddlewareChain(
          this.config.middleware,
          'onError',
          error.toJSON()
        );
        error = new JSONRPCError(modifiedError);
      }

      this.logger.debug('Received error response:', {
        id: response.id,
        code: error.code,
        message: error.message,
      });

      pending.reject(error);
      return;
    }

    // Handle success response
    let finalResponse = response as JSONRPCResponse;

    // Apply response middleware
    if (this.config.middleware && this.config.middleware.length > 0) {
      finalResponse = await executeMiddlewareChain(
        this.config.middleware,
        'onResponse',
        finalResponse
      );
    }

    this.logger.debug('Received response:', { id: finalResponse.id });

    pending.resolve(finalResponse.result);
  }

  /**
   * Handle a notification from the server
   * @private
   */
  private async handleNotification(notification: JSONRPCNotification): Promise<void> {
    this.logger.debug('Received notification:', {
      method: notification.method,
      params: notification.params,
    });

    // Apply notification middleware
    if (this.config.middleware && this.config.middleware.length > 0) {
      await executeMiddlewareChain(this.config.middleware, 'onNotification', notification);
    }

    // Emit notification event
    this.emit('notification', notification.method, notification.params);
  }

  /**
   * Handle a batch response
   * @private
   */
  private async handleBatchResponse(batchResponse: JSONRPCBatchResponse): Promise<void> {
    this.logger.debug('Received batch response with', batchResponse.length, 'items');

    // Apply batch response middleware
    let finalBatchResponse = batchResponse;
    if (this.config.middleware && this.config.middleware.length > 0) {
      finalBatchResponse = await executeMiddlewareChain(
        this.config.middleware,
        'onBatchResponse',
        batchResponse
      );
    }

    // Process each response in the batch
    for (const response of finalBatchResponse) {
      // Each response is either a success or error response
      // Delegate to the single response handler
      await this.handleResponse(response);
    }
  }

  /**
   * Track a pending request and return a promise
   * @private
   */
  private trackPendingRequest<T>(
    id: string | number,
    timeout: number,
    signal?: AbortSignal
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Setup timeout
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${id} timed out after ${timeout}ms`));
      }, timeout);

      // Create pending request entry
      const pending: PendingRequest = {
        resolve: resolve as (result: any) => void,
        reject,
        timeout: timeoutHandle,
      };

      // Handle AbortSignal if provided
      if (signal) {
        const abortHandler = () => {
          this.pendingRequests.delete(id);
          clearTimeout(timeoutHandle);
          reject(new Error('Request aborted'));
        };

        if (signal.aborted) {
          // Already aborted
          abortHandler();
          return;
        }

        signal.addEventListener('abort', abortHandler, { once: true });
      }

      // Store pending request
      this.pendingRequests.set(id, pending);
    });
  }

  /**
   * Clean up all pending requests (called on disconnect)
   * @private
   */
  private cleanupPendingRequests(): void {
    for (const [id, pending] of this.pendingRequests) {
      this.logger.debug('Cleaning up pending request:', id);
      clearTimeout(pending.timeout);
      pending.reject(new Error('Client disconnected'));
    }
    this.pendingRequests.clear();
    this.logger.debug('Cleaned up pending requests');
  }

  /**
   * Get the number of pending requests
   * Useful for monitoring
   */
  getPendingRequestCount(): number {
    return this.pendingRequests.size;
  }
}
