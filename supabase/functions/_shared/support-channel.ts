/**
 * support-channel — de onde sai a mensagem do canal de suporte da Torque.
 *
 * Existe por causa de duas quedas com a mesma forma:
 *
 *   1. 14/07 → 07/08/2026 — `SUPPORT_UAZAPI_TOKEN` apontava para uma instância
 *      cujo token foi revogado. 24 dias, 37 avisos perdidos, 401 em todos.
 *   2. 02/09/2026 — o número reconectou na Uazapi sob OUTRA instância. A antiga,
 *      que a secret ainda apontava, virou `503 session is not reconnectable`.
 *
 * Nos dois casos o código estava certo e a **credencial estática** é que tinha
 * envelhecido calada. Uma secret copiada à mão não sabe que o mundo mudou; a
 * tabela de instâncias sabe, porque o produto inteiro a mantém viva.
 *
 * Por isso a credencial passa a ser RESOLVIDA do banco, a cada envio: a
 * instância conectada da organização da plataforma. Reconectou, trocou de
 * instância, foi repareada — o canal acompanha sozinho, sem deploy e sem
 * ninguém lembrar de rotacionar secret.
 *
 * Quem aponta a organização é `cron_config`, não o código: `support_sender_org_id`
 * (ou `support_sender_instance_id`, quando se quer travar numa linha específica).
 * Trocar de número é um UPDATE, não um release.
 *
 * O `SUPPORT_UAZAPI_TOKEN` continua como último recurso — não por apego, mas
 * porque um canal de aviso que morre quando a configuração falta é pior que um
 * canal apontando para o lugar velho. A origem escolhida viaja em `source` e vai
 * parar no `runtime_logs`: se o resolvedor calar e a função voltar a mandar pela
 * secret, isso aparece, em vez de a regressão passar por sucesso.
 */

/** Só o que a escolha precisa ver. Espelha colunas de `whatsapp_instances`. */
export interface SenderCandidate {
  id: string;
  instance_name: string | null;
  phone_number: string | null;
  status: string | null;
  provider: string | null;
  session_dead_since: string | null;
  last_connection_at: string | null;
}

export type SenderSource = "instance" | "env";

export interface SupportSender {
  token: string;
  baseUrl: string;
  groupJid: string;
  /** `instance` = resolvida do banco. `env` = caiu na secret legada. */
  source: SenderSource;
  instanceId?: string;
  instanceName?: string | null;
  phoneNumber?: string | null;
}

export type ResolveResult =
  | { ok: true; sender: SupportSender }
  | { ok: false; reason: string };

/**
 * Qual instância manda.
 *
 * Pura de propósito: é a única regra do arquivo que erra em silêncio se estiver
 * errada — mandar por uma instância morta devolve 200 do lado de cá e nada do
 * lado de lá. Fora do I/O ela é testável sem banco e sem rede.
 *
 * `session_dead_since` é o que separa "o banco acha que está conectada" de "está
 * mesmo": o watchdog de sessão carimba essa coluna quando a Uazapi desmente o
 * status. Ignorá-la reproduziria exatamente a queda de 02/09, em que
 * `status = 'connected'` convivia com uma sessão irrecuperável.
 */
export function pickSenderInstance(candidates: SenderCandidate[]): SenderCandidate | null {
  const vivas = candidates.filter(
    (c) =>
      c.status === "connected" &&
      c.session_dead_since === null &&
      (c.provider === "uazapi" || c.provider === null),
  );
  if (vivas.length === 0) return null;

  // Mais recentemente conectada primeiro. Quem nunca conectou vai para o fim —
  // `null` aqui é ausência de prova, não prova de antiguidade.
  return [...vivas].sort((a, b) => {
    const ta = a.last_connection_at ? Date.parse(a.last_connection_at) : -Infinity;
    const tb = b.last_connection_at ? Date.parse(b.last_connection_at) : -Infinity;
    return tb - ta;
  })[0];
}

type EnvReader = (key: string) => string | undefined;

/** Cliente Supabase com service role. Tipado frouxo para não arrastar o SDK aqui. */
// deno-lint-ignore no-explicit-any
type AdminClient = any;

