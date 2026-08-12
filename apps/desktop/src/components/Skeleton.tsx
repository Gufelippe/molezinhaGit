interface ListProps {
  rows?: number;
  /** Adds a leading circle, matching rows that start with an avatar. */
  avatar?: boolean;
}

/** Neumorphic placeholder rows used while a list is loading. */
export function SkeletonList({ rows = 4, avatar = true }: ListProps) {
  return (
    <div className="skeleton-list" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          {avatar && <div className="skeleton-avatar skeleton-line" />}
          <div className="skeleton-row-body">
            <div className="skeleton-line" style={{ width: `${55 + ((i * 13) % 30)}%` }} />
            <div className="skeleton-line skeleton-line-sm" style={{ width: `${30 + ((i * 17) % 40)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
