import type {
  JSONRPCError,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
  Middleware,
} from './types.js';

/**
 * Execute a middleware chain for a specific phase
 *
 * @param middlewares - Array of middleware to execute
 * @param phase - Which middleware hook to execute
 * @param data - The data to pass through the chain
 * @returns The potentially modified data after all middleware execution
 */
export async function executeMiddlewareChain<T>(
  middlewares: Middleware[],
  phase: keyof Middleware,
  data: T
): Promise<T> {
  let result = data;

  for (const middleware of middlewares) {
    const handler = middleware[phase];
    if (handler) {
      // Call the middleware handler with the current result
      const modified = await (handler as any).call(middleware, result);
      if (modified !== undefined) {
        result = modified;
      }
    }
  }

  return result;
}

/**
 * Logging Middleware
 * Logs all requests, responses, errors, and notifications
 */
export class LoggingMiddleware implements Middleware {
  constructor(
    private logger: {
      log: (message: string, ...args: any[]) => void;
    } = console
  ) {}

  onRequest(request: JSONRPCRequest): JSONRPCRequest {
    this.logger.log('[JSON-RPC Request]', {
      id: request.id,
      method: request.method,
      params: request.params,
    });
    return request;
  }

  onResponse(response: JSONRPCResponse): JSONRPCResponse {
    this.logger.log('[JSON-RPC Response]', {
      id: response.id,
      result: response.result,
    });
    return response;
  }

  onError(error: JSONRPCError): JSONRPCError {
    this.logger.log('[JSON-RPC Error]', {
      code: error.code,
      message: error.message,
      data: error.data,
    });
    return error;
  }

  onNotification(notification: JSONRPCNotification): void {
    this.logger.log('[JSON-RPC Notification]', {
      method: notification.method,
      params: notification.params,
    });
  }
}

/**
 * Metrics Middleware
 * Tracks timing and counts for requests/responses
 */
export class MetricsMiddleware implements Middleware {
  private requestTimes = new Map<string | number, number>();

  constructor(
    private onMetric?: (metric: {
      type: 'request' | 'response' | 'error' | 'notification';
      method?: string;
      duration?: number;
      success?: boolean;
    }) => void
  ) {}

  onRequest(request: JSONRPCRequest): JSONRPCRequest {
    this.requestTimes.set(request.id, Date.now());
    this.onMetric?.({
      type: 'request',
      method: request.method,
    });
    return request;
  }

  onResponse(response: JSONRPCResponse): JSONRPCResponse {
    const startTime = this.requestTimes.get(response.id);
    if (startTime) {
      const duration = Date.now() - startTime;
      this.requestTimes.delete(response.id);
      this.onMetric?.({
        type: 'response',
        duration,
        success: true,
      });
    }
    return response;
  }

  onError(error: JSONRPCError): JSONRPCError {
    this.onMetric?.({
      type: 'error',
      success: false,
    });
    return error;
  }

  onNotification(notification: JSONRPCNotification): void {
    this.onMetric?.({
      type: 'notification',
      method: notification.method,
    });
  }
}

/**
 * Validation Middleware
 * Validates request/response structures
 */
export class ValidationMiddleware implements Middleware {
  onRequest(request: JSONRPCRequest): JSONRPCRequest {
    if (request.jsonrpc !== '2.0') {
      throw new Error('Invalid JSON-RPC version');
    }
    if (typeof request.method !== 'string' || request.method.length === 0) {
      throw new Error('Invalid method name');
    }
    if (!('id' in request)) {
      throw new Error('Request must have an id');
    }
    return request;
  }

  onResponse(response: JSONRPCResponse): JSONRPCResponse {
    if (response.jsonrpc !== '2.0') {
      throw new Error('Invalid JSON-RPC version');
    }
    if (!('result' in response)) {
      throw new Error('Response must have a result');
    }
    if (!('id' in response)) {
      throw new Error('Response must have an id');
    }
    return response;
  }
}

/**
 * Transform Middleware
 * Allows custom transformation of requests/responses
 */
export class TransformMiddleware implements Middleware {
  constructor(
    private transforms: {
      request?: (request: JSONRPCRequest) => JSONRPCRequest | Promise<JSONRPCRequest>;
      response?: (response: JSONRPCResponse) => JSONRPCResponse | Promise<JSONRPCResponse>;
      error?: (error: JSONRPCError) => JSONRPCError | Promise<JSONRPCError>;
      notification?: (notification: JSONRPCNotification) => void | Promise<void>;
    }
  ) {}

  async onRequest(request: JSONRPCRequest): Promise<JSONRPCRequest> {
    if (this.transforms.request) {
      return this.transforms.request(request);
    }
    return request;
  }

  async onResponse(response: JSONRPCResponse): Promise<JSONRPCResponse> {
    if (this.transforms.response) {
      return this.transforms.response(response);
    }
    return response;
  }

  async onError(error: JSONRPCError): Promise<JSONRPCError> {
    if (this.transforms.error) {
      return this.transforms.error(error);
    }
    return error;
  }

  async onNotification(notification: JSONRPCNotification): Promise<void> {
    if (this.transforms.notification) {
      await this.transforms.notification(notification);
    }
  }
}
