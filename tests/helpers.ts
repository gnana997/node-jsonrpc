import type { EventEmitter } from 'node:events';
import { JSONRPCClient } from '../src/client.js';
import { JSONRPCServer } from '../src/server.js';
import type { Handler, RequestContext } from '../src/types.js';
import { MockTransport } from './mocks/mockTransport.js';
import { MockTransportServer } from './mocks/mockTransportServer.js';

/**
 * Connected Client-Server Pair
 * For integration testing
 */
export interface ConnectedPair {
  client: JSONRPCClient;
  server: JSONRPCServer;
  clientTransport: MockTransport;
  serverTransport: MockTransport;
  cleanup: () => Promise<void>;
}

/**
 * Create a connected client-server pair for testing
 *
 * @example
 * ```typescript
 * const { client, server, cleanup } = await createConnectedPair();
 *
 * server.registerMethod('add', addHandler);
 * const result = await client.request('add', { a: 1, b: 2 });
 *
 * await cleanup();
 * ```
 */
export async function createConnectedPair(): Promise<ConnectedPair> {
  // Create transports
  const clientTransport = new MockTransport();
  const serverTransport = new MockTransport();

  // Connect transports bidirectionally
  clientTransport.on('message', (msg: string) => {
    // Client sends to server
    serverTransport.simulateMessage(msg);
  });

  serverTransport.on('message', (msg: string) => {
    // Server sends to client
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

  // Start server
  await server.listen();

  // Simulate server connection
  transportServer.simulateConnection(serverTransport);
  await serverTransport.connect();

  // Connect client
  await client.connect();

  // Cleanup function
  const cleanup = async () => {
    await client.disconnect();
    await server.close({ closeConnections: true });
  };

  return {
    client,
    server,
    clientTransport,
    serverTransport,
    cleanup,
  };
}

/**
 * Wait for an event to be emitted
 *
 * @param emitter - Event emitter to listen on
 * @param event - Event name to wait for
 * @param timeout - Timeout in milliseconds (default: 1000)
 * @returns Promise that resolves with event arguments
 *
 * @example
 * ```typescript
 * client.notify('update', { status: 'ready' });
 * const [method, params] = await waitForEvent(server, 'notification');
 * ```
 */
export function waitForEvent<T extends any[]>(
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
 * Wait for a condition to become true
 *
 * @param condition - Function that returns true when condition is met
 * @param timeout - Timeout in milliseconds (default: 1000)
 * @param interval - Check interval in milliseconds (default: 10)
 * @returns Promise that resolves when condition is met
 */
export function waitForCondition(
  condition: () => boolean,
  timeout = 1000,
  interval = 10
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      if (condition()) {
        resolve();
        return;
      }

      if (Date.now() - startTime >= timeout) {
        reject(new Error(`Condition not met within ${timeout}ms`));
        return;
      }

      setTimeout(check, interval);
    };

    check();
  });
}

/**
 * Delay for a specified time
 *
 * @param ms - Milliseconds to delay
 * @returns Promise that resolves after the delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Test Fixture Handlers
// ============================================================================

/**
 * Add handler - adds two numbers
 */
export const addHandler: Handler = async (params: { a: number; b: number }) => {
  return params.a + params.b;
};

/**
 * Subtract handler - subtracts two numbers
 */
export const subtractHandler: Handler = async (params: { minuend: number; subtrahend: number }) => {
  return params.minuend - params.subtrahend;
};

/**
 * Echo handler - returns the input
 */
export const echoHandler: Handler = async (params: any) => {
  return params;
};

/**
 * Delay handler - delays for specified time then returns value
 */
export const delayHandler: Handler = async (params: { ms: number; value?: any }) => {
  await delay(params.ms);
  return params.value ?? 'delayed';
};

/**
 * Error handler - always throws an error
 */
export const errorHandler: Handler = async (params: { message?: string }) => {
  throw new Error(params?.message ?? 'Test error');
};

/**
 * Notification handler - demonstrates access to context
 * Can send notifications back via transport
 */
export const notificationHandler: Handler = async (
  params: { count?: number },
  context: RequestContext
) => {
  const count = params?.count ?? 1;

  // Send notifications back to the client through transport
  // Note: In real code, you'd typically use server.notify(transport, ...)
  // but in handlers we have direct access to transport
  for (let i = 0; i < count; i++) {
    const notification = {
      jsonrpc: '2.0' as const,
      method: 'progressUpdate',
      params: { progress: i + 1, total: count },
    };
    context.transport.send(JSON.stringify(notification));
  }

  return { sent: count };
};

/**
 * Get user handler - returns user info
 */
export const getUserHandler: Handler = async (params: { id: number }) => {
  return {
    id: params.id,
    name: `User ${params.id}`,
    email: `user${params.id}@example.com`,
  };
};

/**
 * Sum array handler - sums an array of numbers
 */
export const sumArrayHandler: Handler = async (params: { numbers: number[] }) => {
  return params.numbers.reduce((sum, n) => sum + n, 0);
};
