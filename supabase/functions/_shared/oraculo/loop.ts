/**
 * Laço de function-calling do Oráculo — somente leitura.
 *
 * O raciocínio NUNCA escreve (ADR-0032 §2): o modelo lê por ferramentas e
 * redige; qualquer mudança no CRM sai de uma requisição separada, disparada
 * pelo clique de uma pessoa. Uma leitura errada custa, no pior caso, um botão
 * que ninguém aperta.
 */

import type { OracleScope } from "./scope.ts";
import type { Turn } from "./memory.ts";

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmReply {
  model: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls?: ToolCall[];
  text?: string;
}

export interface LlmRequest {
  messages: Turn[];
  toolResults: Array<{ name: string; result: unknown }>;
}

export interface Llm {
  complete(req: LlmRequest): Promise<LlmReply>;
}

export interface OracleTool {
  name: string;
  execute(args: Record<string, unknown>, scope: OracleScope): Promise<unknown>;
}

export interface RunTurnArgs {
  llm: Llm;
  tools: OracleTool[];
  scope: OracleScope;
  messages: Turn[];
  /**
   * Teto de chamadas de ferramenta por turno. Ao atingi-lo o laço para e
   * responde com o que já apurou — um modelo que se enrosca não vira conta
   * aberta nem espera infinita na tela.
   */
  maxToolCalls?: number;
  /** Relógio injetável — a latência é medida, não estimada. */
  now?: () => number;
}

export interface TurnResult {
  text: string;
  /** Procedência: quais ferramentas foram consultadas, na ordem. */
  toolsUsed: string[];
  /**
   * Ferramentas que o modelo pediu e não existem no catálogo — inclusive
   * qualquer tentativa de escrita. Registrado, nunca engolido: um detector
   * sem consumidor reproduz o incidente que ele deveria evitar.
   */
  rejectedToolCalls: string[];
  /** True quando o turno parou no teto em vez de o modelo ter concluído. */
  hitToolCeiling: boolean;
  /**
   * O que o Oráculo custou neste turno. Sem isto ninguém percebe o produto
   * morrer — foi assim que 81 perguntas em cinco meses passaram despercebidas.
   */
  telemetry: TurnTelemetry;
}

export interface TurnTelemetry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  latencyMs: number;
}

export const DEFAULT_MAX_TOOL_CALLS = 6;

export async function runTurn(args: RunTurnArgs): Promise<TurnResult> {
  const ceiling = args.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const now = args.now ?? (() => Date.now());
  const catalog = new Map(args.tools.map((t) => [t.name, t]));
  const toolsUsed: string[] = [];
  const rejectedToolCalls: string[] = [];
  const toolResults: Array<{ name: string; result: unknown }> = [];

  const startedAt = now();
  let model = "";
  let inputTokens = 0;
  let outputTokens = 0;

  const finish = (text: string, hitToolCeiling: boolean): TurnResult => ({
    text,
    toolsUsed,
    rejectedToolCalls,
    hitToolCeiling,
    telemetry: {
      model,
      inputTokens,
      outputTokens,
      toolCalls: toolsUsed.length,
      latencyMs: now() - startedAt,
    },
  });

  for (;;) {
    const reply = await args.llm.complete({ messages: args.messages, toolResults });
    model = reply.model;
    inputTokens += reply.inputTokens;
    outputTokens += reply.outputTokens;

    if (!reply.toolCalls?.length) {
      return finish(reply.text ?? "", false);
    }

    for (const call of reply.toolCalls) {
      if (toolsUsed.length >= ceiling) {
        return finish(reply.text ?? "", true);
      }
      const tool = catalog.get(call.name);
      if (!tool) {
        rejectedToolCalls.push(call.name);
        toolResults.push({
          name: call.name,
          result: { error: "ferramenta_inexistente", detail: "O Oráculo não escreve — proponha uma ação." },
        });
        continue;
      }
      toolsUsed.push(call.name);
      toolResults.push({ name: call.name, result: await tool.execute(call.arguments, args.scope) });
    }
  }
}
