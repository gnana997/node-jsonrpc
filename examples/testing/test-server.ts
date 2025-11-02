/**
 * Server Testing Example
 *
 * Demonstrates testing patterns for JSON-RPC server including:
 * - Unit testing server methods
 * - Using mock transport for isolated testing
 * - Testing method registration
 * - Testing request handling
 * - Testing error responses
 * - Testing notifications and broadcasting
 * - Testing middleware
 *
 * This example uses Vitest as the test framework, but patterns
 * apply to any testing framework (Jest, Mocha, etc.)
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSONRPCError } from '../../src/error.js';
import { JSONRPCServer } from '../../src/server.js';
import type { Transport, TransportServer } from '../../src/transport.js';
import type { Handler, Middleware, RequestContext } from '../../src/types.js';

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
  }

  isConnected(): boolean {
    return this.connected;
  }

  // Test helpers
  simulateMessage(message: string): void {
    setImmediate(() => this.emit('message', message));
  }

  getLastSentMessage(): string | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  getLastSentMessageAsJSON(): any {
    const lastMessage = this.getLastSentMessage();
    return lastMessage ? JSON.parse(lastMessage) : undefined;
  }

  clearSentMessages(): void {
    this.sentMessages = [];
  }
}

/**
 * Mock Transport Server for testing
 */
class MockTransportServer extends EventEmitter implements TransportServer {
  private listening = false;

  async listen(): Promise<void> {
    this.listening = true;
  }

  async close(): Promise<void> {
    this.listening = false;
    this.emit('close');
  }

  isListening(): boolean {
    return this.listening;
  }

