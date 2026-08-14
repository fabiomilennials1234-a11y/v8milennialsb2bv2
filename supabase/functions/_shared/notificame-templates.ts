/**
 * notificame-templates — a API de TEMPLATES do WhatsApp oficial (HSM), isolada
 * do resto do contrato porque tem uma rota, uma versão e um envelope PRÓPRIOS.
 *
 * Segue as mesmas leis de `notificame.ts`, sem exceção:
 *   • `res.ok` / `res.status` NUNCA entram na decisão — sempre `parseNotificameBody`;
 *   • toda operação de canal usa o token DA SUBCONTA (`NotificameOrgConfig`), e o
 *     tipo é a defesa: o token da conta-mãe não é aceito PELA ASSINATURA;
 *   • erro sai com CÓDIGO NOSSO e mensagem NOSSA. A prosa do fornecedor não
 *     atravessa, porque o `withErrorBoundary` devolve `error.message` cru no 500.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ DIVERGÊNCIA DE ROTA — LEIA ANTES DE "CORRIGIR" PARA `/v2/templates`
 *
 * O brief desta fatia afirmava, como fato verificado, que a listagem é
 * `GET /v2/templates` com `channel_id` em QUERYSTRING. Não é o que o fornecedor
 * documenta, e a checagem foi exaustiva: `/v2/templates` não aparece em NENHUM
 * material do fornecedor — nem em `app-api.md`, `nm-api.md`, `notificame-api.md`,
 * nem na coleção Postman oficial (`NotificaMe Hub API`, 47 requests). As duas
 * únicas ocorrências da string no universo do projeto são comentários NOSSOS, em
 * backups de `notificame.ts` — ou seja, a "verificação" cita a nós mesmos.
 *
 * O que o fornecedor documenta, em quatro capturas independentes E na coleção
 * Postman (que é o material mais forte, por ser request executável e não prosa):
 *
 *     GET    /v1/templates/{channel_id}                      → listar
 *     POST   /v1/templates/{channel_id}                      → criar
 *     DELETE /v2/channels/whatsapp/templates/{channel_id}/{template_name}
 *
 * A SUBSTÂNCIA do brief está certa e é o invariante que este módulo protege:
 * **template é POR CANAL**. Uma org com dois números tem duas listas. O que muda
 * é que o `channel_id` viaja no CAMINHO, não na querystring — e é por isso que
 * ele é obrigatório aqui por CONSTRUÇÃO (ver `channelPathSegment`): sem ele a URL
 * degeneraria para `/v1/templates/`, que é outra rota, e cujo silêncio seria lido
 * como "esta org não tem template nenhum".
 *
 * Como nenhum canal está conectado ainda, NADA aqui foi exercido contra a conta
 * viva. Todo shape é DERIVADO DE DOC e, portanto, lido com tolerância — do mesmo
 * jeito que `normalizeChannel` trata `/v1/channels`. Quando o primeiro canal
 * subir, o custo de estar errado é uma leitura vazia, nunca um dado gravado
 * torto: as funções de leitura recusam shape desconhecido em vez de inventar.
 *
 * ⚠️ ENVIO NÃO MORA AQUI, DE PROPÓSITO. A rota de envio diverge entre a doc
 * (`/v2/channels/whatsapp/messages`) e a coleção Postman
 * (`/v1/channels/whatsapp/messages`), e quem arbitra isso é o provider de envio —
 * dono da rota, do `from`/`to` e do send-governor. Este módulo entrega só o
 * CONTEÚDO do template (`buildTemplateSendContent`), que é o item de `contents[]`
 * do envelope. Duplicar a rota de envio aqui criaria um segundo lugar para ela
 * ficar desatualizada, e um segundo caminho que escapa do governor.
 */
import {
  type FetchImpl,
  NotificameError,
  type NotificameOrgConfig,
  parseNotificameBody,
} from "./notificame.ts";

// ─── Caminho e identidade do canal (puro) ────────────────────────────────────

