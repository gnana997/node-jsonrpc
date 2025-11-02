/**
 * Client Testing Example
 *
 * Demonstrates testing patterns for JSON-RPC client including:
 * - Unit testing client methods
 * - Using mock transport for isolated testing
 * - Testing requests and responses
 * - Testing error handling
 * - Testing notifications
 * - Testing timeouts and cancellation
 *
 * This example uses Vitest as the test framework, but patterns
 * apply to any testing framework (Jest, Mocha, etc.)
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSONRPCClient } from '../../src/client.js';
import { JSONRPCError } from '../../src/error.js';
import type { Transport } from '../../src/transport.js';
import type { Middleware } from '../../src/types.js';

/**
 * Simple Mock Transport for testing
 */
class MockTransport extends EventEmitter implements Transport {
  private connected = false;
  public sentMessages: string[] = [];

  async connect(): Promise<void> {
    this.connected = true;
    setImmediate(() => this.emit('connect'));
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    setImmediate(() => this.emit('disconnect'));
  }

  send(message: string): void {
    if (!this.connected) {
      throw new Error('Not connected');
    }
    this.sentMessages.push(message);
  }

  isConnected(): boolean {
    return this.connected;
  }

  // Test helpers
  simulateMessage(message: string): void {
    setImmediate(() => this.emit('message', message));
  }

