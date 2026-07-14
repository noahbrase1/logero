// Generic shimmer placeholder for a single line/block.
export function Skeleton({ width = '100%', height = '1rem', style }) {
  return <div className="skeleton" style={{ width, height, ...style }} />
}

// A card-shaped placeholder matching the general shape of a workout/event/
// list card — used to fill a list while its data is still loading.
export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <Skeleton width="30%" height="0.75rem" style={{ marginBottom: '0.85rem' }} />
      <Skeleton width="60%" height="1.1rem" style={{ marginBottom: '0.6rem' }} />
      <Skeleton width="85%" height="0.85rem" />
    </div>
  )
}

// Renders `count` SkeletonCards in a stack — drop-in replacement for a list
// that's still loading.
export function SkeletonList({ count = 3 }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