/**
 * Normaliza a base. Cópia local e deliberada do helper privado de
 * `notificame.ts`: três linhas duplicadas custam menos do que alargar a
 * superfície pública daquele módulo no meio de uma fatia não-commitada.
 */
function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Converte o `channel_id` em segmento de caminho SEGURO, ou lança.
 *
 * ⚠️ ESTA FUNÇÃO É O INVARIANTE "template é por canal" ESCRITO EM CÓDIGO, e é
 * onde moram os dois modos de falha que importam:
 *
 *   1. VAZIO ⇒ `GET /v1/templates/` — rota diferente, que responde outra coisa
 *      (ou `Hub404` com HTTP 200, ver `notificame.ts`). Um `channelId` vazio que
 *      passasse daqui viraria "a org não tem templates", que é indistinguível de
 *      "a org tem templates e nós perguntamos errado". Silêncio que some por
 *      semanas — o mesmo modo de falha da subscription que nunca existiu.
 *
 *   2. SEPARADOR DE CAMINHO ⇒ travessia. `encodeURIComponent` já escaparia `/`
 *      e `..`, mas a recusa é EXPLÍCITA e vem antes: um id com barra não é um id
 *      escapável, é um id ERRADO, e escapá-lo em silêncio mandaria a pergunta
 *      para um canal que não é o pedido — cross-tenant dentro da mesma subconta.
 *
 * Recusar é sempre melhor que adivinhar: nada aqui é retentável sem o id certo.
 */
function channelPathSegment(channelId: string | null | undefined): string {
  const id = typeof channelId === "string" ? channelId.trim() : "";
  if (!id) {
    throw new NotificameError(
      "template_channel_id_missing",
      "Template exige o canal: sem canal não há lista de templates",
    );
  }
  if (/[/\\]/.test(id) || id === "." || id === "..") {
    throw new NotificameError(
      "template_channel_id_invalid",
      "Identificador de canal inválido para consulta de templates",
    );
  }
  return encodeURIComponent(id);
}

/** Mesmo tratamento para o nome do template, que também vai no CAMINHO. */
function templateNamePathSegment(name: string | null | undefined): string {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value) {
    throw new NotificameError(
      "template_name_missing",
      "Template exige nome",
    );
  }
  if (/[/\\]/.test(value) || value === "." || value === "..") {
    throw new NotificameError(
      "template_name_invalid",
      "Nome de template inválido",
    );
  }
  return encodeURIComponent(value);
}

// ─── Modelo do template (puro) ───────────────────────────────────────────────

/** Estados de aprovação da Meta. `null` = o fornecedor mandou algo que não conhecemos. */
export type TemplateStatus =
  | "APPROVED"
  | "PENDING"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED";

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

/**
 * POSITIONAL = `{{1}}`, `{{2}}` … | NAMED = `{{nome}}`.
 *
 * ⚠️ Decide o SHAPE do parâmetro no envio: NAMED exige `parameter_name` em cada
 * parâmetro, POSITIONAL exige a ORDEM certa e proíbe o campo. Mandar um pelo
 * outro é o erro mais fácil de cometer e o mais chato de diagnosticar — a Meta
 * recusa com mensagem genérica, e a mensagem simplesmente não chega ao cliente.
 */
export type TemplateParameterFormat = "POSITIONAL" | "NAMED";

export interface NotificameTemplateComponent {
  /** HEADER | BODY | FOOTER | BUTTONS — sempre em CAIXA ALTA na leitura. */
  type: string;
  /** TEXT | IMAGE | VIDEO | DOCUMENT — só em HEADER. */
  format?: string | null;
  text?: string | null;
  buttons?: unknown[] | null;
  /** Exemplos que a Meta exige na criação. Passa cru: é só para exibir. */
  example?: unknown;
}

export interface NotificameTemplate {
  /** Nome canônico — é ele que o envio referencia, não o `id`. */
  name: string;
  /** `id` do fornecedor. Vem NÚMERO na doc; guardamos string. */
  id: string | null;
  language: string | null;
  status: TemplateStatus | null;
  category: TemplateCategory | null;
  parameterFormat: TemplateParameterFormat | null;
  components: NotificameTemplateComponent[];
}

