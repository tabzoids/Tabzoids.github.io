// Admin-only account manager. Caller must be an admin (profiles.is_admin).
// Actions: list | setAdmin | ban | delete.  Uses the service role for auth.admin.*
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function listAll(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return out;
  for (const entry of data) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) out.push(...await listAll(admin, bucket, path));
    else out.push(path);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // Identify + admin-gate the caller.
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: uErr } = await userClient.auth.getUser();
  if (uErr || !user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(url, service);
  const { data: prof } = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!prof?.is_admin) return json({ error: "forbidden" }, 403);

  const { action, userId, value } = await req.json().catch(() => ({}));

  switch (action) {
    case "list": {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
      if (error) return json({ error: error.message }, 500);
      const ids = data.users.map((u) => u.id);
      const { data: profs } = await admin.from("profiles")
        .select("id, username, display_name, is_admin, avatar_url").in("id", ids);
      const pmap = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
      const users = data.users.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        banned_until: (u as { banned_until?: string }).banned_until ?? null,
        username: pmap[u.id]?.username ?? null,
        display_name: pmap[u.id]?.display_name ?? null,
        avatar_url: pmap[u.id]?.avatar_url ?? null,
        is_admin: pmap[u.id]?.is_admin ?? false,
      }));
      return json({ users });
    }

    case "setAdmin": {
      if (!userId) return json({ error: "userId required" }, 400);
      const { error } = await admin.from("profiles").update({ is_admin: !!value }).eq("id", userId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    case "ban": {
      if (!userId) return json({ error: "userId required" }, 400);
      // value === false unbans; otherwise a long ban.
      const ban_duration = value === false ? "none" : (typeof value === "string" ? value : "876000h");
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    case "delete": {
      if (!userId) return json({ error: "userId required" }, 400);
      if (userId === user.id) return json({ error: "use account deletion for your own account" }, 400);
      for (const bucket of ["tab-uploads", "avatars"]) {
        try {
          const paths = await listAll(admin, bucket, userId);
          if (paths.length) await admin.storage.from(bucket).remove(paths);
        } catch (_) { /* best-effort */ }
      }
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    default:
      return json({ error: "unknown action" }, 400);
  }
});
