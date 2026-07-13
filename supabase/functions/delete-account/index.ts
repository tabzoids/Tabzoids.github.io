// Self-serve account deletion.
// The caller's own JWT identifies them; we purge their storage folders and then
// delete their auth user (which cascades profiles + tab_finds via FK ON DELETE CASCADE).
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

// Recursively collect all object paths under a user's folder in a bucket.
async function listAll(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return out;
  for (const entry of data) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    // Supabase returns folders as rows with a null id.
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

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: uErr } = await userClient.auth.getUser();
  if (uErr || !user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(url, service);

  for (const bucket of ["tab-uploads", "avatars"]) {
    try {
      const paths = await listAll(admin, bucket, user.id);
      if (paths.length) await admin.storage.from(bucket).remove(paths);
    } catch (_) { /* best-effort cleanup */ }
  }

  const { error: dErr } = await admin.auth.admin.deleteUser(user.id);
  if (dErr) return json({ error: dErr.message }, 500);

  return json({ ok: true });
});
