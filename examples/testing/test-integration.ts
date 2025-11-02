/**
 * Integration Testing Example
 *
 * Demonstrates integration testing patterns for JSON-RPC including:
 * - End-to-end client-server testing
 * - Testing full request-response cycles
 * - Testing server-to-client notifications
 * - Testing multi-client scenarios
 * - Testing middleware integration
 * - Testing error propagation
 *
 * This example uses Vitest as the test framework, but patterns
 * apply to any testing framework (Jest, Mocha, etc.)
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JSONRPCClient } from '../../src/client.js';
import { JSONRPCError } from '../../src/error.js';
import { JSONRPCServer } from '../../src/server.js';
import type { Transport, TransportServer } from '../../src/transport.js';
import type { RequestContext } from '../../src/types.js';

/**
 * Mock Transport for testing
 */
class MockTransport extends EventEmitter implements Transport {
  private connected = false;
  public sentMessages: string[] = [];

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  send(message: string): void {
    this.sentMessages.push(message);
    // Emit message event for bidirectional testing
    setImmediate(() => this.emit('message', message));
  }

  isConnected(): boolean {
    return this.connected;
  }

  simulateMessage(message: string): void {
    setImmediate(() => this.emit('message', message));
  }
}

/**
 * Mock Transport Server for testing
 */
class MockTransportServer extends EventEmitter implements TransportServer {
  async listen(): Promise<void> {}
  async close(): Promise<void> {}

  isListening(): boolean {
    return true;
  }

  simulateConnection(transport: Transport): void {
    setImmediate(() => this.emit('connection', transport));
  }
}

/**
 * Connected Client-Server Pair
 */
interface ConnectedPair {
  client: JSONRPCClient;
  server: JSONRPCServer;
  clientTransport: MockTransport;
  serverTransport: MockTransport;
  cleanup: () => Promise<void>;
}

/**
 * Create a connected client-server pair for testing
 */
async function createConnectedPair(): Promise<ConnectedPair> {
  const clientTransport = new MockTransport();
  const serverTransport = new MockTransport();

  // Connect transports bidirectionally
  clientTransport.on('message', (msg: string) => {
    serverTransport.simulateMessage(msg);
  });

  serverTransport.on('message', (msg: string) => {
    clientTransport.simulateMessage(msg);
  });

  // Create client
  const client = new JSONRPCClient({
    transport: clientTransport,
  });

  // Create server
  const transportServer = new MockTransportServer();
  const server = new JSONRPCServer({
    transportServer,
  });

  await server.listen();
  transportServer.simulateConnection(serverTransport);
  await serverTransport.connect();
  await client.connect();

  const cleanup = async () => {
    await client.disconnect();
    await server.close({ closeConnections: true });
  };

  return { client, server, clientTransport, serverTransport, cleanup };
}

/**
 * Helper to wait for an event
 */
function waitForEvent<T extends any[]>(
  emitter: EventEmitter,
  event: string,
  timeout = 1000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new Error(`Event '${event}' not emitted within ${timeout}ms`));
    }, timeout);

    emitter.once(event, (...args: any[]) => {
      clearTimeout(timeoutHandle);
      resolve(args as T);
    });
  });
}

