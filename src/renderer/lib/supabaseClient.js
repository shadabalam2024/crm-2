import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL || 'https://qirlevkvfpwulgyqlhts.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpcmxldmt2ZnB3dWxneXFsaHRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MTY3NjUsImV4cCI6MjEwNTQ5Mjc2NX0.WmB4UoWdZ_OIj9jjLhYsEAqXFm4FKH5zExo5Oqa21_k'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})
