# API Reference

Complete API documentation for `@gnana997/node-jsonrpc` - a transport-agnostic JSON-RPC 2.0 implementation for TypeScript and Node.js.

## Table of Contents

- [JSONRPCClient](#jsonrpcclient)
- [JSONRPCServer](#jsonrpcserver)
- [BatchRequest](#batchrequest)
- [Middleware](#middleware)
- [Error Handling](#error-handling)
- [Types](#types)
- [Utilities](#utilities)

---

## JSONRPCClient

The `JSONRPCClient` class provides a full-featured JSON-RPC 2.0 client with support for requests, notifications, batches, middleware, and more.

### Constructor

```typescript
new JSONRPCClient(config: JSONRPCClientConfig)
```

#### JSONRPCClientConfig

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `transport` | `Transport` | Yes | - | Transport implementation for sending/receiving messages |
| `requestTimeout` | `number` | No | `30000` | Default request timeout in milliseconds |
| `debug` | `boolean` | No | `false` | Enable debug logging |
| `middleware` | `Middleware[]` | No | `[]` | Middleware to apply to all requests/responses |

**Example:**

```typescript
import { JSONRPCClient } from '@gnana997/node-jsonrpc';
import { MyTransport } from './transports';

const client = new JSONRPCClient({
  transport: new MyTransport(),
  requestTimeout: 5000,
  debug: true,
});
```

### Methods

#### connect()

Establishes connection to the server via the transport.

```typescript
async connect(): Promise<void>
```

**Example:**

```typescript
await client.connect();
console.log('Connected to server');
```

**Throws:**
- Error if already connected
- Transport-specific connection errors

---

#### disconnect()

Disconnects from the server and cleans up pending requests.

```typescript
async disconnect(): Promise<void>
```

**Example:**

```typescript
await client.disconnect();
console.log('Disconnected from server');
```

**Behavior:**
- All pending requests are rejected with "Client disconnected" error
- Pending request count is reset to 0
- Emits `disconnected` event

---

#### request()

Sends a JSON-RPC request and waits for the response.

```typescript
async request<TResult = any>(
  method: string,
  params?: any,
  options?: RequestOptions
): Promise<TResult>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `method` | `string` | The method name to call |
| `params` | `any` | Method parameters (optional) |
| `options` | `RequestOptions` | Request-specific options (optional) |

**RequestOptions:**

| Property | Type | Description |
|----------|------|-------------|
| `timeout` | `number` | Request timeout in milliseconds (overrides default) |
| `signal` | `AbortSignal` | AbortSignal for request cancellation |

**Example:**

```typescript
// Simple request
const result = await client.request('add', { a: 5, b: 3 });
console.log(result); // 8

// With timeout
const result = await client.request('slowMethod', {}, { timeout: 10000 });

// With abort signal
const controller = new AbortController();
const promise = client.request('method', {}, { signal: controller.signal });

// Cancel after 1 second
setTimeout(() => controller.abort(), 1000);

try {
  await promise;
} catch (error) {
  console.log(error.message); // "Request aborted"
}
```

**Throws:**
- `JSONRPCError` if the server returns an error
- `Error` if timeout occurs
- `Error` if AbortSignal is aborted
- `Error` if client is not connected

**Returns:**
- Promise resolving to the method result

---

#### notify()

Sends a JSON-RPC notification (no response expected).

```typescript
notify(method: string, params?: any): void
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `method` | `string` | The notification method name |
| `params` | `any` | Notification parameters (optional) |

**Example:**

```typescript
// Send notification
client.notify('statusUpdate', { status: 'processing', progress: 50 });
```

**Throws:**
- `Error` if client is not connected

---

#### batch()

Creates a new batch request builder.

```typescript
batch(): BatchRequest
```

**Example:**

```typescript
const batch = client.batch();
batch.add('add', { a: 1, b: 2 });
batch.add('subtract', { minuend: 10, subtrahend: 5 });

const results = await batch.execute();
console.log(results); // [3, 5]
```

**Returns:**
- `BatchRequest` instance for building and executing batch requests

See [BatchRequest](#batchrequest) for detailed batch API.

---

#### use()

Adds middleware to the client.

```typescript
use(middleware: Middleware): void
```

**Example:**

```typescript
import { LoggingMiddleware } from '@gnana997/node-jsonrpc';

client.use(new LoggingMiddleware(console));
```

See [Middleware](#middleware) for available middleware and custom middleware creation.

---

#### isConnected()

Checks if the client is currently connected.

```typescript
isConnected(): boolean
```

**Example:**

```typescript
if (client.isConnected()) {
  await client.request('method', {});
} else {
  await client.connect();
}
```

---

#### getPendingRequestCount()

Gets the number of requests waiting for responses.

```typescript
getPendingRequestCount(): number
```

**Example:**

```typescript
console.log(`Pending requests: ${client.getPendingRequestCount()}`);
```

---

### Events

The `JSONRPCClient` extends `EventEmitter` and emits the following events:

#### connected

Emitted when the client connects to the server.

```typescript
client.on('connected', () => {
  console.log('Client connected');
});
```

---

#### disconnected

Emitted when the client disconnects from the server.

```typescript
client.on('disconnected', () => {
  console.log('Client disconnected');
});
```

---

#### error

Emitted when a transport or protocol error occurs.

```typescript
client.on('error', (error: Error) => {
  console.error('Client error:', error);
});
```

**Note:** This event is for transport-level and protocol errors, not method errors (which are returned as rejected promises from `request()`).

---

#### notification

Emitted when a notification is received from the server.

```typescript
client.on('notification', (method: string, params: any) => {
  console.log(`Notification: ${method}`, params);
});
```

**Example:**

```typescript
client.on('notification', (method, params) => {
  if (method === 'progressUpdate') {
    console.log(`Progress: ${params.percentage}%`);
  }
});
```

---

## JSONRPCServer

The `JSONRPCServer` class provides a full-featured JSON-RPC 2.0 server with method registration, multi-client support, broadcasting, and middleware.

### Constructor

```typescript
new JSONRPCServer(config: JSONRPCServerConfig)
```

#### JSONRPCServerConfig

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `transportServer` | `TransportServer` | Yes | - | Transport server for accepting connections |
| `debug` | `boolean` | No | `false` | Enable debug logging |
| `middleware` | `Middleware[]` | No | `[]` | Middleware to apply to all requests/responses |
| `onConnection` | `(transport: Transport) => void` | No | - | Called when a client connects |
| `onDisconnection` | `(transport: Transport) => void` | No | - | Called when a client disconnects |

**Example:**

```typescript
import { JSONRPCServer } from '@gnana997/node-jsonrpc';
import { MyTransportServer } from './transports';

const server = new JSONRPCServer({
  transportServer: new MyTransportServer(),
  debug: true,
  onConnection: (transport) => {
    console.log('Client connected');
  },
  onDisconnection: (transport) => {
    console.log('Client disconnected');
  },
});
```

### Methods

#### listen()

Starts the server and begins accepting connections.

```typescript
async listen(): Promise<void>
```

**Example:**

```typescript
await server.listen();
console.log('Server listening for connections');
```

---

#### close()

Stops the server and optionally closes all client connections.

```typescript
async close(options?: { closeConnections?: boolean }): Promise<void>
```

**Parameters:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `closeConnections` | `boolean` | `false` | Whether to disconnect all clients |

**Example:**

```typescript
// Stop accepting new connections, keep existing ones
await server.close();

// Stop and disconnect all clients
await server.close({ closeConnections: true });
```

---

#### registerMethod()

Registers a method handler.

```typescript
registerMethod(name: string, handler: Handler): void
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Method name |
| `handler` | `Handler` | Handler function |

**Handler Signature:**

```typescript
type Handler = (params: any, context: RequestContext) => any | Promise<any>;
```

**RequestContext:**

| Property | Type | Description |
|----------|------|-------------|
| `method` | `string` | The method name being called |
| `requestId` | `string \| number` | The request ID |
| `transport` | `Transport` | The client's transport (for sending notifications) |

**Example:**

```typescript
// Simple handler
server.registerMethod('add', async (params) => {
  return params.a + params.b;
});

// Handler with context
server.registerMethod('processWithProgress', async (params, context) => {
  for (let i = 0; i < 10; i++) {
    // Send progress notification to this client
    context.transport.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'progress',
      params: { step: i + 1, total: 10 },
    }));

    await someAsyncWork();
  }

  return { completed: true };
});

// Handler with error
server.registerMethod('divide', async (params) => {
  if (params.b === 0) {
    throw new Error('Division by zero');
  }
  return params.a / params.b;
});
```

---

#### unregisterMethod()

Removes a method handler.

```typescript
unregisterMethod(name: string): boolean
```

**Returns:**
- `true` if method was found and removed
- `false` if method was not registered

**Example:**

```typescript
const removed = server.unregisterMethod('oldMethod');
console.log(removed); // true or false
```

---

#### hasMethod()

Checks if a method is registered.

```typescript
hasMethod(name: string): boolean
```

**Example:**

```typescript
if (server.hasMethod('add')) {
  console.log('Add method is registered');
}
```

---

#### listMethods()

Returns all registered method names.

```typescript
listMethods(): string[]
```

**Example:**

```typescript
const methods = server.listMethods();
console.log('Available methods:', methods);
// ['add', 'subtract', 'multiply', 'divide']
```

---

#### notify()

Sends a notification to a specific client.

```typescript
notify(transport: Transport, method: string, params?: any): void
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `transport` | `Transport` | The client's transport |
| `method` | `string` | Notification method name |
| `params` | `any` | Notification parameters (optional) |

**Example:**

```typescript
// In a handler, send notification to the calling client
server.registerMethod('startWork', async (params, context) => {
  server.notify(context.transport, 'workStarted', { jobId: params.jobId });

  // Do work...

  server.notify(context.transport, 'workCompleted', { jobId: params.jobId });
  return { success: true };
});
```

---

#### broadcast()

Sends a notification to all connected clients.

```typescript
broadcast(method: string, params?: any): number
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `method` | `string` | Notification method name |
| `params` | `any` | Notification parameters (optional) |

**Returns:**
- Number of clients the notification was sent to

**Example:**

```typescript
const count = server.broadcast('serverStatus', { status: 'healthy', uptime: 3600 });
console.log(`Broadcast sent to ${count} clients`);
```

---

#### getConnectionCount()

Gets the number of currently connected clients.

```typescript
getConnectionCount(): number
```

**Example:**

```typescript
console.log(`Connected clients: ${server.getConnectionCount()}`);
```

---

### Events

The `JSONRPCServer` extends `EventEmitter` and emits the following events:

#### notification

Emitted when a notification is received from a client.

```typescript
server.on('notification', (method: string, params: any, transport: Transport) => {
  console.log(`Received notification: ${method}`, params);
});
```

---

#### error

Emitted when a transport or protocol error occurs.

```typescript
server.on('error', (error: Error) => {
  console.error('Server error:', error);
});
```

---

## BatchRequest

The `BatchRequest` class allows building and executing multiple JSON-RPC requests in a single batch.

### Methods

#### add()

Adds a request to the batch.

```typescript
add(method: string, params?: any): this
```

**Returns:**
- `this` for method chaining

**Example:**

```typescript
const batch = client.batch();
batch
  .add('add', { a: 1, b: 2 })
  .add('subtract', { minuend: 10, subtrahend: 5 })
  .add('multiply', { a: 3, b: 4 });
```

---

#### execute()

Executes the batch request.

```typescript
async execute<TResult = any>(options?: BatchOptions): Promise<TResult[]>
```

**BatchOptions:**

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `mode` | `'parallel' \| 'sequential'` | `'parallel'` | Execution mode |
| `timeout` | `number` | `30000` | Timeout for the entire batch |
| `signal` | `AbortSignal` | - | AbortSignal for batch cancellation |

**Execution Modes:**

- **`parallel`** (default): All requests execute concurrently. Results may be returned in any order. If any request fails, the error is thrown when mapping results.
- **`sequential`**: Requests execute one-by-one in order. Stops at the first error.

**Example:**

```typescript
// Parallel execution (default)
const batch1 = client.batch();
batch1.add('method1', {});
batch1.add('method2', {});
const results1 = await batch1.execute();

// Sequential execution
const batch2 = client.batch();
batch2.add('method1', {});
batch2.add('method2', {});
const results2 = await batch2.execute({ mode: 'sequential' });

// With timeout
const batch3 = client.batch();
batch3.add('slowMethod', {});
const results3 = await batch3.execute({ timeout: 10000 });

// With abort signal
const controller = new AbortController();
const batch4 = client.batch();
batch4.add('method', {});
const promise = batch4.execute({ signal: controller.signal });

setTimeout(() => controller.abort(), 1000);
```

**Throws:**
- `Error` if batch is empty ("Cannot execute empty batch")
- `JSONRPCError` if any request fails
- `Error` if timeout occurs
- `Error` if AbortSignal is aborted

**Returns:**
- Promise resolving to an array of results

---

#### length

Gets the number of requests in the batch.

```typescript
get length(): number
```

**Example:**

```typescript
const batch = client.batch();
batch.add('method1', {});
batch.add('method2', {});
console.log(batch.length); // 2
```

---

## Middleware

Middleware allows intercepting and modifying requests, responses, errors, and notifications.

### Middleware Interface

```typescript
interface Middleware {
  onRequest?(request: JSONRPCRequest): JSONRPCRequest | Promise<JSONRPCRequest>;
  onResponse?(response: JSONRPCResponse): JSONRPCResponse | Promise<JSONRPCResponse>;
  onError?(error: JSONRPCError): JSONRPCError | Promise<JSONRPCError>;
  onNotification?(notification: JSONRPCNotification): void | Promise<void>;
  onBatchRequest?(request: JSONRPCBatchRequest): JSONRPCBatchRequest | Promise<JSONRPCBatchRequest>;
  onBatchResponse?(response: JSONRPCBatchResponse): JSONRPCBatchResponse | Promise<JSONRPCBatchResponse>;
}
```

### Custom Middleware Example

```typescript
const loggingMiddleware: Middleware = {
  onRequest: (req) => {
    console.log('→ Request:', req.method, req.params);
    return req;
  },
  onResponse: (res) => {
    console.log('← Response:', res.result);
    return res;
  },
  onError: (err) => {
    console.error('✗ Error:', err.message);
    return err;
  },
};

client.use(loggingMiddleware);
```

### Built-in Middleware

#### LoggingMiddleware

Logs all JSON-RPC activity.

```typescript
import { LoggingMiddleware } from '@gnana997/node-jsonrpc';

const logger = {
  info: (msg, data) => console.log(msg, data),
  error: (msg, data) => console.error(msg, data),
  warn: (msg, data) => console.warn(msg, data),
  debug: (msg, data) => console.debug(msg, data),
};

client.use(new LoggingMiddleware(logger));
```

---

#### MetricsMiddleware

Tracks request metrics (timing, counts, errors).

```typescript
import { MetricsMiddleware } from '@gnana997/node-jsonrpc';

const metrics = new MetricsMiddleware({
  onMetric: (metric) => {
    if (metric.type === 'request') {
      console.log(`Request: ${metric.method}`);
    } else if (metric.type === 'response') {
      console.log(`Response time: ${metric.duration}ms`);
    }
  },
});

client.use(metrics);
```

---

#### TransformMiddleware

Transforms requests and responses.

```typescript
import { TransformMiddleware } from '@gnana997/node-jsonrpc';

const transformer = new TransformMiddleware({
  transformRequest: (req) => ({
    ...req,
    params: { ...req.params, timestamp: Date.now() },
  }),
  transformResponse: (res) => ({
    ...res,
    result: { ...res.result, processed: true },
  }),
});

client.use(transformer);
```

---

#### ValidationMiddleware

Validates requests and responses.

```typescript
import { ValidationMiddleware } from '@gnana997/node-jsonrpc';

const validator = new ValidationMiddleware({
  validateRequest: (req) => {
    if (!req.params || typeof req.params !== 'object') {
      throw new Error('Invalid params');
    }
  },
  validateResponse: (res) => {
    if (res.result === undefined) {
      throw new Error('Missing result');
    }
  },
});

client.use(validator);
```

---

## Error Handling

### JSONRPCError

The `JSONRPCError` class represents JSON-RPC 2.0 errors.

```typescript
class JSONRPCError extends Error {
  code: number;
  data?: any;

  constructor(message: string, code: number, data?: any);

  toJSON(): { code: number; message: string; data?: any };

  // Static factory methods
  static parseError(): JSONRPCError;
  static invalidRequest(): JSONRPCError;
  static methodNotFound(): JSONRPCError;
  static invalidParams(): JSONRPCError;
  static internalError(message?: string): JSONRPCError;
}
```

### Standard Error Codes

| Code | Constant | Message | Description |
|------|----------|---------|-------------|
| `-32700` | Parse error | Invalid JSON | Invalid JSON was received |
| `-32600` | Invalid Request | Invalid Request | The JSON sent is not a valid Request object |
| `-32601` | Method not found | Method not found | The method does not exist |
| `-32602` | Invalid params | Invalid params | Invalid method parameter(s) |
| `-32603` | Internal error | Internal error | Internal JSON-RPC error |

**Example:**

```typescript
try {
  await client.request('divide', { a: 10, b: 0 });
} catch (error) {
  if (error instanceof JSONRPCError) {
    console.error(`Error ${error.code}: ${error.message}`);
    if (error.data) {
      console.error('Additional data:', error.data);
    }
  }
}
```

---

## Types

### Core Types

```typescript
// Request
interface JSONRPCRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id: string | number;
}

// Response (success)
interface JSONRPCResponse {
  jsonrpc: '2.0';
  result: any;
  id: string | number;
}

// Response (error)
interface JSONRPCErrorResponse {
  jsonrpc: '2.0';
  error: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number | null;
}

// Notification
interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

// Batch
type JSONRPCBatch = Array<JSONRPCRequest | JSONRPCNotification>;
type JSONRPCBatchRequest = JSONRPCRequest[];
type JSONRPCBatchResponse = Array<JSONRPCResponse | JSONRPCErrorResponse>;
```

### Transport Types

```typescript
interface Transport {
  send(message: string): void;
  on(event: 'message', handler: (message: string) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'disconnect', handler: () => void): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

interface TransportServer {
  on(event: 'connection', handler: (transport: Transport) => void): void;
  listen(): Promise<void>;
  close(): Promise<void>;
}
```

See [TRANSPORT.md](./TRANSPORT.md) for implementing custom transports.

---

## Utilities

### Type Guards

Utility functions for checking JSON-RPC message types:

```typescript
import {
  isRequest,
  isResponse,
  isErrorResponse,
  isNotification,
  isBatch,
  isBatchRequest,
  isBatchResponse,
  isJSONRPCMessage,
} from '@gnana997/node-jsonrpc';

if (isRequest(message)) {
  // message is JSONRPCRequest
}

if (isBatch(message)) {
  // message is JSONRPCBatch (requests and/or notifications)
}
```

### ID Generator

The default ID generator creates monotonically increasing numeric IDs:

```typescript
import { defaultIDGenerator, IDGenerator } from '@gnana997/node-jsonrpc';

// Custom ID generator
class UUIDGenerator implements IDGenerator {
  next(): string {
    return crypto.randomUUID();
  }
}

const client = new JSONRPCClient({
  transport,
  // Custom ID generator would need to be passed if the client accepted it
});
```

### Logging

```typescript
import { createLogger, noopLogger, type Logger } from '@gnana997/node-jsonrpc';

// Create custom logger
const logger = createLogger({
  level: 'debug',
  prefix: '[MyApp]',
  output: console,
});

// Use noop logger (no output)
const silent = noopLogger;
```

---

## Complete Examples

### Basic Client-Server

```typescript
import { JSONRPCClient, JSONRPCServer } from '@gnana997/node-jsonrpc';
import { MyTransport, MyTransportServer } from './transports';

// Server
const server = new JSONRPCServer({
  transportServer: new MyTransportServer(),
});

server.registerMethod('add', async (params) => {
  return params.a + params.b;
});

await server.listen();

// Client
const client = new JSONRPCClient({
  transport: new MyTransport(),
});

await client.connect();

const result = await client.request('add', { a: 5, b: 3 });
console.log(result); // 8

await client.disconnect();
await server.close({ closeConnections: true });
```

### With Middleware

```typescript
import {
  JSONRPCClient,
  LoggingMiddleware,
  MetricsMiddleware,
} from '@gnana997/node-jsonrpc';

const client = new JSONRPCClient({
  transport: new MyTransport(),
  middleware: [
    new LoggingMiddleware(console),
    new MetricsMiddleware({
      onMetric: (m) => console.log('Metric:', m),
    }),
  ],
});

await client.connect();
await client.request('method', {});
```

### Batch Requests

```typescript
const batch = client.batch();

batch
  .add('add', { a: 1, b: 2 })
  .add('subtract', { minuend: 10, subtrahend: 5 })
  .add('multiply', { a: 3, b: 4 });

// Parallel execution
const results = await batch.execute();
console.log(results); // [3, 5, 12]

// Sequential execution
const results2 = await batch.execute({ mode: 'sequential' });
```

### Progress Notifications

```typescript
// Server
server.registerMethod('longTask', async (params, context) => {
  for (let i = 0; i < 10; i++) {
    await delay(100);

    context.transport.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'progress',
      params: { step: i + 1, total: 10 },
    }));
  }

  return { completed: true };
});

// Client
client.on('notification', (method, params) => {
  if (method === 'progress') {
    console.log(`Progress: ${params.step}/${params.total}`);
  }
});

const result = await client.request('longTask', {});
console.log(result); // { completed: true }
```

---

For more examples, see [EXAMPLES.md](./EXAMPLES.md) and the `examples/` directory.