  // Test helper: simulate a new connection
  simulateConnection(transport: Transport): void {
    setImmediate(() => this.emit('connection', transport));
  }
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
// Tests
// ============================================================================

describe('JSONRPCServer Testing Examples', () => {
  let server: JSONRPCServer;
  let transportServer: MockTransportServer;
  let clientTransport: MockTransport;

  beforeEach(async () => {
    transportServer = new MockTransportServer();
    server = new JSONRPCServer({ transportServer });
    await server.listen();

    clientTransport = new MockTransport();
    await clientTransport.connect();
    transportServer.simulateConnection(clientTransport);
  });

  afterEach(async () => {
    await server.close({ closeConnections: true });
  });

  // ==========================================================================
  // Example 1: Testing Method Registration
  // ==========================================================================

  describe('Example 1: Method Registration', () => {
    it('should register a method', () => {
      const handler: Handler = async (params: { a: number; b: number }) => {
        return params.a + params.b;
      };

      server.registerMethod('add', handler);

      expect(server.hasMethod('add')).toBe(true);
      expect(server.getMethods()).toContain('add');
    });

    it('should unregister a method', () => {
      const handler: Handler = async () => 'test';
      server.registerMethod('test', handler);

      expect(server.hasMethod('test')).toBe(true);

      const removed = server.unregisterMethod('test');
      expect(removed).toBe(true);
      expect(server.hasMethod('test')).toBe(false);
    });

    it('should return false when unregistering non-existent method', () => {
      const removed = server.unregisterMethod('nonExistent');
      expect(removed).toBe(false);
    });
  });

  // ==========================================================================
  // Example 2: Testing Request Handling
  // ==========================================================================

  describe('Example 2: Request Handling', () => {
    it('should handle valid request', async () => {
      server.registerMethod('add', async (params: { a: number; b: number }) => {
        return params.a + params.b;
      });

      clientTransport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'add',
          params: { a: 5, b: 3 },
          id: 1,
        })
      );

      await delay(10);

      const response = clientTransport.getLastSentMessageAsJSON();
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        result: 8,
        id: 1,
      });
    });

    it('should handle request without params', async () => {
      server.registerMethod('getStatus', async () => {
        return { status: 'ok' };
      });

      clientTransport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'getStatus',
          id: 2,
        })
      );

      await delay(10);

      const response = clientTransport.getLastSentMessageAsJSON();
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        result: { status: 'ok' },
        id: 2,
      });
    });

    it('should return error for unknown method', async () => {
      clientTransport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'unknownMethod',
          id: 3,
        })
      );

      await delay(10);

      const response = clientTransport.getLastSentMessageAsJSON();
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: expect.stringContaining('Method not found'),
        },
        id: 3,
      });
    });
  });

  // ==========================================================================
  // Example 3: Testing Error Handling
  // ==========================================================================

  describe('Example 3: Error Handling', () => {
    it('should handle method that throws error', async () => {
      server.registerMethod('errorMethod', async () => {
        throw new Error('Something went wrong');
      });

      clientTransport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'errorMethod',
          id: 4,
        })
      );

      await delay(10);

      const response = clientTransport.getLastSentMessageAsJSON();
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: expect.stringContaining('Something went wrong'),
        },
        id: 4,
      });
    });

    it('should handle JSONRPCError with custom code', async () => {
      server.registerMethod('customError', async () => {
        throw new JSONRPCError(-32000, 'Custom error', { detail: 'Extra info' });
      });

      clientTransport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'customError',
          id: 5,
        })
      );

      await delay(10);

      const response = clientTransport.getLastSentMessageAsJSON();
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Custom error',
          data: { detail: 'Extra info' },
        },
        id: 5,
      });
    });

    it('should handle invalid JSON', async () => {
      const promise = waitForEvent(server, 'error');

      clientTransport.simulateMessage('invalid json {');

      const [error] = await promise;
      expect(error).toBeInstanceOf(Error);
    });
  });

  // ==========================================================================
  // Example 4: Testing Notifications
  // ==========================================================================

  describe('Example 4: Notifications', () => {
    it('should receive client notifications', async () => {
      const promise = waitForEvent(server, 'notification');

      clientTransport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'clientUpdate',
          params: { status: 'active' },
        })
      );

      const [method, params, transport] = await promise;
      expect(method).toBe('clientUpdate');
      expect(params).toEqual({ status: 'active' });
      expect(transport).toBe(clientTransport);
    });

    it('should send notification to client', () => {
      server.notify(clientTransport, 'serverEvent', { type: 'update' });

      const sent = clientTransport.getLastSentMessageAsJSON();
      expect(sent).toMatchObject({
        jsonrpc: '2.0',
        method: 'serverEvent',
        params: { type: 'update' },
      });
      expect(sent.id).toBeUndefined();
    });

    it('should broadcast to all clients', async () => {
      const transport2 = new MockTransport();
      await transport2.connect();
      transportServer.simulateConnection(transport2);

      await delay(10);

      const count = server.broadcast('announcement', { message: 'Hello' });

      expect(count).toBe(2);
      expect(clientTransport.getLastSentMessageAsJSON()).toMatchObject({
        jsonrpc: '2.0',
        method: 'announcement',
        params: { message: 'Hello' },
      });
      expect(transport2.getLastSentMessageAsJSON()).toMatchObject({
        jsonrpc: '2.0',
        method: 'announcement',
        params: { message: 'Hello' },
      });
    });
  });

  // ==========================================================================
  // Example 5: Testing Request Context
  // ==========================================================================

  describe('Example 5: Request Context', () => {
    it('should provide transport in context', async () => {
      let receivedTransport: Transport | undefined;

      server.registerMethod('testContext', async (_params, context?: RequestContext) => {
        receivedTransport = context?.transport;
        return { success: true };
      });

      clientTransport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'testContext',
          id: 6,
        })
      );

      await delay(10);

      expect(receivedTransport).toBe(clientTransport);
    });

    it('should allow sending notifications from handler', async () => {
      server.registerMethod('notifyFromHandler', async (_params, context?: RequestContext) => {
        if (context?.transport) {
          server.notify(context.transport, 'handlerNotification', { data: 'test' });
        }
        return { success: true };
      });

      clientTransport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifyFromHandler',
          id: 7,
        })
      );

      await delay(10);

      // Should have both response and notification
      expect(clientTransport.sentMessages).toHaveLength(2);

      // Find the notification (it doesn't have an id)
      const messages = clientTransport.sentMessages.map((msg) => JSON.parse(msg));
      const notification = messages.find((msg) => msg.id === undefined);

      expect(notification).toMatchObject({
        jsonrpc: '2.0',
        method: 'handlerNotification',
        params: { data: 'test' },
      });
    });
  });

  // ==========================================================================
  // Example 6: Testing Middleware
  // ==========================================================================

  describe('Example 6: Middleware', () => {
    it('should call middleware on request', async () => {
      const middleware: Middleware = {
        onRequest: vi.fn((req) => req),
      };

      server.use(middleware);

      server.registerMethod('test', async () => 'ok');

      clientTransport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'test',
          id: 8,
        })
      );

      await delay(10);

      expect(middleware.onRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'test',
        })
      );
    });

    it('should allow middleware to modify request', async () => {
      const middleware: Middleware = {
        onRequest: (req) => ({
          ...req,
          params: { modified: true, ...req.params },
        }),
      };

      server.use(middleware);

      let receivedParams: any;
      server.registerMethod('test', async (params) => {
        receivedParams = params;
        return 'ok';
      });

      clientTransport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'test',
          params: { original: true },
          id: 9,
        })
      );

      await delay(10);

      expect(receivedParams).toEqual({ modified: true, original: true });
    });

    it('should call middleware on error', async () => {
      const middleware: Middleware = {
        onError: vi.fn((err) => err),
      };

      server.use(middleware);

      server.registerMethod('errorTest', async () => {
        throw new Error('Test error');
      });

      clientTransport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'errorTest',
          id: 10,
        })
      );

      await delay(10);

      expect(middleware.onError).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Example 7: Testing Connection Management
  // ==========================================================================

  describe('Example 7: Connection Management', () => {
    it('should track connection count', async () => {
      expect(server.getConnectionCount()).toBe(1);

      const transport2 = new MockTransport();
      await transport2.connect();
      transportServer.simulateConnection(transport2);

      await delay(10);

      expect(server.getConnectionCount()).toBe(2);
    });

    it('should call onConnection callback', async () => {
      const onConnection = vi.fn();

      const newServer = new JSONRPCServer({
        transportServer: new MockTransportServer(),
        onConnection,
      });

      await newServer.listen();

      const transport = new MockTransport();
      await transport.connect();
      (newServer as any).transportServer.simulateConnection(transport);

      await delay(10);

      expect(onConnection).toHaveBeenCalledWith(transport);

      await newServer.close({ closeConnections: true });
    });

    it('should call onDisconnection callback', async () => {
      const onDisconnection = vi.fn();

      const newServer = new JSONRPCServer({
        transportServer: new MockTransportServer(),
        onDisconnection,
      });

      await newServer.listen();

      const transport = new MockTransport();
      await transport.connect();
      (newServer as any).transportServer.simulateConnection(transport);

      await delay(10);

      transport.emit('close');

      await delay(10);

      expect(onDisconnection).toHaveBeenCalledWith(transport);

      await newServer.close();
    });
  });

  // ==========================================================================
  // Example 8: Testing Batch Requests
  // ==========================================================================

  describe('Example 8: Batch Requests', () => {
    it('should handle batch request', async () => {
      server.registerMethod('add', async (params: { a: number; b: number }) => {
        return params.a + params.b;
      });

      clientTransport.simulateMessage(
        JSON.stringify([
          { jsonrpc: '2.0', method: 'add', params: { a: 1, b: 2 }, id: 11 },
          { jsonrpc: '2.0', method: 'add', params: { a: 3, b: 4 }, id: 12 },
        ])
      );

      await delay(10);

      const response = clientTransport.getLastSentMessageAsJSON();
      expect(Array.isArray(response)).toBe(true);
      expect(response).toHaveLength(2);
      expect(response[0]).toMatchObject({ jsonrpc: '2.0', result: 3, id: 11 });
      expect(response[1]).toMatchObject({ jsonrpc: '2.0', result: 7, id: 12 });
    });
  });
});

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('This is a test file. Run with: npm test examples/testing/test-server.ts');
}

export { MockTransport, MockTransportServer, waitForEvent, delay };
