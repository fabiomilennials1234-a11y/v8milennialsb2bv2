/**
 * Sanitiza saída do LLM antes de enviar ao lead.
 *
 * Bugs que resolve:
 * 1. Leak de JSON ReAct — Gemini e afins às vezes emitem
 *    `{"action":"send_media","action_input":"..."}` como texto
 *    em vez de usar tool_calls nativos. Sem sanitização, o JSON cru
 *    chega ao WhatsApp do cliente.
 * 2. Leak do delimitador ||SPLIT|| — quando o LLM emite em caixa
 *    diferente (||split||, || SPLIT ||) o split literal não matcha
 *    e o marcador vaza como texto.
 *
 * Incidente-fonte: Barulhinho Bom, 2026-04-24.
 */

/** Mapa tool_name (snake_case) → action token (UPPER_CASE) usado pelo executor. */
export const TOOL_NAME_TO_ACTION: Record<string, string> = {
  schedule_meeting: "SCHEDULE_MEETING",
  transfer_to_human: "TRANSFER_HUMAN",
  update_lead: "UPDATE_LEAD",
  qualify_lead: "QUALIFY_LEAD",
  disqualify_lead: "DISQUALIFY_LEAD",
  advance_stage: "ADVANCE_STAGE",
  update_qualification_score: "UPDATE_QUALIFICATION_SCORE",
  confirm_meeting: "CONFIRM_MEETING",
  advance_confirmation_stage: "ADVANCE_CONFIRMATION_STAGE",
  create_custom_field: "CREATE_CUSTOM_FIELD",
  transfer_sz_chat: "TRANSFER_SZ_CHAT",
  send_document: "SEND_DOCUMENT",
  send_product_material: "SEND_PRODUCT_MATERIAL",
};

export interface RecoveredAction {
  action: string;
  params: Record<string, unknown>;
}

export interface SanitizeResult {
  text: string;
  droppedBlocks: number;
  recoveredAction: RecoveredAction | null;
  /** Reasoning chain extraído de <thinking>...</thinking> antes da resposta. */
  reasoning?: string;
}

/**
 * Extrai e remove blocos <thinking>...</thinking> e <response>...</response>.
 *
 * Bug crítico: se LLM esquece tag de fechamento `</thinking>`, regex normal
 * captura tudo até EOF e vaza pro lead. Mitigação: detecta abertura sem
 * fechamento → remove tudo APÓS `<thinking>` (descarta resposta inválida).
 *
 * Returns: { cleanedText, reasoning }
 */
function extractReasoningChain(input: string): { cleaned: string; reasoning?: string } {
  if (!input || !input.includes("<thinking")) return { cleaned: input };

  // 1. Bloco completo <thinking>...</thinking>
  const completeMatch = input.match(/<thinking>([\s\S]*?)<\/thinking>/i);
  if (completeMatch) {
    const reasoning = completeMatch[1].trim();
    let cleaned = input.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();

    // 2. Se houver bloco <response>...</response>, usa só o conteúdo dentro
    const responseMatch = cleaned.match(/<response>([\s\S]*?)<\/response>/i);
    if (responseMatch) {
      cleaned = responseMatch[1].trim();
    }

    // 3. Strip tags resíduo (fallback defensivo)
    cleaned = cleaned.replace(/<\/?(?:thinking|response)[^>]*>/gi, "").trim();
    return { cleaned, reasoning };
  }

  // 4. <thinking> abriu mas NÃO fechou — descarta tudo a partir dele (vazamento)
  const openIdx = input.search(/<thinking[^>]*>/i);
  if (openIdx >= 0) {
    const before = input.slice(0, openIdx).trim();
    return { cleaned: before, reasoning: undefined };
  }

  return { cleaned: input };
}

/**
 * Encontra o próximo objeto JSON balanceado a partir de `start` (posição de `{`).
 * Retorna `{ end }` com índice do `}` de fechamento (inclusivo), ou null se não fecha.
 * Respeita strings (ignora `{`/`}` dentro de aspas) e escapes.
 */
function findBalancedJson(src: string, start: number): { end: number } | null {
  if (src[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { end: i };
    }
  }
  return null;
}

