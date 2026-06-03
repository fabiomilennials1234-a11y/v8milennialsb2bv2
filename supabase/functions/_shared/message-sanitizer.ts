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
 * 3. Leak XML de tool_call — modelos preview (ex. gemini-3-flash-preview)
 *    emitem tool invocations no formato universal-tool-calling
 *    (`<tool_call>{...}</tool_call>`, `<vertical_tool_calls>...`,
 *    `<no_tool_calls>`) como TEXTO no content em vez de native tool_calls.
 *    Schemas conhecidos: `{tool_name, tool_arguments}` e `{name, arguments}`.
 *
 * Incidentes-fonte: Barulhinho Bom 2026-04-24 (JSON ReAct) e 2026-05-21
 * (XML tool_call com gemini-3-flash-preview).
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

/**
 * Tool names que o prompt do agente usa em pseudo-tags inline `<tool: args>`.
 * Inclui o executor map + aliases de mídia/kanban que o prompt usa mas não
 * estão no map (send_video, move_card, ...). Allowlist evita comer texto
 * legítimo que por acaso tenha `<algo: coisa>`.
 */
const INLINE_TOOL_TAG_NAMES: Set<string> = new Set<string>([
  ...Object.keys(TOOL_NAME_TO_ACTION),
  "send_video", "send_image", "send_audio", "send_media", "send_photo",
  "send_product", "send_material", "send_file", "move_card", "move_stage",
]);

/** Defensivo final: nuke de qualquer abertura de tag de tool (mesmo sem fechar). */
const INLINE_TOOL_TAG_RE = new RegExp(
  `<\\s*(?:${[...INLINE_TOOL_TAG_NAMES].join("|")})\\b[^>]*>?`,
  "gi",
);

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

/**
 * Extrai e remove blocos `<tool_call>...</tool_call>` (e wrapper
 * `<vertical_tool_calls>...</vertical_tool_calls>`) emitidos como texto
 * por modelos no formato universal-tool-calling.
 *
 * Suporta:
 *  - <tool_call>{"tool_name":"...","tool_arguments":{...}}</tool_call>
 *  - <tool_call>{"name":"...","arguments":{...}}</tool_call>
 *  - <tool_call name="..." arguments='...'></tool_call> (atributo form)
 *  - <no_tool_calls> e <no_tool_calls /> (sentinelas)
 *  - <tool_call> sem fechamento (descarta tudo a partir do bloco aberto)
 *
 * Retorna texto limpo + lista de candidatos a recovery (primeiro JSON
 * parseável dentro de cada bloco, se schema reconhecido).
 */
function stripToolCallBlocks(
  input: string,
): { cleaned: string; dropped: number; candidates: string[] } {
  if (!input || !/<\/?(?:tool_call|vertical_tool_calls|no_tool_calls)\b/i.test(input)) {
    return { cleaned: input, dropped: 0, candidates: [] };
  }

  let text = input;
  let dropped = 0;
  const candidates: string[] = [];

  // 1. Wrapper <vertical_tool_calls>...</vertical_tool_calls> — strip wrapper
  //    tags só (conteúdo interno é tratado pelo próximo passo)
  text = text.replace(/<\/?vertical_tool_calls\b[^>]*>/gi, () => {
    dropped += 1;
    return "";
  });

  // 2. Blocos completos <tool_call ...>...</tool_call>
  const COMPLETE = /<tool_call\b[^>]*>([\s\S]*?)<\/tool_call\s*>/gi;
  text = text.replace(COMPLETE, (_m, inner: string) => {
    dropped += 1;
    const candidate = extractFirstJsonObject(inner);
    if (candidate) candidates.push(candidate);
    return "";
  });

  // 3. Sentinelas <no_tool_calls>, <no_tool_calls />, </no_tool_calls>
  text = text.replace(/<\/?no_tool_calls\s*\/?\s*>/gi, () => {
    dropped += 1;
    return "";
  });

  // 4. Defensive: <tool_call> aberto sem fechamento — descarta tudo após
  const openIdx = text.search(/<tool_call\b/i);
  if (openIdx >= 0) {
    text = text.slice(0, openIdx);
    dropped += 1;
  }

  // 5. Tag residual órfã </tool_call> ou <tool_call ... /> self-closing
  text = text.replace(/<\/?tool_call\b[^>]*\/?\s*>/gi, "");

  return { cleaned: text, dropped, candidates };
}

/**
 * Extrai primeiro objeto JSON balanceado dentro de string (helper para
 * recuperar tool args do conteúdo de `<tool_call>`).
 */
function extractFirstJsonObject(src: string): string | null {
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "{") continue;
    const found = findBalancedJson(src, i);
    if (found) return src.slice(i, found.end + 1);
  }
  return null;
}

