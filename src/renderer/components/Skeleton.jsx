export function Skeleton({ className = '', style }) {
  return <div className={`animate-pulse rounded bg-gray-200 ${className}`} style={style} />
}

// Mimics the shape of the table it's about to become, so the layout doesn't
// jump once real rows arrive.
export function TableSkeleton({ rows = 5, cols = 4 }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-6 py-4">
              <Skeleton className="h-4" style={{ width: `${55 + ((r + c) % 4) * 10}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}