function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof c === "number" && Number.isFinite(c)) return String(c);
  }
  return null;
}

function readStatus(raw: unknown): TemplateStatus | null {
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return v === "APPROVED" || v === "PENDING" || v === "REJECTED" ||
      v === "PAUSED" || v === "DISABLED"
    ? v
    : null;
}

function readCategory(raw: unknown): TemplateCategory | null {
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return v === "MARKETING" || v === "UTILITY" || v === "AUTHENTICATION" ? v : null;
}

function readParameterFormat(raw: unknown): TemplateParameterFormat | null {
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return v === "POSITIONAL" || v === "NAMED" ? v : null;
}

/**
 * Normaliza um item de `GET /v1/templates/{channel_id}`. PURO.
 *
 * TOLERANTE no acessório, INTOLERANTE na identidade — a mesma assimetria de
 * `normalizeChannel`: sem `name` o item vira `null` e é descartado, porque o
 * envio referencia o template PELO NOME. Um template sem nome não é enviável, e
 * exibi-lo só produziria uma linha que falha quando clicada.
 *
 * ⚠️ `language` vem STRING aqui (`"pt_BR"`) e OBJETO no envio (`{code:"pt_BR"}`).
 * A assimetria é do fornecedor, não nossa: quem ler este campo e o repassar
 * direto para o envio manda `language: "pt_BR"` onde a Meta espera objeto.
 * `buildTemplateSendContent` sempre EMITE o objeto — é lá que a ponte é feita.
 */
export function normalizeTemplate(raw: unknown): NotificameTemplate | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const name = firstString(r.name, r.template_name);
  if (!name) return null;

  const rawComponents = Array.isArray(r.components) ? r.components : [];
  const components: NotificameTemplateComponent[] = [];
  for (const c of rawComponents) {
    if (c === null || typeof c !== "object") continue;
    const cr = c as Record<string, unknown>;
    const type = firstString(cr.type);
    if (!type) continue;
    components.push({
      type: type.toUpperCase(),
      format: firstString(cr.format),
      text: firstString(cr.text),
      buttons: Array.isArray(cr.buttons) ? cr.buttons : null,
      example: cr.example,
    });
  }

  return {
    name,
    id: firstString(r.id, r.template_id),
    language: firstString(r.language, r.language_code),
    status: readStatus(r.status),
    category: readCategory(r.category),
    parameterFormat: readParameterFormat(r.parameter_format),
    components,
  };
}

/**
 * Extrai a lista de dentro do envelope. PURO.
 *
 * A doc mostra `{"data":[…]}`; `/v1/channels` (rota irmã, indocumentada) devolve
 * ARRAY CRU. Aceita os dois e recusa o resto — `null` aqui significa "não é uma
 * listagem", e o chamador transforma isso em erro de shape em vez de em zero.
 * Distinguir "vazio" de "não entendi" é o ponto: os dois renderizam igual na
 * tela e têm causas opostas.
 */
export function readTemplateListEnvelope(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === "object") {
    const data = (value as Record<string, unknown>).data;
    if (Array.isArray(data)) return data;
  }
  return null;
}

// ─── Listagem (I/O) ──────────────────────────────────────────────────────────

/**
 * `GET /v1/templates/{channel_id}` com o token DA SUBCONTA.
 *
 * Devolve só os itens legíveis, na ordem do fornecedor. Item ilegível é
 * DESCARTADO (não derruba a lista): um template sem nome não é enviável, e negar
 * a lista inteira por causa dele tiraria do ar os que funcionam.
 */
