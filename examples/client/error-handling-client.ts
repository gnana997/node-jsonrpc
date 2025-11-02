/**
 * Error Handling Example
 *
 * Demonstrates comprehensive error handling including:
 * - Request timeouts
 * - Request cancellation with AbortSignal
 * - JSON-RPC error responses
 * - Transport errors
 * - Connection failures
 * - Reconnection strategies
 * - Graceful degradation
 */

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { JSONRPCClient } from '../../src/client.js';
import { JSONRPCError } from '../../src/error.js';
import type { Transport } from '../../src/transport.js';

/**
 * Simple TCP Transport implementation
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

      const timeout = setTimeout(() => {
        this.socket?.destroy();
        reject(new Error('Connection timeout'));
      }, 5000);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        this.connected = true;
        this.setupListeners();
        resolve();
      });

      this.socket.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket = undefined;
      this.connected = false;
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
 * Example 1: Handle request timeout
 */
async function exampleTimeout(client: JSONRPCClient): Promise<void> {
  console.log('\n--- Example 1: Request Timeout ---');

  try {
    // This request will timeout after 1 second
    const result = await client.request('slowOperation', { delay: 5000 }, { timeout: 1000 });
    console.log('Result:', result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) {
      console.log(`✓ Request timed out as expected: ${error.message}`);
    } else {
      throw error;
    }
  }
}

/**
 * Example 2: Cancel request with AbortSignal
 */
async function exampleAbort(client: JSONRPCClient): Promise<void> {
  console.log('\n--- Example 2: Request Cancellation ---');

  const controller = new AbortController();

  // Cancel after 500ms
  setTimeout(() => {
    console.log('→ Aborting request...');
    controller.abort();
  }, 500);

  try {
    const result = await client.request(
      'slowOperation',
      { delay: 5000 },
      { signal: controller.signal }
    );
    console.log('Result:', result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('aborted')) {
      console.log(`✓ Request cancelled successfully: ${error.message}`);
    } else {
      throw error;
    }
  }
}

/**
 * Example 3: Handle JSON-RPC errors
 */
async function exampleJSONRPCErrors(client: JSONRPCClient): Promise<void> {
  console.log('\n--- Example 3: JSON-RPC Error Responses ---');

  // Method not found
  try {
    await client.request('nonExistentMethod', {});
  } catch (error) {
    if (error instanceof JSONRPCError) {
      console.log('✓ Method not found error caught:');
      console.log(`  Code: ${error.code}`);
      console.log(`  Message: ${error.message}`);
    }
  }

  // Invalid parameters
  try {
    await client.request('divide', { a: 10, b: 0 });
  } catch (error) {
    if (error instanceof JSONRPCError) {
      console.log('✓ Division by zero error caught:');
      console.log(`  Code: ${error.code}`);
      console.log(`  Message: ${error.message}`);
      console.log('  Data:', error.data);
    }
  }

  // Custom application error
  try {
    await client.request('validateUser', { username: '' });
  } catch (error) {
    if (error instanceof JSONRPCError) {
      console.log('✓ Custom validation error caught:');
      console.log(`  Code: ${error.code}`);
      console.log(`  Message: ${error.message}`);
    }
  }
}

/**
 * Example 4: Handle transport errors
 */
async function exampleTransportErrors(client: JSONRPCClient): Promise<void> {
  console.log('\n--- Example 4: Transport Error Handling ---');

  // Disconnect to force a transport error
  await client.disconnect();

  // Try to send a request while disconnected
  try {
    await client.request('test', {});
  } catch (error) {
    console.log(`✓ Transport error caught: ${(error as Error).message}`);
  }
}

/**
 * Example 5: Graceful error recovery
 */
async function exampleGracefulRecovery(client: JSONRPCClient): Promise<void> {
  console.log('\n--- Example 5: Graceful Error Recovery ---');

  const results = [];

  // Make multiple requests, some will fail
  const requests = [
    { method: 'add', params: { a: 1, b: 2 } },
    { method: 'nonExistent', params: {} }, // Will fail
    { method: 'add', params: { a: 3, b: 4 } },
    { method: 'divide', params: { a: 10, b: 0 } }, // Will fail
    { method: 'add', params: { a: 5, b: 6 } },
  ];

  for (const req of requests) {
    try {
      const result = await client.request(req.method, req.params);
      results.push({ method: req.method, success: true, result });
      console.log(`✓ ${req.method}: ${JSON.stringify(result)}`);
    } catch (error) {
      results.push({
        method: req.method,
        success: false,
        error: error instanceof JSONRPCError ? error.message : 'Unknown error',
      });
      console.log(`✗ ${req.method}: ${(error as Error).message}`);
    }
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`\nSummary: ${successful} successful, ${failed} failed`);
}

