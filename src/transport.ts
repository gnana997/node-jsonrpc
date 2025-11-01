import type { EventEmitter } from 'node:events';

/**
 * Transport interface for sending and receiving JSON-RPC messages.
 *
 * A Transport represents a single bidirectional connection used by both:
 * - JSONRPCClient: to connect to a server
 * - JSONRPCServer: for each individual client connection
 *
 * ## Responsibilities
 *
 * The Transport is responsible for:
 * - Connection lifecycle management (connect/disconnect)
 * - Message framing and buffering (line-delimited, Content-Length, WebSocket frames, etc.)
 * - Emitting complete message strings (after buffering is complete)
 * - Transport-specific error handling
 *
 * ## NOT Responsible For
 *
 * The Transport should NOT handle:
 * - JSON-RPC protocol parsing (that's the client/server's job)
 * - Request/response matching (that's the client/server's job)
 * - Method routing (that's the server's job)
 * - Timeout management (that's the client's job)
 *
 * ## Events
 *
 * - `message`: Emitted when a complete message is received
 *   - Handler: `(message: string) => void`
 *   - The message is a complete JSON string (after framing/buffering)
 *
 * - `connect`: Emitted when connection is established
 *   - Handler: `() => void`
 *
 * - `disconnect`: Emitted when connection is closed
 *   - Handler: `() => void`
 *
 * - `error`: Emitted on transport-level errors
 *   - Handler: `(error: Error) => void`
 *
 * ## Example Implementation (Line-Delimited)
 *
 * ```typescript
 * import { EventEmitter } from 'node:events';
 * import * as net from 'node:net';
 *
 * class IPCTransport extends EventEmitter implements Transport {
 *   private socket: net.Socket | null = null;
 *   private buffer = ''; // Buffer for line-delimited framing
 *
 *   async connect(): Promise<void> {
 *     this.socket = net.connect('/tmp/app.sock');
 *
 *     this.socket.on('data', (data) => {
 *       // Handle line-delimited buffering
 *       this.buffer += data.toString();
 *       const lines = this.buffer.split('\n');
 *       this.buffer = lines.pop() || '';
 *
 *       // Emit complete messages
 *       lines.forEach(line => {
 *         if (line.trim()) {
 *           this.emit('message', line);
 *         }
 *       });
 *     });
 *
 *     this.socket.on('connect', () => this.emit('connect'));
 *     this.socket.on('close', () => this.emit('disconnect'));
 *     this.socket.on('error', (err) => this.emit('error', err));
 *   }
 *
 *   send(message: string): void {
 *     if (!this.socket) throw new Error('Not connected');
 *     // Add line delimiter
 *     this.socket.write(message + '\n');
 *   }
 *
 *   async disconnect(): Promise<void> {
 *     this.socket?.end();
 *   }
 *
 *   isConnected(): boolean {
 *     return this.socket !== null && !this.socket.destroyed;
 *   }
 * }
 * ```
 */
export interface Transport extends EventEmitter {
  /**
   * Send a message over the transport.
   *
   * The message is a complete JSON string (no framing applied by caller).
   * The transport is responsible for adding any framing (e.g., `\n`, Content-Length header).
   *
   * @param message - Complete JSON string to send
   * @throws Error if not connected or send fails
   */
  send(message: string): void;

  /**
   * Connect to the remote endpoint.
   *
   * Should emit 'connect' event when connection is established.
   *
   * @returns Promise that resolves when connected
   * @throws Error if connection fails
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the remote endpoint.
   *
   * Should emit 'disconnect' event when disconnected.
   * Should clean up resources (sockets, file handles, etc.).
   *
   * @returns Promise that resolves when disconnected
   */
  disconnect(): Promise<void>;

  /**
   * Check if transport is currently connected.
   *
   * @returns true if connected, false otherwise
   */
  isConnected(): boolean;
}

/**
 * TransportServer interface for listening and accepting connections.
 *
 * Used only by JSONRPCServer to listen for incoming connections.
 * Each accepted connection is represented as a Transport.
 *
 * ## Responsibilities
 *
 * The TransportServer is responsible for:
 * - Listening on an address/port/socket
 * - Accepting new connections
 * - Creating Transport instances for each connection
 * - Server lifecycle management
 *
 * ## NOT Responsible For
 *
 * The TransportServer should NOT handle:
 * - JSON-RPC protocol handling (that's the server's job)
 * - Request routing (that's the server's job)
 * - Message parsing (that's the Transport + Server's job)
 *
 * ## Events
 *
 * - `connection`: Emitted when a new client connects
 *   - Handler: `(transport: Transport) => void`
 *   - The transport is ready to send/receive messages
 *
 * - `error`: Emitted on server-level errors
 *   - Handler: `(error: Error) => void`
 *
 * - `close`: Emitted when server stops listening
 *   - Handler: `() => void`
 *
 * ## Example Implementation
 *
 * ```typescript
 * import { EventEmitter } from 'node:events';
 * import * as net from 'node:net';
 *
 * class IPCTransportServer extends EventEmitter implements TransportServer {
 *   private server: net.Server | null = null;
 *
 *   async listen(): Promise<void> {
 *     this.server = net.createServer((socket) => {
 *       // Create a Transport for this connection
 *       const transport = new IPCTransport(socket);
 *       this.emit('connection', transport);
 *     });
 *
 *     return new Promise((resolve, reject) => {
 *       this.server!.listen('/tmp/app.sock', () => {
 *         resolve();
 *       });
 *       this.server!.on('error', reject);
 *     });
 *   }
 *
 *   async close(): Promise<void> {
 *     return new Promise((resolve) => {
 *       this.server?.close(() => {
 *         this.emit('close');
 *         resolve();
 *       });
 *     });
 *   }
 *
 *   isListening(): boolean {
 *     return this.server?.listening ?? false;
 *   }
 * }
 * ```
 */
export interface TransportServer extends EventEmitter {
  /**
   * Start listening for connections.
   *
   * Should emit 'connection' event for each new client connection.
   *
   * @returns Promise that resolves when listening
   * @throws Error if listen fails
   */
  listen(): Promise<void>;

  /**
   * Stop listening for new connections.
   *
   * Should emit 'close' event when closed.
   * Should clean up resources (sockets, file handles, etc.).
   *
   * Note: This does NOT necessarily close active client connections.
   * The server implementation decides whether to close existing connections.
   *
   * @returns Promise that resolves when closed
   */
  close(): Promise<void>;

  /**
   * Check if server is currently listening.
   *
   * @returns true if listening, false otherwise
   */
  isListening(): boolean;
}
