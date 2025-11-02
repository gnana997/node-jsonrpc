import { EventEmitter } from 'node:events';
import { JSONRPCError } from './error.js';
import { type Logger, createLogger, noopLogger } from './logger.js';
import { executeMiddlewareChain } from './middleware.js';
import type { Transport, TransportServer } from './transport.js';
import type {
  Handler,
  JSONRPCBatch,
  JSONRPCBatchRequest,
  JSONRPCBatchResponse,
  JSONRPCErrorResponse,
  JSONRPCMessage,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCServerConfig,
  Middleware,
  RequestContext,
} from './types.js';
import { isBatch, isNotification, isRequest } from './utils/typeGuards.js';

/**
 * JSON-RPC 2.0 Server
 *
 * A transport-agnostic server for handling JSON-RPC 2.0 requests.
 * The server handles:
 * - Method registration and routing
 * - Request processing and response generation
 * - Multi-client connection management
 * - Broadcasting notifications to all clients
 * - Middleware execution
 *
 * The server does NOT handle:
 * - Connection lifecycle (delegate to TransportServer)
 * - Message buffering/framing (delegate to Transport)
 *
 * @example
 * ```typescript
 * import { JSONRPCServer } from '@gnana997/node-jsonrpc';
 * import { MyTransportServer } from './my-transport';
 *
 * const server = new JSONRPCServer({
 *   transportServer: new MyTransportServer(),
 * });
 *
 * server.registerMethod('add', async (params) => {
 *   return params.a + params.b;
 * });
 *
 * server.registerMethod('subtract', async (params) => {
 *   return params.minuend - params.subtrahend;
 * });
 *
 * await server.listen();
 * ```
 *
 * @fires notification - When a notification is received from a client (method, params, transport)
 * @fires error - When an error occurs
 */
export class JSONRPCServer extends EventEmitter {
  private transportServer: TransportServer;
  private methods = new Map<string, Handler>();
  private connections = new Set<Transport>();
  private config: Required<
    Omit<JSONRPCServerConfig, 'transportServer' | 'middleware' | 'onConnection' | 'onDisconnection'>
  > & {
    middleware: JSONRPCServerConfig['middleware'];
    onConnection?: JSONRPCServerConfig['onConnection'];
    onDisconnection?: JSONRPCServerConfig['onDisconnection'];
  };
  private logger: Logger;

  /**
   * Create a new JSON-RPC server
   *
   * @param config - Server configuration
   */
  constructor(config: JSONRPCServerConfig) {
    super();

    this.transportServer = config.transportServer;

    // Apply defaults
    this.config = {
      debug: false,
      middleware: [],
      ...config,
    };

    this.logger = this.config.debug ? createLogger({ level: 'debug' }) : noopLogger;

    this.setupTransportServerListeners();
  }

  /**
   * Setup listeners for transport server events
   * @private
   */
  private setupTransportServerListeners(): void {
    // Handle new client connections
    this.transportServer.on('connection', (transport: Transport) => {
      this.handleConnection(transport);
    });

    // Handle server errors
    this.transportServer.on('error', (error: Error) => {
      this.logger.error('Transport server error:', error.message);
      this.emit('error', error);
    });

    // Handle server close
    this.transportServer.on('close', () => {
      this.logger.debug('Transport server closed');
    });
  }

  /**
   * Start listening for connections
   * Delegates to the transport server
   *
   * @returns Promise that resolves when listening
   */
  async listen(): Promise<void> {
    await this.transportServer.listen();
    this.logger.info('Server listening');
  }

  /**
   * Stop listening for new connections
   * Optionally close all active connections
   *
   * @param options - Close options
   * @returns Promise that resolves when closed
   */
  async close(options?: { closeConnections?: boolean }): Promise<void> {
    // Close all active connections if requested
    if (options?.closeConnections) {
      const promises: Promise<void>[] = [];
      for (const transport of this.connections) {
        promises.push(transport.disconnect());
      }
      await Promise.all(promises);
      this.connections.clear();
    }

    await this.transportServer.close();
    this.logger.info('Server closed');
  }

