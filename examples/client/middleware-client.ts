/**
 * Client Middleware Example
 *
 * Demonstrates JSON-RPC client middleware capabilities including:
 * - Logging middleware (request/response/error logging)
 * - Metrics middleware (timing, counters)
 * - Authentication middleware (adding auth headers)
 * - Validation middleware (parameter validation)
 * - Custom middleware implementation
 * - Middleware chaining
 */

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { JSONRPCClient } from '../../src/client.js';
import type { Transport } from '../../src/transport.js';
import type { Middleware } from '../../src/types.js';

/**
 * Simple TCP Transport implementation
 */
class TCPTransport extends EventEmitter implements Transport {
  private socket?: net.Socket;
  private buffer = '';
  private connected = false;

  constructor(
    private host: string,
    private port: number
  ) {
    super();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.connect(this.port, this.host);

      this.socket.on('connect', () => {
        this.connected = true;
        this.setupListeners();
        resolve();
      });

      this.socket.once('error', reject);
    });
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket = undefined;
      this.connected = false;
    }
  }

  send(message: string): void {
    if (!this.connected || !this.socket) {
      this.emit('error', new Error('Cannot send - not connected'));
      return;
    }

    try {
      this.socket.write(`${message}\n`);
    } catch (error) {
      this.emit('error', error as Error);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private setupListeners(): void {
    if (!this.socket) return;

    this.socket.on('data', (data: Buffer) => this.handleData(data));
    this.socket.on('error', (error: Error) => this.emit('error', error));
    this.socket.on('close', () => {
      this.connected = false;
      this.emit('close');
    });
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.substring(0, newlineIndex);
      this.buffer = this.buffer.substring(newlineIndex + 1);

      if (line.trim()) {
        this.emit('message', line);
      }
    }
  }
}

/**
 * Logging Middleware - Logs all requests, responses, errors, and notifications
 */
function createLoggingMiddleware(): Middleware {
  return {
    onRequest: (request) => {
      console.log(`[LOG] → Request: ${request.method}`, {
        id: request.id,
        params: request.params,
      });
      return request;
    },

    onResponse: (response) => {
      console.log('[LOG] ← Response:', {
        id: response.id,
        result: response.result,
      });
      return response;
    },

    onError: (error) => {
      console.log('[LOG] ✗ Error:', {
        code: error.code,
        message: error.message,
        data: error.data,
      });
      return error;
    },

    onNotification: (notification) => {
      console.log(`[LOG] ← Notification: ${notification.method}`, {
        params: notification.params,
      });
    },
  };
}

/**
 * Metrics Middleware - Tracks timing and counts
 */
function createMetricsMiddleware() {
  const metrics = {
    requestCount: 0,
    responseCount: 0,
    errorCount: 0,
    notificationCount: 0,
    totalRequestTime: 0,
    requestTimings: new Map<string | number, number>(),
  };

  const middleware: Middleware = {
    onRequest: (request) => {
      metrics.requestCount++;
      if (request.id !== undefined) {
        metrics.requestTimings.set(request.id, Date.now());
      }
      return request;
    },

    onResponse: (response) => {
      metrics.responseCount++;
      const startTime = metrics.requestTimings.get(response.id);
      if (startTime) {
        const duration = Date.now() - startTime;
        metrics.totalRequestTime += duration;
        metrics.requestTimings.delete(response.id);
        console.log(`[METRICS] Request ${response.id} took ${duration}ms`);
      }
      return response;
    },

    onError: (error) => {
      metrics.errorCount++;
      return error;
    },

    onNotification: (_notification) => {
      metrics.notificationCount++;
    },
  };

  return {
    middleware,
    getMetrics: () => ({
      ...metrics,
      averageRequestTime:
        metrics.responseCount > 0 ? metrics.totalRequestTime / metrics.responseCount : 0,
      pendingRequests: metrics.requestTimings.size,
    }),
  };
}

/**
 * Authentication Middleware - Adds auth token to requests
 */
function createAuthMiddleware(token: string): Middleware {
  return {
    onRequest: (request) => {
      // Add auth token to params (server can extract it)
      return {
        ...request,
        params: {
          ...request.params,
          _auth: token,
        },
      };
    },
  };
}

/**
 * Validation Middleware - Validates request parameters
 */
function createValidationMiddleware(): Middleware {
  return {
    onRequest: (request) => {
      // Example: Ensure numeric parameters are numbers
      if (request.method === 'add' && request.params) {
        const params = request.params as { a: unknown; b: unknown };
        if (typeof params.a !== 'number' || typeof params.b !== 'number') {
          throw new Error(
            `Invalid parameters for ${request.method}: expected numbers, got ${typeof params.a} and ${typeof params.b}`
          );
        }
      }
      return request;
    },
  };
}

