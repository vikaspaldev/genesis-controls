/**
 * Deduplicates concurrent calls to the same async operation.
 *
 * While a call is in-flight, any subsequent call to `run()` receives the
 * same Promise rather than starting a new operation. Once the in-flight
 * Promise settles (success or failure), the slot is cleared so the next
 * call starts fresh.
 *
 * Inspired by Go's `golang.org/x/sync/singleflight`.
 *
 * @example
 * class MyClient {
 *   #loginFlight = new SingleFlight<string>();
 *
 *   async #getToken() {
 *     return this.#loginFlight.run(() => this.#login());
 *   }
 * }
 */
export class SingleFlight<T = void> {
  #inFlight: Promise<T> | null = null;

  /**
   * If no call is in-flight, invokes `fn` and caches the returned Promise.
   * Concurrent callers receive the same Promise and wait for the same result.
   * The cache is cleared when the Promise settles (whether it resolves or rejects).
   */
  run(fn: () => Promise<T>): Promise<T> {
    this.#inFlight ??= fn().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }
}
