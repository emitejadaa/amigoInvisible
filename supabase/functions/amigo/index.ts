import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROOM_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // sin 0/O/1/I

function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return code;
}

// Derangement (Fisher-Yates): nadie queda asignado a si mismo.
function computeAssignments<T>(entries: T[]): T[] {
  const n = entries.length;
  const indices = entries.map((_, i) => i);
  let shuffled: number[] = [];
  let attempts = 0;
  do {
    shuffled = [...indices];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    attempts++;
  } while (shuffled.some((v, i) => v === i) && attempts < 200);

  if (shuffled.some((v, i) => v === i)) {
    shuffled = indices.map((_, i) => (i + 1) % n); // fallback: rotacion
  }
  return shuffled.map((idx) => entries[idx]);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  const action = String(payload.action || "");

  try {
    switch (action) {
      case "create_room":
        return await createRoom(supabase, payload);
      case "join_room":
        return await joinRoom(supabase, payload);
      case "toggle_participate":
        return await toggleParticipate(supabase, payload);
      case "kick":
        return await kick(supabase, payload);
      case "start_draw":
        return await startDraw(supabase, payload);
      case "my_result":
        return await myResult(supabase, payload);
      default:
        return json({ error: "Acción desconocida." }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "Error interno del servidor." }, 500);
  }
});

// deno-lint-ignore no-explicit-any
type SB = any;

async function verifyAdmin(supabase: SB, code: string, adminToken: string) {
  const { data } = await supabase
    .from("room_secrets")
    .select("admin_token")
    .eq("code", code)
    .maybeSingle();
  return data && data.admin_token === adminToken;
}

async function createRoom(supabase: SB, payload: Record<string, unknown>) {
  const adminName = String(payload.adminName || "").trim();
  if (!adminName) return json({ error: "Ingresá tu nombre." }, 400);

  let code = "";
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = generateRoomCode();
    const { data: existing } = await supabase
      .from("rooms")
      .select("code")
      .eq("code", candidate)
      .maybeSingle();
    if (!existing) {
      code = candidate;
      break;
    }
  }
  if (!code) return json({ error: "No se pudo generar la sala, reintentá." }, 500);

  const adminToken = crypto.randomUUID();

  const { error: roomErr } = await supabase.from("rooms").insert({
    code,
    admin_name: adminName,
    admin_participating: false,
    status: "lobby",
  });
  if (roomErr) throw roomErr;

  const { error: secretErr } = await supabase
    .from("room_secrets")
    .insert({ code, admin_token: adminToken });
  if (secretErr) throw secretErr;

  return json({ code, adminToken, adminName });
}

async function joinRoom(supabase: SB, payload: Record<string, unknown>) {
  const code = String(payload.code || "").trim().toUpperCase();
  const name = String(payload.name || "").trim();
  if (!name) return json({ error: "Ingresá tu nombre." }, 400);

  const { data: room } = await supabase
    .from("rooms")
    .select("code, admin_name, status")
    .eq("code", code)
    .maybeSingle();
  if (!room) return json({ error: "La sala no existe." }, 404);
  if (room.status !== "lobby") {
    return json({ error: "El sorteo ya se realizó, no se puede unir." }, 409);
  }

  const target = name.toLowerCase();
  if (room.admin_name.toLowerCase() === target) {
    return json({ error: "Ese nombre ya está en uso en la sala." }, 409);
  }
  const { data: participants } = await supabase
    .from("participants")
    .select("name")
    .eq("code", code);
  if ((participants || []).some((p: { name: string }) =>
    p.name.toLowerCase() === target)) {
    return json({ error: "Ese nombre ya está en uso en la sala." }, 409);
  }

  const { data: inserted, error: insErr } = await supabase
    .from("participants")
    .insert({ code, name })
    .select("id")
    .single();
  if (insErr) throw insErr;

  const token = crypto.randomUUID();
  const { error: tokErr } = await supabase
    .from("participant_tokens")
    .insert({ id: inserted.id, code, token });
  if (tokErr) throw tokErr;

  return json({ code, participantId: inserted.id, token, name });
}

async function toggleParticipate(supabase: SB, payload: Record<string, unknown>) {
  const code = String(payload.code || "").trim().toUpperCase();
  const adminToken = String(payload.adminToken || "");
  if (!(await verifyAdmin(supabase, code, adminToken))) {
    return json({ error: "No autorizado." }, 403);
  }
  const { data: room } = await supabase
    .from("rooms")
    .select("status")
    .eq("code", code)
    .maybeSingle();
  if (!room || room.status !== "lobby") return json({ ok: true });

  await supabase
    .from("rooms")
    .update({ admin_participating: Boolean(payload.participate) })
    .eq("code", code);
  return json({ ok: true });
}

async function kick(supabase: SB, payload: Record<string, unknown>) {
  const code = String(payload.code || "").trim().toUpperCase();
  const adminToken = String(payload.adminToken || "");
  const participantId = String(payload.participantId || "");
  if (!(await verifyAdmin(supabase, code, adminToken))) {
    return json({ error: "No autorizado." }, 403);
  }
  await supabase
    .from("participants")
    .delete()
    .eq("code", code)
    .eq("id", participantId);
  return json({ ok: true });
}

async function startDraw(supabase: SB, payload: Record<string, unknown>) {
  const code = String(payload.code || "").trim().toUpperCase();
  const adminToken = String(payload.adminToken || "");
  if (!(await verifyAdmin(supabase, code, adminToken))) {
    return json({ error: "No autorizado." }, 403);
  }

  const { data: room } = await supabase
    .from("rooms")
    .select("admin_name, admin_participating, status")
    .eq("code", code)
    .maybeSingle();
  if (!room) return json({ error: "La sala no existe." }, 404);
  if (room.status !== "lobby") {
    return json({ error: "El sorteo ya se realizó." }, 409);
  }

  const { data: parts } = await supabase
    .from("participants")
    .select("id, name")
    .eq("code", code);
  const { data: toks } = await supabase
    .from("participant_tokens")
    .select("id, token")
    .eq("code", code);
  const tokenById = new Map<string, string>(
    (toks || []).map((t: { id: string; token: string }) => [t.id, t.token]),
  );

  const entries: { token: string; name: string }[] = (parts || []).map(
    (p: { id: string; name: string }) => ({
      token: tokenById.get(p.id)!,
      name: p.name,
    }),
  );
  if (room.admin_participating) {
    entries.push({ token: adminToken, name: room.admin_name });
  }

  if (entries.length < 2) {
    return json(
      { error: "Se necesitan al menos 2 participantes para sortear." },
      400,
    );
  }

  const receivers = computeAssignments(entries);
  const rows = entries.map((giver, i) => ({
    code,
    giver_token: giver.token,
    giver_name: giver.name,
    receiver_name: receivers[i].name,
  }));

  const { error: insErr } = await supabase.from("assignments").insert(rows);
  if (insErr) throw insErr;

  await supabase.from("rooms").update({ status: "drawn" }).eq("code", code);

  return json({ ok: true });
}

async function myResult(supabase: SB, payload: Record<string, unknown>) {
  const code = String(payload.code || "").trim().toUpperCase();
  const token = String(payload.token || "");
  const { data } = await supabase
    .from("assignments")
    .select("receiver_name")
    .eq("code", code)
    .eq("giver_token", token)
    .maybeSingle();
  return json({ receiverName: data ? data.receiver_name : null });
}