/**
 * Retry Middleware - Automatically retries failed requests
 */
function createRetryMiddleware(maxRetries = 3): Middleware {
  const retryCount = new Map<string | number, number>();

  return {
    onError: (error) => {
      // Note: This is a simplified example. Real retry logic would need
      // to re-send the request, which requires access to the client.
      const requestId = (error as unknown as { id?: string | number }).id;
      if (requestId !== undefined) {
        const count = retryCount.get(requestId) || 0;
        if (count < maxRetries && error.code !== -32600) {
          // Don't retry client errors
          retryCount.set(requestId, count + 1);
          console.log(`[RETRY] Attempt ${count + 1}/${maxRetries} for request ${requestId}`);
        } else {
          retryCount.delete(requestId);
        }
      }
      return error;
    },
  };
}

/**
 * Rate Limiting Middleware - Limits request rate
 */
function createRateLimitMiddleware(requestsPerSecond: number): Middleware {
  const timestamps: number[] = [];

  return {
    onRequest: (request) => {
      const now = Date.now();
      const oneSecondAgo = now - 1000;

      // Remove old timestamps
      while (timestamps.length > 0 && timestamps[0]! < oneSecondAgo) {
        timestamps.shift();
      }

      // Check rate limit
      if (timestamps.length >= requestsPerSecond) {
        throw new Error(
          `Rate limit exceeded: ${requestsPerSecond} requests per second. Try again in ${Math.ceil(1000 - (now - timestamps[0]!))}ms`
        );
      }

      timestamps.push(now);
      return request;
    },
  };
}

/**
 * Main example function
 */
async function main(): Promise<void> {
  const transport = new TCPTransport('localhost', 3000);

  // Create metrics middleware
  const { middleware: metricsMiddleware, getMetrics } = createMetricsMiddleware();

  // Create client with multiple middleware
  const client = new JSONRPCClient({
    transport,
    requestTimeout: 5000,
    debug: false, // Disable debug mode to see clean middleware output
  });

  // Register middleware in order
  console.log('Registering middleware...\n');
  client.use(createLoggingMiddleware());
  client.use(metricsMiddleware);
  client.use(createAuthMiddleware('secret-token-12345'));
  client.use(createValidationMiddleware());
  client.use(createRateLimitMiddleware(10)); // 10 requests per second

  client.on('connected', () => console.log('✓ Connected to server\n'));
  client.on('error', (error: Error) => console.error('✗ Error:', error.message));

  try {
    await client.connect();

    // Example 1: Normal request (passes validation)
    console.log('--- Example 1: Valid Request ---');
    const result1 = await client.request<number>('add', { a: 5, b: 3 });
    console.log(`Result: ${result1}\n`);

    // Example 2: Request with validation error
    console.log('--- Example 2: Invalid Request (Validation Error) ---');
    try {
      await client.request('add', { a: 'not a number', b: 3 });
    } catch (error) {
      console.log(`Caught validation error: ${(error as Error).message}\n`);
    }

    // Example 3: Multiple requests to show metrics
    console.log('--- Example 3: Multiple Requests ---');
    await Promise.all([
      client.request('add', { a: 1, b: 2 }),
      client.request('add', { a: 3, b: 4 }),
      client.request('add', { a: 5, b: 6 }),
    ]);
    console.log('');

    // Example 4: Rate limiting
    console.log('--- Example 4: Rate Limiting ---');
    const promises = [];
    for (let i = 0; i < 15; i++) {
      promises.push(
        client.request('add', { a: i, b: i + 1 }).catch((err) => ({
          error: err.message,
        }))
      );
    }
    const rateLimitResults = await Promise.all(promises);
    const errors = rateLimitResults.filter((r) => 'error' in r);
    console.log(`Sent 15 requests, ${errors.length} were rate limited\n`);

    // Example 5: Handle server notification
    console.log('--- Example 5: Server Notifications ---');
    client.notify('subscribe', { topic: 'updates' });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log('');

    // Display metrics
    console.log('--- Final Metrics ---');
    const finalMetrics = getMetrics();
    console.log('Total requests:', finalMetrics.requestCount);
    console.log('Total responses:', finalMetrics.responseCount);
    console.log('Total errors:', finalMetrics.errorCount);
    console.log('Total notifications:', finalMetrics.notificationCount);
    console.log('Average request time:', `${finalMetrics.averageRequestTime.toFixed(2)}ms`);
    console.log('Pending requests:', finalMetrics.pendingRequests);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    console.log('\nDisconnecting...');
    await client.disconnect();
    console.log('Example completed');
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export {
  main,
  TCPTransport,
  createLoggingMiddleware,
  createMetricsMiddleware,
  createAuthMiddleware,
  createValidationMiddleware,
  createRetryMiddleware,
  createRateLimitMiddleware,
};
