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

interface CreateLeadResult {
  status?: string;
  lead?: { id?: string; name?: string | null };
}

export async function createLead(ctx: ApiRouteContext): Promise<Response> {
  const body = await readJson(ctx.req);
  if (body === INVALID || !isPlainObject(body)) {
    return apiError(400, "invalid_body", "Corpo deve ser um objeto JSON", ctx.cors);
  }

  const supabase = ctx.supabase as unknown as RpcClient;
  // A chave viaja para o banco porque é lá que ela vale: duas requisições
  // simultâneas com a mesma chave são corrida, e corrida não se resolve aqui.
  const { data, error } = await supabase.rpc("api_create_lead", {
    p_org: ctx.organizationId,
    p_lead: body,
    p_idempotency_key: ctx.req.headers.get("Idempotency-Key"),
  });
  if (error) return apiError(500, "internal_error", "Erro ao criar lead", ctx.cors);

  const result = (data ?? {}) as CreateLeadResult;

  if (result.status === "conflict") {
    // `details` é o campo que o envelope de erro já tem para carga estruturada —
    // é por ele que o identificador volta, sem inventar um segundo formato de erro.
    return apiError(
      409,
      "lead_already_exists",
      "Já existe um Lead com este telefone nesta organização",
      ctx.cors,
      { lead_id: result.lead?.id, name: result.lead?.name },
    );
  }

  // Replay não é criação. 201 aqui afirmaria que esta requisição criou o Lead,
  // quando ela só recebeu de volta o que a primeira já tinha criado.
  return apiResource(result.lead, ctx.cors, result.status === "replayed" ? 200 : 201);
}