  /**
   * Register a method handler
   *
   * @param name - Method name
   * @param handler - Handler function
   *
   * @example
   * ```typescript
   * server.registerMethod('add', async (params) => {
   *   return params.a + params.b;
   * });
   * ```
   *
   * @example With context
   * ```typescript
   * server.registerMethod('notify_client', async (params, context) => {
   *   // Send notification back to this client
   *   server.notify(context.transport, 'update', { status: 'processing' });
   *   return { success: true };
   * });
   * ```
   */
  registerMethod(name: string, handler: Handler): void {
    if (this.methods.has(name)) {
      this.logger.warn(`Method '${name}' already registered, overwriting`);
    }
    this.methods.set(name, handler);
    this.logger.debug(`Registered method: ${name}`);
  }

  /**
   * Unregister a method handler
   *
   * @param name - Method name to remove
   * @returns true if method was removed, false if not found
   */
  unregisterMethod(name: string): boolean {
    const removed = this.methods.delete(name);
    if (removed) {
      this.logger.debug(`Unregistered method: ${name}`);
    }
    return removed;
  }

  /**
   * Get a list of all registered method names
   *
   * @returns Array of method names
   */
  getMethods(): string[] {
    return Array.from(this.methods.keys());
  }

  /**
   * Check if a method is registered
   *
   * @param name - Method name
   * @returns true if method is registered
   */
  hasMethod(name: string): boolean {
    return this.methods.has(name);
  }

  /**
   * Add middleware to the server
   * Middleware is executed in the order it's added
   *
   * @param middleware - Middleware to add
   *
   * @example
   * ```typescript
   * import { LoggingMiddleware } from '@gnana997/node-jsonrpc';
   *
   * server.use(new LoggingMiddleware());
   * ```
   */
  use(middleware: Middleware): void {
    if (!this.config.middleware) {
      this.config.middleware = [];
    }
    this.config.middleware.push(middleware);
  }

  /**
   * Send a notification to a specific client
   *
   * @param transport - Client transport to send to
   * @param method - Notification method name
   * @param params - Notification parameters
   *
   * @example
   * ```typescript
   * server.notify(clientTransport, 'update', { status: 'ready' });
   * ```
   */
  notify(transport: Transport, method: string, params?: any): void {
    if (!transport.isConnected()) {
      this.logger.warn('Attempted to notify disconnected client');
      return;
    }

    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.logger.debug('Sending notification to client:', { method, params });

    const messageStr = JSON.stringify(notification);
    transport.send(messageStr);
  }

  /**
   * Broadcast a notification to all connected clients
   *
   * @param method - Notification method name
   * @param params - Notification parameters
   * @returns Number of clients the notification was sent to
   *
   * @example
   * ```typescript
   * const count = server.broadcast('serverStatus', { status: 'ready' });
   * console.log(`Sent to ${count} clients`);
   * ```
   */
  broadcast(method: string, params?: any): number {
    let count = 0;

    for (const transport of this.connections) {
      if (transport.isConnected()) {
        this.notify(transport, method, params);
        count++;
      }
    }

    this.logger.debug(`Broadcast to ${count} clients:`, { method, params });

    return count;
  }

  /**
   * Get the number of active client connections
   *
   * @returns Number of connected clients
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Handle a new client connection
   * @private
   */
  private handleConnection(transport: Transport): void {
    this.connections.add(transport);
    this.logger.debug(`Client connected. Total connections: ${this.connections.size}`);

    // Call onConnection hook if provided
    if (this.config.onConnection) {
      this.config.onConnection(transport);
    }

    // Listen for messages from this client
    transport.on('message', (message: string) => {
      this.handleRawMessage(message, transport);
    });

    // Handle client disconnect
    transport.on('disconnect', () => {
      this.connections.delete(transport);
      this.logger.debug(`Client disconnected. Total connections: ${this.connections.size}`);

      // Call onDisconnection hook if provided
      if (this.config.onDisconnection) {
        this.config.onDisconnection(transport);
      }
    });

    // Handle transport errors
    transport.on('error', (error: Error) => {
      this.logger.error('Client transport error:', error.message);
      this.emit('error', error);
    });
  }

