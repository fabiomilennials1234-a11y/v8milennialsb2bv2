/**
 * `POST /api/v1/leads` — criação de Lead pela API pública.
 *
 * A decisão que define esta rota: **telefone repetido não cria uma segunda
 * pessoa**. A API recusa e devolve, na própria recusa, o identificador e o nome
 * de quem já está lá — o chamador segue para abrir o Negócio sem precisar de uma
 * chamada extra. Isso torna a integração ingênua correta por padrão: quem
 * esqueceu de procurar antes recebe de volta exatamente o que a busca daria.
 *
 * Substitui, para quem usa chave escopada, o comportamento do webhook de ingest
 * — que cria sempre por padrão e só procura quando explicitamente pedido. Foi
 * esse padrão que produziu 45.678 pares duplicados em 52 organizações.
 *
 * **A decisão de conflito mora no banco, não aqui.** Procurar em TypeScript e
 * inserir depois é check-then-insert: duas requisições simultâneas com o mesmo
 * telefone veem "não existe" as duas e criam dois Leads — exatamente a duplicata
 * que a rota existe para impedir. A RPC resolve achar-ou-recusar de forma
 * atômica; este handler só traduz o resultado em HTTP.
 */
import type { ApiRouteContext } from "../router.ts";
import { apiError, apiResource } from "../responses.ts";

interface RpcClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data?: unknown; error?: unknown }>;
}

const INVALID = Symbol("invalid-json");

async function readJson(req: Request): Promise<unknown | typeof INVALID> {
  try {
    return await req.json();
  } catch {
    return INVALID;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Campos que a criação aceita E grava na mesma chamada. Tudo fora daqui é
 * recusado com 422 — antes desta lista, o corpo inteiro ia para a RPC, ela
 * gravava cinco colunas e o resto sumia com 201. Contrato que aceita e descarta
 * é contrato mentindo.
 *
 * A lista mora em DOIS lugares: aqui e no INSERT de `public.api_create_lead`
 * (supabase/migrations/20271209000000_api_create_lead_campos.sql). Somar um campo
 * aqui sem somar lá reabre a perda silenciosa; o teste de paridade da OpenAPI
 * amarra esta lista à documentação.
 */
export const CREATE_FIELDS = [
  "name", "phone", "email", "company", "origin", "notes",
  "segment", "faturamento",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
] as const;

const CREATE_FIELD_SET: ReadonlySet<string> = new Set(CREATE_FIELDS);

// Chaves que o PATCH entende e a criação não. Responsável, tier e score passam
// por validação própria (membro da org, vocabulário de tier) que mora no PATCH —
// duplicá-la aqui seria ter duas regras para o mesmo campo. A dica aponta o
// caminho em vez de só dizer "não".
const PATCH_ONLY_FIELDS: ReadonlySet<string> = new Set([
  "responsible_id", "sdr_id", "closer_id",
  "pre_sale_responsible_id", "sale_responsible_id",
  "tier", "pre_qualification_tier", "qualification_score",
]);

const HINT_PATCH = "Crie o Lead e use PATCH /api/v1/leads/{id} para responsáveis, tier e qualification_score.";
const HINT_CUSTOM_FIELDS = "Crie o Lead e use PUT /api/v1/leads/{id}/custom-fields para campos personalizados.";

type Validated =
  | { ok: true; lead: Record<string, string | null> }
  | { ok: false; status: number; code: string; message: string; details?: unknown };

/**
 * Filtra e normaliza o corpo. Devolve SÓ os campos da lista — é este objeto, e
 * nunca o corpo recebido, que viaja para o banco.
 */
function validateCreateBody(body: Record<string, unknown>): Validated {
  const unknown = Object.keys(body).filter((k) => !CREATE_FIELD_SET.has(k)).sort();
  if (unknown.length > 0) {
    const hints: string[] = [];
    if (unknown.some((k) => PATCH_ONLY_FIELDS.has(k))) hints.push(HINT_PATCH);
    if (unknown.some((k) => !PATCH_ONLY_FIELDS.has(k))) hints.push(HINT_CUSTOM_FIELDS);
    return {
      ok: false,
      status: 422,
      code: "unknown_fields",
      message: `Campos não aceitos na criação: ${unknown.join(", ")}`,
      details: { fields: unknown, hint: hints.join(" ") },
    };
  }

  const lead: Record<string, string | null> = {};
  for (const field of CREATE_FIELDS) {
    if (!(field in body)) continue;
    const v = body[field];
    if (v === null || typeof v === "string") lead[field] = v;
    // Número vira texto: as colunas são text, e quem manda faturamento 50000
    // quer 50000 gravado, não um 422.
    else if (typeof v === "number" && Number.isFinite(v)) lead[field] = String(v);
    else {
      return {
        ok: false,
        status: 422,
        code: "invalid_value",
        message: `Campo ${field} deve ser texto, número ou null`,
        details: { field },
      };
    }
  }

  // `leads.name` é NOT NULL: sem esta checagem o banco recusa com 23502 e o
  // chamador recebe 500 por um erro que é dele.
  if (typeof lead.name !== "string" || lead.name.trim() === "") {
    return { ok: false, status: 422, code: "missing_name", message: "Campo name é obrigatório" };
  }

  return { ok: true, lead };
}

interface CreateLeadResult {
  status?: string;
  reason?: string;
  lead?: { id?: string; name?: string | null };
}

export async function createLead(ctx: ApiRouteContext): Promise<Response> {
  const body = await readJson(ctx.req);
  if (body === INVALID || !isPlainObject(body)) {
    return apiError(400, "invalid_body", "Corpo deve ser um objeto JSON", ctx.cors);
  }

  const validated = validateCreateBody(body);
  if (!validated.ok) {
    return apiError(validated.status, validated.code, validated.message, ctx.cors, validated.details);
  }

  const supabase = ctx.supabase as unknown as RpcClient;
  // A chave viaja para o banco porque é lá que ela vale: duas requisições
  // simultâneas com a mesma chave são corrida, e corrida não se resolve aqui.
  const { data, error } = await supabase.rpc("api_create_lead", {
    p_org: ctx.organizationId,
    p_lead: validated.lead,
    p_idempotency_key: ctx.req.headers.get("Idempotency-Key"),
  });
  if (error) return apiError(500, "internal_error", "Erro ao criar lead", ctx.cors);

  const result = (data ?? {}) as CreateLeadResult;

  if (result.status === "conflict") {
    // `details` é o campo que o envelope de erro já tem para carga estruturada —
    // é por ele que o identificador volta, sem inventar um segundo formato de erro.
    // O código continua `lead_already_exists` também quando a causa é a chave de
    // idempotência reusada com outro corpo: os fluxos do n8n tratam exatamente
    // este código, e um código novo os derrubaria. A causa vai em `reason`.
    // O Lead existente nunca é alterado por esta chamada.
    const details: Record<string, unknown> = { lead_id: result.lead?.id, name: result.lead?.name };
    if (result.reason) details.reason = result.reason;
    return apiError(
      409,
      "lead_already_exists",
      result.reason === "idempotency_key_reused"
        ? "Idempotency-Key já usada com outro corpo; o Lead dela não foi alterado"
        : "Já existe um Lead com este telefone nesta organização",
      ctx.cors,
      details,
    );
  }

  // Replay não é criação. 201 aqui afirmaria que esta requisição criou o Lead,
  // quando ela só recebeu de volta o que a primeira já tinha criado.
  return apiResource(result.lead, ctx.cors, result.status === "replayed" ? 200 : 201);
}
