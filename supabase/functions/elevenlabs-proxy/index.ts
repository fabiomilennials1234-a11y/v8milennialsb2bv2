import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { logRuntime } from "../_shared/logger.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";

/**
 * ElevenLabs Proxy
 *
 * Proxies requests to ElevenLabs API, keeping the API key server-side.
 * Used by frontend for voice listing and voice cloning.
 *
 * Supported actions:
 * - { action: "list_voices" } — GET /v1/voices
 * - { action: "clone_voice", name, files } — POST /v1/voices/add
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

interface ProxyRequest {
  action: "list_voices" | "clone_voice";
  name?: string;
  description?: string;
  files?: Array<{ name: string; data: string; mime_type: string }>;
}

Deno.serve(withErrorBoundary('elevenlabs-proxy', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Authenticate user via JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Validate user JWT using service role client
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error("[elevenlabs-proxy] Auth failed:", authError?.message);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user's organization and check admin role
    console.log("[elevenlabs-proxy] User authenticated:", user.id);
    const { data: membership, error: memberError } = await supabase
      .from("team_members")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    console.log("[elevenlabs-proxy] Membership:", { membership, memberError: memberError?.message });

    if (!membership) {
      return new Response(
        JSON.stringify({ error: "No organization found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (membership.role !== "admin") {
      console.log("[elevenlabs-proxy] Role check failed:", membership.role);
      return new Response(
        JSON.stringify({ error: `Admin access required. Your role: ${membership.role}` }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve API key: try org DB first, fall back to env var
    let orgApiKey: string | null = null;
    try {
      const { data: orgData, error: orgError } = await supabase
        .from("organizations")
        .select("elevenlabs_api_key")
        .eq("id", membership.organization_id)
        .single();

      if (orgError) {
        console.warn("[elevenlabs-proxy] Org query error (falling back to env var):", orgError.message);
      } else {
        orgApiKey = (orgData as any)?.elevenlabs_api_key || null;
      }
    } catch (e) {
      console.warn("[elevenlabs-proxy] Org query failed (falling back to env var):", e);
    }

    const apiKey = orgApiKey || Deno.env.get("ELEVENLABS_API_KEY");
    console.log("[elevenlabs-proxy] API key resolved:", { fromOrg: !!orgApiKey, fromEnv: !!Deno.env.get("ELEVENLABS_API_KEY"), hasKey: !!apiKey });
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ElevenLabs API key not configured. Add it in organization settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: ProxyRequest = await req.json();

    if (body.action === "list_voices") {
      const response = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": apiKey },
      });

      const result = await response.json();
      return new Response(JSON.stringify(result), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "clone_voice") {
      if (!body.name || !body.files?.length) {
        return new Response(
          JSON.stringify({ error: "name and files are required for voice cloning" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const formData = new FormData();
      formData.append("name", body.name);
      if (body.description) formData.append("description", body.description);

      for (const file of body.files) {
        const binaryData = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
        const blob = new Blob([binaryData], { type: file.mime_type });
        formData.append("files", blob, file.name);
      }

      const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        await logRuntime({
          organizationId: membership.organization_id,
          module: "tts",
          action: "clone_voice",
          status: "success",
          payloadSnapshot: { voiceName: body.name, voiceId: result.voice_id },
        });
      }

      return new Response(JSON.stringify(result), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Unknown action. Use list_voices or clone_voice" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[elevenlabs-proxy] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));
