/**
 * google-calendar-sharing
 *
 * Gerencia com quem cada usuário compartilha seu Google Calendar.
 *
 *   GET    → lista usuários com quem o caller compartilha + usuários que compartilharam com ele
 *   POST   body: { viewer_id, can_create_events }  → compartilha com um colega
 *   PATCH  body: { viewer_id, can_create_events }  → atualiza permissão
 *   DELETE ?viewer_id=xxx                          → revoga compartilhamento
 *
 * Requer: Authorization: Bearer <supabase_jwt>
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY         =
  Deno.env.get("ANON_KEY_2")?.trim() ||
  Deno.env.get("ANON_KEY")?.trim() ||
  Deno.env.get("SUPABASE_ANON_KEY")?.trim() ||
  "";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const jwt = req.headers
      .get("Authorization")
      ?.replace(/^Bearer\s+/i, "")
      ?.trim();

    if (!jwt) {
      return json({ error: "Unauthorized", message: "Token JWT ausente" }, 401);
    }

    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser(jwt);
    if (authError || !user?.id) {
      return json({ error: "Unauthorized", message: "JWT inválido ou expirado" }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Busca org do usuário
    const { data: member } = await supabase
      .from("team_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    const orgId = member?.organization_id ?? "";

    // ── GET: listar compartilhamentos ───────────────────────────────────────
    if (req.method === "GET") {
      // Quem eu compartilhei (outgoing) — consulta sem depender de nome de FK
      const { data: outgoingRaw, error: outgoingErr } = await supabase
        .from("google_calendar_sharing")
        .select("viewer_id, can_create_events, created_at")
        .eq("owner_id", user.id);

      if (outgoingErr) console.error("[sharing] outgoing query error:", outgoingErr);

      // Quem compartilhou comigo (incoming)
      const { data: incomingRaw, error: incomingErr } = await supabase
        .from("google_calendar_sharing")
        .select("owner_id, can_create_events, created_at")
        .eq("viewer_id", user.id);

      if (incomingErr) console.error("[sharing] incoming query error:", incomingErr);

      // Busca dados dos membros referenciados nas shares
      const viewerIds  = (outgoingRaw ?? []).map((s) => s.viewer_id);
      const ownerIds   = (incomingRaw  ?? []).map((s) => s.owner_id);
      const memberIds  = [...new Set([...viewerIds, ...ownerIds])];

      let memberMap: Record<string, { user_id: string; name: string; email: string; role: string }> = {};
      if (memberIds.length > 0) {
        const { data: membersData } = await supabase
          .from("team_members")
          .select("user_id, name, email, role")
          .in("user_id", memberIds);
        (membersData ?? []).forEach((m) => { memberMap[m.user_id] = m; });
      }

      // Monta outgoing com dados do viewer
      const outgoing = (outgoingRaw ?? []).map((s) => ({
        ...s,
        viewer: memberMap[s.viewer_id] ?? null,
      }));

      // Monta incoming com dados do owner
      const incoming = (incomingRaw ?? []).map((s) => ({
        ...s,
        owner: memberMap[s.owner_id] ?? null,
      }));

      // Lista de membros da org que ainda não estão no compartilhamento (para adicionar)
      const sharedViewerIds = (outgoingRaw ?? []).map((s) => s.viewer_id);
      const { data: orgMembers } = await supabase
        .from("team_members")
        .select("user_id, name, email, role")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .neq("user_id", user.id)
        .not("user_id", "in", `(${sharedViewerIds.join(",") || "00000000-0000-0000-0000-000000000000"})`);

      return json({
        outgoing: outgoing ?? [],
        incoming: incoming ?? [],
        available_members: orgMembers ?? [],
      });
    }

    // ── POST: compartilhar com colega ───────────────────────────────────────
    if (req.method === "POST") {
      const { viewer_id, can_create_events = false } = await req.json();

      if (!viewer_id) {
        return json({ error: "Bad Request", message: "viewer_id é obrigatório" }, 400);
      }

      if (viewer_id === user.id) {
        return json({ error: "Bad Request", message: "Não é possível compartilhar com você mesmo" }, 400);
      }

      // Verifica se viewer pertence à mesma org
      const { data: viewerMember } = await supabase
        .from("team_members")
        .select("user_id")
        .eq("user_id", viewer_id)
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .maybeSingle();

      if (!viewerMember) {
        return json({ error: "Not Found", message: "Usuário não encontrado na organização" }, 404);
      }

      const { error } = await supabase
        .from("google_calendar_sharing")
        .insert({
          organization_id:   orgId,
          owner_id:          user.id,
          viewer_id,
          can_create_events,
        });

      if (error) {
        if (error.code === "23505") {
          return json({ error: "Conflict", message: "Compartilhamento já existe. Use PATCH para atualizar." }, 409);
        }
        throw error;
      }

      return json({ success: true, message: "Calendário compartilhado com sucesso" });
    }

    // ── PATCH: atualizar permissão ──────────────────────────────────────────
    if (req.method === "PATCH") {
      const { viewer_id, can_create_events } = await req.json();

      if (!viewer_id || can_create_events === undefined) {
        return json({ error: "Bad Request", message: "viewer_id e can_create_events são obrigatórios" }, 400);
      }

      const { error } = await supabase
        .from("google_calendar_sharing")
        .update({ can_create_events })
        .eq("owner_id", user.id)
        .eq("viewer_id", viewer_id);

      if (error) throw error;

      return json({ success: true, message: "Permissão atualizada com sucesso" });
    }

    // ── DELETE: revogar compartilhamento ────────────────────────────────────
    if (req.method === "DELETE") {
      const viewerId = new URL(req.url).searchParams.get("viewer_id");

      if (!viewerId) {
        return json({ error: "Bad Request", message: "viewer_id é obrigatório" }, 400);
      }

      const { error } = await supabase
        .from("google_calendar_sharing")
        .delete()
        .eq("owner_id", user.id)
        .eq("viewer_id", viewerId);

      if (error) throw error;

      return json({ success: true, message: "Acesso ao calendário revogado" });
    }

    return json({ error: "Method Not Allowed" }, 405);
  } catch (err) {
    console.error("[google-calendar-sharing]", err);
    return json({ error: "Erro interno", message: String(err) }, 500);
  }
});
