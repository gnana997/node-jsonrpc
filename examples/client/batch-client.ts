/**
 * Batch Request Example
 *
 * Demonstrates JSON-RPC batch request capabilities including:
 * - Parallel batch execution (all requests sent at once)
 * - Sequential batch execution (requests sent one after another)
 * - Batch timeout handling
 * - Batch cancellation with AbortSignal
 * - Error handling in batches
 */

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { JSONRPCClient } from '../../src/client.js';
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
 * Main example function
 */
async function main(): Promise<void> {
  const transport = new TCPTransport('localhost', 3000);
  const client = new JSONRPCClient({
    transport,
    requestTimeout: 10000,
    debug: true,
  });

  client.on('connected', () => console.log('✓ Connected to server'));
  client.on('error', (error: Error) => console.error('✗ Error:', error.message));

  try {
    await client.connect();

    // Example 1: Parallel batch execution (default)
    console.log('\n--- Example 1: Parallel Batch Execution ---');
    const parallelBatch = client.batch();
    parallelBatch.add('add', { a: 1, b: 2 });
    parallelBatch.add('add', { a: 3, b: 4 });
    parallelBatch.add('add', { a: 5, b: 6 });
    parallelBatch.add('multiply', { a: 2, b: 3 });

    console.log(`→ Sending batch of ${parallelBatch.length} requests (parallel mode)`);
    const startParallel = Date.now();
    const parallelResults = await parallelBatch.execute();
    const parallelDuration = Date.now() - startParallel;

    console.log(`← Results received in ${parallelDuration}ms:`, parallelResults);
    console.log(`  add(1,2) = ${parallelResults[0]}`);
    console.log(`  add(3,4) = ${parallelResults[1]}`);
    console.log(`  add(5,6) = ${parallelResults[2]}`);
    console.log(`  multiply(2,3) = ${parallelResults[3]}`);

    // Example 2: Sequential batch execution
    console.log('\n--- Example 2: Sequential Batch Execution ---');
    const sequentialBatch = client.batch();
    sequentialBatch.add('add', { a: 10, b: 20 });
    sequentialBatch.add('add', { a: 30, b: 40 });
    sequentialBatch.add('add', { a: 50, b: 60 });

    console.log(`→ Sending batch of ${sequentialBatch.length} requests (sequential mode)`);
    const startSequential = Date.now();
    const sequentialResults = await sequentialBatch.execute({ mode: 'sequential' });
    const sequentialDuration = Date.now() - startSequential;

    console.log(`← Results received in ${sequentialDuration}ms:`, sequentialResults);

    // Example 3: Batch with timeout
    console.log('\n--- Example 3: Batch with Timeout ---');
    const timeoutBatch = client.batch();
    timeoutBatch.add('add', { a: 1, b: 1 });
    timeoutBatch.add('add', { a: 2, b: 2 });

    try {
      console.log('→ Sending batch with 2000ms timeout');
      const results = await timeoutBatch.execute({ timeout: 2000 });
      console.log('← Results:', results);
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) {
        console.log('✗ Batch timed out as expected');
      } else {
        throw error;
      }
    }

    // Example 4: Batch with AbortSignal
    console.log('\n--- Example 4: Batch Cancellation with AbortSignal ---');
    const controller = new AbortController();
    const abortBatch = client.batch();
    abortBatch.add('slowOperation', { delay: 5000 });
    abortBatch.add('add', { a: 1, b: 1 });

    // Cancel after 100ms
    setTimeout(() => {
      console.log('→ Aborting batch request...');
      controller.abort();
    }, 100);

    try {
      console.log('→ Sending batch with AbortSignal');
      await abortBatch.execute({ signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.message.includes('aborted')) {
        console.log('✓ Batch cancelled successfully');
      } else {
        throw error;
      }
    }

    // Example 5: Large batch request
    console.log('\n--- Example 5: Large Batch Request ---');
    const largeBatch = client.batch();
    const numRequests = 100;

    for (let i = 0; i < numRequests; i++) {
      largeBatch.add('add', { a: i, b: i + 1 });
    }

    console.log(`→ Sending batch of ${largeBatch.length} requests`);
    const startLarge = Date.now();
    const largeResults = await largeBatch.execute();
    const largeDuration = Date.now() - startLarge;

    console.log(`← ${largeResults.length} results received in ${largeDuration}ms`);
    console.log(`  Average: ${(largeDuration / numRequests).toFixed(2)}ms per request`);
    console.log(`  Sample results: ${largeResults.slice(0, 5).join(', ')}...`);

    // Example 6: Mixed batch with notifications
    console.log('\n--- Example 6: Batch Request Performance Comparison ---');

    // Method 1: Individual requests
    console.log('\nMethod 1: Individual requests');
    const startIndividual = Date.now();
    const individualResults = await Promise.all([
      client.request('add', { a: 1, b: 2 }),
      client.request('add', { a: 3, b: 4 }),
      client.request('add', { a: 5, b: 6 }),
      client.request('add', { a: 7, b: 8 }),
      client.request('add', { a: 9, b: 10 }),
    ]);
    const individualDuration = Date.now() - startIndividual;
    console.log(`  Duration: ${individualDuration}ms`);
    console.log('  Results:', individualResults);

    // Method 2: Batch request
    console.log('\nMethod 2: Batch request');
    const comparisonBatch = client.batch();
    comparisonBatch.add('add', { a: 1, b: 2 });
    comparisonBatch.add('add', { a: 3, b: 4 });
    comparisonBatch.add('add', { a: 5, b: 6 });
    comparisonBatch.add('add', { a: 7, b: 8 });
    comparisonBatch.add('add', { a: 9, b: 10 });

    const startBatch = Date.now();
    const batchResults = await comparisonBatch.execute();
    const batchDuration = Date.now() - startBatch;
    console.log(`  Duration: ${batchDuration}ms`);
    console.log('  Results:', batchResults);

    const improvement = ((individualDuration - batchDuration) / individualDuration) * 100;
    console.log(`\n  Batch was ${improvement.toFixed(1)}% faster than individual requests`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
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