export async function listTemplates(
  cfg: NotificameOrgConfig,
  channelId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<NotificameTemplate[]> {
  const segment = channelPathSegment(channelId);
  const endpoint = `${stripTrailingSlash(cfg.baseUrl)}/v1/templates/${segment}`;

  let raw: string;
  try {
    const res = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        "X-Api-Token": cfg.subaccountToken,
        Accept: "application/json",
      },
    });
    raw = await res.text();
  } catch {
    throw new NotificameError(
      "templates_transport_error",
      "Não foi possível falar com o NotificaMe para listar templates",
    );
  }

  const parsed = parseNotificameBody(raw);
  if (!parsed.ok) {
    throw new NotificameError(parsed.code, "NotificaMe recusou a listagem de templates");
  }

  const items = readTemplateListEnvelope(parsed.value);
  if (!items) {
    throw new NotificameError(
      "templates_unexpected_shape",
      "NotificaMe devolveu um formato inesperado na listagem de templates",
    );
  }

  const templates: NotificameTemplate[] = [];
  for (const item of items) {
    const template = normalizeTemplate(item);
    if (template) templates.push(template);
  }
  return templates;
}

// ─── Criação (puro + I/O) ────────────────────────────────────────────────────

export interface CreateTemplateComponentInput {
  /** HEADER | BODY | FOOTER | BUTTONS. */
  type: string;
  /** TEXT | IMAGE | VIDEO | DOCUMENT — só faz sentido em HEADER. */
  format?: string;
  text?: string;
  buttons?: unknown[];
  /** `{header_text:[…]}` / `{body_text:[…]}` — a Meta EXIGE quando há `{{n}}`. */
  example?: unknown;
}

export interface CreateTemplateInput {
  name: string;
  /** String, não objeto — na CRIAÇÃO o fornecedor quer `"pt_BR"` cru. */
  language: string;
  category: TemplateCategory;
  components: CreateTemplateComponentInput[];
}

/**
 * Monta o corpo de `POST /v1/templates/{channel_id}`. PURO.
 *
 * ⚠️ DUAS REDUNDÂNCIAS DO FORNECEDOR QUE PARECEM ENGANO E NÃO SÃO — a
 * implementação "limpa" (mandar o template no topo do corpo) é recusada:
 *
 *   1. `from` REPETE o `channel_id` que já está no CAMINHO. Omitir parece óbvio
 *      e quebra.
 *   2. O template vai ENVELOPADO em `contents: [{ template: … }]` — o mesmo
 *      envelope das mensagens, sem `to` e sem `type`. Não é `{template: …}` no
 *      topo.
 *
 * `channelId` entra CRU aqui (é conteúdo de corpo, não caminho); quem chama a
 * rota passa o mesmo valor por `channelPathSegment`, que é quem valida.
 */
export function buildCreateTemplateBody(
  channelId: string,
  input: CreateTemplateInput,
): Record<string, unknown> {
  const components = input.components.map((c) => {
    const out: Record<string, unknown> = { type: c.type.toUpperCase() };
    if (c.format !== undefined) out.format = c.format.toUpperCase();
    if (c.text !== undefined) out.text = c.text;
    if (c.buttons !== undefined) out.buttons = c.buttons;
    if (c.example !== undefined) out.example = c.example;
    return out;
  });

  return {
    from: channelId,
    contents: [
      {
        template: {
          name: input.name,
          language: input.language,
          category: input.category,
          components,
        },
      },
    ],
  };
}

export interface CreatedTemplate {
  id: string | null;
  /** `PENDING` é o SUCESSO NORMAL — ver `createTemplate`. */
  status: TemplateStatus | null;
  category: TemplateCategory | null;
}

/**
 * `POST /v1/templates/{channel_id}` com o token DA SUBCONTA.
 *
 * ⚠️ `status: "PENDING"` É SUCESSO. Todo template nasce em revisão da Meta e leva
 * de minutos a horas para virar `APPROVED`. Quem tratar "não-APPROVED" como falha
 * vai reprovar toda criação bem-sucedida, e o operador vai recriar o mesmo
 * template em loop — cada tentativa nascendo de verdade do lado do fornecedor,
 * porque a criação FUNCIONOU. `parseNotificameBody` já deixa passar (a resposta
 * não tem `code`); esta função só normaliza e NÃO julga o `status`.
 */
