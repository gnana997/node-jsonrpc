/**
 * Notification Server Example
 *
 * Demonstrates server-initiated notifications including:
 * - Broadcasting to all clients
 * - Sending notifications to specific clients
 * - Periodic status updates
 * - Event-driven notifications
 * - Progress notifications for long-running operations
 */

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { JSONRPCServer } from '../../src/server.js';
import type { Transport, TransportServer } from '../../src/transport.js';
import type { RequestContext } from '../../src/types.js';

/**
 * TCP Transport implementation
 */
class TCPTransport extends EventEmitter implements Transport {
  private buffer = '';
  private connected = true;

  constructor(private socket: net.Socket) {
    super();
    this.setupListeners();
  }

  async connect(): Promise<void> {}

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
    return new Promise((resolve) => {
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
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

/**
 * Subscription manager for pub/sub pattern
 */
class SubscriptionManager {
  private subscriptions = new Map<string, Set<Transport>>();

  subscribe(topic: string, transport: Transport): void {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }
    this.subscriptions.get(topic)!.add(transport);
    console.log(`✓ Client subscribed to topic: ${topic}`);
  }

  unsubscribe(topic: string, transport: Transport): boolean {
    const subscribers = this.subscriptions.get(topic);
    if (!subscribers) return false;

    const removed = subscribers.delete(transport);
    if (removed) {
      console.log(`✓ Client unsubscribed from topic: ${topic}`);
      if (subscribers.size === 0) {
        this.subscriptions.delete(topic);
      }
    }
    return removed;
  }

  unsubscribeAll(transport: Transport): void {
    for (const [topic, subscribers] of this.subscriptions.entries()) {
      if (subscribers.delete(transport)) {
        console.log(`✓ Client unsubscribed from topic: ${topic}`);
      }
      if (subscribers.size === 0) {
        this.subscriptions.delete(topic);
      }
    }
  }

  getSubscribers(topic: string): Transport[] {
    return Array.from(this.subscriptions.get(topic) || []);
  }

  getTopics(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  getSubscriberCount(topic: string): number {
    return this.subscriptions.get(topic)?.size || 0;
  }
}

/**
 * Main example function
 */
async function main(): Promise<void> {
  const transportServer = new TCPTransportServer(3000);
  const server = new JSONRPCServer({
    transportServer,
    debug: true,
  });

  const subscriptions = new SubscriptionManager();

  // Track connected transports for cleanup
  const connectedTransports = new Set<Transport>();

  // Handle new connections
  server.on('error', (error: Error) => {
    console.error('✗ Server error:', error.message);
  });

  // Example 1: Broadcast method - sends to ALL connected clients
  server.registerMethod('broadcastTest', async () => {
    const count = server.broadcast('testNotification', {
      message: 'This is a broadcast to all clients',
      timestamp: Date.now(),
    });
    return { sent: count, message: 'Broadcast sent' };
  });

  // Example 2: Subscribe to topic (pub/sub pattern)
  server.registerMethod(
    'subscribe',
    async (params: { topic: string }, context?: RequestContext) => {
      if (!context?.transport) {
        throw new Error('No transport in context');
      }

      subscriptions.subscribe(params.topic, context.transport);
      connectedTransports.add(context.transport);

      // Clean up when client disconnects
      context.transport.once('close', () => {
        subscriptions.unsubscribeAll(context.transport);
        connectedTransports.delete(context.transport);
      });

      return { success: true, topic: params.topic };
    }
  );

  // Example 3: Unsubscribe from topic
  server.registerMethod(
    'unsubscribe',
    async (params: { topic: string }, context?: RequestContext) => {
      if (!context?.transport) {
        throw new Error('No transport in context');
      }

      const success = subscriptions.unsubscribe(params.topic, context.transport);
      return { success, topic: params.topic };
    }
  );

  // Example 4: Publish to topic
  server.registerMethod('publish', async (params: { topic: string; data: any }) => {
    const subscribers = subscriptions.getSubscribers(params.topic);

    for (const transport of subscribers) {
      if (transport.isConnected()) {
        server.notify(transport, 'topicUpdate', {
          topic: params.topic,
          data: params.data,
          timestamp: Date.now(),
        });
      }
    }

    return {
      success: true,
      topic: params.topic,
      subscriberCount: subscribers.length,
    };
  });

  // Example 5: Long-running operation with progress notifications
  server.registerMethod(
    'processWithProgress',
    async (params: { items: number }, context?: RequestContext) => {
      const totalItems = params.items || 10;

      for (let i = 1; i <= totalItems; i++) {
        // Simulate work
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Send progress notification
        if (context?.transport) {
          server.notify(context.transport, 'progress', {
            current: i,
            total: totalItems,
            percentage: Math.round((i / totalItems) * 100),
          });
        }
      }

      return { success: true, itemsProcessed: totalItems };
    }
  );

  // Example 6: Get subscription info
  server.registerMethod('getSubscriptions', async () => {
    const topics = subscriptions.getTopics();
    const topicInfo = topics.map((topic) => ({
      topic,
      subscribers: subscriptions.getSubscriberCount(topic),
    }));

    return {
      topics: topicInfo,
      totalTopics: topics.length,
    };
  });

  // Example 7: Send targeted notification
  server.registerMethod(
    'notifyMe',
    async (params: { message: string }, context?: RequestContext) => {
      if (!context?.transport) {
        throw new Error('No transport in context');
      }

      server.notify(context.transport, 'personalMessage', {
        message: `You said: ${params.message}`,
        timestamp: Date.now(),
      });

      return { success: true };
    }
  );

  console.log('\nRegistered methods:');
  for (const method of server.getMethods()) {
    console.log(`  - ${method}`);
  }

  // Start the server
  console.log('\nStarting server...');
  await server.listen();

  // Example: Periodic heartbeat broadcast
  const heartbeatInterval = setInterval(() => {
    const count = server.broadcast('heartbeat', {
      uptime: process.uptime(),
      connections: server.getConnectionCount(),
      timestamp: Date.now(),
    });

    if (count > 0) {
      console.log(`→ Sent heartbeat to ${count} client(s)`);
    }
  }, 10000); // Every 10 seconds

  // Example: Periodic topic updates
  const topicUpdateInterval = setInterval(() => {
    const topics = subscriptions.getTopics();

    for (const topic of topics) {
      const subscribers = subscriptions.getSubscribers(topic);

      for (const transport of subscribers) {
        if (transport.isConnected()) {
          server.notify(transport, 'topicUpdate', {
            topic,
            data: {
              type: 'periodic',
              message: `Periodic update for ${topic}`,
              value: Math.random(),
            },
            timestamp: Date.now(),
          });
        }
      }
    }

    if (topics.length > 0) {
      console.log(`→ Sent periodic updates to ${topics.length} topic(s)`);
    }
  }, 5000); // Every 5 seconds

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n\nShutting down server...');
    clearInterval(heartbeatInterval);
    clearInterval(topicUpdateInterval);
    await server.close({ closeConnections: true });
    console.log('✓ Server closed');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('\nServer is ready to accept connections');
  console.log('Heartbeat broadcasts every 10 seconds');
  console.log('Topic updates every 5 seconds');
  console.log('Press Ctrl+C to stop\n');
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main, TCPTransportServer, TCPTransport, SubscriptionManager };
