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
 * 4. Leak de diretiva de mídia SEM chave "action" — quando o agente é
 *    instruído a enviar um arquivo mas o tool nativo não está disponível
 *    (ex: documento preso em status!='ready'), o modelo improvisa um objeto
 *    JSON tipo `{"file":"CATALOGO.jpg"}` / `{"document":"..."}` no texto.
 *    Sem chave "action", escapava de TODOS os filtros (que só matcham
 *    `"action":"..."`) e chegava cru ao cliente. Mitigação: Passo 2b remove
 *    objetos JSON balanceados cujas chaves ⊆ allowlist de mídia.
 *
 * Incidentes-fonte: Barulhinho Bom 2026-04-24 (JSON ReAct), 2026-05-21
 * (XML tool_call com gemini-3-flash-preview) e VitrineVET 2026-06-01
 * (diretiva `{"file":...}` sem action — documento preso em processing).
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

/**
 * Filename de mídia EXTRAÍDO de uma tag-de-chamada vazada cujo nome estava
 * FORA da allowlist (incidente KomBag 2026-06-23). O sanitizer é PURO (sem
 * DB), então só consegue extrair o nome do arquivo do argumento — a resolução
 * file_name→document_id + dispatch de SEND_DOCUMENT acontece no ENGINE.
 */
export interface RecoveredMediaByName {
  file_name: string;
}

export interface SanitizeResult {
  text: string;
  droppedBlocks: number;
  recoveredAction: RecoveredAction | null;
  /**
   * Candidato a mídia extraído de uma tag-de-chamada vazada (nome do arquivo
   * sem prefixo `[imagem] `/`[video] ` e sem aspas). null quando nenhuma tag
   * desse tipo foi vista ou nenhum filename foi reconhecido no argumento.
   * Resolvido para document_id no engine (DB). Ver Parte B do incidente KomBag.
   */
  recoveredMediaByName: RecoveredMediaByName | null;
  /** Reasoning chain extraído de <thinking>...</thinking> antes da resposta. */
  reasoning?: string;
}

/**
 * Tags de RACIOCÍNIO/estrutura que os modelos inventam ALÉM do par
 * <thinking>/<response> instruído por reasoning_mode. Curadas de propósito
 * (denylist explícita, NÃO regex genérica `<\w+>`) pra não comer texto legítimo
 * como `<200`, `<3`, `<=` ou autolink `<https://...>`.
 *
 * Group A (DESCARTA o bloco inteiro — o conteúdo é raciocínio interno):
 * incidentes gemini-*-preview / gpt-4.1-mini que "pensam em voz alta".
 */