export async function createTemplate(
  cfg: NotificameOrgConfig,
  channelId: string,
  input: CreateTemplateInput,
  fetchImpl: FetchImpl = fetch,
): Promise<CreatedTemplate> {
  const segment = channelPathSegment(channelId);

  const name = input.name?.trim();
  if (!name) {
    throw new NotificameError("template_name_missing", "Template exige nome");
  }
  if (!input.language?.trim()) {
    throw new NotificameError("template_language_missing", "Template exige idioma");
  }
  if (!Array.isArray(input.components) || input.components.length === 0) {
    throw new NotificameError(
      "template_components_missing",
      "Template exige ao menos um componente",
    );
  }

  const endpoint = `${stripTrailingSlash(cfg.baseUrl)}/v1/templates/${segment}`;
  const body = buildCreateTemplateBody(channelId, { ...input, name });

  let raw: string;
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "X-Api-Token": cfg.subaccountToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    raw = await res.text();
  } catch {
    // Transporte quebrado: "não sei se nasceu". NUNCA "falhou" — o template pode
    // ter sido criado do outro lado, e recriar dá nome duplicado na Meta.
    throw new NotificameError(
      "templates_transport_error",
      "Não foi possível falar com o NotificaMe para criar o template",
    );
  }

  const parsed = parseNotificameBody(raw);
  if (!parsed.ok) {
    throw new NotificameError(parsed.code, "NotificaMe recusou a criação do template");
  }

  const value = parsed.value;
  if (value === null || typeof value !== "object") {
    throw new NotificameError(
      "templates_unexpected_shape",
      "NotificaMe devolveu um formato inesperado na criação do template",
    );
  }
  const r = value as Record<string, unknown>;

  return {
    id: firstString(r.id, r.template_id),
    status: readStatus(r.status),
    category: readCategory(r.category),
  };
}

// ─── Exclusão (I/O) ──────────────────────────────────────────────────────────

/**
 * `DELETE /v2/channels/whatsapp/templates/{channel_id}/{template_name}`.
 *
 * ⚠️ ESTA É A ÚNICA OPERAÇÃO DO MÓDULO QUE MUDA DE VERSÃO — `/v2` e sob
 * `channels/whatsapp`, enquanto listar e criar são `/v1/templates`. Não é engano
 * de transcrição: doc e coleção Postman concordam. Uniformizar "por coerência"
 * manda a exclusão para uma rota inexistente, que responde HTTP 200 com
 * `Hub404` — ou seja, pareceria ter funcionado.
 *
 * Exclusão é IRREVERSÍVEL do lado da Meta e um template apagado derruba todo
 * envio que o referencia pelo nome. A UI que chamar isto (fatia própria) precisa
 * confirmar; aqui não há guarda possível além de exigir nome e canal.
 */
export async function deleteTemplate(
  cfg: NotificameOrgConfig,
  channelId: string,
  templateName: string,
  fetchImpl: FetchImpl = fetch,
): Promise<void> {
  const channelSegment = channelPathSegment(channelId);
  const nameSegment = templateNamePathSegment(templateName);

  const endpoint = `${stripTrailingSlash(cfg.baseUrl)}` +
    `/v2/channels/whatsapp/templates/${channelSegment}/${nameSegment}`;

  let raw: string;
  try {
    const res = await fetchImpl(endpoint, {
      method: "DELETE",
      headers: {
        "X-Api-Token": cfg.subaccountToken,
        Accept: "application/json",
      },
    });
    raw = await res.text();
  } catch {
    throw new NotificameError(
      "templates_transport_error",
      "Não foi possível falar com o NotificaMe para excluir o template",
    );
  }

  const parsed = parseNotificameBody(raw);
  if (!parsed.ok) {
    throw new NotificameError(parsed.code, "NotificaMe recusou a exclusão do template");
  }
}

// ─── Conteúdo de envio (puro) ────────────────────────────────────────────────

