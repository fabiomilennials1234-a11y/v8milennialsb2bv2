import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

/**
 * Evolution API Proxy
 *
 * Esta Edge Function atua como proxy para a Evolution API,
 * mantendo a API key segura no servidor.
 *
 * Endpoints suportados:
 * - POST /instance/create - Criar instância
 * - GET /instance/connect/:instanceName - Obter QR Code
 * - GET /instance/connectionState/:instanceName - Status da conexão
 * - DELETE /instance/delete/:instanceName - Deletar instância
 * - DELETE /instance/logout/:instanceName - Logout da instância
 * - GET / - Testar conexão
 */

const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL") || "";
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY") || "";

interface ProxyRequest {
  endpoint: string;
  method?: string;
  body?: Record<string, unknown>;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  try {
    // Validar configuração
    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
      console.error("[Evolution Proxy] Missing configuration:", {
        hasUrl: !!EVOLUTION_API_URL,
        hasKey: !!EVOLUTION_API_KEY,
      });
      return new Response(
        JSON.stringify({
          error: "Evolution API não configurada. Configure EVOLUTION_API_URL e EVOLUTION_API_KEY no Supabase.",
          code: "MISSING_CONFIG",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse request body
    const { endpoint, method = "GET", body }: ProxyRequest = await req.json();

    if (!endpoint && endpoint !== "") {
      return new Response(
        JSON.stringify({
          error: "Endpoint é obrigatório",
          code: "MISSING_ENDPOINT",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Construir URL completa
    const fullUrl = `${EVOLUTION_API_URL}${endpoint}`;

    console.log("[Evolution Proxy] Request:", {
      endpoint,
      method,
      hasBody: !!body,
      targetUrl: fullUrl,
      bodyPreview: body ? JSON.stringify(body).substring(0, 500) : null,
    });

    // Fazer requisição para Evolution API
    const fetchOptions: RequestInit = {
      method,
      headers: {
        "apikey": EVOLUTION_API_KEY,
        "Content-Type": "application/json",
      },
    };

    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(fullUrl, fetchOptions);

    // Logar resposta
    console.log("[Evolution Proxy] Response:", {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    });

    // Tentar ler o body da resposta
    let responseData: unknown;
    const contentType = response.headers.get("content-type");

    if (contentType?.includes("application/json")) {
      responseData = await response.json();
    } else {
      const text = await response.text();
      responseData = { message: text };
    }

    // Se erro, formatar mensagem amigável
    if (!response.ok) {
      const errorMessage = getErrorMessage(response.status, responseData);
      console.error("[Evolution Proxy] API Error:", {
        status: response.status,
        statusText: response.statusText,
        endpoint: endpoint,
        data: JSON.stringify(responseData),
        message: errorMessage,
      });

      return new Response(
        JSON.stringify({
          error: errorMessage,
          status: response.status,
          details: responseData,
        }),
        {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Sucesso - retornar dados
    return new Response(JSON.stringify(responseData), {
      status: response.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Evolution Proxy] Error:", error);

    // Verificar se é erro de rede/conexão
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    const isNetworkError =
      errorMessage.includes("fetch") ||
      errorMessage.includes("network") ||
      errorMessage.includes("ECONNREFUSED");

    return new Response(
      JSON.stringify({
        error: isNetworkError
          ? "Não foi possível conectar com a Evolution API. Verifique se o servidor está online."
          : `Erro interno: ${errorMessage}`,
        code: isNetworkError ? "NETWORK_ERROR" : "INTERNAL_ERROR",
      }),
      {
        status: isNetworkError ? 503 : 500,
        headers: { ...getCorsHeaders(null), "Content-Type": "application/json" },
      }
    );
  }
});

function getErrorMessage(status: number, data: unknown): string {
  const details = typeof data === "object" && data !== null
    ? (data as Record<string, unknown>).message || (data as Record<string, unknown>).error || ""
    : String(data);

  switch (status) {
    case 400:
      return `Requisição inválida: ${details}`;
    case 401:
      return "API Key inválida ou expirada. Verifique a configuração no Supabase.";
    case 403:
      return "Acesso negado. Verifique se a API Key tem permissões adequadas na Evolution API.";
    case 404:
      return `Recurso não encontrado: ${details || "Endpoint ou instância não existe"}`;
    case 409:
      return `Conflito: ${details || "Instância já existe"}`;
    case 422:
      return `Dados inválidos: ${details}`;
    case 429:
      return "Muitas requisições. Aguarde um momento e tente novamente.";
    case 500:
    case 502:
    case 503:
      return "Evolution API está temporariamente indisponível. Tente novamente em alguns minutos.";
    default:
      return details ? String(details) : `Erro ${status}`;
  }
}
