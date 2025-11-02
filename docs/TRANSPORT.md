# Transport Guide

This guide explains how to implement custom transports for `@gnana997/node-jsonrpc` and provides best practices for transport development.

## Table of Contents

- [Overview](#overview)
- [Transport Interface](#transport-interface)
- [TransportServer Interface](#transportserver-interface)
- [Message Framing](#message-framing)
- [Implementing a Custom Transport](#implementing-a-custom-transport)
- [Testing Transports](#testing-transports)
- [Example Implementations](#example-implementations)

---

## Overview

Transports in `@gnana997/node-jsonrpc` are responsible for:

1. **Sending messages** - Transmitting JSON-RPC messages to the other party
2. **Receiving messages** - Listening for and emitting incoming messages
3. **Connection management** - Handling connect/disconnect lifecycle
4. **Error handling** - Reporting transport-level errors

The library is transport-agnostic, meaning you can implement any underlying communication mechanism (TCP, WebSocket, IPC, HTTP, etc.) as long as it conforms to the transport interfaces.

---

## Transport Interface

The `Transport` interface represents a single bidirectional communication channel (client-to-server or server-to-client connection).

### Interface Definition

```typescript
interface Transport extends EventEmitter {
  // Send a message
  send(message: string): void;

  // Connect to the other party
  connect(): Promise<void>;

  // Disconnect from the other party
  disconnect(): Promise<void>;

  // Check connection status
  isConnected(): boolean;

  // Event listeners
  on(event: 'message', handler: (message: string) => void): this;
  on(event: 'error', handler: (error: Error) => void): this;
  on(event: 'disconnect', handler: () => void): this;
}
```

### Method Requirements

#### send(message: string): void

Sends a message to the other party.

**Requirements:**
- MUST send the message synchronously or queue it for async delivery
- MUST NOT throw errors - report them via the `'error'` event instead
- MUST handle the case where the connection is not yet established or has been closed
- SHOULD buffer messages if the underlying connection is not ready

**Example:**

```typescript
send(message: string): void {
  if (!this.isConnected()) {
    this.emit('error', new Error('Cannot send - not connected'));
    return;
  }

  try {
    this.socket.write(message + '\n');
  } catch (error) {
    this.emit('error', error);
  }
}
```

---

#### connect(): Promise<void>

Establishes the connection.

**Requirements:**
- MUST resolve only when the connection is fully established and ready to send/receive
- MUST reject if connection fails
- MUST emit `'message'` events for incoming messages once connected
- SHOULD handle reconnection logic internally if desired
- MUST NOT be called multiple times (check `isConnected()` first)

**Example:**

```typescript
async connect(): Promise<void> {
  if (this.connected) {
    throw new Error('Already connected');
  }

  return new Promise((resolve, reject) => {
    this.socket = net.connect(this.port, this.host);

    this.socket.on('connect', () => {
      this.connected = true;
      resolve();
    });

    this.socket.on('error', (error) => {
      reject(error);
    });

    this.socket.on('data', (data) => {
      this.handleData(data);
    });
  });
}
```

---

#### disconnect(): Promise<void>

Closes the connection.

**Requirements:**
- MUST close the underlying connection
- MUST emit a `'disconnect'` event after closing
- MUST clean up all resources (sockets, timers, etc.)
- SHOULD resolve only after the connection is fully closed
- MUST be idempotent (safe to call multiple times)

**Example:**

```typescript
async disconnect(): Promise<void> {
  if (!this.connected) {
    return;
  }

  return new Promise((resolve) => {
    this.socket.once('close', () => {
      this.connected = false;
      this.emit('disconnect');
      resolve();
    });

    this.socket.end();
  });
}
```

---

#### isConnected(): boolean

Returns the current connection status.

**Requirements:**
- MUST return `true` only when the connection is established and ready
- MUST return `false` if not connected or in the process of connecting/disconnecting

**Example:**

```typescript
isConnected(): boolean {
  return this.connected && !this.socket.destroyed;
}
```

---

### Event Requirements

#### 'message' Event

Emitted when a complete message is received.

**Requirements:**
- MUST emit one event per complete JSON-RPC message
- MUST pass the message as a string
- MUST handle message framing (see [Message Framing](#message-framing))

**Example:**

```typescript
this.emit('message', '{"jsonrpc":"2.0","method":"test","id":1}');
```

---

#### 'error' Event

Emitted when a transport-level error occurs.

**Requirements:**
- MUST emit for send errors, receive errors, protocol errors, etc.
- SHOULD NOT emit for JSON-RPC protocol errors (those are handled at a higher level)
- MUST pass an `Error` object

**Example:**

```typescript
this.emit('error', new Error('Connection lost'));
```

---

#### 'disconnect' Event

Emitted when the connection is closed.

**Requirements:**
- MUST emit when the connection closes (gracefully or due to error)
- MUST emit regardless of whether `disconnect()` was called or the connection dropped
- SHOULD NOT pass any arguments

**Example:**

```typescript
this.emit('disconnect');
```

---

## TransportServer Interface

The `TransportServer` interface represents a server that accepts incoming connections and creates `Transport` instances for each client.

### Interface Definition

```typescript
interface TransportServer extends EventEmitter {
  // Start listening for connections
  listen(): Promise<void>;

  // Stop listening and close all connections
  close(): Promise<void>;

  // Event listeners
  on(event: 'connection', handler: (transport: Transport) => void): this;
}
```

### Method Requirements

#### listen(): Promise<void>

Starts listening for incoming connections.

**Requirements:**
- MUST begin accepting connections
- MUST resolve when the server is ready to accept connections
- MUST reject if the server cannot start
- MUST NOT be called multiple times

**Example:**

```typescript
async listen(): Promise<void> {
  return new Promise((resolve, reject) => {
    this.server = net.createServer((socket) => {
      const transport = new MyTransport(socket);
      this.emit('connection', transport);
    });

    this.server.listen(this.port, () => {
      resolve();
    });

    this.server.on('error', (error) => {
      reject(error);
    });
  });
}
```

---

#### close(): Promise<void>

Stops the server and closes all connections.

**Requirements:**
- MUST stop accepting new connections
- SHOULD close all existing client connections (or let them finish gracefully)
- MUST clean up all resources
- MUST be idempotent

**Example:**

```typescript
async close(): Promise<void> {
  if (!this.server) {
    return;
  }

  return new Promise((resolve) => {
    this.server.close(() => {
      resolve();
    });
  });
}
```

---

### Event Requirements

#### 'connection' Event

Emitted when a new client connects.

**Requirements:**
- MUST emit for each new client connection
- MUST pass a fully constructed and connected `Transport` instance
- The `Transport` MUST already have its `connect()` called (be ready to use)

**Example:**

```typescript
this.server.on('connection', (socket) => {
  const transport = new TCPTransport(socket);
  // Transport is already connected since we have the socket
  this.emit('connection', transport);
});
```

---

## Message Framing

JSON-RPC messages must be clearly delimited so the receiver knows where one message ends and the next begins. The standard approach in `@gnana997/node-jsonrpc` is **line-delimited JSON**.

### Line-Delimited JSON

Each JSON-RPC message is a single line terminated with `\n` (newline character).

**Example:**

```
{"jsonrpc":"2.0","method":"test","id":1}\n
{"jsonrpc":"2.0","result":"ok","id":1}\n
```

### Implementing Line-Delimited Framing

#### Sending

Simply append `\n` to each message:

```typescript
send(message: string): void {
  this.socket.write(message + '\n');
}
```

#### Receiving

Buffer incoming data and emit messages when complete lines are received:

```typescript
class MyTransport extends EventEmitter implements Transport {
  private buffer = '';

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
```

### Alternative Framing Methods

While line-delimited is the recommended approach, you can implement other framing methods:

1. **Length-prefixed**: Prefix each message with its byte length
2. **Delimiter-based**: Use a special delimiter (e.g., `\0`, `\r\n\r\n`)
3. **Message Boundaries**: Use a protocol-level framing (e.g., HTTP chunked encoding)

**Important:** Whatever framing method you choose must ensure one `'message'` event is emitted per complete JSON-RPC message.

---

## Implementing a Custom Transport

Let's implement a simple TCP transport from scratch.

### Step 1: Define the Class

```typescript
import { EventEmitter } from 'events';
import * as net from 'net';
import type { Transport } from '@gnana997/node-jsonrpc';

export class TCPTransport extends EventEmitter implements Transport {
  private socket: net.Socket;
  private buffer = '';
  private connected = false;

  constructor(
    private host: string,
    private port: number
  ) {
    super();
  }

  // ... methods below
}
```

### Step 2: Implement connect()

```typescript
async connect(): Promise<void> {
  if (this.connected) {
    throw new Error('Already connected');
  }

  return new Promise((resolve, reject) => {
    this.socket = net.connect(this.port, this.host);

    this.socket.on('connect', () => {
      this.connected = true;
      this.setupListeners();
      resolve();
    });

    this.socket.once('error', (error) => {
      reject(error);
    });
  });
}
```

### Step 3: Setup Event Listeners

```typescript
private setupListeners(): void {
  this.socket.on('data', (data: Buffer) => {
    this.handleData(data);
  });

  this.socket.on('error', (error: Error) => {
    this.emit('error', error);
  });

  this.socket.on('close', () => {
    this.connected = false;
    this.emit('disconnect');
  });
}
```

### Step 4: Implement Message Framing

```typescript
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
```

### Step 5: Implement send()

```typescript
send(message: string): void {
  if (!this.connected) {
    this.emit('error', new Error('Cannot send - not connected'));
    return;
  }

  try {
    this.socket.write(message + '\n');
  } catch (error) {
    this.emit('error', error as Error);
  }
}
```

### Step 6: Implement disconnect()

```typescript
async disconnect(): Promise<void> {
  if (!this.connected) {
    return;
  }

  return new Promise((resolve) => {
    this.socket.once('close', () => {
      this.connected = false;
      this.emit('disconnect');
      resolve();
    });

    this.socket.end();
  });
}
```

### Step 7: Implement isConnected()

```typescript
isConnected(): boolean {
  return this.connected && !this.socket.destroyed;
}
```

### Complete Example

```typescript
import { EventEmitter } from 'events';
import * as net from 'net';
import type { Transport } from '@gnana997/node-jsonrpc';

export class TCPTransport extends EventEmitter implements Transport {
  private socket!: net.Socket;
  private buffer = '';
  private connected = false;

  constructor(
    private host: string,
    private port: number
  ) {
    super();
  }

  async connect(): Promise<void> {
    if (this.connected) {
      throw new Error('Already connected');
    }

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

  private setupListeners(): void {
    this.socket.on('data', (data) => this.handleData(data));
    this.socket.on('error', (error) => this.emit('error', error));
    this.socket.on('close', () => {
      this.connected = false;
      this.emit('disconnect');
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

  send(message: string): void {
    if (!this.connected) {
      this.emit('error', new Error('Cannot send - not connected'));
      return;
    }

    try {
      this.socket.write(message + '\n');
    } catch (error) {
      this.emit('error', error as Error);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    return new Promise((resolve) => {
      this.socket.once('close', () => {
        this.connected = false;
        this.emit('disconnect');
        resolve();
      });

      this.socket.end();
    });
  }

  isConnected(): boolean {
    return this.connected && !this.socket.destroyed;
  }
}
```

---

## Testing Transports

### Unit Testing

Test each method in isolation:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { TCPTransport } from './TCPTransport';

describe('TCPTransport', () => {
  let transport: TCPTransport;

  beforeEach(() => {
    transport = new TCPTransport('localhost', 9000);
  });

  it('should start disconnected', () => {
    expect(transport.isConnected()).toBe(false);
  });

  it('should emit message events', async () => {
    const messages: string[] = [];

    transport.on('message', (msg) => {
      messages.push(msg);
    });

    await transport.connect();

    // Simulate receiving data
    // ... test logic ...

    expect(messages).toHaveLength(1);
  });

  it('should handle line-delimited messages', () => {
    const messages: string[] = [];

    transport.on('message', (msg) => {
      messages.push(msg);
    });

    // Test framing logic
    transport['handleData'](Buffer.from('{"test":1}\n{"test":2}\n'));

    expect(messages).toEqual(['{"test":1}', '{"test":2}']);
  });
});
```

### Integration Testing

Test with a real server:

```typescript
it('should connect to server and exchange messages', async () => {
  // Start a test server
  const server = net.createServer();
  await new Promise((resolve) => server.listen(9000, resolve));

  const transport = new TCPTransport('localhost', 9000);
  await transport.connect();

  // Test sending/receiving
  transport.send('{"jsonrpc":"2.0","method":"test","id":1}');

  await transport.disconnect();
  await new Promise((resolve) => server.close(resolve));
});
```

---

## Example Implementations

### WebSocket Transport

```typescript
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type { Transport } from '@gnana997/node-jsonrpc';

export class WebSocketTransport extends EventEmitter implements Transport {
  private ws?: WebSocket;
  private connected = false;

  constructor(private url: string) {
    super();
  }

  async connect(): Promise<void> {
    if (this.connected) {
      throw new Error('Already connected');
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        this.connected = true;
        this.setupListeners();
        resolve();
      });

      this.ws.once('error', reject);
    });
  }

  private setupListeners(): void {
    this.ws!.on('message', (data: Buffer) => {
      this.emit('message', data.toString());
    });

    this.ws!.on('error', (error) => {
      this.emit('error', error);
    });

    this.ws!.on('close', () => {
      this.connected = false;
      this.emit('disconnect');
    });
  }

  send(message: string): void {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) {
      this.emit('error', new Error('WebSocket not ready'));
      return;
    }

    this.ws.send(message);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    return new Promise((resolve) => {
      this.ws!.once('close', () => {
        this.connected = false;
        this.emit('disconnect');
        resolve();
      });

      this.ws!.close();
    });
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }
}
```

### HTTP/POST Transport (Request-Response)

```typescript
import { EventEmitter } from 'events';
import type { Transport } from '@gnana997/node-jsonrpc';

export class HTTPTransport extends EventEmitter implements Transport {
  private connected = false;
  private requestId = 0;

  constructor(private url: string) {
    super();
  }

  async connect(): Promise<void> {
    // HTTP is connectionless, but we can test connectivity
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"jsonrpc":"2.0","method":"ping","id":0}',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      this.connected = true;
    } catch (error) {
      throw new Error(`Connection failed: ${error}`);
    }
  }

  send(message: string): void {
    if (!this.connected) {
      this.emit('error', new Error('Not connected'));
      return;
    }

    fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: message,
    })
      .then((response) => response.text())
      .then((data) => {
        this.emit('message', data);
      })
      .catch((error) => {
        this.emit('error', error);
      });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnect');
  }

  isConnected(): boolean {
    return this.connected;
  }
}
```

---

## Best Practices

### Error Handling

1. **Never throw from send()** - Emit `'error'` events instead
2. **Handle all socket errors** - Prevent uncaught exceptions
3. **Clean up resources** - Close sockets, clear timers, remove listeners

### Performance

1. **Buffer management** - Don't let buffers grow unbounded
2. **Backpressure** - Handle slow consumers (use `socket.pause()`/`socket.resume()`)
3. **Connection pooling** - Reuse connections when possible

### Security

1. **Validate data** - Check message size limits before buffering
2. **Timeout handling** - Implement connection timeouts
3. **TLS/SSL** - Use encrypted transports for production

### Testing

1. **Unit test each method** - Test connect, disconnect, send, receive separately
2. **Test error scenarios** - Connection failures, malformed data, disconnects
3. **Integration test** - Test with real client-server communication

---

## Summary

To implement a custom transport:

1. Extend `EventEmitter` and implement `Transport` interface
2. Implement `connect()`, `disconnect()`, `send()`, `isConnected()`
3. Emit `'message'`, `'error'`, and `'disconnect'` events
4. Handle message framing (line-delimited JSON recommended)
5. Clean up resources properly
6. Write comprehensive tests

For server-side transports, also implement `TransportServer` interface with `listen()`, `close()`, and `'connection'` event.

See the [API Reference](./API.md) for using transports with JSONRPCClient and JSONRPCServer.