/**
 * Parâmetro de um componente no ENVIO.
 *
 * `parameterName` só existe em template NAMED (`parameter_format: "NAMED"` na
 * listagem). Em POSITIONAL, o que vale é a ORDEM do array.
 */
export type TemplateSendParameter =
  | { type: "text"; text: string; parameterName?: string }
  | { type: "image" | "video" | "document"; link: string }
  | { type: "action"; flowToken: string };

export interface TemplateSendComponent {
  type: "header" | "body" | "footer" | "button";
  /** Obrigatório quando `type === "button"`. */
  subType?: "flow" | "quick_reply" | "url";
  /** Posição do botão, obrigatória quando `type === "button"`. */
  index?: string | number;
  /** Vazio é LEGÍTIMO: template sem parâmetro manda `parameters: []`. */
  parameters?: TemplateSendParameter[];
}

export interface TemplateSendInput {
  name: string;
  /** `pt_BR`, `en_US` … Vai como OBJETO `{code}` no envio. */
  languageCode: string;
  components: TemplateSendComponent[];
  /**
   * `deterministic` = exatamente este idioma; `fallback` = a Meta pode escolher
   * outro. Só documentado na rota Marketing Lite; omitido por padrão.
   */
  languagePolicy?: "deterministic" | "fallback";
}

function buildSendParameter(p: TemplateSendParameter): Record<string, unknown> {
  if (p.type === "text") {
    const out: Record<string, unknown> = { type: "text", text: p.text };
    // Só emite `parameter_name` quando existe: mandá-lo num template POSITIONAL
    // é recusado pela Meta, e o envio some sem mensagem útil.
    if (p.parameterName) out.parameter_name = p.parameterName;
    return out;
  }
  if (p.type === "action") {
    return { type: "action", action: { flow_token: p.flowToken } };
  }
  // Mídia aninha sob a PRÓPRIA chave: {type:"image", image:{link}}.
  return { type: p.type, [p.type]: { link: p.link } };
}

/**
 * Monta UM item de `contents[]` para enviar um template. PURO — não faz I/O e
 * não conhece rota: o envelope (`from`/`to`) e a rota são do provider de envio.
 *
 * ⚠️ O COMPONENTE ENTRA MESMO SEM PARÂMETRO. O exemplo "sem parâmetros" da doc
 * manda o componente com `parameters: []`, e é o shape que reproduzimos: a
 * tentação é podar componente vazio, e um template aprovado com HEADER podado no
 * envio é recusado pela Meta.
 *
 * ⚠️ BOTÃO SEM `sub_type`/`index` NÃO FUNCIONA — a doc é explícita ("se não
 * passar botão flow dessa forma o template não irá funcionar"), e a falha é
 * silenciosa. Por isso aqui é ERRO DE CONSTRUÇÃO, levantado antes da rede, e não
 * um 422 opaco depois.
 */
export function buildTemplateSendContent(
  input: TemplateSendInput,
): Record<string, unknown> {
  const name = input.name?.trim();
  if (!name) {
    throw new NotificameError("template_name_missing", "Envio de template exige nome");
  }
  const code = input.languageCode?.trim();
  if (!code) {
    throw new NotificameError(
      "template_language_missing",
      "Envio de template exige idioma",
    );
  }

  const components = (input.components ?? []).map((c) => {
    const out: Record<string, unknown> = { type: c.type };

    if (c.type === "button") {
      if (!c.subType) {
        throw new NotificameError(
          "template_button_subtype_missing",
          "Botão de template exige o subtipo",
        );
      }
      if (c.index === undefined || c.index === null || c.index === "") {
        throw new NotificameError(
          "template_button_index_missing",
          "Botão de template exige a posição",
        );
      }
      out.sub_type = c.subType;
      out.index = String(c.index);
    }

    out.parameters = (c.parameters ?? []).map(buildSendParameter);
    return out;
  });

  const language: Record<string, unknown> = { code };
  if (input.languagePolicy) language.policy = input.languagePolicy;

  return {
    type: "template",
    template: { name, components, language },
  };
}
