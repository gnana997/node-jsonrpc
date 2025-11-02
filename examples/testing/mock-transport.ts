/**
 * Mock Transport Implementation
 *
 * Provides mock Transport and TransportServer implementations for testing.
 * These mocks allow you to test JSON-RPC clients and servers in isolation
 * without requiring real network connections.
 *
 * Features:
 * - In-memory message passing
 * - Simulated connection states
 * - Message inspection
 * - Error simulation
 * - Bidirectional communication
 * - Connection lifecycle management
 *
 * @example
 * ```typescript
 * import { MockTransport, MockTransportServer } from './mock-transport';
 *
 * // Test client
 * const transport = new MockTransport();
 * const client = new JSONRPCClient({ transport });
 * await client.connect();
 *
 * // Simulate response
 * transport.simulateMessage('{"jsonrpc":"2.0","result":"ok","id":1}');
 *
 * // Test server
 * const transportServer = new MockTransportServer();
 * const server = new JSONRPCServer({ transportServer });
 * await server.listen();
 *
 * // Simulate connection
 * const clientTransport = new MockTransport();
 * transportServer.simulateConnection(clientTransport);
 * ```
 */

import { EventEmitter } from 'node:events';
import type { Transport, TransportServer } from '../../src/transport.js';

/**
 * Mock Transport for testing
 *
 * A simple in-memory transport implementation that can be used for testing.
 * Provides methods to simulate receiving messages, errors, and connection state changes.
 */
export class MockTransport extends EventEmitter implements Transport {
  private connected = false;

  /**
   * All messages sent via this transport
   */
  public sentMessages: string[] = [];

  /**
   * Whether the transport is connected
   */
  get isConnectedValue(): boolean {
    return this.connected;
  }

  /**
   * Connect the transport
   * Emits 'connect' event
   */
  async connect(): Promise<void> {
    if (this.connected) {
      throw new Error('Already connected');
    }
    this.connected = true;
    // Emit connect on next tick to simulate async behavior
    setImmediate(() => this.emit('connect'));
  }

  /**
   * Disconnect the transport
   * Emits 'disconnect' event
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }
    this.connected = false;
    setImmediate(() => this.emit('disconnect'));
  }

  /**
   * Send a message
   * Stores the message in sentMessages array
   */
  send(message: string): void {
    if (!this.connected) {
      throw new Error('Not connected');
    }
    this.sentMessages.push(message);
  }

  /**
   * Check if transport is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ==========================================================================
  // Test Helpers
  // ==========================================================================

  /**
   * Test helper: Simulate receiving a message
   * Emits 'message' event with the provided message
   *
   * @param message - JSON-RPC message string to simulate
   *
   * @example
   * ```typescript
   * transport.simulateMessage('{"jsonrpc":"2.0","result":"ok","id":1}');
   * ```
   */
  simulateMessage(message: string): void {
    setImmediate(() => this.emit('message', message));
  }

  /**
   * Test helper: Simulate a transport error
   * Emits 'error' event with the provided error
   *
   * @param error - Error to simulate
   *
   * @example
   * ```typescript
   * transport.simulateError(new Error('Connection lost'));
   * ```
   */
  simulateError(error: Error): void {
    setImmediate(() => this.emit('error', error));
  }

  /**
   * Test helper: Simulate disconnection
   * Sets connected to false and emits 'close' event
   *
   * @example
   * ```typescript
   * transport.simulateDisconnect();
   * ```
   */
  simulateDisconnect(): void {
    this.connected = false;
    setImmediate(() => this.emit('close'));
  }

  /**
   * Test helper: Get the last sent message
   *
   * @returns The last message sent, or undefined if none
   *
   * @example
   * ```typescript
   * client.request('test');
   * const lastMessage = transport.getLastSentMessage();
   * ```
   */
  getLastSentMessage(): string | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  /**
   * Test helper: Get the last sent message as parsed JSON
   *
   * @returns Parsed JSON object, or undefined if no messages sent
   *
   * @example
   * ```typescript
   * client.request('test', { foo: 'bar' });
   * const json = transport.getLastSentMessageAsJSON();
   * expect(json).toMatchObject({ method: 'test', params: { foo: 'bar' } });
   * ```
   */
  getLastSentMessageAsJSON(): any {
    const lastMessage = this.getLastSentMessage();
    return lastMessage ? JSON.parse(lastMessage) : undefined;
  }

