import { supabase } from '../lib/supabaseClient'

// Used only if the permissions table can't be reached (offline, RLS
// misconfigured, row missing) so the app can still degrade to a safe,
// minimal permission set instead of failing to load entirely.
const FALLBACK_PERMISSIONS = {
  Admin: { billing: true, inventory: true, purchase: true, customers: true, dashboard: true, analytics: true, settings: true, returns: true, daily_closing: true },
  Manager: { billing: true, inventory: true, customers: true, dashboard: true, analytics: true, returns: true, daily_closing: true },
  Cashier: { billing: true, inventory: false, customers: true, returns: true, daily_closing: true },
  Warehouse: { inventory: true, purchase: true },
}

export async function getPermissionsForRole(role) {
  const { data, error } = await supabase
    .from('permissions')
    .select('permissions')
    .eq('role', role)
    .maybeSingle()

  if (error || !data?.permissions) {
    return FALLBACK_PERMISSIONS[role] || FALLBACK_PERMISSIONS.Cashier
  }

  return data.permissions
}
