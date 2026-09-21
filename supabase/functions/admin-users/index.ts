// Supabase Edge Function: admin-users
//
// Handles the privileged parts of Users & Roles management that the browser
// can never be trusted with directly (creating/deleting auth users, resetting
// passwords) because they require the service-role key, which must never
// ship to client code.
//
// Deploy with:
//   supabase functions deploy admin-users
//
// Requires these secrets to be set in the Supabase project (the first two are
// provided automatically by the platform for every Edge Function; you do not
// need to set them yourself):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// The frontend calls this via:
//   supabase.functions.invoke('admin-users', { body: { action: 'create', ... } })
// The supabase-js client automatically attaches the caller's JWT in the
// Authorization header, which this function verifies before doing anything.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.53.0'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return json({ success: false, message: 'Method not allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ success: false, message: 'Edge Function is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY secrets.' }, 500)
  }

  const authHeader = req.headers.get('Authorization') || ''
  const callerJwt = authHeader.replace(/^Bearer\s+/i, '')

  if (!callerJwt) {
    return json({ success: false, message: 'Missing Authorization header.' }, 401)
  }

  // Service-role client: bypasses RLS, only used after we've verified the caller is an Admin.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Identify the caller from their JWT.
  const { data: callerData, error: callerError } = await adminClient.auth.getUser(callerJwt)
  if (callerError || !callerData?.user) {
    return json({ success: false, message: 'Invalid or expired session.' }, 401)
  }

  const callerId = callerData.user.id

  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', callerId)
    .maybeSingle()

  if (profileError) {
    return json({ success: false, message: `Could not verify caller role: ${profileError.message}` }, 500)
  }

  if (callerProfile?.role !== 'Admin') {
    return json({ success: false, message: 'Only Admins can manage users.' }, 403)
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return json({ success: false, message: 'Invalid JSON body.' }, 400)
  }

  const action = payload.action

  try {
    if (action === 'create') {
      const { username, password, role } = payload as { username?: string; password?: string; role?: string }

      if (!username || !password || !role) {
        return json({ success: false, message: 'username, password and role are required.' }, 400)
      }

      const email = username.includes('@') ? username : `${username}@local.invalid`

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })

      if (createError || !created?.user) {
        return json({ success: false, message: createError?.message || 'Failed to create user.' }, 400)
      }

      // profiles row: an insert/update trigger (handle_new_user) may already create
      // one on auth.users insert - upsert here so this works either way, and set
      // the requested username/role explicitly (the trigger's role guard doesn't
      // block a service-role write).
      const { error: upsertError } = await adminClient
        .from('profiles')
        .upsert({ id: created.user.id, username, role }, { onConflict: 'id' })

      if (upsertError) {
        // Roll back the auth user so we don't leave an orphaned login with no profile.
        await adminClient.auth.admin.deleteUser(created.user.id)
        return json({ success: false, message: `User created but profile setup failed: ${upsertError.message}` }, 500)
      }

      return json({ success: true, userId: created.user.id })
    }

    if (action === 'delete') {
      const { userId } = payload as { userId?: string }
      if (!userId) {
        return json({ success: false, message: 'userId is required.' }, 400)
      }

      if (userId === callerId) {
        return json({ success: false, message: 'You cannot delete your own account.' }, 400)
      }

      const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId)
      if (deleteError) {
        return json({ success: false, message: deleteError.message }, 400)
      }

      // profiles row is expected to cascade-delete via a foreign key to auth.users;
      // clean it up explicitly too in case that FK isn't set up that way.
      await adminClient.from('profiles').delete().eq('id', userId)

      return json({ success: true })
    }

    if (action === 'reset-password') {
      const { userId, newPassword } = payload as { userId?: string; newPassword?: string }
      if (!userId || !newPassword) {
        return json({ success: false, message: 'userId and newPassword are required.' }, 400)
      }

      const { error: resetError } = await adminClient.auth.admin.updateUserById(userId, { password: newPassword })
      if (resetError) {
        return json({ success: false, message: resetError.message }, 400)
      }

      return json({ success: true })
    }

    return json({ success: false, message: `Unknown action: ${String(action)}` }, 400)
  } catch (error) {
    return json({ success: false, message: error instanceof Error ? error.message : 'Unexpected error.' }, 500)
  }
})
