import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { supabase } from '../lib/supabaseClient'

const links = [
  { to: '/', label: 'Dashboard', icon: '📊', perm: null },
  { to: '/billing', label: 'Billing', icon: '💳', perm: 'billing' },
  { to: '/inventory', label: 'Inventory', icon: '📦', perm: 'inventory' },
  { to: '/purchase', label: 'Purchase', icon: '🛒', perm: 'purchase' },
  { to: '/customers', label: 'Customers', icon: '👥', perm: 'customers' },
  { to: '/returns', label: 'Returns', icon: '↩️', perm: 'returns' },
  { to: '/daily-closing', label: 'Daily Closing', icon: '🧾', perm: 'daily_closing' },
  { to: '/analytics', label: 'Analytics', icon: '📈', perm: 'analytics' },
  { to: '/settings', label: 'Settings', icon: '⚙️', perm: 'settings' },
]

export default function Sidebar() {
  const permissions = useSelector(state => state.auth.permissions)
  const [logoUrl, setLogoUrl] = useState(null)
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    supabase
      .from('shop_settings')
      .select('logo_path')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setLogoUrl(data?.logo_path || null))
      .catch(() => setLogoUrl(null))
  }, [])

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setOpen(false) }, [location.pathname])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="md:hidden fixed top-3 left-3 z-30 w-10 h-10 rounded-lg bg-gray-900 text-white flex items-center justify-center shadow"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      {open && (
        <div
          className="overlay-in md:hidden fixed inset-0 bg-black/40 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`w-64 bg-gray-900 text-white h-screen p-6 overflow-y-auto shrink-0
          fixed top-0 left-0 z-50 transition-transform duration-200 ease-out
          ${open ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 md:sticky md:z-0`}
      >
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            {logoUrl && <img src={logoUrl} alt="Logo" className="w-8 h-8 object-contain rounded bg-white p-0.5" />}
            <h1 className="text-lg font-bold leading-tight">CRM</h1>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Close menu" className="md:hidden text-gray-400 hover:text-white">
            ✕
          </button>
        </div>
        <nav className="space-y-4">
          {links.map(({ to, label, icon, perm }) => (
            (!perm || permissions[perm]) && (
              <Link
                key={to}
                to={to}
                className={`block px-4 py-2 rounded transition-colors ${
                  location.pathname === to ? 'bg-gray-800' : 'hover:bg-gray-800'
                }`}
              >
                {icon} {label}
              </Link>
            )
          ))}
        </nav>
      </aside>
    </>
  )
}
