import { EventEmitter } from 'node:events';
import type { Transport, TransportServer } from '../../src/transport.js';

/**
 * Mock TransportServer for testing
 *
 * A simple in-memory transport server implementation that can be used for testing.
 * Provides methods to simulate client connections and server lifecycle events.
 *
 * @example
 * ```typescript
 * import { MockTransportServer } from './mocks/mockTransportServer';
 * import { MockTransport } from './mocks/mockTransport';
 *
 * const server = new MockTransportServer();
 *
 * // Start listening
 * await server.listen();
 *
 * // Simulate a client connection
 * const clientTransport = new MockTransport();
 * await clientTransport.connect();
 * server.simulateConnection(clientTransport);
 *
 * // The 'connection' event will be emitted
 * server.on('connection', (transport) => {
 *   console.log('Client connected');
 * });
 * ```
 */
export class MockTransportServer extends EventEmitter implements TransportServer {
  private listening = false;

  /**
   * All transports that have connected
   */
  public connections: Transport[] = [];

  /**
   * Whether the server is listening
   */
  get isListeningValue(): boolean {
    return this.listening;
  }

  /**
   * Start listening for connections
   * Emits nothing immediately, connections must be simulated
   */
  async listen(): Promise<void> {
    if (this.listening) {
      throw new Error('Already listening');
    }
    this.listening = true;
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
    setImmediate(() => this.emit('close'));
  }

  /**
   * Check if server is listening
   */
  isListening(): boolean {
    return this.listening;
  }

  /**
   * Test helper: Simulate a client connection
   * Emits 'connection' event with the provided transport
   *
   * @param transport - The transport for the connected client
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
   */
  simulateError(error: Error): void {
    setImmediate(() => this.emit('error', error));
  }

  /**
   * Test helper: Get the number of connections
   */
  getConnectionCount(): number {
    return this.connections.length;
  }

  /**
   * Test helper: Clear all connections
   */
  clearConnections(): void {
    this.connections = [];
  }

  /**
   * Test helper: Reset the server to initial state
   */
  reset(): void {
    this.listening = false;
    this.connections = [];
    this.removeAllListeners();
  }
}