  /**
   * Handle raw message string from a client transport
   * @private
   */
  private async handleRawMessage(messageStr: string, transport: Transport): Promise<void> {
    let message: JSONRPCMessage | JSONRPCBatchRequest;

    try {
      message = JSON.parse(messageStr);
    } catch (error) {
      this.logger.error('Failed to parse message:', messageStr);
      // Send parse error to client
      this.sendErrorResponse(transport, null, JSONRPCError.parseError());
      return;
    }

    // Handle batch (requests and/or notifications)
    if (isBatch(message)) {
      await this.handleBatchRequest(message, transport);
      return;
    }

    // Handle single message
    if (isRequest(message)) {
      await this.handleRequest(message, transport);
    } else if (isNotification(message)) {
      await this.handleNotification(message, transport);
    } else {
      this.logger.warn('Received unknown message type:', message);
      this.sendErrorResponse(transport, null, JSONRPCError.invalidRequest());
    }
  }

  /**
   * Handle a JSON-RPC request from a client
   * @private
   */
  private async handleRequest(request: JSONRPCRequest, transport: Transport): Promise<void> {
    this.logger.debug('Received request:', {
      id: request.id,
      method: request.method,
      params: request.params,
    });

    // Apply request middleware
    let processedRequest = request;
    if (this.config.middleware && this.config.middleware.length > 0) {
      try {
        processedRequest = await executeMiddlewareChain(
          this.config.middleware,
          'onRequest',
          request
        );
      } catch (error) {
        this.logger.error('Request middleware error:', error);
        this.sendErrorResponse(
          transport,
          request.id,
          JSONRPCError.internalError('Middleware error')
        );
        return;
      }
    }

    // Check if method exists
    const handler = this.methods.get(processedRequest.method);
    if (!handler) {
      this.sendErrorResponse(
        transport,
        processedRequest.id,
        JSONRPCError.methodNotFound(processedRequest.method)
      );
      return;
    }

    // Build request context
    const context: RequestContext = {
      method: processedRequest.method,
      requestId: processedRequest.id,
      transport,
    };

    try {
      // Call handler
      const result = await handler(processedRequest.params, context);

      // Build response
      let response: JSONRPCResponse = {
        jsonrpc: '2.0',
        result,
        id: processedRequest.id,
      };

      // Apply response middleware
      if (this.config.middleware && this.config.middleware.length > 0) {
        response = await executeMiddlewareChain(this.config.middleware, 'onResponse', response);
      }

      this.logger.debug('Sending response:', { id: response.id });

      // Send response
      const messageStr = JSON.stringify(response);
      transport.send(messageStr);
    } catch (error: any) {
      this.logger.error('Handler error:', error);

      // Send error response
      const jsonRpcError =
        error instanceof JSONRPCError
          ? error
          : JSONRPCError.internalError(error.message, {
              stack: error.stack,
            });

      this.sendErrorResponse(transport, processedRequest.id, jsonRpcError);
    }
  }

  /**
   * Handle a notification from a client
   * @private
   */
  private async handleNotification(
    notification: JSONRPCNotification,
    transport: Transport
  ): Promise<void> {
    this.logger.debug('Received notification:', {
      method: notification.method,
      params: notification.params,
    });

    // Apply notification middleware
    if (this.config.middleware && this.config.middleware.length > 0) {
      try {
        await executeMiddlewareChain(this.config.middleware, 'onNotification', notification);
      } catch (error) {
        this.logger.error('Notification middleware error:', error);
        // Notifications don't send responses, so just log
      }
    }

    // Emit notification event
    this.emit('notification', notification.method, notification.params, transport);
  }

