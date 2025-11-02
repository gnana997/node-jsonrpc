/**
 * Basic Server Example
 *
 * Demonstrates fundamental JSON-RPC server usage including:
 * - Creating and starting a server
 * - Registering method handlers
 * - Handling requests with typed parameters
 * - Sending responses
 * - Handling client notifications
 * - Graceful shutdown
 */

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { JSONRPCServer } from '../../src/server.js';
import type { Transport, TransportServer } from '../../src/transport.js';

/**
 * TCP Transport implementation for individual connections
 */
class TCPTransport extends EventEmitter implements Transport {
  private buffer = '';
  private connected = true;

  constructor(private socket: net.Socket) {
    super();
    this.setupListeners();
  }

  async connect(): Promise<void> {
    // Already connected when created from server
  }

  async disconnect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }
    this.connected = false;
  }

  send(message: string): void {
    if (!this.connected || this.socket.destroyed) {
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
    return this.connected && !this.socket.destroyed;
  }

  private setupListeners(): void {
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
 * TCP Transport Server implementation
 */
class TCPTransportServer extends EventEmitter implements TransportServer {
  private server?: net.Server;

  constructor(private port: number) {
    super();
  }

  isListening(): boolean {
    return !!this.server && this.server.listening;
  }

  getPort(): number {
    return this.port;
  }

  getAddress(): { address: string; port: number | null } | null {
    if (!this.server) return null;
    const addr = this.server.address();
    if (!addr) return null;
    if (typeof addr === 'string') {
      return { address: addr, port: null };
    }
    return { address: addr.address, port: addr.port };
  }

  async listen(): Promise<void> {
    return new Promise((resolve, _reject) => {
      this.server = net.createServer((socket) => {
        const transport = new TCPTransport(socket);
        this.emit('connection', transport);
      });

      this.server.on('error', (error: Error) => {
        this.emit('error', error);
      });

      this.server.listen(this.port, () => {
        console.log(`✓ Server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  address() {
    return this.server?.address();
  }
}

/**
 * Example request parameter types
 */
interface AddParams {
  a: number;
  b: number;
}

interface SubtractParams {
  minuend: number;
  subtrahend: number;
}

interface MultiplyParams {
  a: number;
  b: number;
}

interface DivideParams {
  a: number;
  b: number;
}

interface GreetParams {
  name: string;
}

/**
 * Main example function
 */
async function main(): Promise<void> {
  // Create transport server
  const transportServer = new TCPTransportServer(3000);

  // Create JSON-RPC server
  const server = new JSONRPCServer({
    transportServer,
    debug: true,
  });

  // Handle server events
  server.on('error', (error: Error) => {
    console.error('✗ Server error:', error.message);
  });

  server.on('notification', (method: string, params: unknown, _transport: Transport) => {
    console.log(`← Client notification: ${method}`, params);
  });

  // Example 1: Simple arithmetic method
  server.registerMethod('add', async (params: AddParams) => {
    console.log(`Handling add: ${params.a} + ${params.b}`);
    return params.a + params.b;
  });

  // Example 2: Another arithmetic method
  server.registerMethod('subtract', async (params: SubtractParams) => {
    console.log(`Handling subtract: ${params.minuend} - ${params.subtrahend}`);
    return params.minuend - params.subtrahend;
  });

  // Example 3: Multiplication
  server.registerMethod('multiply', async (params: MultiplyParams) => {
    console.log(`Handling multiply: ${params.a} * ${params.b}`);
    return params.a * params.b;
  });

  // Example 4: Division with error handling
  server.registerMethod('divide', async (params: DivideParams) => {
    console.log(`Handling divide: ${params.a} / ${params.b}`);

    if (params.b === 0) {
      throw new Error('Division by zero');
    }

    return params.a / params.b;
  });

  // Example 5: String method
  server.registerMethod('greet', async (params: GreetParams) => {
    console.log(`Handling greet: ${params.name}`);
    return {
      message: `Hello, ${params.name}!`,
      timestamp: new Date().toISOString(),
    };
  });

  // Example 6: Method without parameters
  server.registerMethod('getStatus', async () => {
    console.log('Handling getStatus');
    return {
      uptime: process.uptime(),
      version: '1.0.0',
      connections: server.getConnectionCount(),
      methods: server.getMethods(),
    };
  });

  // Example 7: Method with context (accessing transport)
  server.registerMethod('echo', async (params: any, context) => {
    console.log('Handling echo:', params);

    // Send a notification back to the client that made the request
    if (context?.transport) {
      server.notify(context.transport, 'echoNotification', {
        message: 'Echo notification',
        receivedParams: params,
      });
    }

    return { echoed: params };
  });

  // Example 8: Async method with delay
  server.registerMethod('slowOperation', async (params: { delay: number }) => {
    console.log(`Handling slowOperation: waiting ${params.delay}ms`);
    await new Promise((resolve) => setTimeout(resolve, params.delay));
    return { completed: true, waited: params.delay };
  });

  // Display registered methods
  console.log('\nRegistered methods:');
  for (const method of server.getMethods()) {
    console.log(`  - ${method}`);
  }

  // Start the server
  console.log('\nStarting server...');
  await server.listen();

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('\n\nShutting down server...');
    await server.close({ closeConnections: true });
    console.log('✓ Server closed');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('\nServer is ready to accept connections');
  console.log('Press Ctrl+C to stop\n');
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main, TCPTransportServer, TCPTransport };