/**
 * Strip de pseudo-tags inline `<tool_name: args>` emitidas como TEXTO
 * (incidente Barulhinho Bom 2026-06-02: `<send_video: Linha.mp4>`,
 * `<qualify_lead: {...}>`, `<move_card: "Qualificado">`,
 * `<transfer_to_human: "...">`). Modelo emite a ação como texto em vez de
 * tool_call nativo — sem este strip, a tag vaza no WhatsApp do cliente.
 *
 * Allowlist (INLINE_TOOL_TAG_NAMES) garante que só tags de tool sejam
 * removidas. Args em JSON viram candidatos a recovery.
 */
function stripInlineToolTags(
  input: string,
): { cleaned: string; dropped: number; candidates: string[] } {
  if (!input || input.indexOf("<") === -1) {
    return { cleaned: input, dropped: 0, candidates: [] };
  }
  let dropped = 0;
  const candidates: string[] = [];
  const RE = /<\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([^>]*)>/g;
  let cleaned = input.replace(RE, (match, rawName: string, rawArgs: string) => {
    if (!INLINE_TOOL_TAG_NAMES.has(rawName.toLowerCase())) return match; // não é tool — preserva
    dropped += 1;
    const args = rawArgs.trim();
    if (args.startsWith("{")) {
      candidates.push(JSON.stringify({ tool_name: rawName.toLowerCase(), tool_arguments: args }));
    }
    return "";
  });
  // Defensivo: abertura órfã (args continham `>` e cortou cedo).
  if (INLINE_TOOL_TAG_RE.test(cleaned)) {
    INLINE_TOOL_TAG_RE.lastIndex = 0;
    cleaned = cleaned.replace(INLINE_TOOL_TAG_RE, () => { dropped += 1; return ""; });
  }
  INLINE_TOOL_TAG_RE.lastIndex = 0;
  return { cleaned, dropped, candidates };
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

  // Passo 1b: tirar blocos XML <tool_call> / <vertical_tool_calls> / <no_tool_calls>
  // (formato universal-tool-calling emitido como texto por modelos preview).
  const toolCallStrip = stripToolCallBlocks(text);
  text = toolCallStrip.cleaned;
  droppedBlocks += toolCallStrip.dropped;
  if (!alreadyHasAction && !recoveredAction) {
    for (const candidate of toolCallStrip.candidates) {
      const rec = tryRecoverFromString(candidate);
      if (rec) {
        recoveredAction = rec;
        break;
      }
    }
  }

  // Passo 1c: pseudo-tags inline `<tool_name: args>` emitidas como texto
  // (incidente Barulhinho Bom 2026-06-02).
  const inlineStrip = stripInlineToolTags(text);
  text = inlineStrip.cleaned;
  droppedBlocks += inlineStrip.dropped;
  if (!alreadyHasAction && !recoveredAction) {
    for (const candidate of inlineStrip.candidates) {
      const rec = tryRecoverFromString(candidate);
      if (rec) {
        recoveredAction = rec;
        break;
      }
    }
  }

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

  // Defensive final: garantir zero vazamento de tags reasoning + tool_call +
  // pseudo-tags inline `<tool_name: args>` residuais.
  INLINE_TOOL_TAG_RE.lastIndex = 0;
  text = text
    .replace(/<\/?(?:thinking|response)[^>]*>/gi, "")
    .replace(/<\/?(?:tool_call|vertical_tool_calls|no_tool_calls)\b[^>]*\/?\s*>/gi, "")
    .replace(INLINE_TOOL_TAG_RE, "")
    .trim();
  INLINE_TOOL_TAG_RE.lastIndex = 0;

  return { text, droppedBlocks, recoveredAction, reasoning };
}

function tryRecoverFromString(jsonStr: string): RecoveredAction | null {
  try {
    const parsed = JSON.parse(jsonStr);
    // Schemas aceitos:
    //  - ReAct/legacy: { action, action_input }
    //  - OpenRouter universal: { tool_name, tool_arguments }
    //  - OpenAI-like: { name, arguments }
    const rawToolName =
      (typeof parsed?.action === "string" && parsed.action) ||
      (typeof parsed?.tool_name === "string" && parsed.tool_name) ||
      (typeof parsed?.name === "string" && parsed.name) ||
      "";
    const toolName = typeof rawToolName === "string" ? rawToolName.toLowerCase() : "";
    const mapped = TOOL_NAME_TO_ACTION[toolName];
    if (!mapped) return null;

    const rawInput =
      parsed.action_input ??
      parsed.tool_arguments ??
      parsed.arguments ??
      parsed.input ??
      parsed.params;
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