/**
 * Example 6: Retry logic with exponential backoff
 */
async function exampleRetryLogic(client: JSONRPCClient): Promise<void> {
  console.log('\n--- Example 6: Retry Logic with Exponential Backoff ---');

  async function requestWithRetry<T>(method: string, params: unknown, maxRetries = 3): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempt ${attempt}/${maxRetries} for ${method}`);
        return await client.request<T>(method, params, { timeout: 1000 });
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }

        // Don't retry on client errors (4xx equivalent)
        if (error instanceof JSONRPCError && error.code === -32600) {
          throw error;
        }

        // Exponential backoff: 2^attempt * 100ms
        const backoff = 2 ** attempt * 100;
        console.log(`  Failed, retrying in ${backoff}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
    throw new Error('Should not reach here');
  }

  try {
    const result = await requestWithRetry<number>('unreliableMethod', {});
    console.log(`✓ Success after retries: ${result}`);
  } catch (error) {
    console.log(`✗ Failed after all retries: ${(error as Error).message}`);
  }
}

/**
 * Example 7: Fallback strategies
 */
async function exampleFallbackStrategies(client: JSONRPCClient): Promise<void> {
  console.log('\n--- Example 7: Fallback Strategies ---');

  // Strategy 1: Default value on error
  async function getConfigWithDefault(key: string, defaultValue: string): Promise<string> {
    try {
      return await client.request<string>('getConfig', { key });
    } catch (error) {
      console.log(`  Using default value for ${key}`);
      return defaultValue;
    }
  }

  const config1 = await getConfigWithDefault('theme', 'dark');
  console.log(`✓ Config 'theme': ${config1}`);

  // Strategy 2: Alternative method on error
  async function getUserData(userId: string): Promise<unknown> {
    try {
      return await client.request('getUserV2', { userId });
    } catch (error) {
      console.log('  Falling back to getUserV1');
      return await client.request('getUserV1', { userId });
    }
  }

  try {
    const userData = await getUserData('123');
    console.log('✓ User data:', userData);
  } catch (error) {
    console.log(`✗ All methods failed: ${(error as Error).message}`);
  }

  // Strategy 3: Cached value on error
  const cache = new Map<string, unknown>();

  async function getWithCache<T>(method: string, params: unknown, cacheKey: string): Promise<T> {
    try {
      const result = await client.request<T>(method, params);
      cache.set(cacheKey, result);
      return result;
    } catch (error) {
      if (cache.has(cacheKey)) {
        console.log(`  Using cached value for ${cacheKey}`);
        return cache.get(cacheKey) as T;
      }
      throw error;
    }
  }

  const data = await getWithCache<string>('getData', { id: '456' }, 'data-456');
  console.log('✓ Data retrieved:', data);
}

/**
 * Main example function
 */
async function main(): Promise<void> {
  const transport = new TCPTransport('localhost', 3000);
  const client = new JSONRPCClient({
    transport,
    requestTimeout: 5000,
    debug: false,
  });

  // Set up event handlers
  client.on('connected', () => console.log('✓ Connected to server'));
  client.on('disconnected', () => console.log('✓ Disconnected from server'));
  client.on('error', (error: Error) => {
    // Global error handler for unhandled errors
    console.error('Unhandled error:', error.message);
  });

  try {
    console.log('Connecting to server...');
    await client.connect();

    // Run all examples
    await exampleTimeout(client);
    await exampleAbort(client);
    await exampleJSONRPCErrors(client);
    await exampleGracefulRecovery(client);
    await exampleRetryLogic(client);
    await exampleFallbackStrategies(client);

    // Note: exampleTransportErrors is skipped because it disconnects the client
  } catch (error) {
    if (error instanceof JSONRPCError) {
      console.error('JSON-RPC Error:');
      console.error('  Code:', error.code);
      console.error('  Message:', error.message);
      if (error.data) {
        console.error('  Data:', error.data);
      }
    } else if (error instanceof Error) {
      console.error('Error:', error.message);
      console.error('Stack:', error.stack);
    } else {
      console.error('Unknown error:', error);
    }
  } finally {
    if (client.isConnected()) {
      console.log('\nDisconnecting...');
      await client.disconnect();
    }
    console.log('Example completed');
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export {
  main,
  TCPTransport,
  exampleTimeout,
  exampleAbort,
  exampleJSONRPCErrors,
  exampleTransportErrors,
  exampleGracefulRecovery,
  exampleRetryLogic,
  exampleFallbackStrategies,
};
