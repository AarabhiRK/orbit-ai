import { createClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export function isSupabaseClientConfigured() {
  return Boolean(url && anonKey)
}

/** Browser Supabase client (anon key + user session). */
export function getSupabase() {
  if (!url || !anonKey) return null
  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}
