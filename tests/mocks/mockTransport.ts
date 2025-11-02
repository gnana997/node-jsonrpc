import { EventEmitter } from 'node:events';
import type { Transport } from '../../src/transport.js';

/**
 * Mock Transport for testing
 *
 * A simple in-memory transport implementation that can be used for testing.
 * Provides methods to simulate receiving messages, errors, and connection state changes.
 *
 * @example
 * ```typescript
 * const transport = new MockTransport();
 *
 * // Simulate connection
 * await transport.connect();
 *
 * // Send a message
 * transport.send('{"jsonrpc":"2.0","method":"test","id":1}');
 *
 * // Check what was sent
 * console.log(transport.sentMessages); // ['{"jsonrpc":"2.0","method":"test","id":1}']
 *
 * // Simulate receiving a message
 * transport.simulateMessage('{"jsonrpc":"2.0","result":"ok","id":1}');
 * ```
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

  /**
   * Test helper: Simulate receiving a message
   * Emits 'message' event with the provided message
   */
  simulateMessage(message: string): void {
    setImmediate(() => this.emit('message', message));
  }

  /**
   * Test helper: Simulate a transport error
   * Emits 'error' event with the provided error
   */
  simulateError(error: Error): void {
    setImmediate(() => this.emit('error', error));
  }

  /**
   * Test helper: Simulate disconnection
   * Sets connected to false and emits 'disconnect' event
   */
  simulateDisconnect(): void {
    this.connected = false;
    setImmediate(() => this.emit('disconnect'));
  }

  /**
   * Test helper: Get the last sent message
   */
  getLastSentMessage(): string | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  /**
   * Test helper: Get the last sent message as parsed JSON
   */
  getLastSentMessageAsJSON(): any {
    const lastMessage = this.getLastSentMessage();
    return lastMessage ? JSON.parse(lastMessage) : undefined;
  }

  /**
   * Test helper: Clear sent messages
   */
  clearSentMessages(): void {
    this.sentMessages = [];
  }

  /**
   * Test helper: Reset the transport to initial state
   */
  reset(): void {
    this.connected = false;
    this.sentMessages = [];
    this.removeAllListeners();
  }
}
