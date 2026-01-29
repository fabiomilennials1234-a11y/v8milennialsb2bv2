/**
 * Exemplo de backend (API) para convite de usuários — SaaS multi-tenant
 *
 * Este backend:
 * 1. Recebe POST com Authorization: Bearer <JWT do usuário> e body { email, name, role, organization_id }
 * 2. Valida o JWT e confirma que o usuário é admin da organização (via Supabase com anon key)
 * 3. Chama a Edge Function create-org-user com X-Internal-Api-Key (sem repassar JWT)
 *
 * Use como referência para Vercel Serverless (api/invite-user.ts), Netlify Functions, Express, etc.
 * Variáveis de ambiente necessárias: SUPABASE_URL, SUPABASE_ANON_KEY, INTERNAL_API_KEY
 *
 * NUNCA exponha INTERNAL_API_KEY no frontend.
 */

import { createClient, User } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY!;

export async function post(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json({ success: false, error: "Method not allowed" }, { status: 405 });
  }

  const authHeader = request.headers.get("Authorization")?.trim();
  if (!authHeader?.startsWith("Bearer ")) {
    return Response.json(
      { success: false, error: "Unauthorized", message: "Missing Authorization header" },
      { status: 401 }
    );
  }

  const jwt = authHeader.replace("Bearer ", "").trim();
  const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  const { data: { user }, error: userError } = await supabaseAnon.auth.getUser(jwt);
  if (userError || !user) {
    return Response.json(
      { success: false, error: "Unauthorized", message: "Token inválido ou expirado" },
      { status: 401 }
    );
  }

  let body: { email?: string; name?: string; role?: string; organization_id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: "Bad request", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const organizationId = typeof body.organization_id === "string" ? body.organization_id.trim() : "";
  if (!organizationId) {
    return Response.json(
      { success: false, error: "Bad request", message: "organization_id é obrigatório" },
      { status: 400 }
    );
  }

  const supabaseService = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const [adminRole, masterUser, teamMember] = await Promise.all([
    supabaseService.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle(),
    supabaseService.from("master_users").select("id").eq("user_id", user.id).eq("is_active", true).maybeSingle(),
    supabaseService.from("team_members").select("organization_id").eq("user_id", user.id).eq("organization_id", organizationId).maybeSingle(),
  ]);

  const isAdmin = !!adminRole.data;
  const isMaster = !!masterUser.data;
  const belongsToOrg = !!teamMember.data;

  if (!isAdmin && !isMaster) {
    return Response.json(
      { success: false, error: "Forbidden", message: "Apenas admins ou masters podem convidar usuários" },
      { status: 403 }
    );
  }
  if (!isMaster && !belongsToOrg) {
    return Response.json(
      { success: false, error: "Forbidden", message: "Você não pertence a esta organização" },
      { status: 403 }
    );
  }

  const edgeUrl = `${SUPABASE_URL}/functions/v1/create-org-user`;
  const res = await fetch(edgeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Api-Key": INTERNAL_API_KEY,
    },
    body: JSON.stringify({
      email: body.email,
      name: body.name,
      role: body.role ?? "member",
      organization_id: organizationId,
    }),
  });

  const data = await res.json().catch(() => ({}));
  return Response.json(data, { status: res.status });
}
