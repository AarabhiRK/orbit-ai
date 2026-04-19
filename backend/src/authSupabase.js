import { createClient } from "@supabase/supabase-js"

const url = process.env.SUPABASE_URL?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const anonKey = process.env.SUPABASE_ANON_KEY?.trim()

export function isSupabaseConfigured() {
  return Boolean(url && serviceKey && anonKey)
}

/** For /health only — booleans so you can see what is missing without exposing keys. */
export function getSupabaseEnvDebug() {
  return {
    url_set: Boolean(url),
    anon_key_set: Boolean(anonKey),
    service_role_set: Boolean(serviceKey),
  }
}

let adminClient = null

/** Service role — server only; bypasses RLS. */
export function getSupabaseAdmin() {
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
  }
  if (!adminClient) {
    adminClient = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return adminClient
}

export function getBearerToken(req) {
  const h = req.headers.authorization || ""
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1].trim() : ""
}

/**
 * Validate Supabase access token and return the user row (or null).
 * @param {string} accessToken
 */
export async function getUserFromAccessToken(accessToken) {
  if (!accessToken || !url || !anonKey) return null
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.getUser(accessToken)
  if (error || !data?.user) return null
  return data.user
}
