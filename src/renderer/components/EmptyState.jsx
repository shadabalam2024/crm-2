// A blank list is an invitation to act, not a dead end - so every empty
// state names what's missing and gives a direct way to fix it.
export default function EmptyState({ title, message, actionLabel, onAction, icon }) {
  return (
    <div className="row-in flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-4">
        {icon || (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="7" width="18" height="13" rx="2" />
            <path d="M3 11h18" />
            <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        )}
      </div>
      <p className="font-medium text-gray-700">{title}</p>
      {message && <p className="text-sm text-gray-400 mt-1 max-w-sm">{message}</p>}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-4 text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