  simulateError(error: Error): void {
    setImmediate(() => this.emit('error', error));
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

  reset(): void {
    this.connected = false;
    this.sentMessages = [];
    this.removeAllListeners();
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

describe('JSONRPCClient Testing Examples', () => {
  let client: JSONRPCClient;
  let transport: MockTransport;

  beforeEach(async () => {
    transport = new MockTransport();
    client = new JSONRPCClient({ transport });
    await client.connect();
  });

  afterEach(async () => {
    if (client.isConnected()) {
      await client.disconnect();
    }
    transport.reset();
  });

  // ==========================================================================
  // Example 1: Testing Basic Requests
  // ==========================================================================

  describe('Example 1: Basic Request Testing', () => {
    it('should send request with correct format', async () => {
      const promise = client.request('add', { a: 1, b: 2 });

      await delay(10);

      // Verify request format
      const sent = transport.getLastSentMessageAsJSON();
      expect(sent).toMatchObject({
        jsonrpc: '2.0',
        method: 'add',
        params: { a: 1, b: 2 },
        id: expect.any(Number),
      });

      // Simulate response
      transport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          result: 3,
          id: sent.id,
        })
      );

      const result = await promise;
      expect(result).toBe(3);
    });

    it('should handle successful response', async () => {
      const promise = client.request<number>('multiply', { a: 5, b: 6 });

      await delay(10);
      const sent = transport.getLastSentMessageAsJSON();

      transport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          result: 30,
          id: sent.id,
        })
      );

      const result = await promise;
      expect(result).toBe(30);
    });
  });

  // ==========================================================================
  // Example 2: Testing Error Handling
  // ==========================================================================

  describe('Example 2: Error Handling', () => {
    it('should handle error response', async () => {
      const promise = client.request('unknownMethod');

      await delay(10);
      const sent = transport.getLastSentMessageAsJSON();

      transport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32601,
            message: 'Method not found',
          },
          id: sent.id,
        })
      );

      await expect(promise).rejects.toThrow(JSONRPCError);
      await expect(promise).rejects.toMatchObject({
        code: -32601,
        message: 'Method not found',
      });
    });

    it('should handle transport errors', async () => {
      const promise = waitForEvent(client, 'error');

      transport.simulateError(new Error('Connection lost'));

      const [error] = await promise;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Connection lost');
    });

    it('should handle invalid JSON', async () => {
      const promise = waitForEvent(client, 'error');

      transport.simulateMessage('invalid json {');

      const [error] = await promise;
      expect(error).toBeInstanceOf(Error);
    });
  });

  // ==========================================================================
  // Example 3: Testing Notifications
  // ==========================================================================

  describe('Example 3: Notifications', () => {
    it('should send notification without id', () => {
      client.notify('update', { status: 'ready' });

      const sent = transport.getLastSentMessageAsJSON();
      expect(sent).toMatchObject({
        jsonrpc: '2.0',
        method: 'update',
        params: { status: 'ready' },
      });
      expect(sent.id).toBeUndefined();
    });

    it('should receive server notifications', async () => {
      const promise = waitForEvent(client, 'notification');

      transport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'serverEvent',
          params: { event: 'data_updated' },
        })
      );

      const [method, params] = await promise;
      expect(method).toBe('serverEvent');
      expect(params).toEqual({ event: 'data_updated' });
    });
  });

  // ==========================================================================
  // Example 4: Testing Timeout
  // ==========================================================================

  describe('Example 4: Timeout Handling', () => {
    it('should timeout if no response received', async () => {
      const promise = client.request('slow', {}, { timeout: 50 });

      await expect(promise).rejects.toThrow(/timed out after 50ms/);
    });

    it('should use default timeout from config', async () => {
      const newTransport = new MockTransport();
      const newClient = new JSONRPCClient({
        transport: newTransport,
        requestTimeout: 50,
      });
      await newClient.connect();

      const promise = newClient.request('slow');

      await expect(promise).rejects.toThrow(/timed out after 50ms/);

      await newClient.disconnect();
    });
  });

  // ==========================================================================
  // Example 5: Testing Cancellation
  // ==========================================================================

  describe('Example 5: Request Cancellation', () => {
    it('should cancel request with AbortSignal', async () => {
      const controller = new AbortController();
      const promise = client.request('test', {}, { signal: controller.signal });

      await delay(10);
      controller.abort();

      await expect(promise).rejects.toThrow('Request aborted');
    });

    it('should reject immediately if already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const promise = client.request('test', {}, { signal: controller.signal });

      await expect(promise).rejects.toThrow('Request aborted');
    });
  });

  // ==========================================================================
  // Example 6: Testing Batch Requests
  // ==========================================================================

  describe('Example 6: Batch Requests', () => {
    it('should send batch request', async () => {
      const batch = client.batch();
      batch.add('add', { a: 1, b: 2 });
      batch.add('add', { a: 3, b: 4 });

      const promise = batch.execute();

      await delay(10);
      const sent = transport.getLastSentMessageAsJSON();

      expect(Array.isArray(sent)).toBe(true);
      expect(sent).toHaveLength(2);

      // Simulate batch response
      transport.simulateMessage(
        JSON.stringify([
          { jsonrpc: '2.0', result: 3, id: sent[0].id },
          { jsonrpc: '2.0', result: 7, id: sent[1].id },
        ])
      );

      const results = await promise;
      expect(results).toEqual([3, 7]);
    });

    it('should throw error for empty batch', async () => {
      const batch = client.batch();
      await expect(batch.execute()).rejects.toThrow('Cannot execute empty batch');
    });
  });

  // ==========================================================================
  // Example 7: Testing Middleware
  // ==========================================================================

  describe('Example 7: Middleware', () => {
    it('should call middleware on request', async () => {
      const middleware: Middleware = {
        onRequest: vi.fn((req) => req),
      };

      client.use(middleware);

      const promise = client.request('test', { foo: 'bar' });
      await delay(10);

      expect(middleware.onRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'test',
          params: { foo: 'bar' },
        })
      );

      // Cleanup
      const sent = transport.getLastSentMessageAsJSON();
      transport.simulateMessage(JSON.stringify({ jsonrpc: '2.0', result: null, id: sent.id }));
      await promise;
    });

    it('should allow middleware to modify request', async () => {
      const middleware: Middleware = {
        onRequest: (req) => ({
          ...req,
          params: { ...req.params, modified: true },
        }),
      };

      client.use(middleware);

      const promise = client.request('test', { foo: 'bar' });
      await delay(10);

      const sent = transport.getLastSentMessageAsJSON();
      expect(sent.params).toEqual({ foo: 'bar', modified: true });

      // Cleanup
      transport.simulateMessage(JSON.stringify({ jsonrpc: '2.0', result: null, id: sent.id }));
      await promise;
    });
  });

  // ==========================================================================
  // Example 8: Testing Connection Management
  // ==========================================================================

  describe('Example 8: Connection Management', () => {
    it('should emit connected event', async () => {
      const newTransport = new MockTransport();
      const newClient = new JSONRPCClient({ transport: newTransport });

      const promise = waitForEvent(newClient, 'connected');
      await newClient.connect();
      await promise;

      expect(newClient.isConnected()).toBe(true);
      await newClient.disconnect();
    });

    it('should emit disconnected event', async () => {
      const promise = waitForEvent(client, 'disconnected');
      await client.disconnect();
      await promise;

      expect(client.isConnected()).toBe(false);
    });

    it('should reject requests when not connected', async () => {
      await client.disconnect();
      await expect(client.request('test')).rejects.toThrow('Client not connected');
    });
  });
});

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('This is a test file. Run with: npm test examples/testing/test-client.ts');
}

export { MockTransport, waitForEvent, delay };
