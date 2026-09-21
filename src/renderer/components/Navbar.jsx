import { useDispatch, useSelector } from 'react-redux'
import { logout } from '../store/slices/auth'
import { supabase } from '../lib/supabaseClient'

export default function Navbar() {
  const user = useSelector(state => state.auth.user)
  const dispatch = useDispatch()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    dispatch(logout())
  }

  return (
    <nav className="bg-white shadow-md pl-16 pr-4 md:px-8 py-4 flex justify-between items-center gap-3">
      <div className="min-w-0">
        <p className="text-sm text-gray-600">Logged in as</p>
        <p className="font-bold truncate">{user?.email || 'User'} ({user?.role || 'Member'})</p>
      </div>
      <button
        onClick={handleLogout}
        className="shrink-0 bg-red-600 text-white px-4 py-2 rounded transition-colors hover:bg-red-700"
      >
        Logout
      </button>
    </nav>
  )
}
