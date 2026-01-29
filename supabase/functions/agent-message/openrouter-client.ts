/**
 * OpenRouter API Client
 * 
 * Cliente para interagir com OpenRouter API (suporta múltiplos modelos)
 * Formato compatível com OpenAI Chat Completions API
 */

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': Deno.env.get('OPENROUTER_REFERER_URL') || 'https://v8millennials.com',
        'X-Title': 'V8 Millennials CRM Agent',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} ${error}`);
    }

    return await response.json();
  }

  /**
   * Converte mensagens do formato interno para formato OpenRouter
   */
  convertMessages(messages: Array<{ role: string; content: string }>, systemPrompt?: string): OpenRouterMessage[] {
    const openRouterMessages: OpenRouterMessage[] = [];

    // Adicionar system prompt se fornecido
    if (systemPrompt) {
      openRouterMessages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    // Converter mensagens
    for (const msg of messages) {
      openRouterMessages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
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