/**
 * Helper to delay
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration Testing Examples', () => {
  let pair: ConnectedPair;

  beforeEach(async () => {
    pair = await createConnectedPair();
  });

  afterEach(async () => {
    await pair.cleanup();
  });

  // ==========================================================================
  // Example 1: End-to-End Request-Response
  // ==========================================================================

  describe('Example 1: End-to-End Request-Response', () => {
    it('should handle complete request-response cycle', async () => {
      pair.server.registerMethod('add', async (params: { a: number; b: number }) => {
        return params.a + params.b;
      });

      const result = await pair.client.request<number>('add', { a: 5, b: 3 });

      expect(result).toBe(8);
    });

    it('should handle multiple requests', async () => {
      pair.server.registerMethod('add', async (params: { a: number; b: number }) => {
        return params.a + params.b;
      });

      pair.server.registerMethod('multiply', async (params: { a: number; b: number }) => {
        return params.a * params.b;
      });

      const [result1, result2, result3] = await Promise.all([
        pair.client.request<number>('add', { a: 1, b: 2 }),
        pair.client.request<number>('add', { a: 3, b: 4 }),
        pair.client.request<number>('multiply', { a: 2, b: 3 }),
      ]);

      expect(result1).toBe(3);
      expect(result2).toBe(7);
      expect(result3).toBe(6);
    });

    it('should handle requests with complex data types', async () => {
      interface User {
        id: number;
        name: string;
        tags: string[];
      }

      pair.server.registerMethod('createUser', async (params: Omit<User, 'id'>) => {
        return {
          id: 123,
          ...params,
        };
      });

      const result = await pair.client.request<User>('createUser', {
        name: 'Alice',
        tags: ['admin', 'developer'],
      });

      expect(result).toEqual({
        id: 123,
        name: 'Alice',
        tags: ['admin', 'developer'],
      });
    });
  });

  // ==========================================================================
  // Example 2: Error Propagation
  // ==========================================================================

  describe('Example 2: Error Propagation', () => {
    it('should propagate errors from server to client', async () => {
      pair.server.registerMethod('divide', async (params: { a: number; b: number }) => {
        if (params.b === 0) {
          throw new JSONRPCError(-32000, 'Division by zero');
        }
        return params.a / params.b;
      });

      await expect(pair.client.request('divide', { a: 10, b: 0 })).rejects.toThrow(JSONRPCError);

      await expect(pair.client.request('divide', { a: 10, b: 0 })).rejects.toMatchObject({
        code: -32000,
        message: 'Division by zero',
      });
    });

    it('should handle method not found', async () => {
      await expect(pair.client.request('nonExistent')).rejects.toThrow(JSONRPCError);

      await expect(pair.client.request('nonExistent')).rejects.toMatchObject({
        code: -32601,
      });
    });
  });

  // ==========================================================================
  // Example 3: Server-to-Client Notifications
  // ==========================================================================

  describe('Example 3: Server-to-Client Notifications', () => {
    it('should send notification from server to client', async () => {
      pair.server.registerMethod('subscribe', async (_params, context?: RequestContext) => {
        if (context?.transport) {
          pair.server.notify(context.transport, 'welcome', { message: 'Subscribed!' });
        }
        return { success: true };
      });

      const notificationPromise = waitForEvent(pair.client, 'notification');

      await pair.client.request('subscribe');

      const [method, params] = await notificationPromise;
      expect(method).toBe('welcome');
      expect(params).toEqual({ message: 'Subscribed!' });
    });

    it('should broadcast to all clients', async () => {
      // Create second client
      const pair2 = await createConnectedPair();

      pair.server.registerMethod('triggerBroadcast', async () => {
        const count = pair.server.broadcast('announcement', { message: 'Hello all!' });
        return { sent: count };
      });

      const notification1 = waitForEvent(pair.client, 'notification');
      const notification2 = waitForEvent(pair2.client, 'notification');

      await pair.client.request('triggerBroadcast');

      const [method1, params1] = await notification1;
      const [method2, params2] = await notification2;

      expect(method1).toBe('announcement');
      expect(params1).toEqual({ message: 'Hello all!' });
      expect(method2).toBe('announcement');
      expect(params2).toEqual({ message: 'Hello all!' });

      await pair2.cleanup();
    });

    it('should send progress notifications during long operation', async () => {
      pair.server.registerMethod('longOperation', async (_params, context?: RequestContext) => {
        for (let i = 1; i <= 5; i++) {
          await delay(10);
          if (context?.transport) {
            pair.server.notify(context.transport, 'progress', {
              current: i,
              total: 5,
            });
          }
        }
        return { completed: true };
      });

      const notifications: any[] = [];
      pair.client.on('notification', (method, params) => {
        if (method === 'progress') {
          notifications.push(params);
        }
      });

      const result = await pair.client.request('longOperation');

      expect(result).toEqual({ completed: true });
      expect(notifications).toHaveLength(5);
      expect(notifications[0]).toEqual({ current: 1, total: 5 });
      expect(notifications[4]).toEqual({ current: 5, total: 5 });
    });
  });

  // ==========================================================================
  // Example 4: Batch Requests
  // ==========================================================================

  describe('Example 4: Batch Requests', () => {
    it('should handle batch requests', async () => {
      pair.server.registerMethod('add', async (params: { a: number; b: number }) => {
        return params.a + params.b;
      });

      const batch = pair.client.batch();
      batch.add('add', { a: 1, b: 2 });
      batch.add('add', { a: 3, b: 4 });
      batch.add('add', { a: 5, b: 6 });

      const results = await batch.execute();

      expect(results).toEqual([3, 7, 11]);
    });

    it('should handle mixed success and error in batch', async () => {
      pair.server.registerMethod('divide', async (params: { a: number; b: number }) => {
        if (params.b === 0) {
          throw new JSONRPCError(-32000, 'Division by zero');
        }
        return params.a / params.b;
      });

      const batch = pair.client.batch();
      batch.add('divide', { a: 10, b: 2 });
      batch.add('divide', { a: 10, b: 0 });
      batch.add('divide', { a: 20, b: 4 });

      // Batch should throw because one request failed
      await expect(batch.execute()).rejects.toThrow();
    });
  });

  // ==========================================================================
  // Example 5: Middleware Integration
  // ==========================================================================

  describe('Example 5: Middleware Integration', () => {
    it('should apply client and server middleware', async () => {
      // Client middleware adds auth token
      pair.client.use({
        onRequest: (req) => ({
          ...req,
          params: { ...req.params, _token: 'secret' },
        }),
      });

      // Server middleware validates auth token
      pair.server.use({
        onRequest: (req) => {
          const params = req.params as { _token?: string };
          if (!params?._token || params._token !== 'secret') {
            throw new JSONRPCError(-32001, 'Unauthorized');
          }
          return req;
        },
      });

      pair.server.registerMethod('secure', async () => {
        return { data: 'secret data' };
      });

      const result = await pair.client.request('secure');
      expect(result).toEqual({ data: 'secret data' });
    });

    it('should reject request with invalid auth', async () => {
      // Server middleware validates auth token
      pair.server.use({
        onRequest: (req) => {
          const params = req.params as { _token?: string };
          if (!params?._token || params._token !== 'secret') {
            throw new JSONRPCError(-32001, 'Unauthorized');
          }
          return req;
        },
      });

      pair.server.registerMethod('secure', async () => {
        return { data: 'secret data' };
      });

      // Request without token should fail
      await expect(pair.client.request('secure')).rejects.toThrow(JSONRPCError);
    });
  });

  // ==========================================================================
  // Example 6: Connection Lifecycle
  // ==========================================================================

  describe('Example 6: Connection Lifecycle', () => {
    it('should handle disconnect and reconnect', async () => {
      pair.server.registerMethod('test', async () => 'ok');

      // Initial request
      const result1 = await pair.client.request('test');
      expect(result1).toBe('ok');

      // Disconnect
      await pair.client.disconnect();
      expect(pair.client.isConnected()).toBe(false);

      // Reconnect
      await pair.client.connect();
      expect(pair.client.isConnected()).toBe(true);

      // Request after reconnect
      const result2 = await pair.client.request('test');
      expect(result2).toBe('ok');
    });

    it('should reject requests when disconnected', async () => {
      await pair.client.disconnect();

      await expect(pair.client.request('test')).rejects.toThrow('Client not connected');
    });
  });

  // ==========================================================================
  // Example 7: Complex Workflows
  // ==========================================================================

  describe('Example 7: Complex Workflows', () => {
    it('should handle stateful operations', async () => {
      const sessions = new Map<string, any>();

      pair.server.registerMethod('createSession', async () => {
        const sessionId = Math.random().toString(36);
        sessions.set(sessionId, { data: [] });
        return { sessionId };
      });

      pair.server.registerMethod(
        'addToSession',
        async (params: { sessionId: string; value: any }) => {
          const session = sessions.get(params.sessionId);
          if (!session) {
            throw new JSONRPCError(-32000, 'Session not found');
          }
          session.data.push(params.value);
          return { count: session.data.length };
        }
      );

      pair.server.registerMethod('getSession', async (params: { sessionId: string }) => {
        const session = sessions.get(params.sessionId);
        if (!session) {
          throw new JSONRPCError(-32000, 'Session not found');
        }
        return session;
      });

      // Create session
      const { sessionId } = await pair.client.request<{ sessionId: string }>('createSession');

      // Add items
      await pair.client.request('addToSession', { sessionId, value: 'item1' });
      await pair.client.request('addToSession', { sessionId, value: 'item2' });
      await pair.client.request('addToSession', { sessionId, value: 'item3' });

      // Get session
      const session = await pair.client.request<{ data: string[] }>('getSession', {
        sessionId,
      });

      expect(session.data).toEqual(['item1', 'item2', 'item3']);
    });
  });
});

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('This is a test file. Run with: npm test examples/testing/test-integration.ts');
}

export { createConnectedPair, waitForEvent, delay };
