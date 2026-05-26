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

export class OpenRouterClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://openrouter.ai/api/v1';
  }

  /**
   * Chama a API do OpenRouter
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

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      const fallback = 'google/gemini-2.5-flash';

      // If model is invalid/deprecated, retry with fallback
      if (response.status === 400 && request.model !== fallback) {
        console.warn(`[OpenRouterClient] Model "${request.model}" failed with 400, retrying with ${fallback}`);
        return this.chat({ ...request, model: fallback });
      }

      throw new Error(`OpenRouter API error: ${response.status} ${error}`);
    }

    return await response.json();
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
