import { executeMiddlewareChain } from './middleware.js';
import type { Transport } from './transport.js';
import type {
  BatchExecutionMode,
  BatchOptions,
  JSONRPCBatchRequest,
  Middleware,
  PendingRequest,
} from './types.js';
import type { IDGenerator } from './utils/idGenerator.js';

/**
 * Batch Request Item
 * Internal representation of a request in a batch
 */
interface BatchRequestItem {
  method: string;
  params?: any;
}

/**
 * Batch Request Builder
 *
 * Allows building and executing a batch of JSON-RPC requests.
 * Supports both parallel and sequential execution modes.
 *
 * @example
 * ```typescript
 * const batch = client.batch();
 * batch.add('add', { a: 1, b: 2 });
 * batch.add('subtract', { minuend: 10, subtrahend: 5 });
 *
 * // Execute in parallel (default)
 * const [sum, difference] = await batch.execute();
 *
 * // Execute sequentially
 * const results = await batch.execute({ mode: 'sequential' });
 * ```
 */
export class BatchRequest {
  private items: BatchRequestItem[] = [];
  private transport: Transport;
  private idGenerator: IDGenerator;
  private pendingRequests: Map<string | number, PendingRequest>;
  private middleware?: Middleware[];
  private defaultTimeout: number;

  constructor(
    transport: Transport,
    idGenerator: IDGenerator,
    pendingRequests: Map<string | number, PendingRequest>,
    middleware?: Middleware[],
    defaultTimeout = 30000
  ) {
    this.transport = transport;
    this.idGenerator = idGenerator;
    this.pendingRequests = pendingRequests;
    this.middleware = middleware;
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * Add a request to the batch
   *
   * @param method - Method name to call
   * @param params - Method parameters
   * @returns This BatchRequest instance for chaining
   *
   * @example
   * ```typescript
   * batch.add('add', { a: 1, b: 2 })
   *      .add('subtract', { minuend: 10, subtrahend: 5 });
   * ```
   */
  add(method: string, params?: any): this {
    this.items.push({ method, params });
    return this;
  }

  /**
   * Execute the batch request
   *
   * @param options - Batch execution options
   * @returns Promise that resolves with an array of results
   * @throws JSONRPCError if any request fails (in sequential mode, stops at first error)
   *
   * @example Parallel execution (default)
   * ```typescript
   * const results = await batch.execute();
   * // Results may include errors mixed with successes
   * ```
   *
   * @example Sequential execution
   * ```typescript
   * const results = await batch.execute({ mode: 'sequential' });
   * // Stops at first error
   * ```
   *
   * @example With timeout
   * ```typescript
   * const results = await batch.execute({ timeout: 5000 });
   * ```
   */
  async execute<TResult = any>(options?: BatchOptions): Promise<TResult[]> {
    if (this.items.length === 0) {
      throw new Error('Cannot execute empty batch');
    }

    const mode: BatchExecutionMode = options?.mode ?? 'parallel';
    const timeout = options?.timeout ?? this.defaultTimeout;
    const signal = options?.signal;

    // Build batch request with IDs
    const batchRequest: JSONRPCBatchRequest = this.items.map((item) => ({
      jsonrpc: '2.0',
      method: item.method,
      params: item.params,
      id: this.idGenerator.next(),
    }));

    // Apply batch request middleware
    let processedBatch = batchRequest;
    if (this.middleware && this.middleware.length > 0) {
      processedBatch = await executeMiddlewareChain(
        this.middleware,
        'onBatchRequest',
        batchRequest
      );
    }

    // Send batch request
    const messageStr = JSON.stringify(processedBatch);
    this.transport.send(messageStr);

    // Track all pending requests
    const promises: Promise<TResult>[] = processedBatch.map((request) =>
      this.trackPendingRequest<TResult>(request.id, timeout, signal)
    );

    // Execute based on mode
    if (mode === 'parallel') {
      // Parallel: all requests execute concurrently
      // Use Promise.allSettled to get all results (including errors)
      const results = await Promise.allSettled(promises);
      return results.map((result) => {
        if (result.status === 'fulfilled') {
          return result.value;
        }
        // Re-throw the error for this specific request
        throw result.reason;
      });
    }
    // Sequential: execute one by one, stop at first error
    const results: TResult[] = [];
    for (const promise of promises) {
      const result = await promise;
      results.push(result);
    }
    return results;
  }

  /**
   * Get the number of requests in this batch
   */
  get length(): number {
    return this.items.length;
  }

  /**
   * Track a pending request and return a promise
   * @private
   */
  private trackPendingRequest<T>(
    id: string | number,
    timeout: number,
    signal?: AbortSignal
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Setup timeout
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${id} timed out after ${timeout}ms`));
      }, timeout);

      // Create pending request entry
      const pending: PendingRequest = {
        resolve: resolve as (result: any) => void,
        reject,
        timeout: timeoutHandle,
      };

      // Handle AbortSignal if provided
      if (signal) {
        const abortHandler = () => {
          this.pendingRequests.delete(id);
          clearTimeout(timeoutHandle);
          reject(new Error('Request aborted'));
        };

        if (signal.aborted) {
          // Already aborted
          abortHandler();
          return;
        }

        signal.addEventListener('abort', abortHandler, { once: true });
      }

      // Store pending request
      this.pendingRequests.set(id, pending);
    });
  }
}
