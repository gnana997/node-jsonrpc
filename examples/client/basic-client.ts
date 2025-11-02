/**
 * Basic Client Example
 *
 * Demonstrates fundamental JSON-RPC client usage including:
 * - Connecting to a server
 * - Making simple requests
 * - Sending notifications
 * - Handling server notifications
 * - Proper cleanup
 */

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { JSONRPCClient } from '../../src/client.js';
import type { Transport } from '../../src/transport.js';

/**
 * Simple TCP Transport implementation for the client
 */
class TCPTransport extends EventEmitter implements Transport {
  private socket?: net.Socket;
  private buffer = '';
  private connected = false;

  constructor(
    private host: string,
    private port: number
  ) {
    super();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.connect(this.port, this.host);

      this.socket.on('connect', () => {
        this.connected = true;
        this.setupListeners();
        resolve();
      });

      this.socket.once('error', reject);
    });
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket = undefined;
      this.connected = false;
      this.buffer = '';
    }
  }

  send(message: string): void {
    if (!this.connected || !this.socket) {
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
    return this.connected;
  }

  private setupListeners(): void {
    if (!this.socket) return;

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
 * Example request parameter types
 */
interface AddParams {
  a: number;
  b: number;
}

interface GreetParams {
  name: string;
}

interface GreetResult {
  message: string;
}

/**
 * Main example function
 */
async function main(): Promise<void> {
  // Create transport (connecting to localhost:3000)
  const transport = new TCPTransport('localhost', 3000);

  // Create JSON-RPC client
  const client = new JSONRPCClient({
    transport,
    requestTimeout: 5000,
    debug: true,
  });

  // Handle connection events
  client.on('connected', () => {
    console.log('✓ Connected to server');
  });

  client.on('disconnected', () => {
    console.log('✓ Disconnected from server');
  });

  client.on('error', (error: Error) => {
    console.error('✗ Client error:', error.message);
  });

  // Handle server notifications
  client.on('notification', (method: string, params: unknown) => {
    console.log(`← Server notification: ${method}`, params);
  });

  try {
    // Connect to the server
    console.log('Connecting to server...');
    await client.connect();

    // Example 1: Simple request with result
    console.log('\n--- Example 1: Simple Request ---');
    const sum = await client.request<number>('add', { a: 5, b: 3 } as AddParams);
    console.log('→ Request: add(5, 3)');
    console.log(`← Response: ${sum}`);

    // Example 2: Request with typed parameters and result
    console.log('\n--- Example 2: Typed Request ---');
    const greeting = await client.request<GreetResult>('greet', {
      name: 'Alice',
    } as GreetParams);
    console.log(`→ Request: greet("Alice")`);
    console.log('← Response:', greeting);

    // Example 3: Request without parameters
    console.log('\n--- Example 3: Request Without Params ---');
    const status = await client.request<{ uptime: number; version: string }>('getStatus');
    console.log('→ Request: getStatus()');
    console.log('← Response:', status);

    // Example 4: Send notification (no response expected)
    console.log('\n--- Example 4: Send Notification ---');
    client.notify('logActivity', { action: 'example_completed', timestamp: Date.now() });
    console.log('→ Notification: logActivity (no response expected)');

    // Example 5: Multiple concurrent requests
    console.log('\n--- Example 5: Concurrent Requests ---');
    const [result1, result2, result3] = await Promise.all([
      client.request<number>('add', { a: 1, b: 2 }),
      client.request<number>('add', { a: 3, b: 4 }),
      client.request<number>('add', { a: 5, b: 6 }),
    ]);
    console.log('→ Concurrent requests sent');
    console.log(`← Results: ${result1}, ${result2}, ${result3}`);

    // Wait a bit for any server notifications
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Clean disconnect
    console.log('\nDisconnecting...');
    await client.disconnect();
    console.log('Example completed');
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main, TCPTransport };
