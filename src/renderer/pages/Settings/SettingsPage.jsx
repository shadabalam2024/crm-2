import { useState, useEffect } from 'react'
import Navbar from '../../components/Navbar'
import Sidebar from '../../components/Sidebar'
import EmptyState from '../../components/EmptyState'
import { Skeleton, TableSkeleton } from '../../components/Skeleton'
import { supabase } from '../../lib/supabaseClient'

const PERMISSION_KEYS = ['dashboard', 'billing', 'inventory', 'purchase', 'customers', 'analytics', 'settings']
const ROLE_OPTIONS = ['Admin', 'Manager', 'Cashier', 'Warehouse']
const LOGO_BUCKET = 'shop-assets'
const LOGO_STORAGE_PATH = 'shop-logo'

function Field({ label, className = '', children }) {
  return (
    <div className={className}>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

// The Edge Function that backs privileged user-management actions (create /
// delete / reset-password) is something the user has to deploy themselves
// (`supabase functions deploy admin-users`) - it isn't something this app can
// deploy on its own. If it hasn't been deployed yet, supabase-js returns an
// error here instead of a raw crash; surface that clearly.
const describeFunctionError = (error) => {
  if (!error) return 'Something went wrong.'
  const message = error.message || String(error)
  if (/failed to send a request|not found|404/i.test(message)) {
    return 'This action requires the "admin-users" Edge Function, which has not been deployed to this Supabase project yet.'
  }
  return message
}

function ShopInfoTab() {
  const [form, setForm] = useState({
    shop_name: '', shop_address: '', shop_phone: '', shop_email: '',
    gst_number: '', gst_rate: '', payment_terms: '', return_policy: '',
    thermal_printing_enabled: false, thermal_paper_width: 80
  })
  const [logoUrl, setLogoUrl] = useState(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    const { data, error } = await supabase
      .from('shop_settings')
      .select('*')
      .limit(1)
      .maybeSingle()

    if (!error && data) {
      setForm(f => ({ ...f, ...data, thermal_printing_enabled: !!data.thermal_printing_enabled }))
      setLogoUrl(data.logo_path || null)
    }
    setLoading(false)
  }

  const handleUploadLogo = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setUploadingLogo(true)
    setMessage('')
    try {
      const { error: uploadError } = await supabase.storage
        .from(LOGO_BUCKET)
        .upload(LOGO_STORAGE_PATH, file, { upsert: true, contentType: file.type })

      if (uploadError) throw uploadError

      const { data: publicUrlData } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(LOGO_STORAGE_PATH)
      const publicUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`

      const { error: saveError } = await supabase
        .from('shop_settings')
        .upsert({ id: 1, logo_path: publicUrl }, { onConflict: 'id' })

      if (saveError) throw saveError

      setLogoUrl(publicUrl)
      setMessage('Logo updated')
      setTimeout(() => setMessage(''), 3000)
    } catch (error) {
      setMessage(error.message || 'Failed to upload logo')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleRemoveLogo = async () => {
    setMessage('')
    try {
      const { error } = await supabase
        .from('shop_settings')
        .upsert({ id: 1, logo_path: null }, { onConflict: 'id' })

      if (error) throw error

      await supabase.storage.from(LOGO_BUCKET).remove([LOGO_STORAGE_PATH])
      setLogoUrl(null)
    } catch (error) {
      setMessage(error.message || 'Failed to remove logo')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMessage('')

    const { logo_path, ...rest } = form
    const { error } = await supabase
      .from('shop_settings')
      .upsert({ id: 1, ...rest }, { onConflict: 'id' })

    setMessage(error ? (error.message || 'Failed to save') : 'Saved')
    setSaving(false)
    setTimeout(() => setMessage(''), 3000)
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6 max-w-2xl">
        <h2 className="text-xl font-bold mb-4">Shop Information</h2>
        <Skeleton className="h-20 w-20 mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Skeleton className="h-10 sm:col-span-2" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-16 sm:col-span-2" />
          <Skeleton className="h-16 sm:col-span-2" />
          <Skeleton className="h-16 sm:col-span-2" />
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 max-w-2xl">
      <h2 className="text-xl font-bold mb-4">Shop Information</h2>

      <label className="block text-xs text-gray-500 mb-1">Company Logo</label>
      <div className="flex items-center gap-4 mb-4">
        <div className="w-20 h-20 border rounded flex items-center justify-center bg-gray-50 overflow-hidden">
          {logoUrl ? (
            <img src={logoUrl} alt="Company logo" className="max-w-full max-h-full object-contain" />
          ) : (
            <span className="text-xs text-gray-400">No logo</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <label className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50 cursor-pointer text-center">
            {uploadingLogo ? 'Uploading...' : (logoUrl ? 'Change Logo' : 'Upload Logo')}
            <input type="file" accept="image/*" onChange={handleUploadLogo} disabled={uploadingLogo} className="hidden" />
          </label>
          {logoUrl && (
            <button type="button" onClick={handleRemoveLogo} className="px-3 py-1.5 text-sm text-red-600 hover:underline">
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <Field label="Shop Name" className="sm:col-span-2">
          <input placeholder="Shop Name" value={form.shop_name || ''}
            onChange={(e) => setForm({ ...form, shop_name: e.target.value })}
            className="w-full px-4 py-2 border rounded" />
        </Field>
        <Field label="Phone">
          <input placeholder="Phone" value={form.shop_phone || ''}
            onChange={(e) => setForm({ ...form, shop_phone: e.target.value })}
            className="w-full px-4 py-2 border rounded" />
        </Field>
        <Field label="Email">
          <input placeholder="Email" value={form.shop_email || ''}
            onChange={(e) => setForm({ ...form, shop_email: e.target.value })}
            className="w-full px-4 py-2 border rounded" />
        </Field>
        <Field label="GST Number">
          <input placeholder="GST Number" value={form.gst_number || ''}
            onChange={(e) => setForm({ ...form, gst_number: e.target.value })}
            className="w-full px-4 py-2 border rounded" />
        </Field>
        <Field label="GST Rate (%)">
          <input placeholder="GST Rate (%)" type="number" min="0" step="0.01" value={form.gst_rate || ''}
            onChange={(e) => setForm({ ...form, gst_rate: e.target.value })}
            className="w-full px-4 py-2 border rounded" />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <textarea placeholder="Address" value={form.shop_address || ''}
            onChange={(e) => setForm({ ...form, shop_address: e.target.value })}
            className="w-full px-4 py-2 border rounded" />
        </Field>
        <Field label="Payment Terms (shown on invoices)" className="sm:col-span-2">
          <textarea placeholder="Payment Terms (shown on invoices)" value={form.payment_terms || ''}
            onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
            className="w-full px-4 py-2 border rounded" />
        </Field>
        <Field label="Return Policy (shown on invoices)" className="sm:col-span-2">
          <textarea placeholder="Return Policy (shown on invoices)" value={form.return_policy || ''}
            onChange={(e) => setForm({ ...form, return_policy: e.target.value })}
            className="w-full px-4 py-2 border rounded" />
        </Field>
      </div>

      <div className="border-t pt-4 mb-4">
        <h3 className="text-sm font-bold text-gray-700 mb-2">Receipt Printing</h3>
        <p className="text-xs text-gray-500 mb-3">
          These only affect the sizing of the printed invoice page - the browser's own print
          dialog is used to pick a printer.
        </p>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.thermal_printing_enabled}
              onChange={(e) => setForm({ ...form, thermal_printing_enabled: e.target.checked })} />
            Use thermal receipt sizing
          </label>
          <Field label="Paper Width" className="w-32">
            <select value={form.thermal_paper_width || 80}
              onChange={(e) => setForm({ ...form, thermal_paper_width: parseInt(e.target.value) })}
              className="w-full px-3 py-2 border rounded">
              <option value={80}>80mm</option>
              <option value={58}>58mm</option>
            </select>
          </Field>
        </div>
      </div>

      {message && <p className="text-green-600 mb-4 text-sm">{message}</p>}
      <button type="submit" disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Saving...' : 'Save Shop Settings'}
      </button>
    </form>
  )
}

function UsersRolesTab() {
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [showUserForm, setShowUserForm] = useState(false)
  const [userForm, setUserForm] = useState({ username: '', password: '', role: '' })
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([loadUsers(), loadRoles()]).finally(() => setLoading(false))
  }, [])

  const loadUsers = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, role, created_at')
      .order('created_at', { ascending: true })

    if (!error) setUsers(data || [])
  }

  const loadRoles = async () => {
    const { data, error } = await supabase
      .from('permissions')
      .select('*')
      .order('role', { ascending: true })

    if (!error) setRoles(data || [])
  }

  const handleCreateUser = async (e) => {
    e.preventDefault()
    setError('')
    setCreating(true)

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('admin-users', {
        body: { action: 'create', username: userForm.username, password: userForm.password, role: userForm.role }
      })

      if (invokeError) throw invokeError
      if (data && data.success === false) throw new Error(data.message || 'Could not create user')

      setShowUserForm(false)
      setUserForm({ username: '', password: '', role: '' })
      loadUsers()
    } catch (err) {
      setError(describeFunctionError(err))
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteUser = async (user) => {
    if (!confirm(`Delete user "${user.username}"?`)) return
    setError('')

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('admin-users', {
        body: { action: 'delete', userId: user.id }
      })

      if (invokeError) throw invokeError
      if (data && data.success === false) throw new Error(data.message || 'Could not delete user')

      loadUsers()
    } catch (err) {
      setError(describeFunctionError(err))
    }
  }

  const handleResetPassword = async (user) => {
    const newPassword = window.prompt(`New password for "${user.username}":`)
    if (!newPassword) return
    setError('')

    try {
      const { data, error: invokeError } = await supabase.functions.invoke('admin-users', {
        body: { action: 'reset-password', userId: user.id, newPassword }
      })

      if (invokeError) throw invokeError
      if (data && data.success === false) throw new Error(data.message || 'Could not reset password')

      alert('Password reset.')
    } catch (err) {
      setError(describeFunctionError(err))
    }
  }

  const togglePermission = (role, currentPermissions, key) => {
    const updated = { ...currentPermissions, [key]: !currentPermissions[key] }
    setRoles(prev => prev.map(r => r.role === role ? { ...r, permissions: updated } : r))
  }

  const saveRolePermissions = async (role) => {
    setError('')
    const { error: updateError } = await supabase
      .from('permissions')
      .update({ permissions: role.permissions })
      .eq('role', role.role)

    if (updateError) setError(updateError.message)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Users</h2>
          <button onClick={() => setShowUserForm(v => !v)} className="text-blue-600 hover:underline text-sm">
            + New User
          </button>
        </div>

        {showUserForm && (
          <form onSubmit={handleCreateUser} className="border rounded p-4 mb-4 bg-gray-50">
            <Field label="Username or Email" className="mb-2">
              <input required placeholder="Username or Email" value={userForm.username}
                onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                className="w-full px-3 py-2 border rounded" />
            </Field>
            <Field label="Password" className="mb-2">
              <input required type="password" placeholder="Password" value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                className="w-full px-3 py-2 border rounded" />
            </Field>
            <Field label="Role" className="mb-2">
              <select required value={userForm.role}
                onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                className="w-full px-3 py-2 border rounded">
                <option value="">Select Role</option>
                {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
            <button type="submit" disabled={creating} className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50">
              {creating ? 'Creating...' : 'Create User'}
            </button>
          </form>
        )}

        {!showUserForm && error && <p className="text-red-500 text-sm mb-2">{error}</p>}

        {loading ? (
          <table className="w-full text-sm"><TableSkeleton rows={4} cols={3} /></table>
        ) : users.length === 0 ? (
          <EmptyState title="No users yet" message="Create your first user with the button above." actionLabel="+ New User" onAction={() => setShowUserForm(true)} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Username</th>
                <th className="py-2">Role</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="row-in border-b">
                  <td className="py-2">{u.username}</td>
                  <td className="py-2">{u.role}</td>
                  <td className="py-2 text-right space-x-3 whitespace-nowrap">
                    <button onClick={() => handleResetPassword(u)} className="text-gray-600 hover:underline">Reset Password</button>
                    <button onClick={() => handleDeleteUser(u)} className="text-red-600 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-4">Role Permissions</h2>
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
        <div className="space-y-6">
          {roles.map(role => (
            <div key={role.role} className="row-in border-b pb-4 last:border-0">
              <div className="flex justify-between items-center mb-2">
                <p className="font-bold">{role.role}</p>
                <button onClick={() => saveRolePermissions(role)} className="text-blue-600 hover:underline text-sm">
                  Save
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {PERMISSION_KEYS.map(key => (
                  <label key={key} className="flex items-center gap-2 text-sm capitalize">
                    <input
                      type="checkbox"
                      checked={!!role.permissions?.[key]}
                      onChange={() => togglePermission(role.role, role.permissions || {}, key)}
                    />
                    {key}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {roles.length === 0 && <p className="text-sm text-gray-400">No roles found.</p>}
        </div>
        )}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const [tab, setTab] = useState('shop')

  const tabs = [
    { key: 'shop', label: 'Shop Info' },
    { key: 'users', label: 'Users & Roles' }
  ]

  return (
    <div className="flex">
      <Sidebar />
      <div className="flex-1">
        <Navbar />
        <div className="p-4 sm:p-8">
          <h1 className="text-3xl font-bold mb-6">Settings</h1>

          <div className="flex gap-2 mb-6 border-b">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 font-medium ${tab === t.key ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'shop' && <ShopInfoTab />}
          {tab === 'users' && <UsersRolesTab />}
        </div>
      </div>
    </div>
  )
}
