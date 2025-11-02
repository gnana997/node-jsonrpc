import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSONRPCClient } from '../src/client.js';
import { JSONRPCError } from '../src/error.js';
import type { Middleware } from '../src/types.js';
import { delay, waitForEvent } from './helpers.js';
import { MockTransport } from './mocks/mockTransport.js';

describe('JSONRPCClient', () => {
  let client: JSONRPCClient;
  let transport: MockTransport;

  beforeEach(async () => {
    transport = new MockTransport();
    client = new JSONRPCClient({ transport });
    await client.connect();
  });

  describe('Connection Management', () => {
    it('should connect to transport', async () => {
      const newTransport = new MockTransport();
      const newClient = new JSONRPCClient({ transport: newTransport });

      expect(newClient.isConnected()).toBe(false);

      await newClient.connect();

      expect(newClient.isConnected()).toBe(true);
    });

    it('should disconnect from transport', async () => {
      expect(client.isConnected()).toBe(true);

      await client.disconnect();

      expect(client.isConnected()).toBe(false);
    });

    it('should emit connected event', async () => {
      const newTransport = new MockTransport();
      const newClient = new JSONRPCClient({ transport: newTransport });

      const promise = waitForEvent(newClient, 'connected');

      await newClient.connect();
      await promise;
    });

    it('should emit disconnected event', async () => {
      const promise = waitForEvent(client, 'disconnected');

      await client.disconnect();
      await promise;
    });
  });

  describe('Requests', () => {
    it('should send request with correct format', async () => {
      // Send request (don't await yet)
      const promise = client.request('test', { foo: 'bar' });

      // Check sent message
      await delay(10);
      const sent = transport.getLastSentMessageAsJSON();
      expect(sent).toMatchObject({
        jsonrpc: '2.0',
        method: 'test',
        params: { foo: 'bar' },
        id: expect.any(Number),
      });

      // Simulate response
      transport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          result: 'ok',
          id: sent.id,
        })
      );

      const result = await promise;
      expect(result).toBe('ok');
    });

    it('should handle successful response', async () => {
      const promise = client.request('add', { a: 1, b: 2 });

      await delay(10);
      const sent = transport.getLastSentMessageAsJSON();

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

    it('should handle error response', async () => {
      const promise = client.request('unknown');

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

    it('should generate monotonically increasing IDs', async () => {
      const promise1 = client.request('test1');
      await delay(10);
      const id1 = transport.getLastSentMessageAsJSON().id;

      const promise2 = client.request('test2');
      await delay(10);
      const id2 = transport.getLastSentMessageAsJSON().id;

      expect(id2).toBeGreaterThan(id1);

      // Cleanup
      transport.simulateMessage(JSON.stringify({ jsonrpc: '2.0', result: null, id: id1 }));
      transport.simulateMessage(JSON.stringify({ jsonrpc: '2.0', result: null, id: id2 }));
      await promise1;
      await promise2;
    });

    it('should throw if not connected', async () => {
      await client.disconnect();

      await expect(client.request('test')).rejects.toThrow('Client not connected');
    });
  });

  describe('Notifications', () => {
    it('should send notification with correct format', () => {
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
          method: 'serverUpdate',
          params: { data: 'test' },
        })
      );

      const [method, params] = await promise;
      expect(method).toBe('serverUpdate');
      expect(params).toEqual({ data: 'test' });
    });

    it('should throw if not connected', () => {
      client.disconnect();

      expect(() => client.notify('test')).toThrow('Client not connected');
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout request after specified time', async () => {
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
    });
  });

  describe('AbortSignal Support', () => {
    it('should cancel request when signal is aborted', async () => {
      const controller = new AbortController();
      const promise = client.request('test', {}, { signal: controller.signal });

      await delay(10);
      controller.abort();

      await expect(promise).rejects.toThrow('Request aborted');
    });

    it('should reject immediately if signal already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const promise = client.request('test', {}, { signal: controller.signal });

      await expect(promise).rejects.toThrow('Request aborted');
    });
  });

  describe('Middleware', () => {
    it('should call request middleware', async () => {
      const middleware: Middleware = {
        onRequest: vi.fn((req) => req),
      };

      client.use(middleware);

      const promise = client.request('test');
      await delay(10);

      expect(middleware.onRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'test',
        })
      );

      // Cleanup
      const sent = transport.getLastSentMessageAsJSON();
      transport.simulateMessage(JSON.stringify({ jsonrpc: '2.0', result: null, id: sent.id }));
      await promise;
    });

    it('should call response middleware', async () => {
      const middleware: Middleware = {
        onResponse: vi.fn((res) => res),
      };

      client.use(middleware);

      const promise = client.request('test');
      await delay(10);

      const sent = transport.getLastSentMessageAsJSON();
      transport.simulateMessage(JSON.stringify({ jsonrpc: '2.0', result: 'ok', id: sent.id }));

      await promise;

      expect(middleware.onResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'ok',
        })
      );
    });

    it('should call error middleware', async () => {
      const middleware: Middleware = {
        onError: vi.fn((err) => err),
      };

      client.use(middleware);

      const promise = client.request('test');
      await delay(10);

      const sent = transport.getLastSentMessageAsJSON();
      transport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32600, message: 'Invalid request' },
          id: sent.id,
        })
      );

      await expect(promise).rejects.toThrow();

      expect(middleware.onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: -32600,
          message: 'Invalid request',
        })
      );
    });

    it('should call notification middleware', async () => {
      const middleware: Middleware = {
        onNotification: vi.fn(),
      };

      client.use(middleware);

      transport.simulateMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'update',
          params: { status: 'ready' },
        })
      );

      await delay(10);

      expect(middleware.onNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'update',
          params: { status: 'ready' },
        })
      );
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

  describe('Error Handling', () => {
    it('should emit error on invalid JSON', async () => {
      const promise = waitForEvent(client, 'error');

      transport.simulateMessage('invalid json');

      const [error] = await promise;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('Invalid JSON');
    });

    it('should emit error on transport error', async () => {
      const promise = waitForEvent(client, 'error');

      transport.simulateError(new Error('Transport error'));

      const [error] = await promise;
      expect(error.message).toBe('Transport error');
    });
  });

  describe('Disconnect Cleanup', () => {
    it('should cleanup pending requests on disconnect', async () => {
      const promise = client.request('test');

      await delay(10);
      expect(client.getPendingRequestCount()).toBe(1);

      await client.disconnect();

      await expect(promise).rejects.toThrow('Client disconnected');
      expect(client.getPendingRequestCount()).toBe(0);
    });

    it('should cleanup multiple pending requests', async () => {
      const promise1 = client.request('test1');
      const promise2 = client.request('test2');
      const promise3 = client.request('test3');

      await delay(10);
      expect(client.getPendingRequestCount()).toBe(3);

      await client.disconnect();

      await expect(promise1).rejects.toThrow('Client disconnected');
      await expect(promise2).rejects.toThrow('Client disconnected');
      await expect(promise3).rejects.toThrow('Client disconnected');
      expect(client.getPendingRequestCount()).toBe(0);
    });
  });

  describe('Batch Requests', () => {
    it('should return BatchRequest instance', () => {
      const batch = client.batch();

      expect(batch).toBeDefined();
      expect(typeof batch.add).toBe('function');
      expect(typeof batch.execute).toBe('function');
    });

    it('should execute batch request', async () => {
      const batch = client.batch();
      batch.add('add', { a: 1, b: 2 });
      batch.add('subtract', { minuend: 10, subtrahend: 5 });

      const promise = batch.execute();

      await delay(10);
      const sent = transport.getLastSentMessageAsJSON();

      // Should send array of requests
      expect(Array.isArray(sent)).toBe(true);
      expect(sent).toHaveLength(2);

      // Simulate batch response
      transport.simulateMessage(
        JSON.stringify([
          { jsonrpc: '2.0', result: 3, id: sent[0].id },
          { jsonrpc: '2.0', result: 5, id: sent[1].id },
        ])
      );

      const results = await promise;
      expect(results).toEqual([3, 5]);
    });

    it('should execute batch in sequential mode', async () => {
      const batch = client.batch();
      batch.add('test1', {});
      batch.add('test2', {});

      const promise = batch.execute({ mode: 'sequential' });

      await delay(10);
      const sent = transport.getLastSentMessageAsJSON();

      // Simulate responses
      transport.simulateMessage(
        JSON.stringify([
          { jsonrpc: '2.0', result: 'r1', id: sent[0].id },
          { jsonrpc: '2.0', result: 'r2', id: sent[1].id },
        ])
      );

      const results = await promise;
      expect(results).toEqual(['r1', 'r2']);
    });

    it('should throw error for empty batch', async () => {
      const batch = client.batch();

      await expect(batch.execute()).rejects.toThrow('Cannot execute empty batch');
    });

    it('should get batch length', () => {
      const batch = client.batch();
      expect(batch.length).toBe(0);

      batch.add('test', {});
      expect(batch.length).toBe(1);
    });

    it('should support batch timeout option', async () => {
      const batch = client.batch();
      batch.add('slow', {});

      const promise = batch.execute({ timeout: 50 });

      await expect(promise).rejects.toThrow(/timed out/);
    });

    it('should support batch AbortSignal', async () => {
      const batch = client.batch();
      batch.add('test', {});

      const controller = new AbortController();
      const promise = batch.execute({ signal: controller.signal });

      await delay(10);
      controller.abort();

      await expect(promise).rejects.toThrow('Request aborted');
    });

    it('should reject immediately if signal already aborted', async () => {
      const batch = client.batch();
      batch.add('test', {});

      const controller = new AbortController();
      controller.abort();

      await expect(batch.execute({ signal: controller.signal })).rejects.toThrow('Request aborted');
    });
  });

  describe('getPendingRequestCount', () => {
    it('should return 0 when no pending requests', () => {
      expect(client.getPendingRequestCount()).toBe(0);
    });

    it('should return count of pending requests', async () => {
      const promise1 = client.request('test1');
      const promise2 = client.request('test2');

      await delay(10);

      expect(client.getPendingRequestCount()).toBe(2);

      // Cleanup
      const messages = transport.sentMessages.map((msg) => JSON.parse(msg));
      for (const msg of messages) {
        transport.simulateMessage(JSON.stringify({ jsonrpc: '2.0', result: null, id: msg.id }));
      }
      await promise1;
      await promise2;

      expect(client.getPendingRequestCount()).toBe(0);
    });
  });
});