  /**
   * Test helper: Get all sent messages as parsed JSON
   *
   * @returns Array of parsed JSON objects
   *
   * @example
   * ```typescript
   * const messages = transport.getAllSentMessagesAsJSON();
   * expect(messages).toHaveLength(3);
   * ```
   */
  getAllSentMessagesAsJSON(): any[] {
    return this.sentMessages.map((msg) => JSON.parse(msg));
  }

  /**
   * Test helper: Clear all sent messages
   *
   * @example
   * ```typescript
   * transport.clearSentMessages();
   * expect(transport.sentMessages).toHaveLength(0);
   * ```
   */
  clearSentMessages(): void {
    this.sentMessages = [];
  }

  /**
   * Test helper: Reset the transport to initial state
   * Clears messages, disconnects, and removes all listeners
   *
   * @example
   * ```typescript
   * afterEach(() => {
   *   transport.reset();
   * });
   * ```
   */
  reset(): void {
    this.connected = false;
    this.sentMessages = [];
    this.removeAllListeners();
  }

  /**
   * Test helper: Wait for a message to be sent
   *
   * @param timeout - Timeout in milliseconds (default: 1000)
   * @returns Promise that resolves with the sent message
   *
   * @example
   * ```typescript
   * client.request('test');
   * const message = await transport.waitForMessage();
   * expect(JSON.parse(message).method).toBe('test');
   * ```
   */
  async waitForMessage(timeout = 1000): Promise<string> {
    return new Promise((resolve, reject) => {
      const initialCount = this.sentMessages.length;
      const timeoutHandle = setTimeout(() => {
        reject(new Error(`No message sent within ${timeout}ms`));
      }, timeout);

      const checkInterval = setInterval(() => {
        if (this.sentMessages.length > initialCount) {
          clearTimeout(timeoutHandle);
          clearInterval(checkInterval);
          resolve(this.sentMessages[this.sentMessages.length - 1]!);
        }
      }, 10);
    });
  }

  /**
   * Test helper: Get message count
   *
   * @returns Number of messages sent
   */
  getMessageCount(): number {
    return this.sentMessages.length;
  }

  /**
   * Test helper: Find message matching predicate
   *
   * @param predicate - Function to test each message
   * @returns First matching message, or undefined
   *
   * @example
   * ```typescript
   * const requestMsg = transport.findMessage((msg) => {
   *   const json = JSON.parse(msg);
   *   return json.method === 'test';
   * });
   * ```
   */
  findMessage(predicate: (message: string) => boolean): string | undefined {
    return this.sentMessages.find(predicate);
  }

  /**
   * Test helper: Find all messages matching predicate
   *
   * @param predicate - Function to test each message
   * @returns Array of matching messages
   */
  findAllMessages(predicate: (message: string) => boolean): string[] {
    return this.sentMessages.filter(predicate);
  }
}

/**
 * Mock Transport Server for testing
 *
 * A simple in-memory transport server implementation for testing.
 * Provides methods to simulate client connections.
 */
export class MockTransportServer extends EventEmitter implements TransportServer {
  private listening = false;
  private connections: Transport[] = [];

  /**
   * Whether the server is listening
   */
  get isListeningValue(): boolean {
    return this.listening;
  }

  /**
   * Start listening for connections
   * Emits 'listening' event
   */
  async listen(): Promise<void> {
    if (this.listening) {
      throw new Error('Already listening');
    }
    this.listening = true;
    setImmediate(() => this.emit('listening'));
  }

  /**
   * Stop listening for connections
   * Emits 'close' event
   */
  async close(): Promise<void> {
    if (!this.listening) {
      return;
    }
    this.listening = false;
    this.connections = [];
    setImmediate(() => this.emit('close'));
  }

  /**
   * Check if server is listening
   */
  isListening(): boolean {
    return this.listening;
  }

  // ==========================================================================
  // Test Helpers
  // ==========================================================================

