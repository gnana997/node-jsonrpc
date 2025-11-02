/**
 * Server Middleware Example
 *
 * Demonstrates JSON-RPC server middleware capabilities including:
 * - Logging middleware (request/response/error logging)
 * - Metrics middleware (timing, counters)
 * - Authentication middleware (validating auth tokens)
 * - Validation middleware (parameter validation)
 * - Rate limiting middleware
 * - Custom middleware implementation
 * - Middleware chaining
 */

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { JSONRPCError } from '../../src/error.js';
import { JSONRPCServer } from '../../src/server.js';
import type { Transport, TransportServer } from '../../src/transport.js';
import type { JSONRPCRequest, JSONRPCResponse, Middleware } from '../../src/types.js';

/**
 * TCP Transport implementation
 */
class TCPTransport extends EventEmitter implements Transport {
  private buffer = '';
  private connected = true;

  constructor(private socket: net.Socket) {
    super();
    this.setupListeners();
  }

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }
    this.connected = false;
  }

  send(message: string): void {
    if (!this.connected || this.socket.destroyed) {
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
    return this.connected && !this.socket.destroyed;
  }

  private setupListeners(): void {
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
 * TCP Transport Server implementation
 */
class TCPTransportServer extends EventEmitter implements TransportServer {
  private server?: net.Server;

  constructor(private port: number) {
    super();
  }

  isListening(): boolean {
    return !!this.server && this.server.listening;
  }

  getPort(): number {
    return this.port;
  }

  getAddress(): { address: string; port: number | null } | null {
    if (!this.server) return null;
    const addr = this.server.address();
    if (!addr) return null;
    if (typeof addr === 'string') {
      return { address: addr, port: null };
    }
    return { address: addr.address, port: addr.port };
  }

  async listen(): Promise<void> {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => {
        const transport = new TCPTransport(socket);
        this.emit('connection', transport);
      });

      this.server.on('error', (error: Error) => {
        this.emit('error', error);
      });

      this.server.listen(this.port, () => {
        console.log(`✓ Server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

/**
 * Logging Middleware - Logs all requests and responses
 */
function createLoggingMiddleware(): Middleware {
  return {
    onRequest: (request: JSONRPCRequest) => {
      console.log(`[LOG] → Request: ${request.method}`, {
        id: request.id,
        params: request.params,
      });
      return request;
    },

    onResponse: (response: JSONRPCResponse) => {
      console.log('[LOG] ← Response (success):', {
        id: response.id,
        result: response.result,
      });
      return response;
    },

    onError: (error: JSONRPCError) => {
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
 * Metrics Middleware - Tracks request timing and counts
 */
function createMetricsMiddleware() {
  const metrics = {
    requestCount: 0,
    responseCount: 0,
    errorCount: 0,
    notificationCount: 0,
    totalRequestTime: 0,
    requestTimings: new Map<string | number, number>(),
    methodCounts: new Map<string, number>(),
  };

  const middleware: Middleware = {
    onRequest: (request: JSONRPCRequest) => {
      metrics.requestCount++;
      metrics.requestTimings.set(request.id, Date.now());

      // Track method-specific counts
      const count = metrics.methodCounts.get(request.method) || 0;
      metrics.methodCounts.set(request.method, count + 1);

      return request;
    },

    onResponse: (response: JSONRPCResponse) => {
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

    onError: (error: JSONRPCError) => {
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
      methodBreakdown: Object.fromEntries(metrics.methodCounts),
    }),
  };
}

/**
 * Authentication Middleware - Validates auth tokens
 */
function createAuthMiddleware(validTokens: Set<string>): Middleware {
  return {
    onRequest: (request: JSONRPCRequest) => {
      // Skip auth for certain methods
      const publicMethods = ['login', 'getStatus'];
      if (publicMethods.includes(request.method)) {
        return request;
      }

      // Check for auth token in params
      const params = request.params as { _auth?: string };
      const token = params?._auth;

      if (!token || !validTokens.has(token)) {
        throw new JSONRPCError(-32001, 'Authentication required', {
          message: 'Invalid or missing authentication token',
        });
      }

      console.log(`[AUTH] Request ${request.id} authenticated`);

      // Remove auth token from params before passing to handler
      if (params && '_auth' in params) {
        const { _auth, ...cleanParams } = params;
        request.params = cleanParams;
      }

      return request;
    },
  };
}

/**
 * Validation Middleware - Validates request parameters
 */
function createValidationMiddleware(): Middleware {
  const schemas: Record<string, (params: any) => void> = {
    add: (params) => {
      if (typeof params?.a !== 'number' || typeof params?.b !== 'number') {
        throw new JSONRPCError(-32602, 'Invalid params', {
          message: 'Parameters "a" and "b" must be numbers',
        });
      }
    },
    multiply: (params) => {
      if (typeof params?.a !== 'number' || typeof params?.b !== 'number') {
        throw new JSONRPCError(-32602, 'Invalid params', {
          message: 'Parameters "a" and "b" must be numbers',
        });
      }
    },
    greet: (params) => {
      if (typeof params?.name !== 'string' || params.name.trim() === '') {
        throw new JSONRPCError(-32602, 'Invalid params', {
          message: 'Parameter "name" must be a non-empty string',
        });
      }
    },
  };

  return {
    onRequest: (request: JSONRPCRequest) => {
      const validator = schemas[request.method];
      if (validator) {
        try {
          validator(request.params);
          console.log(`[VALIDATION] Request ${request.id} validated`);
        } catch (error) {
          if (error instanceof JSONRPCError) {
            throw error;
          }
          throw new JSONRPCError(-32602, 'Validation failed', {
            message: (error as Error).message,
          });
        }
      }
      return request;
    },
  };
}

/**
 * Rate Limiting Middleware - Limits request rate per method
 */
function createRateLimitMiddleware(requestsPerSecond: number): Middleware {
  const requestLog = new Map<string, number[]>();

  return {
    onRequest: (request: JSONRPCRequest) => {
      const now = Date.now();
      const oneSecondAgo = now - 1000;

      // Get or create request log for this method
      const methodLog = requestLog.get(request.method) || [];
      requestLog.set(request.method, methodLog);

      // Remove old timestamps
      const recentRequests = methodLog.filter((timestamp) => timestamp > oneSecondAgo);
      requestLog.set(request.method, recentRequests);

      // Check rate limit
      if (recentRequests.length >= requestsPerSecond) {
        throw new JSONRPCError(-32000, 'Rate limit exceeded', {
          message: `Method "${request.method}" rate limit: ${requestsPerSecond} requests per second`,
          retryAfter: Math.ceil(1000 - (now - recentRequests[0]!)),
        });
      }

      // Log this request
      recentRequests.push(now);

      return request;
    },
  };
}

/**
 * Error Recovery Middleware - Converts certain errors to user-friendly messages
 */
function createErrorRecoveryMiddleware(): Middleware {
  return {
    onError: (error: JSONRPCError) => {
      // Convert generic errors to specific JSON-RPC errors
      if (error.message.includes('not found')) {
        return new JSONRPCError(-32601, 'Method not found', {
          originalMessage: error.message,
        });
      }

      if (error.message.includes('timeout')) {
        return new JSONRPCError(-32000, 'Request timeout', {
          originalMessage: error.message,
        });
      }

      return error;
    },
  };
}

/**
 * Main example function
 */
async function main(): Promise<void> {
  const transportServer = new TCPTransportServer(3000);

  // Create metrics middleware
  const { middleware: metricsMiddleware, getMetrics } = createMetricsMiddleware();

  // Create server
  const server = new JSONRPCServer({
    transportServer,
    debug: false, // Disable debug logging to see clean middleware output
  });

  // Register middleware in order
  console.log('Registering middleware...');
  server.use(createLoggingMiddleware());
  server.use(metricsMiddleware);
  server.use(createAuthMiddleware(new Set(['secret-token-12345', 'test-token'])));
  server.use(createValidationMiddleware());
  server.use(createRateLimitMiddleware(10)); // 10 requests per second per method
  server.use(createErrorRecoveryMiddleware());

  // Register methods
  server.registerMethod('add', async (params: { a: number; b: number }) => {
    return params.a + params.b;
  });

  server.registerMethod('multiply', async (params: { a: number; b: number }) => {
    return params.a * params.b;
  });

  server.registerMethod('greet', async (params: { name: string }) => {
    return { message: `Hello, ${params.name}!` };
  });

  // Public method (no auth required)
  server.registerMethod('getStatus', async () => {
    return {
      uptime: process.uptime(),
      connections: server.getConnectionCount(),
      metrics: getMetrics(),
    };
  });

  // Public method for getting a token (simulated)
  server.registerMethod('login', async (params: { username: string; password: string }) => {
    // Simplified login (in reality, validate credentials)
    if (params.username && params.password) {
      return { token: 'secret-token-12345' };
    }
    throw new JSONRPCError(-32000, 'Invalid credentials');
  });

  server.on('error', (error: Error) => {
    console.error('✗ Server error:', error.message);
  });

  console.log('\nRegistered methods:');
  for (const method of server.getMethods()) {
    console.log(`  - ${method}`);
  }

  console.log('\nStarting server...');
  await server.listen();

  // Periodic metrics logging
  const metricsInterval = setInterval(() => {
    const metrics = getMetrics();
    console.log('\n--- Server Metrics ---');
    console.log(`Total requests: ${metrics.requestCount}`);
    console.log(`Total responses: ${metrics.responseCount}`);
    console.log(`Total errors: ${metrics.errorCount}`);
    console.log(`Total notifications: ${metrics.notificationCount}`);
    console.log(`Average response time: ${metrics.averageRequestTime.toFixed(2)}ms`);
    console.log(`Pending requests: ${metrics.pendingRequests}`);
    console.log('Method breakdown:', metrics.methodBreakdown);
    console.log('----------------------\n');
  }, 30000); // Every 30 seconds

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n\nShutting down server...');
    clearInterval(metricsInterval);
    await server.close({ closeConnections: true });
    console.log('✓ Server closed');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('\nServer is ready to accept connections');
  console.log('Metrics logged every 30 seconds');
  console.log('Press Ctrl+C to stop\n');
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export {
  main,
  TCPTransportServer,
  TCPTransport,
  createLoggingMiddleware,
  createMetricsMiddleware,
  createAuthMiddleware,
  createValidationMiddleware,
  createRateLimitMiddleware,
  createErrorRecoveryMiddleware,
};
