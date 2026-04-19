import { getBearerToken, getSupabaseAdmin, getUserFromAccessToken } from "./authSupabase.js"

function utcYmd() {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function daysBetweenYmd(a, b) {
  const [ya, ma, da] = a.split("-").map(Number)
  const [yb, mb, db] = b.split("-").map(Number)
  const ua = Date.UTC(ya, ma - 1, da)
  const ub = Date.UTC(yb, mb - 1, db)
  return Math.round((ub - ua) / 86400000)
}

function nextStreakFromVisit({ lastVisitYmd, currentStreak, longestStreak }, today) {
  if (lastVisitYmd === today) {
    return { lastVisitYmd, currentStreak, longestStreak }
  }
  let next = 1
  if (lastVisitYmd) {
    const gap = daysBetweenYmd(lastVisitYmd, today)
    if (gap === 1) next = (currentStreak || 0) + 1
    else next = 1
  }
  const longest = Math.max(longestStreak || 0, next)
  return { lastVisitYmd: today, currentStreak: next, longestStreak: longest }
}

async function ensureProfile(admin, userId, email) {
  const { data: row, error: selErr } = await admin.from("profiles").select("*").eq("id", userId).maybeSingle()
  if (selErr) throw selErr
  if (row) return row
  const fallbackName = email?.split("@")[0] || "ORBIT user"
  const { error: insErr } = await admin.from("profiles").insert({
    id: userId,
    display_name: fallbackName,
  })
  if (insErr && insErr.code !== "23505") throw insErr
  const { data: again, error: rErr } = await admin.from("profiles").select("*").eq("id", userId).single()
  if (rErr) throw rErr
  return again
}

/**
 * @param {import("express").Express} app
 */
export function registerMeRoutes(app) {
  app.get("/me/state", async (req, res) => {
    try {
      const token = getBearerToken(req)
      if (!token) return res.status(401).json({ error: "Missing Authorization: Bearer <access_token>" })
      const user = await getUserFromAccessToken(token)
      if (!user) return res.status(401).json({ error: "Invalid or expired session" })

      const admin = getSupabaseAdmin()
      const profile = await ensureProfile(admin, user.id, user.email ?? "")

      return res.json({
        userId: user.id,
        email: user.email,
        displayName: profile.display_name ?? "",
        lastVisitYmd: profile.last_visit_ymd,
        currentStreak: profile.current_streak ?? 0,
        longestStreak: profile.longest_streak ?? 0,
        goals: Array.isArray(profile.goals_data) ? profile.goals_data : [],
        calendar: profile.calendar_data && typeof profile.calendar_data === "object" ? profile.calendar_data : {},
      })
    } catch (e) {
      console.error("[ORBIT] /me/state:", e)
      return res.status(500).json({ error: e?.message ?? "Server error" })
    }
  })

  app.post("/me/visit", async (req, res) => {
    try {
      const token = getBearerToken(req)
      if (!token) return res.status(401).json({ error: "Missing Authorization: Bearer <access_token>" })
      const user = await getUserFromAccessToken(token)
      if (!user) return res.status(401).json({ error: "Invalid or expired session" })

      const admin = getSupabaseAdmin()
      const today = utcYmd()
      const { error: vErr } = await admin.from("daily_visits").upsert(
        { user_id: user.id, visit_date: today },
        { onConflict: "user_id,visit_date" },
      )
      if (vErr) throw vErr

      const profile = await ensureProfile(admin, user.id, user.email ?? "")
      const streak = nextStreakFromVisit(
        {
          lastVisitYmd: profile.last_visit_ymd,
          currentStreak: profile.current_streak,
          longestStreak: profile.longest_streak,
        },
        today,
      )

      const { error: uErr } = await admin
        .from("profiles")
        .update({
          last_visit_ymd: streak.lastVisitYmd,
          current_streak: streak.currentStreak,
          longest_streak: streak.longestStreak,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)
      if (uErr) throw uErr

      return res.json({
        lastVisitYmd: streak.lastVisitYmd,
        currentStreak: streak.currentStreak,
        longestStreak: streak.longestStreak,
      })
    } catch (e) {
      console.error("[ORBIT] /me/visit:", e)
      return res.status(500).json({ error: e?.message ?? "Server error" })
    }
  })

  app.put("/me/state", async (req, res) => {
    try {
      const token = getBearerToken(req)
      if (!token) return res.status(401).json({ error: "Missing Authorization: Bearer <access_token>" })
      const user = await getUserFromAccessToken(token)
      if (!user) return res.status(401).json({ error: "Invalid or expired session" })

      const body = req.body && typeof req.body === "object" ? req.body : {}
      const patch = { updated_at: new Date().toISOString() }
      if (Array.isArray(body.goals)) patch.goals_data = body.goals
      if (body.calendar && typeof body.calendar === "object") patch.calendar_data = body.calendar
      if (typeof body.displayName === "string" && body.displayName.trim()) {
        patch.display_name = body.displayName.trim().slice(0, 120)
      }

      const admin = getSupabaseAdmin()
      await ensureProfile(admin, user.id, user.email ?? "")
      const { error } = await admin.from("profiles").update(patch).eq("id", user.id)
      if (error) throw error
      return res.json({ ok: true })
    } catch (e) {
      console.error("[ORBIT] /me/state:", e)
      return res.status(500).json({ error: e?.message ?? "Server error" })
    }
  })
}