async function readConfig(supabaseAdmin: AdminClient, key: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("cron_config")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  const value = data?.value;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

async function tokenForInstance(
  supabaseAdmin: AdminClient,
  instanceId: string,
): Promise<string | null> {
  // Mesma porta que o resto do produto usa: `whatsapp_instance_secrets` é
  // deny-all e só a RPC SECURITY DEFINER (service_role) enxerga o cofre.
  const { data, error } = await supabaseAdmin.rpc("get_uazapi_credentials", {
    p_instance_id: instanceId,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  const token = row?.uazapi_token;
  return typeof token === "string" && token !== "" ? token : null;
}

async function candidatesFor(
  supabaseAdmin: AdminClient,
  filtro: { instanceId?: string; orgId?: string },
): Promise<SenderCandidate[]> {
  let query = supabaseAdmin
    .from("whatsapp_instances")
    .select(
      "id, instance_name, phone_number, status, provider, session_dead_since, last_connection_at",
    );
  query = filtro.instanceId
    ? query.eq("id", filtro.instanceId)
    : query.eq("organization_id", filtro.orgId);

  const { data, error } = await query;
  if (error || !Array.isArray(data)) return [];
  return data as SenderCandidate[];
}

/**
 * Resolve quem manda a mensagem do canal de suporte.
 *
 * Ordem: instância travada em `support_sender_instance_id` → instância conectada
 * da org em `support_sender_org_id` → `SUPPORT_UAZAPI_TOKEN` (legado).
 */
export async function resolveSupportSender(
  supabaseAdmin: AdminClient,
  env: EnvReader,
): Promise<ResolveResult> {
  const baseUrl = env("UAZAPI_BASE_URL");
  const groupJid = env("SUPPORT_WHATSAPP_GROUP_JID");
  if (!baseUrl) return { ok: false, reason: "UAZAPI_BASE_URL ausente" };
  if (!groupJid) return { ok: false, reason: "SUPPORT_WHATSAPP_GROUP_JID ausente" };

  const pinnedInstance = await readConfig(supabaseAdmin, "support_sender_instance_id");
  const orgId = pinnedInstance ? null : await readConfig(supabaseAdmin, "support_sender_org_id");

  if (pinnedInstance || orgId) {
    const candidatos = await candidatesFor(
      supabaseAdmin,
      pinnedInstance ? { instanceId: pinnedInstance } : { orgId: orgId! },
    );
    const escolhida = pickSenderInstance(candidatos);
    if (escolhida) {
      const token = await tokenForInstance(supabaseAdmin, escolhida.id);
      if (token) {
        return {
          ok: true,
          sender: {
            token,
            baseUrl,
            groupJid,
            source: "instance",
            instanceId: escolhida.id,
            instanceName: escolhida.instance_name,
            phoneNumber: escolhida.phone_number,
          },
        };
      }
    }
  }

  const envToken = env("SUPPORT_UAZAPI_TOKEN");
  if (envToken) {
    return { ok: true, sender: { token: envToken, baseUrl, groupJid, source: "env" } };
  }

  return {
    ok: false,
    reason: pinnedInstance || orgId
      ? "nenhuma instância conectada na configuração do canal e SUPPORT_UAZAPI_TOKEN ausente"
      : "canal sem configuração (support_sender_org_id / support_sender_instance_id) e sem SUPPORT_UAZAPI_TOKEN",
  };
}

/**
 * Envia texto pelo canal resolvido.
 *
 * Nunca lança: quem chama é caminho best-effort (o Chamado já está gravado, o
 * alerta já foi decidido) e uma exceção aqui viraria 5xx que faz o trigger ou o
 * cron repetir. O erro volta como dado, para virar linha em `runtime_logs`.
 */
export async function sendSupportText(
  sender: SupportSender,
  text: string,
  numberOverride?: string,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const resp = await fetch(`${sender.baseUrl.replace(/\/$/, "")}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: sender.token },
      body: JSON.stringify({ number: numberOverride ?? sender.groupJid, text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return { ok: false, detail: `uazapi ${resp.status}: ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Rastro do canal usado, para o `payloadSnapshot` do `runtime_logs`. */
export function senderTrace(sender: SupportSender): Record<string, unknown> {
  return {
    sender_source: sender.source,
    sender_instance_id: sender.instanceId ?? null,
    sender_instance_name: sender.instanceName ?? null,
    sender_phone: sender.phoneNumber ?? null,
  };
}
