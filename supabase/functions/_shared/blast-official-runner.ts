/**
 * blast-official-runner — o laço do Disparo pelo Canal Oficial (#1722).
 *
 * Um tique: reivindica destinatários pendentes, envia um a um por Template
 * aprovado, e marca cada linha com o que o fornecedor respondeu. É o motor
 * próprio do ADR-0028 — o canal oficial não tem endpoint de lote, e a unidade
 * passa a ser o destinatário em vez de um contador de job.
 *
 * ⚠️ ESTE MÓDULO NÃO GRAVA A MENSAGEM NA CONVERSA.
 *
 * O provider do canal oficial já escreve a própria linha, no mesmo instante do
 * envio (`whatsapp-providers/notificame-provider.ts:1297-1316`, upsert em
 * `channel_messages`). Gravar aqui de novo duplicaria a mensagem na thread do
 * vendedor — e o `external_id` do eco viria diferente, então nem a UNIQUE
 * protegeria. Mesma regra que `action-handlers/enviar-template.ts:103-105`
 * carrega para o nó de Workflow. É critério de aceite, não detalhe.
 *
 * ⚠️ O TRANSPORTE ENTRA POR INJEÇÃO, e o de produção é `sendTemplateViaInstance`
 * (`whatsapp-dispatch.ts:393`), que já traz o choke único: dedup, governor,
 * accounting e espelhamento da mídia de cabeçalho. Trocá-lo por uma chamada
 * direta ao provider sairia de todas essas guardas de uma vez.
 *
 * O relógio e o sono também entram por injeção — é o que torna o laço testável
 * sem esperar em tempo real e sem banco.
 */
import {
  decidirDisparoDoDestinatario,
  type TemplateDoDisparo,
} from "./decisao-do-disparo.ts";

/**
 * O `trackSource` do envio.
 *
 * ⚠️ NÃO TROQUE POR UM VALOR NOVO. `deriveSendSource` reconhece um vocabulário
 * FECHADO (`send-dedup.ts:65-77`); um valor fora do mapa faz o dedup ser pulado
 * FAIL-OPEN, com um único log — o envio sai do choke em silêncio. `mass_send`
 * está no mapa e é o que este Disparo é.
 */
export const TRACK_SOURCE_DO_DISPARO = "mass_send";

/** A linha reivindicada, como o RPC a devolve. */
export interface LinhaDoDisparo {
  id: string;
  plan_id: string;
  lead_id: string | null;
  phone: string | null;
  status: string;
  claimed_at: string | null;
  lot_index: number;
}

/** O Template do plano, já no formato que o transporte espera. */
export interface TemplateDoPlano extends TemplateDoDisparo {
  previewText: string;
  buttonLabels: string[];
}

