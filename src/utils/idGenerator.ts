/**
 * ID Generator for JSON-RPC requests
 * Generates monotonically increasing numeric IDs
 *
 * Note: This is NOT cryptographically secure.
 * For security-sensitive applications, consider using UUIDs or other secure ID generation.
 */
export class IDGenerator {
  private currentId: number;

  /**
   * Create a new ID generator
   * @param startId - Starting ID (default: 0)
   */
  constructor(startId = 0) {
    this.currentId = startId;
  }

  /**
   * Generate the next ID
   * @returns Next numeric ID
   */
  next(): number {
    return ++this.currentId;
  }

  /**
   * Get the current ID without incrementing
   * @returns Current ID
   */
  current(): number {
    return this.currentId;
  }

  /**
   * Reset the ID generator to a specific value
   * @param value - Value to reset to (default: 0)
   */
  reset(value = 0): void {
    this.currentId = value;
  }
}

/**
 * Default ID generator instance
 * Can be used if you don't need multiple independent sequences
 */
export const defaultIDGenerator = new IDGenerator();
