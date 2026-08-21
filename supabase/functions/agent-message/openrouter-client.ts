/**
 * OpenRouter API Client
 * 
 * Cliente para interagir com OpenRouter API (suporta múltiplos modelos)
 * Formato compatível com OpenAI Chat Completions API
 */

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface OpenRouterTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  tools?: OpenRouterTool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
}

export interface OpenRouterResponse {
  id: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string; // JSON string
        };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenRouterClientOptions {
  /** Backoff base in ms (delay = retryBaseMs * 2^attempt). Tests pass 0. */
  retryBaseMs?: number;
  /** Max retries on transient failures (total attempts = maxRetries + 1). */
  maxRetries?: number;
  /** Per-attempt request timeout in ms. Guards against silent hangs that
   *  cascade into the empty-text fallback (Bug 2). */
  timeoutMs?: number;
}

// Status codes worth retrying — transient infra/rate-limit, not client errors.
// 400 is intentionally absent (handled separately via model fallback).
const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class OpenRouterClient {
  private apiKey: string;
  private baseUrl: string;
  private retryBaseMs: number;
  private maxRetries: number;
  private timeoutMs: number;

  constructor(apiKey: string, opts: OpenRouterClientOptions = {}) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://openrouter.ai/api/v1';
    this.retryBaseMs = opts.retryBaseMs ?? 500;
    this.maxRetries = opts.maxRetries ?? 2;
    this.timeoutMs = opts.timeoutMs ?? 45_000;
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Chama a API do OpenRouter.
   *
   * Resiliência (Bug 2 — fallback "houve um problema"):
   *   - Erros transientes (429/5xx/timeout/rede) → retry com backoff exponencial.
   *   - Erro 400 (modelo inválido/deprecado) → swap único para o fallback.
   *   - Timeout por tentativa evita hang silencioso que virava texto vazio.
   */
  async chat(request: OpenRouterRequest): Promise<OpenRouterResponse> {
    const isAnthropic = request.model.startsWith('anthropic/');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'HTTP-Referer': Deno.env.get('OPENROUTER_REFERER_URL') || 'https://v8millennials.com',
      'X-Title': 'V8 Millennials CRM Agent',
    };
    if (isAnthropic) {
      headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
    }

    const body = { ...request };
    if (isAnthropic && body.messages) {
      body.messages = body.messages.map((msg) =>
        msg.role === 'system'
          ? { ...msg, cache_control: { type: 'ephemeral' } }
          : msg,
      ) as OpenRouterMessage[];
    }

    // Motor único (decisão CTO 2026-08-12). Com o primário já em gpt-4.1-mini o
    // guard `request.model !== fallback` abaixo torna o swap um no-op e o 400
    // sobe como erro — de propósito: um fallback para outro provider gastava
    // tokens fora do motor escolhido, silenciosamente e sem aparecer em lugar nenhum.
    const fallback = 'openai/gpt-4.1-mini';
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await this.sleep(this.retryBaseMs * 2 ** (attempt - 1));
      }

      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        // Network failure / timeout — transient, retry.
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[OpenRouterClient] fetch failed (attempt ${attempt + 1}/${this.maxRetries + 1}):`, lastError.message);
        continue;
      }

      if (response.ok) {
        return await response.json();
      }

      const error = await response.text();

      // Modelo inválido/deprecado → swap único para fallback (não conta como retry).
      if (response.status === 400 && request.model !== fallback) {
        console.warn(`[OpenRouterClient] Model "${request.model}" failed with 400, retrying with ${fallback}`);
        return this.chat({ ...request, model: fallback });
      }

      lastError = new Error(`OpenRouter API error: ${response.status} ${error}`);

      if (TRANSIENT_STATUS.has(response.status) && attempt < this.maxRetries) {
        console.warn(`[OpenRouterClient] transient ${response.status} (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying`);
        continue;
      }

      throw lastError;
    }

    throw lastError ?? new Error('OpenRouter API error: exhausted retries');
  }

  /**
   * Converte mensagens do formato interno para formato OpenRouter.
   *
   * Contrato OpenAI (seguido por OpenRouter e maioria dos providers):
   *   - assistant messages com tool_calls DEVEM ter content === null
   *     (não string vazia). Alguns modelos rejeitam "" e outros tratam
   *     inconsistentemente. Preservar null aqui elimina ambiguidade.
   *   - assistant messages sem tool_calls: content é string (pode ser "").
   *   - tool messages: content string obrigatório.
   *   - user/system: content string obrigatório.
   */
  convertMessages(messages: Array<{ role: string; content: string | null; tool_calls?: any; tool_call_id?: string }>, systemPrompt?: string): OpenRouterMessage[] {
    const openRouterMessages: OpenRouterMessage[] = [];

    if (systemPrompt) {
      openRouterMessages.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of messages) {
      const hasToolCalls = !!msg.tool_calls && msg.tool_calls.length > 0;
      // Assistant + tool_calls: preservar null; caso contrário, coagir para string
      let contentForWire: string | null;
      if (hasToolCalls) {
        contentForWire = msg.content === null || msg.content === '' ? null : msg.content;
      } else {
        contentForWire = msg.content ?? '';
      }

      const orMsg: OpenRouterMessage = {
        role: msg.role as OpenRouterMessage['role'],
        content: contentForWire,
      };
      if (hasToolCalls) orMsg.tool_calls = msg.tool_calls;
      if (msg.tool_call_id) orMsg.tool_call_id = msg.tool_call_id;
      openRouterMessages.push(orMsg);
    }

    return openRouterMessages;
  }

  /**
   * Converte tools do formato Anthropic para formato OpenRouter (OpenAI)
   */
  convertTools(anthropicTools: Array<{
    name: string;
    description: string;
    input_schema: {
      type: string;
      properties: Record<string, any>;
      required?: string[];
    };
  }>): OpenRouterTool[] {
    return anthropicTools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: tool.input_schema.type as 'object',
          properties: tool.input_schema.properties,
          required: tool.input_schema.required || [],
        },
      },
    }));
  }
}
