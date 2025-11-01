# node-jsonrpc

> Transport-agnostic JSON-RPC 2.0 client and server for TypeScript/Node.js

[![CI](https://github.com/gnana997/node-jsonrpc/actions/workflows/ci.yml/badge.svg)](https://github.com/gnana997/node-jsonrpc/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/node-jsonrpc.svg)](https://www.npmjs.com/package/node-jsonrpc)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- ✅ **Transport Agnostic** - Works with IPC, stdio, HTTP, WebSocket, or any custom transport
- ✅ **Full JSON-RPC 2.0** - Complete spec compliance for client and server
- ✅ **TypeScript First** - Fully typed with excellent IntelliSense support
- ✅ **Zero Dependencies** - Only uses Node.js standard library
- ✅ **Middleware Support** - Intercept and modify requests/responses
- ✅ **Batch Requests** - Send multiple requests in a single round-trip
- ✅ **Request Cancellation** - AbortSignal support for cancelling requests
- ✅ **Debug Logging** - Built-in logger with configurable levels
- ✅ **Bidirectional** - Server can send notifications to clients
- ✅ **Multi-Client** - Server handles multiple concurrent connections
- ✅ **Well Tested** - Comprehensive test suite with 80%+ coverage

## Installation

```bash
npm install node-jsonrpc
```

## Quick Start

### Client

```typescript
import { JSONRPCClient } from 'node-jsonrpc';
import { MyTransport } from './my-transport'; // Your transport implementation

const client = new JSONRPCClient({
  transport: new MyTransport(),
});

await client.connect();

// Make a request
const result = await client.request('subtract', { minuend: 42, subtrahend: 23 });
console.log(result); // 19

// Send a notification (no response)
client.notify('update', { status: 'ready' });

// Listen for server notifications
client.on('notification', (method, params) => {
  console.log(`Server sent ${method}:`, params);
});
```

### Server

```typescript
import { JSONRPCServer } from 'node-jsonrpc';
import { MyTransportServer } from './my-transport'; // Your transport implementation

const server = new JSONRPCServer({
  transportServer: new MyTransportServer(),
});

// Register method handlers
server.registerMethod('subtract', async (params) => {
  return params.minuend - params.subtrahend;
});

server.registerMethod('sum', async (params) => {
  return params.reduce((a: number, b: number) => a + b, 0);
});

await server.listen();

// Send notification to all connected clients
server.broadcast('serverStatus', { status: 'ready' });
```

## Transport Abstraction

This package is transport-agnostic. You need to provide a `Transport` implementation for the client and a `TransportServer` implementation for the server.

See [TRANSPORT.md](./docs/TRANSPORT.md) for details on implementing custom transports.

### Available Transports

- [`node-ipc-jsonrpc`](https://github.com/gnana997/ipc-jsonrpc/tree/main/node) - IPC transport (Unix sockets, Windows named pipes)
- More coming soon...

## Documentation

- [API Reference](./docs/API.md) - Complete API documentation
- [Transport Guide](./docs/TRANSPORT.md) - How to implement custom transports
- [Examples](./docs/EXAMPLES.md) - Usage examples and patterns

## API Overview

### JSONRPCClient

```typescript
class JSONRPCClient extends EventEmitter {
  constructor(config: JSONRPCClientConfig);

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  request<T>(method: string, params?: any, options?: RequestOptions): Promise<T>;
  notify(method: string, params?: any): void;
  batch(): BatchRequest;

  use(middleware: Middleware): void;

  // Events: 'connected', 'disconnected', 'notification', 'error'
}
```

### JSONRPCServer

```typescript
class JSONRPCServer extends EventEmitter {
  constructor(config: JSONRPCServerConfig);

  listen(): Promise<void>;
  close(): Promise<void>;

  registerMethod(name: string, handler: Handler): void;
  use(middleware: Middleware): void;

  notify(transport: Transport, method: string, params?: any): void;
  broadcast(method: string, params?: any): number;

  // Events: 'notification', 'error'
}
```

## License

MIT © gnana997
