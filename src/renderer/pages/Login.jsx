import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { setUser } from '../store/slices/auth'
import { supabase } from '../lib/supabaseClient'
import { getPermissionsForRole } from '../utils/permissions'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const dispatch = useDispatch()

  const handleLogin = async (e) => {
    e.preventDefault()

    const loginValue = username.trim()

    if (!loginValue || !password) {
      setMessage('Username or email and password are required.')
      return
    }

    try {
      let emailToUse = loginValue

      if (!loginValue.includes('@')) {
        const { data: resolvedEmail, error: usernameLookupError } = await supabase
          .rpc('get_email_for_username', { p_username: loginValue })

        if (usernameLookupError) {
          setMessage(usernameLookupError.message)
          return
        }

        if (!resolvedEmail) {
          setMessage('Username not found. Try your email or create the profile row first.')
          return
        }

        emailToUse = resolvedEmail
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailToUse,
        password,
      })

      if (error) {
        setMessage(error.message)
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .maybeSingle()

      if (profileError && profileError.code !== 'PGRST116') {
        setMessage(profileError.message)
        return
      }

      const role = profile?.role || 'Cashier'
      const permissions = await getPermissionsForRole(role)

      dispatch(setUser({
        user: {
          id: data.user.id,
          email: data.user.email,
          role,
          permissions,
        },
        permissions,
      }))
    } catch (error) {
      setMessage(error.message || 'Unable to sign in.')
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-md w-96">
        <h1 className="text-3xl font-bold mb-6 text-center">CRM</h1>
        <form onSubmit={handleLogin}>
          <label className="block text-xs text-gray-500 mb-1">Username or Email</label>
          <input
            type="text"
            placeholder="user@ex.com or username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-2 border rounded mb-4"
          />
          <label className="block text-xs text-gray-500 mb-1">Password</label>
          <div className="relative mb-4">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border rounded pr-16"
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {message && <p className="text-red-500 mb-4">{message}</p>}
          <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700">
            Login
          </button>
        </form>
      </div>
    </div>
  )
}