const REASONING_TAG_NAMES = [
  "thinking", "think", "thought", "thoughts", "reasoning", "reflection",
  "analysis", "scratchpad", "inner_monologue", "monologue",
  "chain_of_thought", "cot",
];
const REASONING_TAGS_ALT = REASONING_TAG_NAMES.join("|");
/** Bloco completo <tag>...</tag> (fecha com a MESMA tag via backref). */
const REASONING_BLOCK_RE = new RegExp(
  `<(${REASONING_TAGS_ALT})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi",
);
/** Abertura de qualquer tag de raciocínio (para detectar leak sem fechamento). */
const REASONING_OPEN_RE = new RegExp(`<(?:${REASONING_TAGS_ALT})\\b[^>]*>`, "i");
/** Tag residual órfã de raciocínio (defensivo final). */
const REASONING_RESIDUAL_RE = new RegExp(
  `<\\/?(?:${REASONING_TAGS_ALT})\\b[^>]*>`, "gi",
);

/**
 * Group B — tags que EMBRULHAM a resposta final (o texto do cliente fica
 * DENTRO). DESEMBRULHA: remove só as tags, preserva o conteúdo. Cobre as
 * variantes que o modelo inventa quando vai "enviar" algo:
 * <prefill>/<perfil> (incidente Forever Bella/Bia 2026-07-13: `<prefill> </prefill>`),
 * <response> (instruída), <final>/<answer>/<output>/<resposta>.
 */
const WRAPPER_TAG_NAMES = [
  "response", "final_response", "final_answer", "final", "answer",
  "output", "result", "reply", "prefill", "perfil", "resposta", "resposta_final",
];
const WRAPPER_TAGS_ALT = WRAPPER_TAG_NAMES.join("|");
/** Bloco wrapper <tag>...</tag> (para usar só o conteúdo interno). */
const WRAPPER_BLOCK_RE = new RegExp(
  `<(${WRAPPER_TAGS_ALT})\\b[^>]*>([\\s\\S]*?)<\\/\\1\\s*>`, "i",
);
/** Tag residual órfã de wrapper (defensivo final — mantém o conteúdo). */
const WRAPPER_RESIDUAL_RE = new RegExp(
  `<\\/?(?:${WRAPPER_TAGS_ALT})\\b[^>]*>`, "gi",
);

/**
 * Extrai e remove blocos de raciocínio (<thinking>, <thought>, <analysis>, ...)
 * e desembrulha wrapper (<response>, <prefill>, ...).
 *
 * Bug crítico: se LLM esquece a tag de fechamento, regex normal captura tudo
 * até EOF e vaza pro lead. Mitigação: detecta abertura de raciocínio sem
 * fechamento → remove tudo APÓS ela (descarta resposta inválida).
 *
 * Robustez (2026-07-13): modelos como gpt-4.1-mini / gemini-*-preview não
 * respeitam a convenção exata `<thinking>/<response>` — inventam `<thought>`,
 * `<prefill>`, `<perfil>`, `<analysis>` e vazavam pro cliente porque o strip
 * antigo só casava `thinking|response`. Agora cobre as duas denylists curadas.
 *
 * Returns: { cleanedText, reasoning }
 */
function extractReasoningChain(input: string): { cleaned: string; reasoning?: string } {
  if (!input) return { cleaned: input };
  REASONING_OPEN_RE.lastIndex = 0;
  if (!REASONING_OPEN_RE.test(input)) return { cleaned: input };

  let reasoning: string | undefined;

  // 1. Remove blocos completos de raciocínio <tag>...</tag> (qualquer da lista),
  //    guardando o primeiro como reasoning (log).
  REASONING_BLOCK_RE.lastIndex = 0;
  let cleaned = input.replace(REASONING_BLOCK_RE, (m: string) => {
    if (reasoning === undefined) {
      reasoning = m.replace(/^<[^>]*>/, "").replace(/<[^>]*>$/, "").trim();
    }
    return "";
  });

  // 2. Sobrou abertura de raciocínio SEM fechamento → vazamento: descarta daqui até EOF.
  REASONING_OPEN_RE.lastIndex = 0;
  const openIdx = cleaned.search(REASONING_OPEN_RE);
  if (openIdx >= 0) cleaned = cleaned.slice(0, openIdx);

  // 3. Se há bloco wrapper <response>...</response> (ou variante), usa só o interno.
  const wrapperBlock = cleaned.match(WRAPPER_BLOCK_RE);
  if (wrapperBlock) cleaned = wrapperBlock[2].trim();

  // 4. Strip residual de tags de raciocínio + wrapper (defensivo; wrapper preserva conteúdo)
  REASONING_RESIDUAL_RE.lastIndex = 0;
  WRAPPER_RESIDUAL_RE.lastIndex = 0;
  cleaned = cleaned
    .replace(REASONING_RESIDUAL_RE, "")
    .replace(WRAPPER_RESIDUAL_RE, "")
    .trim();
  return { cleaned, reasoning };
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
 * Chaves permitidas num objeto de diretiva de mídia. Se TODAS as chaves de um
 * objeto JSON balanceado pertencem a este conjunto, tratamos como diretiva
 * improvisada (não-`action`) e removemos do texto antes de enviar ao lead.
 * Mantido estreito de propósito (só mídia) pra não remover JSON legítimo que
 * o agente eventualmente cite ao cliente.
 */
const MEDIA_DIRECTIVE_KEYS = new Set([
  "file", "files", "filename", "file_name",
  "document", "documents", "document_id",
  "image", "images", "image_url",
  "media", "media_id", "media_ids", "media_url",
  "caption", "attachment", "attachments",
]);

/**
 * Extrai objetos JSON balanceados cujas chaves de topo são TODAS de mídia
 * (allowlist acima). Captura o leak `{"file":"X.jpg"}` / `{"document":"..."}`
 * que não tem chave "action" e por isso escapa de extractActionJsonBlocks.
 */
function extractMediaDirectiveBlocks(src: string): Array<{ start: number; end: number }> {
  const blocks: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "{") continue;
    const found = findBalancedJson(src, i);
    if (!found) continue;
    const slice = src.slice(i, found.end + 1);
    try {
      const parsed = JSON.parse(slice);
      if (
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ) {
        const keys = Object.keys(parsed);
        if (keys.length > 0 && keys.every((k) => MEDIA_DIRECTIVE_KEYS.has(k.toLowerCase()))) {
          blocks.push({ start: i, end: found.end });
        }
      }
    } catch {
      // não é JSON válido — deixa pro fallback / preserva
    }
    i = found.end; // avança além deste objeto independente do veredito
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
  if (!input || !/<\/?(?:tool_call|tool_code|vertical_tool_calls|no_tool_calls)\b/i.test(input)) {
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

  // 2. Blocos completos <tool_call ...>...</tool_call> e <tool_code>...</tool_code>
  //    (Gemini emite tool-calls no formato code-execution `<tool_code>` como TEXTO).
  const COMPLETE = /<(tool_call|tool_code)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  text = text.replace(COMPLETE, (_m, _tag: string, inner: string) => {
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

  // 4. Defensive: <tool_call>/<tool_code> aberto sem fechamento — descarta tudo após
  const openIdx = text.search(/<(?:tool_call|tool_code)\b/i);
  if (openIdx >= 0) {
    text = text.slice(0, openIdx);
    dropped += 1;
  }

  // 5. Tag residual órfã </tool_call|tool_code> ou self-closing
  text = text.replace(/<\/?(?:tool_call|tool_code)\b[^>]*\/?\s*>/gi, "");

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

/**
 * Tag angular cujo CONTEÚDO contém uma chamada-de-função `identificador(`.
 * Cobre `<a:b(...)>`, `<b(...)>`, `<scope:tool(args='x')>`. A heurística é
 * "abre `<`, em algum ponto tem `palavra(`, fecha `>`". Parênteses de call
 * dentro de `<...>` são raríssimos em texto pt-BR legítimo pro cliente, então
 * é seguro nukar independente de allowlist (incidente KomBag 2026-06-23, onde
 * o nome `atendimento_vendas_b2b` estava FORA da allowlist e vazava).
 *
 * NÃO casa autolink `<https://x.com>` (sem `palavra(`) nem texto solto como
 * "preço (promo)" (não está dentro de `<...>`).
 */
const FUNCTION_CALL_TAG_RE =
  /<[^<>]*\b[a-zA-Z_][a-zA-Z0-9_]*\s*\([^<>]*>/g;

/** Abertura órfã: `<...palavra(...` sem `>` de fechamento (defensivo). */
const FUNCTION_CALL_TAG_ORPHAN_RE =
  /<[^<>]*\b[a-zA-Z_][a-zA-Z0-9_]*\s*\([^<>]*$/;

/**
 * Reconhece um nome de arquivo de mídia dentro do argumento de uma tag-de-call.
 * Aceita o arg no formato `chave='valor'` / `chave="valor"` (qualquer chave),
 * remove prefixo `[imagem] ` / `[video] ` / `[audio] ` e aspas, e devolve o
 * basename. Retorna null se não houver algo com cara de arquivo de mídia.
 */
const MEDIA_FILENAME_IN_ARG_RE =
  /['"]?\s*(?:\[(?:imagem|image|video|vídeo|audio|áudio|foto|photo|documento|document|arquivo|file)\]\s*)?([^'"<>]*?\.(?:jpe?g|png|gif|webp|bmp|svg|mp4|mov|avi|mkv|webm|mp3|ogg|opus|wav|m4a|pdf|docx?|xlsx?|pptx?|csv|txt))\s*['"]?/i;

function extractMediaFileNameFromTag(tagInner: string): string | null {
  const m = tagInner.match(MEDIA_FILENAME_IN_ARG_RE);
  if (!m) return null;
  const name = m[1].trim();
  return name.length > 0 ? name : null;
}

/**
 * Strip de tags em forma de CHAMADA-DE-FUNÇÃO `<...palavra(args)>` — rede de
 * segurança independente de allowlist (incidente KomBag 2026-06-23). Captura
 * o filename de mídia do argumento (se houver) como candidato a recovery.
 */
function stripFunctionCallTags(
  input: string,
): { cleaned: string; dropped: number; mediaFileName: string | null } {
  if (!input || input.indexOf("<") === -1) {
    return { cleaned: input, dropped: 0, mediaFileName: null };
  }
  let dropped = 0;
  let mediaFileName: string | null = null;

  FUNCTION_CALL_TAG_RE.lastIndex = 0;
  let cleaned = input.replace(FUNCTION_CALL_TAG_RE, (match) => {
    dropped += 1;
    if (!mediaFileName) {
      const name = extractMediaFileNameFromTag(match);
      if (name) mediaFileName = name;
    }
    return "";
  });
  FUNCTION_CALL_TAG_RE.lastIndex = 0;

  // Defensivo: abertura órfã `<...palavra(...` sem fechar (LLM cortou a tag).
  const orphan = cleaned.match(FUNCTION_CALL_TAG_ORPHAN_RE);
  if (orphan) {
    dropped += 1;
    if (!mediaFileName) {
      const name = extractMediaFileNameFromTag(orphan[0]);
      if (name) mediaFileName = name;
    }
    cleaned = cleaned.slice(0, orphan.index).trimEnd();
  }

  return { cleaned, dropped, mediaFileName };
}

/** Alternância de nomes de tool conhecidos (para regex). */
const KNOWN_TOOL_NAMES_ALT = Object.keys(TOOL_NAME_TO_ACTION).join("|");

/**
 * Chamadas de função "namespaced" que alguns modelos (Gemini via OpenRouter)
 * vazam como TEXTO no content em vez de emitir tool_calls nativo. Formato:
 * `[prefixo:]default_api:tool_name{args}` (ou `...(args)`), com args
 * FREQUENTEMENTE SEM aspas (não-JSON) — por isso escapa de tudo que depende de
 * JSON.parse / chave `"action"` / tag angular `<...>`.
 *
 * Incidentes Forever Bella/Bia:
 *  - `deffn:default_api:update_lead{updates:{address:...,cep:...}}` (2026-06-30)
 *  - `declaration:default_api:update_lead{updates:{pedido:1x Kit ...}}` (2026-07-02)
 *
 * O prefixo antes de `default_api:` varia (deffn, declaration, ...), então
 * casamos qualquer sequência de segmentos `palavra:`.
 */
const NAMESPACED_TOOLCALL_RE =
  /(?:[A-Za-z_][A-Za-z0-9_]*\s*:\s*)*default_api\s*:\s*[A-Za-z_][A-Za-z0-9_]*\s*[({]/g;

/** Tool conhecido colado direto num `{`/`(` sem namespace (ex: `update_lead{...}`). */
const KNOWN_TOOL_GLUED_RE = new RegExp(`\\b(?:${KNOWN_TOOL_NAMES_ALT})\\s*[({]`, "g");
const KNOWN_TOOL_GLUED_TEST_RE = new RegExp(`\\b(?:${KNOWN_TOOL_NAMES_ALT})\\s*[({]`);

/** Head órfão `[prefixo:]default_api:tool` sem grupo balanceado (LLM cortou). */
const NAMESPACED_HEAD_RE =
  /(?:[A-Za-z_][A-Za-z0-9_]*\s*:\s*)*default_api\s*:\s*[A-Za-z_][A-Za-z0-9_]*/gi;

/**
 * Encontra grupo balanceado a partir de `start` (posição de `{`, `(` ou `[`).
 * Diferente de findBalancedJson: aceita `()`/`[]` além de `{}`, e NÃO exige
 * JSON válido (os args vazados costumam vir sem aspas). Respeita strings
 * (aspas simples e duplas) e escapes.
 */
function findBalancedGroup(src: string, start: number): { end: number } | null {
  const OPENERS: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
  if (!OPENERS[src[start]]) return null;
  const stack: string[] = [];
  let inString: string | null = null;
  let escape = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (OPENERS[ch]) { stack.push(OPENERS[ch]); continue; }
    if (ch === "}" || ch === ")" || ch === "]") {
      if (stack.length === 0) return null;
      stack.pop();
      if (stack.length === 0) return { end: i };
    }
  }
  return null;
}

/**
 * Strip de chamadas de função "namespaced" vazadas como texto
 * (`[prefixo:]default_api:tool{args}` e `tool{args}` de tool conhecido). Rede
 * de segurança independente de JSON válido / tag angular. Ver
 * NAMESPACED_TOOLCALL_RE. Não recupera a ação (args sem aspas não são
 * parseáveis com segurança) — o canal confiável é o tool_call nativo.
 */
function stripNamespacedToolCalls(
  input: string,
): { cleaned: string; dropped: number } {
  if (!input || (!input.includes("default_api") && !KNOWN_TOOL_GLUED_TEST_RE.test(input))) {
    return { cleaned: input, dropped: 0 };
  }
  const ranges: Array<{ start: number; end: number }> = [];
  const collect = (re: RegExp) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      const bracketPos = m.index + m[0].length - 1; // último char do match = `{`/`(`
      const grp = findBalancedGroup(input, bracketPos);
      if (grp) {
        ranges.push({ start: m.index, end: grp.end });
        re.lastIndex = grp.end + 1; // não re-scanear dentro do grupo removido
      } else {
        // grupo não fecha (LLM truncou a call) — tudo daqui até o fim é lixo.
        ranges.push({ start: m.index, end: input.length - 1 });
        break;
      }
    }
  };
  collect(NAMESPACED_TOOLCALL_RE);
  collect(KNOWN_TOOL_GLUED_RE);
  if (ranges.length === 0) return { cleaned: input, dropped: 0 };

  ranges.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  let cleaned = input;
  let dropped = 0;
  for (let i = merged.length - 1; i >= 0; i--) {
    const { start, end } = merged[i];
    cleaned = cleaned.slice(0, start) + cleaned.slice(end + 1);
    dropped += 1;
  }
  return { cleaned, dropped };
}

export function sanitizeAssistantMessage(
  raw: string,
  alreadyHasAction: boolean,
): SanitizeResult {
  if (!raw) {
    return { text: raw, droppedBlocks: 0, recoveredAction: null, recoveredMediaByName: null };
  }

  // Passo 0: extrair reasoning chain (<thinking>...</thinking>) ANTES de tudo
  // Defensive: se LLM vazar <thinking> sem fechar, descartamos tudo após.
  const { cleaned: afterReasoning, reasoning } = extractReasoningChain(raw);
  raw = afterReasoning;

  let droppedBlocks = 0;
  let recoveredAction: RecoveredAction | null = null;
  let recoveredMediaByName: RecoveredMediaByName | null = null;

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

  // Passo 1c: tags em forma de CHAMADA-DE-FUNÇÃO `<...palavra(args)>` — rede
  // de segurança independente de allowlist (incidente KomBag 2026-06-23, onde
  // `<atendimento_vendas_b2b:enviar_midia_vendas_b2b(arquivo_midia='[imagem]Tamanhos.jpeg')>`
  // vazou porque o nome estava FORA da allowlist). Roda ANTES do strip inline
  // por allowlist pra capturar o filename de mídia do argumento (resolvido no
  // engine via DB) mesmo quando o nome do tool por acaso está na allowlist
  // (ex: `<send_media(file='x.jpg')>`).
  const fnCallStrip = stripFunctionCallTags(text);
  text = fnCallStrip.cleaned;
  droppedBlocks += fnCallStrip.dropped;
  if (fnCallStrip.mediaFileName && !recoveredMediaByName) {
    recoveredMediaByName = { file_name: fnCallStrip.mediaFileName };
  }

  // Passo 1d: pseudo-tags inline `<tool_name: args>` emitidas como texto
  // (incidente Barulhinho Bom 2026-06-02). Forma SEM parênteses
  // (`<send_video: Linha.mp4>`) — não casa 1c, gateada por allowlist aqui.
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

  // Passo 1e: chamadas "namespaced" vazadas como texto
  // (`declaration:default_api:update_lead{...}` / `deffn:default_api:...` /
  // `update_lead{...}`). Sem `<...>`, sem `"action"`, args sem aspas → escapa
  // de todos os passos acima. Incidentes Bia 2026-06-30 e 2026-07-02.
  const nsStrip = stripNamespacedToolCalls(text);
  text = nsStrip.cleaned;
  droppedBlocks += nsStrip.dropped;

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

  // Passo 2b: diretivas de mídia improvisadas SEM chave "action"
  // (ex: {"file":"CATALOGO.jpg"}, {"document":"..."}). Incidente VitrineVET
  // 2026-06-01. Remove o objeto pra não vazar; NÃO recupera ação aqui —
  // resolver filename→document_id exige DB (fora do sanitizer puro). O envio
  // correto volta pelo tool nativo send_document quando o doc está 'ready'.
  const mediaBlocks = extractMediaDirectiveBlocks(text);
  if (mediaBlocks.length > 0) {
    for (let i = mediaBlocks.length - 1; i >= 0; i--) {
      const b = mediaBlocks[i];
      droppedBlocks += 1;
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
  // pseudo-tags inline `<tool_name: args>` + tags-de-chamada `<...palavra(args)>`
  // residuais.
  INLINE_TOOL_TAG_RE.lastIndex = 0;
  FUNCTION_CALL_TAG_RE.lastIndex = 0;
  NAMESPACED_HEAD_RE.lastIndex = 0;
  REASONING_RESIDUAL_RE.lastIndex = 0;
  WRAPPER_RESIDUAL_RE.lastIndex = 0;
  text = text
    // tags de raciocínio (thinking/thought/analysis/...) e wrapper
    // (response/prefill/perfil/...) residuais — cobre o par instruído + as
    // variantes inventadas por gpt-4.1-mini / gemini-*-preview.
    .replace(REASONING_RESIDUAL_RE, "")
    .replace(WRAPPER_RESIDUAL_RE, "")
    .replace(/<\/?(?:tool_call|tool_code|vertical_tool_calls|no_tool_calls)\b[^>]*\/?\s*>/gi, "")
    .replace(INLINE_TOOL_TAG_RE, "")
    .replace(FUNCTION_CALL_TAG_RE, "")
    // head órfão `[prefixo:]default_api:tool` sem grupo balanceado (LLM cortou)
    .replace(NAMESPACED_HEAD_RE, "")
    .trim();
  INLINE_TOOL_TAG_RE.lastIndex = 0;
  FUNCTION_CALL_TAG_RE.lastIndex = 0;
  NAMESPACED_HEAD_RE.lastIndex = 0;
  REASONING_RESIDUAL_RE.lastIndex = 0;
  WRAPPER_RESIDUAL_RE.lastIndex = 0;

  return { text, droppedBlocks, recoveredAction, recoveredMediaByName, reasoning };
}

function tryRecoverFromString(jsonStr: string): RecoveredAction | null {
  try {
    const parsed = JSON.parse(jsonStr);
    // Schemas aceitos:
    //  - ReAct/legacy: { action, action_input }
    //  - OpenRouter universal: { tool_name, tool_arguments }
    //  - OpenAI-like: { name, arguments }
    //  - Gemini code-exec (<tool_code>): { tool, parameters }
    const rawToolName =
      (typeof parsed?.action === "string" && parsed.action) ||
      (typeof parsed?.tool_name === "string" && parsed.tool_name) ||
      (typeof parsed?.tool === "string" && parsed.tool) ||
      (typeof parsed?.name === "string" && parsed.name) ||
      "";
    const toolName = typeof rawToolName === "string" ? rawToolName.toLowerCase() : "";
    const mapped = TOOL_NAME_TO_ACTION[toolName];
    if (!mapped) return null;

    const rawInput =
      parsed.action_input ??
      parsed.tool_arguments ??
      parsed.arguments ??
      parsed.parameters ??
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
 *
 * Além de caixa/espaços (`||split||`, `|| SPLIT ||`), tolera **truncamento
 * frontal do token** — modo de falha real do LLM que para de emitir o token no
 * meio: `||SPL||` (incidente Forever Bella/Bia 2026-07-14, vazou pro lead
 * Kaylane), `||SPLI||`, `||SPLITT||`. Casa qualquer palavra que comece por `spl`
 * cercada por 2+ pipes de cada lado. `spl` entre pipes não ocorre em texto PT
 * legítimo — é sempre token de controle vazado. Sem isto, a variante truncada
 * NÃO batia no split → não quebrava a mensagem E ainda vazava crua no balão.
 */
export const SPLIT_DELIMITER_RE = /\|{2,}\s*spl[a-z]*\s*\|{2,}/gi;

/**
 * Quebra de parágrafo (linha em branco). Modelos como gemini-2.5-flash separam
 * pensamentos com `\n\n` em vez de emitir `||SPLIT||`, então sem isto o texto
 * vira UM balão único com quebra de linha (incidente Barulhinho 2026-06-02:
 * "cada parágrafo tinha que ser um balão"). `\n` simples NÃO quebra (mantém
 * quebras dentro do mesmo balão).
 */
const PARAGRAPH_BREAK_RE = /\n[ \t]*\n+/g;

export function splitByDelimiter(text: string): string[] {
  return text
    .split(SPLIT_DELIMITER_RE)
    .flatMap((chunk) => chunk.split(PARAGRAPH_BREAK_RE))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
