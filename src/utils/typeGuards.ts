import type {
  JSONRPCBatch,
  JSONRPCErrorResponse,
  JSONRPCMessage,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
} from '../types.js';

/**
 * Type guard to check if a message is a JSON-RPC request
 * Request has: jsonrpc, method, params (optional), id
 */
export function isRequest(message: any): message is JSONRPCRequest {
  return (
    message &&
    typeof message === 'object' &&
    message.jsonrpc === '2.0' &&
    typeof message.method === 'string' &&
    'id' in message &&
    (typeof message.id === 'string' || typeof message.id === 'number')
  );
}

/**
 * Type guard to check if a message is a JSON-RPC success response
 * Response has: jsonrpc, result, id (no error field)
 */
export function isResponse(message: any): message is JSONRPCResponse {
  return (
    message &&
    typeof message === 'object' &&
    message.jsonrpc === '2.0' &&
    'result' in message &&
    !('error' in message) &&
    'id' in message
  );
}

/**
 * Type guard to check if a message is a JSON-RPC error response
 * Error response has: jsonrpc, error, id (no result field)
 */
export function isErrorResponse(message: any): message is JSONRPCErrorResponse {
  return (
    message &&
    typeof message === 'object' &&
    message.jsonrpc === '2.0' &&
    'error' in message &&
    message.error !== undefined &&
    typeof message.error === 'object' &&
    typeof message.error.code === 'number' &&
    typeof message.error.message === 'string' &&
    'id' in message
  );
}

/**
 * Type guard to check if a message is a JSON-RPC notification
 * Notification has: jsonrpc, method, params (optional)
 * Notification does NOT have an id field
 */
export function isNotification(message: any): message is JSONRPCNotification {
  return (
    message &&
    typeof message === 'object' &&
    message.jsonrpc === '2.0' &&
    typeof message.method === 'string' &&
    !('id' in message) // Key difference: no id field
  );
}

/**
 * Type guard to check if a message is any valid JSON-RPC message
 */
export function isJSONRPCMessage(message: any): message is JSONRPCMessage {
  return (
    isRequest(message) || isResponse(message) || isErrorResponse(message) || isNotification(message)
  );
}

/**
 * Type guard to check if a value is a batch request (array of requests)
 */
export function isBatchRequest(value: any): value is JSONRPCRequest[] {
  return Array.isArray(value) && value.length > 0 && value.every(isRequest);
}

/**
 * Type guard to check if a value is a batch (array of requests and/or notifications)
 * Per JSON-RPC 2.0 spec, a batch can contain requests, notifications, or both
 */
export function isBatch(value: any): value is JSONRPCBatch {
  return (
    Array.isArray(value) &&
    value.length >= 0 && // Allow empty arrays to be handled specially by server
    value.every((item) => isRequest(item) || isNotification(item))
  );
}

/**
 * Type guard to check if a value is a batch response (array of responses)
 */
export function isBatchResponse(
  value: any
): value is Array<JSONRPCResponse | JSONRPCErrorResponse> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isResponse(item) || isErrorResponse(item))
  );
}