  /**
   * Test helper: Simulate a new client connection
   * Emits 'connection' event with the provided transport
   *
   * @param transport - Transport to simulate as new connection
   *
   * @example
   * ```typescript
   * const transportServer = new MockTransportServer();
   * const server = new JSONRPCServer({ transportServer });
   * await server.listen();
   *
   * const clientTransport = new MockTransport();
   * transportServer.simulateConnection(clientTransport);
   * ```
   */
  simulateConnection(transport: Transport): void {
    if (!this.listening) {
      throw new Error('Server not listening');
    }
    this.connections.push(transport);
    setImmediate(() => this.emit('connection', transport));
  }

  /**
   * Test helper: Simulate a server error
   * Emits 'error' event with the provided error
   *
   * @param error - Error to simulate
   *
   * @example
   * ```typescript
   * transportServer.simulateError(new Error('Bind failed'));
   * ```
   */
  simulateError(error: Error): void {
    setImmediate(() => this.emit('error', error));
  }

  /**
   * Test helper: Get all simulated connections
   *
   * @returns Array of connected transports
   */
  getConnections(): Transport[] {
    return [...this.connections];
  }

  /**
   * Test helper: Get connection count
   *
   * @returns Number of active connections
   */
  getConnectionCount(): number {
    return this.connections.length;
  }

  /**
   * Test helper: Reset the server to initial state
   * Stops listening and removes all listeners
   *
   * @example
   * ```typescript
   * afterEach(() => {
   *   transportServer.reset();
   * });
   * ```
   */
  reset(): void {
    this.listening = false;
    this.connections = [];
    this.removeAllListeners();
  }
}

/**
 * Create a bidirectionally connected pair of transports
 * Messages sent on one transport are received by the other
 *
 * @returns Object containing both transports
 *
 * @example
 * ```typescript
 * const { clientTransport, serverTransport } = createConnectedTransportPair();
 *
 * // Messages sent by client are received by server
 * clientTransport.send('{"jsonrpc":"2.0","method":"test","id":1}');
 * serverTransport.on('message', (msg) => {
 *   console.log('Server received:', msg);
 * });
 *
 * // Messages sent by server are received by client
 * serverTransport.send('{"jsonrpc":"2.0","result":"ok","id":1}');
 * clientTransport.on('message', (msg) => {
 *   console.log('Client received:', msg);
 * });
 * ```
 */
export function createConnectedTransportPair(): {
  clientTransport: MockTransport;
  serverTransport: MockTransport;
} {
  const clientTransport = new MockTransport();
  const serverTransport = new MockTransport();

  // Connect transports bidirectionally
  clientTransport.on('message', (_msg: string) => {
    // Override send to forward to server
    const originalSend = clientTransport.send.bind(clientTransport);
    clientTransport.send = (message: string) => {
      originalSend(message);
      serverTransport.simulateMessage(message);
    };
  });

  serverTransport.on('message', (_msg: string) => {
    // Override send to forward to client
    const originalSend = serverTransport.send.bind(serverTransport);
    serverTransport.send = (message: string) => {
      originalSend(message);
      clientTransport.simulateMessage(message);
    };
  });

  // Actually set up the forwarding
  const clientOriginalSend = clientTransport.send.bind(clientTransport);
  clientTransport.send = (message: string) => {
    clientOriginalSend(message);
    serverTransport.simulateMessage(message);
  };

  const serverOriginalSend = serverTransport.send.bind(serverTransport);
  serverTransport.send = (message: string) => {
    serverOriginalSend(message);
    clientTransport.simulateMessage(message);
  };

  return { clientTransport, serverTransport };
}

/**
 * Helper function to wait for a condition to become true
 *
 * @param condition - Function that returns true when condition is met
 * @param timeout - Timeout in milliseconds (default: 1000)
 * @param interval - Check interval in milliseconds (default: 10)
 * @returns Promise that resolves when condition is met
 *
 * @example
 * ```typescript
 * await waitForCondition(() => transport.getMessageCount() > 0, 1000);
 * ```
 */
export async function waitForCondition(
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

// Export for use in tests
export default {
  MockTransport,
  MockTransportServer,
  createConnectedTransportPair,
  waitForCondition,
};
