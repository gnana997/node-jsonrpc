import type { JSONRPCError as IJSONRPCError } from './types.js';

/**
 * JSON-RPC Error class
 * Extends Error with JSON-RPC error properties
 *
 * Standard JSON-RPC 2.0 error codes:
 * - -32700: Parse error (invalid JSON)
 * - -32600: Invalid Request (not a valid JSON-RPC request)
 * - -32601: Method not found
 * - -32602: Invalid params
 * - -32603: Internal error
 * - -32000 to -32099: Server error (implementation-defined)
 */
export class JSONRPCError extends Error implements IJSONRPCError {
  code: number;
  data?: any;

  constructor(code: number, message: string, data?: any);
  constructor(error: IJSONRPCError);
  constructor(codeOrError: number | IJSONRPCError, message?: string, data?: any) {
    if (typeof codeOrError === 'object') {
      // Constructor with error object
      super(codeOrError.message);
      this.code = codeOrError.code;
      this.data = codeOrError.data;
    } else {
      // Constructor with individual parameters
      super(message!);
      this.code = codeOrError;
      this.data = data;
    }

    this.name = 'JSONRPCError';

    // Maintain proper stack trace for debugging
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, JSONRPCError);
    }
  }

  /**
   * Standard JSON-RPC 2.0 error codes
   */
  static readonly PARSE_ERROR = -32700;
  static readonly INVALID_REQUEST = -32600;
  static readonly METHOD_NOT_FOUND = -32601;
  static readonly INVALID_PARAMS = -32602;
  static readonly INTERNAL_ERROR = -32603;

  /**
   * Server error range: -32000 to -32099
   * Reserved for implementation-defined server errors
   */
  static readonly SERVER_ERROR_MIN = -32000;
  static readonly SERVER_ERROR_MAX = -32099;

  /**
   * Create a parse error
   */
  static parseError(data?: any): JSONRPCError {
    return new JSONRPCError(
      JSONRPCError.PARSE_ERROR,
      'Parse error: Invalid JSON was received by the server',
      data
    );
  }

  /**
   * Create an invalid request error
   */
  static invalidRequest(data?: any): JSONRPCError {
    return new JSONRPCError(
      JSONRPCError.INVALID_REQUEST,
      'Invalid Request: The JSON sent is not a valid Request object',
      data
    );
  }

  /**
   * Create a method not found error
   */
  static methodNotFound(method: string): JSONRPCError {
    return new JSONRPCError(JSONRPCError.METHOD_NOT_FOUND, `Method not found: ${method}`, {
      method,
    });
  }

  /**
   * Create an invalid params error
   */
  static invalidParams(message?: string, data?: any): JSONRPCError {
    return new JSONRPCError(
      JSONRPCError.INVALID_PARAMS,
      message || 'Invalid params: Invalid method parameter(s)',
      data
    );
  }

  /**
   * Create an internal error
   */
  static internalError(message?: string, data?: any): JSONRPCError {
    return new JSONRPCError(
      JSONRPCError.INTERNAL_ERROR,
      message || 'Internal error: Internal JSON-RPC error',
      data
    );
  }

  /**
   * Create a custom server error
   * Code must be in the range -32000 to -32099
   */
  static serverError(code: number, message: string, data?: any): JSONRPCError {
    if (code < JSONRPCError.SERVER_ERROR_MIN || code > JSONRPCError.SERVER_ERROR_MAX) {
      throw new Error(
        `Server error code must be between ${JSONRPCError.SERVER_ERROR_MIN} and ${JSONRPCError.SERVER_ERROR_MAX}`
      );
    }
    return new JSONRPCError(code, message, data);
  }

  /**
   * Convert to JSON-RPC error object
   */
  toJSON(): IJSONRPCError {
    return {
      code: this.code,
      message: this.message,
      ...(this.data !== undefined && { data: this.data }),
    };
  }
}
