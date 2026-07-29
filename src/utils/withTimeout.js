// Races a promise against a hard timeout so a fetch that never settles (the
// most common symptom of a PWA tab resuming from a long background/sleep
// period with a silently-dead connection) can't leave a "loading" state
// stuck forever — it rejects instead, so the caller can show a retryable
// error rather than an infinite spinner.
export function withTimeout(promise, ms = 9000, message = 'Timed out') {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