/** Extrai todos os objetos JSON válidos com chave "action". */
function extractActionJsonBlocks(src: string): Array<{ start: number; end: number; json: string }> {
  const blocks: Array<{ start: number; end: number; json: string }> = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "{") continue;
    const found = findBalancedJson(src, i);
    if (!found) continue;
    const slice = src.slice(i, found.end + 1);
    if (/"action"\s*:\s*"[a-z_]+"/i.test(slice)) {
      try {
        JSON.parse(slice);
        blocks.push({ start: i, end: found.end, json: slice });
        i = found.end;
      } catch {
        // não é JSON válido — deixa pro fallback textual
      }
    } else {
      i = found.end; // pula este objeto válido sem action
    }
  }
  return blocks;
}

export function sanitizeAssistantMessage(
  raw: string,
  alreadyHasAction: boolean,
): SanitizeResult {
  if (!raw) return { text: raw, droppedBlocks: 0, recoveredAction: null };

  // Passo 0: extrair reasoning chain (<thinking>...</thinking>) ANTES de tudo
  // Defensive: se LLM vazar <thinking> sem fechar, descartamos tudo após.
  const { cleaned: afterReasoning, reasoning } = extractReasoningChain(raw);
  raw = afterReasoning;

  let droppedBlocks = 0;
  let recoveredAction: RecoveredAction | null = null;

  // Passo 1: tirar code-fences ```json ... ``` primeiro (simplifica lookup balanceado)
  let text = raw.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, (_m, inner: string) => {
    if (/"action"\s*:\s*"[a-z_]+"/i.test(inner)) {
      droppedBlocks += 1;
      if (!alreadyHasAction && !recoveredAction) {
        const rec = tryRecoverFromString(inner);
        if (rec) recoveredAction = rec;
      }
      return "";
    }
    return _m; // fence sem action-json — preserva
  });

  // Passo 2: objetos JSON soltos contendo "action":"..."
  const blocks = extractActionJsonBlocks(text);
  if (blocks.length > 0) {
    // Remover do fim pro início pra não invalidar índices
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      droppedBlocks += 1;
      if (!alreadyHasAction && !recoveredAction) {
        const rec = tryRecoverFromString(b.json);
        if (rec) recoveredAction = rec;
      }
      text = text.slice(0, b.start) + text.slice(b.end + 1);
    }
  }

  // Passo 3: fallback — se ainda sobrou linha com `"action":"..."` (JSON quebrado), tira a linha
  if (/"action"\s*:\s*"[a-z_]+"/i.test(text)) {
    text = text
      .split("\n")
      .filter((line) => !/"action"\s*:\s*"[a-z_]+"/i.test(line))
      .join("\n");
  }

  // Normalização de whitespace
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  // Defensive final: garantir zero vazamento de tags reasoning
  text = text.replace(/<\/?(?:thinking|response)[^>]*>/gi, "").trim();

  return { text, droppedBlocks, recoveredAction, reasoning };
}

function tryRecoverFromString(jsonStr: string): RecoveredAction | null {
  try {
    const parsed = JSON.parse(jsonStr);
    const toolName =
      typeof parsed?.action === "string" ? parsed.action.toLowerCase() : "";
    const mapped = TOOL_NAME_TO_ACTION[toolName];
    if (!mapped) return null;

    const rawInput = parsed.action_input ?? parsed.input ?? parsed.arguments ?? parsed.params;
    let params: Record<string, unknown> = {};
    if (typeof rawInput === "string") {
      try {
        params = JSON.parse(rawInput);
      } catch {
        params = { _raw: rawInput };
      }
    } else if (rawInput && typeof rawInput === "object") {
      params = rawInput as Record<string, unknown>;
    }
    return { action: mapped, params };
  } catch {
    return null;
  }
}

/**
 * Split case-insensitive tolerante a variações do delimitador `||SPLIT||`.
 * Mantém compatível com prompt que ensina o formato UPPER exato.
 */
export const SPLIT_DELIMITER_RE = /\|\|\s*split\s*\|\|/gi;

export function splitByDelimiter(text: string): string[] {
  return text
    .split(SPLIT_DELIMITER_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