export interface ResultadoDoEnvio {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface DepsDoWorker {
  supabaseAdmin: any;
  /** Em produção: `sendTemplateViaInstance`, com o choke dentro. */
  enviarTemplate(params: {
    instance: Record<string, unknown>;
    phone: string;
    template: TemplateDoPlano;
    trackSource: string;
    trackId: string;
  }): Promise<ResultadoDoEnvio>;
  esperar(ms: number): Promise<void>;
  agora(): Date;
}

export interface ConfigDoTique {
  batchSize: number;
  perOrgCap: number;
  /** Pausa entre envios. FIXA e conservadora — o adaptativo é #1728. */
  pausaMs: number;
}

export interface ResultadoDoTique {
  reivindicados: number;
  enviados: number;
  falhas: number;
  pulados: number;
  recusados: number;
}

export async function processarTiqueDoDisparo(
  deps: DepsDoWorker,
  cfg: ConfigDoTique,
): Promise<ResultadoDoTique> {
  const r: ResultadoDoTique = {
    reivindicados: 0,
    enviados: 0,
    falhas: 0,
    pulados: 0,
    recusados: 0,
  };

  // A reivindicação É a idempotência (ADR-0028 §5): o RPC marca `claimed_at`
  // sob `FOR UPDATE SKIP LOCKED`, então dois tiques nunca pegam a mesma linha.
  const { data: linhas, error } = await deps.supabaseAdmin.rpc(
    "claim_blast_recipients",
    { batch_size: cfg.batchSize, per_org_cap: cfg.perOrgCap },
  );
  if (error) throw new Error(`claim_blast_recipients: ${error.message}`);

  const reivindicadas: LinhaDoDisparo[] = (linhas ?? []) as LinhaDoDisparo[];
  r.reivindicados = reivindicadas.length;
  if (reivindicadas.length === 0) return r;

  const contexto = await carregarContexto(deps, reivindicadas);

  let primeiro = true;
  for (const linha of reivindicadas) {
    const ctx = contexto.get(linha.plan_id);

    const decisao = decidirDisparoDoDestinatario({
      // Sem contexto do plano não há regime a afirmar. `chip` é a resposta
      // fail-closed: faz a regra recusar, e recusar não toca na linha.
      regime: ctx?.regime ?? "chip",
      plano: {
        status: ctx?.plano.status ?? "unknown",
        template: ctx?.plano.template ?? null,
      },
      destinatario: {
        status: linha.status,
        phone: linha.phone,
        claimedAt: linha.claimed_at,
      },
    });

    if (decisao.acao === "recusar") {
      // A linha fica INTACTA — volta no próximo tique. Não é ela que está
      // errada; é o Disparo que não pode partir agora.
      r.recusados += 1;
      continue;
    }

    if (decisao.acao === "pular") {
      await marcar(deps, linha.id, { status: "skipped", reason: decisao.motivo });
      r.pulados += 1;
      continue;
    }

    // Ritmo fixo: a pausa fica ENTRE envios, não antes do primeiro — um tique
    // que manda uma mensagem só não deve pagar espera nenhuma.
    if (!primeiro) await deps.esperar(cfg.pausaMs);
    primeiro = false;

    const envio = await deps.enviarTemplate({
      instance: ctx!.instance,
      phone: linha.phone!,
      template: ctx!.plano.template!,
      trackSource: TRACK_SOURCE_DO_DISPARO,
      trackId: linha.id,
    });

    if (envio.success) {
      await marcar(deps, linha.id, {
        status: "sent",
        sent_at: deps.agora().toISOString(),
        // O id da resposta do envio. É o que o callback de status usa para
        // achar esta linha (#1724) — e a UNIQUE parcial em
        // `provider_message_id` é o que impede a mesma resposta de fechar duas.
        provider_message_id: envio.messageId ?? null,
        reason: null,
      });
      r.enviados += 1;
    } else {
      // Falha de UM destinatário não derruba o tique: a fila é por pessoa
      // justamente para que o defeito de uma não vire o silêncio de todas.
      await marcar(deps, linha.id, {
        status: "failed",
        reason: envio.error ?? "Falha no envio, sem motivo do fornecedor.",
      });
      r.falhas += 1;
    }
  }

  return r;
}

interface ContextoDoPlano {
  plano: { status: string; template: TemplateDoPlano | null };
  instance: Record<string, unknown>;
  regime: "chip" | "oficial";
}

/**
 * Carrega plano e instância das linhas reivindicadas, em DUAS consultas — não
 * uma por destinatário. Um tique com 20 linhas de um plano só faria 40 idas ao
 * banco para reler a mesma coisa.
 */
async function carregarContexto(
  deps: DepsDoWorker,
  linhas: LinhaDoDisparo[],
): Promise<Map<string, ContextoDoPlano>> {
  const planIds = [...new Set(linhas.map((l) => l.plan_id))];

  const { data: planos } = await deps.supabaseAdmin
    .from("blast_plans")
    .select("id, organization_id, status, instance_id, template")
    .in("id", planIds);

  const instanceIds = [
    ...new Set(((planos ?? []) as any[]).map((p) => p.instance_id).filter(Boolean)),
  ];

  const { data: instancias } = await deps.supabaseAdmin
    .from("whatsapp_instances")
    .select("*")
    .in("id", instanceIds);

  const porInstancia = new Map(
    ((instancias ?? []) as any[]).map((i) => [i.id, i]),
  );

  const mapa = new Map<string, ContextoDoPlano>();
  for (const p of (planos ?? []) as any[]) {
    const instance = porInstancia.get(p.instance_id);
    if (!instance) continue;
    mapa.set(p.id, {
      plano: { status: p.status, template: p.template ?? null },
      instance,
      // O regime é do provedor da Instance, e a mesma verdade do módulo do
      // front (`campaigns/lib/disparo-numbers.ts`): oficial é `notificame`.
      regime: instance.provider === "notificame" ? "oficial" : "chip",
    });
  }
  return mapa;
}

async function marcar(
  deps: DepsDoWorker,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await deps.supabaseAdmin
    .from("blast_plan_recipients")
    .update(patch)
    .eq("id", id);
  if (error) {
    // A mensagem JÁ SAIU. Transformar falha de banco em exceção faria o tique
    // seguinte reprocessar quem já recebeu — e a duplicata é cobrada. Barulho
    // no log, e a linha fica reivindicada até o stale de 10 minutos.
    console.error(
      `[blast-official] envio feito mas linha NÃO marcada: id=${id} err=${error.message}`,
    );
  }
}
