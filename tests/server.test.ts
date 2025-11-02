import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSONRPCServer } from '../src/server.js';
import type { Middleware } from '../src/types.js';
import {
  addHandler,
  delay,
  echoHandler,
  errorHandler,
  subtractHandler,
  waitForEvent,
} from './helpers.js';
import { MockTransport } from './mocks/mockTransport.js';
import { MockTransportServer } from './mocks/mockTransportServer.js';

describe('JSONRPCServer', () => {
  let server: JSONRPCServer;
  let transportServer: MockTransportServer;

  beforeEach(async () => {
    transportServer = new MockTransportServer();
    server = new JSONRPCServer({ transportServer });
    await server.listen();
  });

  // Helper to create a connected client
  async function createConnectedClient(): Promise<
    MockTransport & { receivedMessages: string[]; serverTransport: MockTransport }
  > {
    const clientTransport = new MockTransport();
    const serverTransport = new MockTransport();

    // Track received messages on client (responses from server)
    const receivedMessages: string[] = [];

    // Override send methods to forward messages bidirectionally
    const originalClientSend = clientTransport.send.bind(clientTransport);
    const originalServerSend = serverTransport.send.bind(serverTransport);
    const originalGetLastSent = clientTransport.getLastSentMessage.bind(clientTransport);
    const originalGetLastSentJSON = clientTransport.getLastSentMessageAsJSON.bind(clientTransport);

    clientTransport.send = (msg: string) => {
      originalClientSend(msg);
      // Forward to server
      serverTransport.simulateMessage(msg);
    };

    serverTransport.send = (msg: string) => {
      // originalServerSend(msg);  // Don't store on server, store on client as received
      receivedMessages.push(msg);
      // Forward to client
      clientTransport.simulateMessage(msg);
    };

    // Override getLastSentMessage to return last RECEIVED message (from server)
    clientTransport.getLastSentMessage = () => {
      return receivedMessages[receivedMessages.length - 1];
    };

    clientTransport.getLastSentMessageAsJSON = () => {
      const lastMessage = receivedMessages[receivedMessages.length - 1];
      return lastMessage ? JSON.parse(lastMessage) : undefined;
    };

    await clientTransport.connect();
    await serverTransport.connect();

    transportServer.simulateConnection(serverTransport);

    await delay(10);

    // Expose receivedMessages and serverTransport for tests that need them
    return Object.assign(clientTransport, { receivedMessages, serverTransport });
  }

  describe('Lifecycle', () => {
    it('should start listening', async () => {
      const newTransportServer = new MockTransportServer();
      const newServer = new JSONRPCServer({ transportServer: newTransportServer });

      expect(newTransportServer.isListening()).toBe(false);

      await newServer.listen();

      expect(newTransportServer.isListening()).toBe(true);
    });

    it('should close gracefully', async () => {
      await server.close();

      expect(transportServer.isListening()).toBe(false);
    });

    it('should close with connections cleanup', async () => {
      const clientTransport = new MockTransport();
      await clientTransport.connect();
      transportServer.simulateConnection(clientTransport);

      await delay(10);
      expect(server.getConnectionCount()).toBe(1);

      await server.close({ closeConnections: true });

      expect(server.getConnectionCount()).toBe(0);
    });
  });

  describe('Method Registration', () => {
    it('should register a method', () => {
      server.registerMethod('add', addHandler);

      expect(server.hasMethod('add')).toBe(true);
    });

    it('should unregister a method', () => {
      server.registerMethod('add', addHandler);

      const removed = server.unregisterMethod('add');

      expect(removed).toBe(true);
      expect(server.hasMethod('add')).toBe(false);
    });

    it('should return false when unregistering non-existent method', () => {
      const removed = server.unregisterMethod('unknown');

      expect(removed).toBe(false);
    });

    it('should list all registered methods', () => {
      server.registerMethod('add', addHandler);
      server.registerMethod('subtract', subtractHandler);
      server.registerMethod('echo', echoHandler);

      const methods = server.getMethods();

      expect(methods).toEqual(['add', 'subtract', 'echo']);
    });

    it('should check if method exists', () => {
      server.registerMethod('add', addHandler);

      expect(server.hasMethod('add')).toBe(true);
      expect(server.hasMethod('unknown')).toBe(false);
    });
  });

  describe('Request Handling', () => {
    it('should handle successful request', async () => {
      server.registerMethod('add', addHandler);

      const clientTransport = await createConnectedClient();

      // Send request
      clientTransport.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'add',
          params: { a: 1, b: 2 },
          id: 1,
        })
      );

      await delay(10);

      const response = clientTransport.getLastSentMessageAsJSON();
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        result: 3,
        id: 1,
      });
    });

    it('should return method not found error', async () => {
      const clientTransport = await createConnectedClient();

      // Send request for unknown method
      clientTransport.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'unknown',
          params: {},
          id: 1,
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
        id: 1,
      });
    });

    it('should return internal error when handler throws', async () => {
      server.registerMethod('error', errorHandler);

      const clientTransport = await createConnectedClient();

      // Send request
      clientTransport.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'error',
          params: { message: 'Test error' },
          id: 1,
        })
      );

      await delay(10);

      const response = clientTransport.getLastSentMessageAsJSON();
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Test error',
        },
        id: 1,
      });
    });

    it('should return parse error for invalid JSON', async () => {
      const clientTransport = await createConnectedClient();

      // Send invalid JSON
      clientTransport.send('invalid json');

      await delay(10);

      // Response should be valid JSON with parse error
      const response = JSON.parse(clientTransport.getLastSentMessage() || '{}');
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        error: {
          code: -32700,
          message: expect.stringContaining('Parse error'),
        },
        id: null,
      });
    });

    it('should return invalid request for malformed message', async () => {
      const clientTransport = await createConnectedClient();

      // Send malformed message (missing jsonrpc version)
      clientTransport.send(
        JSON.stringify({
          method: 'test',
          id: 1,
        })
      );

      await delay(10);

      const response = clientTransport.getLastSentMessageAsJSON();
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: expect.stringContaining('Invalid Request'),
        },
        id: null,
      });
    });
  });

  describe('Notifications', () => {
    it('should receive notifications from clients', async () => {
      const clientTransport = await createConnectedClient();

      const promise = waitForEvent(server, 'notification');

      // Send notification
      clientTransport.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'update',
          params: { status: 'ready' },
        })
      );

      const [method, params] = await promise;
      expect(method).toBe('update');
      expect(params).toEqual({ status: 'ready' });
    });

    it('should not send response for notifications', async () => {
      const clientTransport = await createConnectedClient();

      // Clear received messages
      clientTransport.receivedMessages.length = 0;

      // Send notification
      clientTransport.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'update',
          params: { status: 'ready' },
        })
      );

      await delay(10);

      // Should not send any response
      expect(clientTransport.receivedMessages).toHaveLength(0);
    });

    it('should send notification to specific client', async () => {
      const clientTransport = await createConnectedClient();

      // Use serverTransport (the transport the server knows about)
      server.notify(clientTransport.serverTransport, 'update', { status: 'ready' });

      const sent = clientTransport.getLastSentMessageAsJSON();
      expect(sent).toMatchObject({
        jsonrpc: '2.0',
        method: 'update',
        params: { status: 'ready' },
      });
      expect(sent.id).toBeUndefined();
    });
  });

  describe('Broadcasting', () => {
    it('should broadcast to all connected clients', async () => {
      const client1 = await createConnectedClient();
      const client2 = await createConnectedClient();
      const client3 = await createConnectedClient();

      const count = server.broadcast('serverStatus', { status: 'ready' });

      expect(count).toBe(3);

      expect(client1.getLastSentMessageAsJSON()).toMatchObject({
        method: 'serverStatus',
        params: { status: 'ready' },
      });
      expect(client2.getLastSentMessageAsJSON()).toMatchObject({
        method: 'serverStatus',
        params: { status: 'ready' },
      });
      expect(client3.getLastSentMessageAsJSON()).toMatchObject({
        method: 'serverStatus',
        params: { status: 'ready' },
      });
    });

    it('should not broadcast to disconnected clients', async () => {
      const client1 = await createConnectedClient();
      const client2 = await createConnectedClient();

      // Disconnect client2 (both transports)
      await client2.disconnect();
      await client2.serverTransport.disconnect();

      await delay(10);

      const count = server.broadcast('update', {});

      expect(count).toBe(1); // Only client1
    });
  });

  describe('Middleware', () => {
    it('should call request middleware', async () => {
      const middleware: Middleware = {
        onRequest: vi.fn((req) => req),
      };

      server.use(middleware);
      server.registerMethod('add', addHandler);

      const clientTransport = await createConnectedClient();

      // Send request
      clientTransport.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'add',
          params: { a: 1, b: 2 },
          id: 1,
        })
      );

      await delay(10);

      expect(middleware.onRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'add',
          params: { a: 1, b: 2 },
        })
      );
    });

    it('should call response middleware', async () => {
      const middleware: Middleware = {
        onResponse: vi.fn((res) => res),
      };

      server.use(middleware);
      server.registerMethod('add', addHandler);

      const clientTransport = await createConnectedClient();

      // Send request
      clientTransport.send(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'add',
          params: { a: 1, b: 2 },
          id: 1,
        })
      );

      await delay(10);

      expect(middleware.onResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 3,
        })
      );
    });

    it('should call notification middleware', async () => {
      const middleware: Middleware = {
        onNotification: vi.fn(),
      };

      server.use(middleware);

      const clientTransport = await createConnectedClient();

      // Send notification
      clientTransport.send(
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
  });

  describe('Connection Management', () => {
    it('should track connected clients', async () => {
      expect(server.getConnectionCount()).toBe(0);

      const client1 = await createConnectedClient();

      expect(server.getConnectionCount()).toBe(1);

      const client2 = await createConnectedClient();

      expect(server.getConnectionCount()).toBe(2);
    });

    it('should remove disconnected clients', async () => {
      const client1 = await createConnectedClient();

      expect(server.getConnectionCount()).toBe(1);

      // Disconnect both client and server transports
      await client1.disconnect();
      await client1.serverTransport.disconnect();

      await delay(10);
      expect(server.getConnectionCount()).toBe(0);
    });

    it('should call onConnection hook', async () => {
      const onConnection = vi.fn();
      const newTransportServer = new MockTransportServer();
      const newServer = new JSONRPCServer({
        transportServer: newTransportServer,
        onConnection,
      });
      await newServer.listen();

      const clientTransport = new MockTransport();
      await clientTransport.connect();
      newTransportServer.simulateConnection(clientTransport);

      await delay(10);

      expect(onConnection).toHaveBeenCalledWith(clientTransport);
    });

    it('should call onDisconnection hook', async () => {
      const onDisconnection = vi.fn();
      const newTransportServer = new MockTransportServer();
      const newServer = new JSONRPCServer({
        transportServer: newTransportServer,
        onDisconnection,
      });
      await newServer.listen();

      const clientTransport = new MockTransport();
      await clientTransport.connect();
      newTransportServer.simulateConnection(clientTransport);

      await delay(10);

      await clientTransport.disconnect();

      await delay(10);

      expect(onDisconnection).toHaveBeenCalledWith(clientTransport);
    });
  });

  describe('Batch Requests', () => {
    it('should handle batch requests', async () => {
      server.registerMethod('add', addHandler);
      server.registerMethod('subtract', subtractHandler);

      const clientTransport = await createConnectedClient();

      // Send batch request
      clientTransport.send(
        JSON.stringify([
          { jsonrpc: '2.0', method: 'add', params: { a: 1, b: 2 }, id: 1 },
          { jsonrpc: '2.0', method: 'subtract', params: { minuend: 10, subtrahend: 5 }, id: 2 },
        ])
      );

      await delay(10);

      const response = clientTransport.getLastSentMessageAsJSON();
      expect(Array.isArray(response)).toBe(true);
      expect(response).toHaveLength(2);

      // Responses can be in any order, so check by ID
      const response1 = response.find((r: any) => r.id === 1);
      const response2 = response.find((r: any) => r.id === 2);

      expect(response1).toMatchObject({ jsonrpc: '2.0', result: 3, id: 1 });
      expect(response2).toMatchObject({ jsonrpc: '2.0', result: 5, id: 2 });
    });

    it('should return error for empty batch', async () => {
      const clientTransport = await createConnectedClient();

      // Send empty batch
      clientTransport.send(JSON.stringify([]));

      await delay(10);

      const response = clientTransport.getLastSentMessageAsJSON();
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        error: {
          code: -32600,
        },
        id: null,
      });
    });

    it('should not send response for batch with only notifications', async () => {
      const clientTransport = await createConnectedClient();

      // Clear received messages
      clientTransport.receivedMessages.length = 0;

      // Send batch with only notifications
      clientTransport.send(
        JSON.stringify([
          { jsonrpc: '2.0', method: 'notify1', params: {} },
          { jsonrpc: '2.0', method: 'notify2', params: {} },
        ])
      );

      await delay(10);

      // Should not send any response
      expect(clientTransport.receivedMessages).toHaveLength(0);
    });

    it('should handle mixed batch (requests and notifications)', async () => {
      server.registerMethod('add', addHandler);

      const clientTransport = await createConnectedClient();

      // Clear received messages to ensure we get the batch response
      clientTransport.receivedMessages.length = 0;

      // Send mixed batch
      clientTransport.send(
        JSON.stringify([
          { jsonrpc: '2.0', method: 'add', params: { a: 1, b: 2 }, id: 1 },
          { jsonrpc: '2.0', method: 'notify', params: {} },
          { jsonrpc: '2.0', method: 'add', params: { a: 3, b: 4 }, id: 2 },
        ])
      );

      await delay(10);

      const response = clientTransport.getLastSentMessageAsJSON();
      expect(Array.isArray(response)).toBe(true);
      expect(response).toHaveLength(2); // Only 2 responses (notifications don't get responses)

      const response1 = response.find((r: any) => r.id === 1);
      const response2 = response.find((r: any) => r.id === 2);

      expect(response1).toMatchObject({ jsonrpc: '2.0', result: 3, id: 1 });
      expect(response2).toMatchObject({ jsonrpc: '2.0', result: 7, id: 2 });
    });
  });
});
