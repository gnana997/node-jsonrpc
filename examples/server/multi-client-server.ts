/**
 * Multi-Client Server Example
 *
 * Demonstrates handling multiple simultaneous clients including:
 * - Connection tracking and management
 * - Client identification and metadata
 * - Broadcasting to all clients
 * - Targeted notifications to specific clients
 * - Client-to-client messaging (relay)
 * - Connection lifecycle events
 * - Resource cleanup on disconnect
 */

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { JSONRPCServer } from '../../src/server.js';
import type { Transport, TransportServer } from '../../src/transport.js';
import type { RequestContext } from '../../src/types.js';

/**
 * TCP Transport implementation with client identification
 */
class TCPTransport extends EventEmitter implements Transport {
  private buffer = '';
  private connected = true;

  // Public property for client identification
  public clientId?: string;
  public metadata?: ClientMetadata;

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

  getRemoteAddress(): string {
    return `${this.socket.remoteAddress}:${this.socket.remotePort}`;
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
 * Client metadata
 */
interface ClientMetadata {
  id: string;
  name?: string;
  connectedAt: Date;
  lastActivity: Date;
  requestCount: number;
  address: string;
}

/**
 * Client manager for tracking connected clients
 */
class ClientManager {
  private clients = new Map<Transport, ClientMetadata>();
  private clientsByName = new Map<string, Transport>();
  private nextClientId = 1;

  register(transport: TCPTransport): ClientMetadata {
    const metadata: ClientMetadata = {
      id: `client-${this.nextClientId++}`,
      connectedAt: new Date(),
      lastActivity: new Date(),
      requestCount: 0,
      address: transport.getRemoteAddress(),
    };

    this.clients.set(transport, metadata);
    transport.clientId = metadata.id;
    transport.metadata = metadata;

    console.log(`✓ Client registered: ${metadata.id} from ${metadata.address}`);

    // Clean up on disconnect
    transport.once('close', () => {
      this.unregister(transport);
    });

    return metadata;
  }

  unregister(transport: Transport): void {
    const metadata = this.clients.get(transport);
    if (metadata) {
      if (metadata.name) {
        this.clientsByName.delete(metadata.name);
      }
      this.clients.delete(transport);
      console.log(`✓ Client unregistered: ${metadata.id}`);
    }
  }

  setClientName(transport: Transport, name: string): void {
    const metadata = this.clients.get(transport);
    if (metadata) {
      // Remove old name mapping
      if (metadata.name) {
        this.clientsByName.delete(metadata.name);
      }

      metadata.name = name;
      this.clientsByName.set(name, transport);
      console.log(`✓ Client ${metadata.id} named: ${name}`);
    }
  }

  getClientByName(name: string): Transport | undefined {
    return this.clientsByName.get(name);
  }

  getMetadata(transport: Transport): ClientMetadata | undefined {
    return this.clients.get(transport);
  }

  getAllClients(): Array<{ transport: Transport; metadata: ClientMetadata }> {
    return Array.from(this.clients.entries()).map(([transport, metadata]) => ({
      transport,
      metadata,
    }));
  }

  getClientCount(): number {
    return this.clients.size;
  }

  updateActivity(transport: Transport): void {
    const metadata = this.clients.get(transport);
    if (metadata) {
      metadata.lastActivity = new Date();
      metadata.requestCount++;
    }
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
    onConnection: (transport: Transport) => {
      const metadata = clientManager.register(transport as TCPTransport);

      // Send welcome notification
      server.notify(transport, 'welcome', {
        clientId: metadata.id,
        serverVersion: '1.0.0',
        timestamp: new Date().toISOString(),
      });
    },
    onDisconnection: (transport: Transport) => {
      const metadata = clientManager.getMetadata(transport);
      if (metadata) {
        console.log(`Client ${metadata.id} disconnected after ${metadata.requestCount} requests`);
      }
    },
  });

  const clientManager = new ClientManager();

  server.on('error', (error: Error) => {
    console.error('✗ Server error:', error.message);
  });

  // Example 1: Register client with a name
  server.registerMethod('register', async (params: { name: string }, context?: RequestContext) => {
    if (!context?.transport) {
      throw new Error('No transport in context');
    }

    clientManager.setClientName(context.transport, params.name);
    const metadata = clientManager.getMetadata(context.transport);

    return {
      success: true,
      clientId: metadata?.id,
      name: params.name,
    };
  });

  // Example 2: Get list of all connected clients
  server.registerMethod('listClients', async () => {
    const clients = clientManager.getAllClients().map(({ metadata }) => ({
      id: metadata.id,
      name: metadata.name,
      connectedAt: metadata.connectedAt.toISOString(),
      requestCount: metadata.requestCount,
      address: metadata.address,
    }));

    return {
      count: clients.length,
      clients,
    };
  });

  // Example 3: Send message to specific client by name
  server.registerMethod(
    'sendTo',
    async (params: { recipient: string; message: string }, context?: RequestContext) => {
      const recipientTransport = clientManager.getClientByName(params.recipient);

      if (!recipientTransport) {
        throw new Error(`Client "${params.recipient}" not found`);
      }

      const senderMetadata = context?.transport
        ? clientManager.getMetadata(context.transport)
        : undefined;

      server.notify(recipientTransport, 'directMessage', {
        from: senderMetadata?.name || senderMetadata?.id || 'unknown',
        message: params.message,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        recipient: params.recipient,
        delivered: true,
      };
    }
  );

  // Example 4: Broadcast message to all other clients
  server.registerMethod(
    'broadcast',
    async (params: { message: string }, context?: RequestContext) => {
      const senderMetadata = context?.transport
        ? clientManager.getMetadata(context.transport)
        : undefined;

      const clients = clientManager.getAllClients();
      let count = 0;

      for (const { transport } of clients) {
        // Don't send to sender
        if (transport !== context?.transport) {
          server.notify(transport, 'broadcast', {
            from: senderMetadata?.name || senderMetadata?.id || 'unknown',
            message: params.message,
            timestamp: new Date().toISOString(),
          });
          count++;
        }
      }

      return {
        success: true,
        recipientCount: count,
      };
    }
  );

  // Example 5: Get own client info
  server.registerMethod('whoami', async (_params: unknown, context?: RequestContext) => {
    if (!context?.transport) {
      throw new Error('No transport in context');
    }

    const metadata = clientManager.getMetadata(context.transport);
    if (!metadata) {
      throw new Error('Client not registered');
    }

    return {
      id: metadata.id,
      name: metadata.name,
      connectedAt: metadata.connectedAt.toISOString(),
      requestCount: metadata.requestCount,
      address: metadata.address,
    };
  });

  // Example 6: Ping (updates activity)
  server.registerMethod('ping', async (_params: unknown, context?: RequestContext) => {
    if (context?.transport) {
      clientManager.updateActivity(context.transport);
    }
    return { pong: true, timestamp: Date.now() };
  });

  // Example 7: Server statistics
  server.registerMethod('stats', async () => {
    const clients = clientManager.getAllClients();
    const totalRequests = clients.reduce((sum, { metadata }) => sum + metadata.requestCount, 0);

    return {
      uptime: process.uptime(),
      connectedClients: server.getConnectionCount(),
      totalRequests,
      methods: server.getMethods(),
    };
  });

  console.log('\nRegistered methods:');
  for (const method of server.getMethods()) {
    console.log(`  - ${method}`);
  }

  console.log('\nStarting server...');
  await server.listen();

  // Periodic status broadcast
  const statusInterval = setInterval(() => {
    const count = server.broadcast('serverStatus', {
      uptime: process.uptime(),
      connectedClients: server.getConnectionCount(),
      timestamp: new Date().toISOString(),
    });

    if (count > 0) {
      console.log(`→ Sent status update to ${count} client(s)`);
    }
  }, 30000); // Every 30 seconds

  // Periodic client activity check
  const activityInterval = setInterval(() => {
    const clients = clientManager.getAllClients();
    const now = Date.now();

    for (const { transport, metadata } of clients) {
      const inactiveSec = Math.floor((now - metadata.lastActivity.getTime()) / 1000);

      if (inactiveSec > 120) {
        // 2 minutes
        console.log(`⚠ Client ${metadata.id} inactive for ${inactiveSec}s`);
        server.notify(transport, 'inactivityWarning', {
          inactiveSec,
          message: 'You have been inactive for a while',
        });
      }
    }
  }, 60000); // Every minute

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n\nShutting down server...');
    clearInterval(statusInterval);
    clearInterval(activityInterval);

    // Notify all clients about shutdown
    server.broadcast('serverShutdown', {
      message: 'Server is shutting down',
      timestamp: new Date().toISOString(),
    });

    await new Promise((resolve) => setTimeout(resolve, 500)); // Give time for notifications
    await server.close({ closeConnections: true });
    console.log('✓ Server closed');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('\nServer is ready to accept connections');
  console.log('Status broadcasts every 30 seconds');
  console.log('Activity checks every minute');
  console.log('Press Ctrl+C to stop\n');
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main, TCPTransportServer, TCPTransport, ClientManager, type ClientMetadata };