  /**
   * Handle a batch from a client (can contain requests and/or notifications)
   * @private
   */
  private async handleBatchRequest(
    batchRequest: JSONRPCBatch,
    transport: Transport
  ): Promise<void> {
    this.logger.debug('Received batch request with', batchRequest.length, 'items');

    // Per JSON-RPC 2.0 spec: empty batch is invalid
    if (batchRequest.length === 0) {
      this.sendErrorResponse(transport, null, JSONRPCError.invalidRequest());
      return;
    }

    // Apply batch request middleware
    let processedBatch = batchRequest;
    if (this.config.middleware && this.config.middleware.length > 0) {
      try {
        processedBatch = await executeMiddlewareChain(
          this.config.middleware,
          'onBatchRequest',
          batchRequest
        );
      } catch (error) {
        this.logger.error('Batch request middleware error:', error);
        this.sendErrorResponse(transport, null, JSONRPCError.internalError('Middleware error'));
        return;
      }
    }

    // Process all requests in parallel
    const responsePromises = processedBatch.map(async (item) => {
      // Handle notifications separately (no response)
      if (isNotification(item)) {
        await this.handleNotification(item, transport);
        return null; // No response for notifications
      }

      // Handle regular requests - return the response
      if (isRequest(item)) {
        return this.processRequestForBatch(item, transport);
      }

      // Invalid item in batch
      return {
        jsonrpc: '2.0' as const,
        error: JSONRPCError.invalidRequest().toJSON(),
        id: null,
      };
    });

    const responses = await Promise.all(responsePromises);

    // Filter out null responses (from notifications)
    const batchResponse: JSONRPCBatchResponse = responses.filter(
      (r): r is JSONRPCResponse | JSONRPCErrorResponse => r !== null
    );

    // Per JSON-RPC 2.0 spec: if all requests were notifications, don't send a response
    if (batchResponse.length === 0) {
      this.logger.debug('Batch contained only notifications, not sending response');
      return;
    }

    // Apply batch response middleware
    let finalBatchResponse = batchResponse;
    if (this.config.middleware && this.config.middleware.length > 0) {
      finalBatchResponse = await executeMiddlewareChain(
        this.config.middleware,
        'onBatchResponse',
        batchResponse
      );
    }

    // Send batch response
    this.logger.debug('Sending batch response with', finalBatchResponse.length, 'items');
    const messageStr = JSON.stringify(finalBatchResponse);
    transport.send(messageStr);
  }

  /**
   * Process a single request within a batch and return the response
   * @private
   */
  private async processRequestForBatch(
    request: JSONRPCRequest,
    transport: Transport
  ): Promise<JSONRPCResponse | JSONRPCErrorResponse> {
    try {
      // Apply request middleware
      let processedRequest = request;
      if (this.config.middleware && this.config.middleware.length > 0) {
        processedRequest = await executeMiddlewareChain(
          this.config.middleware,
          'onRequest',
          request
        );
      }

      // Check if method exists
      const handler = this.methods.get(processedRequest.method);
      if (!handler) {
        return {
          jsonrpc: '2.0',
          error: JSONRPCError.methodNotFound(processedRequest.method).toJSON(),
          id: processedRequest.id,
        };
      }

      // Build request context
      const context: RequestContext = {
        method: processedRequest.method,
        requestId: processedRequest.id,
        transport,
      };

      // Call handler
      const result = await handler(processedRequest.params, context);

      // Build response
      let response: JSONRPCResponse = {
        jsonrpc: '2.0',
        result,
        id: processedRequest.id,
      };

      // Apply response middleware
      if (this.config.middleware && this.config.middleware.length > 0) {
        response = await executeMiddlewareChain(this.config.middleware, 'onResponse', response);
      }

      return response;
    } catch (error: any) {
      const jsonRpcError =
        error instanceof JSONRPCError
          ? error
          : JSONRPCError.internalError(error.message, {
              stack: error.stack,
            });

      return {
        jsonrpc: '2.0',
        error: jsonRpcError.toJSON(),
        id: request.id,
      };
    }
  }

  /**
   * Send an error response to a client
   * @private
   */
  private sendErrorResponse(
    transport: Transport,
    id: string | number | null,
    error: JSONRPCError
  ): void {
    const errorResponse: JSONRPCErrorResponse = {
      jsonrpc: '2.0',
      error: error.toJSON(),
      id,
    };

    this.logger.debug('Sending error response:', {
      id,
      code: error.code,
      message: error.message,
    });

    const messageStr = JSON.stringify(errorResponse);
    transport.send(messageStr);
  }
}
