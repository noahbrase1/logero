// Runs `worker` over `items` with at most `concurrency` in flight at once —
// avoids both an unbounded Promise.all (e.g. up to 50 athletes × 7 days for
// a full grid-to-grid assignment paste) and slow sequential awaits. Each
// item is treated as independent — one failing doesn't stop the rest;
// failures are collected and returned rather than thrown. Shared by
// AssignmentGrid's paste and SplitRecorder's save, both of which fan one
// user action out into many per-athlete requests.
export async function mapWithConcurrency(items, concurrency, worker) {
  const errors = []
  let index = 0
  async function run() {
    while (index < items.length) {
      const item = items[index++]
      try {
        await worker(item)
      } catch (err) {
        errors.push(err)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run))
  return errors
}
