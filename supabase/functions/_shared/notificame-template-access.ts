/**
 * Gate de acesso da porta de templates.
 *
 * ⚠️ TEMPLATE É COISA DE WHATSAPP, E CANAL DE WHATSAPP MORA EM
 * `whatsapp_instances`. `messaging_channels` guarda os canais SOCIAIS
 * (Instagram/Facebook) — medido em prod: uma linha, de Instagram, contra 139 de
 * WhatsApp em `whatsapp_instances`. Ler a tabela errada aqui produz uma porta
 * que passa em todo teste de unidade e nunca encontra um canal real.
 *
 * O `instance_id` chega DO CLIENTE — e função com credencial de servidor que
 * recorta por parâmetro do cliente SEM CONFERIR o parâmetro é o vetor já
 * catalogado neste repo. A conferência mora aqui, pura, e não dentro do handler:
 * atrás de rede e auth nenhum teste a alcançaria, e um gate que ninguém
 * exercita é um gate que ninguém sabe se funciona.
 *
 * As regras espelham `whatsapp-client.ts` (o resolvedor canônico de instância
 * NotificaMe) de propósito: o que é uma instância válida precisa ser decidido no
 * mesmo vocabulário nos dois lugares, ou o envio aceita o que a listagem recusa.
 */

import { isNonWhatsAppChannelType } from "./whatsapp-client.ts";

export interface TemplateInstanceRow {
  id: string;
  organization_id: string;
  provider: string | null;
  provider_config: Record<string, unknown> | null;
}

export type TemplateChannelResolution =
  | { ok: true; channelId: string }
  | { ok: false; code: string; status: number; error: string };

/** Instância ausente e instância alheia respondem IGUAL — ver o comentário abaixo. */
const notFound: TemplateChannelResolution = {
  ok: false,
  code: "channel_not_found",
  status: 404,
  error: "Canal não encontrado nesta organização",
};

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveTemplateChannel(
  row: TemplateInstanceRow | null,
  orgId: string,
): TemplateChannelResolution {
  // Instância inexistente e instância de OUTRA org devolvem a mesma coisa, de
  // propósito: um código distinto para "existe, mas não é sua" contaria à org B
  // que aquele uuid existe em algum lugar. Erro de banco, índice único e código
  // de erro são todos canais de informação cross-tenant quando diferenciam demais.
  if (!row || row.organization_id !== orgId) return notFound;

  if (row.provider !== "notificame") {
    return {
      ok: false,
      code: "channel_not_notificame",
      status: 422,
      error: "Este canal não é do NotificaMe",
    };
  }

  const cfg = row.provider_config ?? {};

  // Backstop de isolamento social — um canal de Instagram que tenha escapado para
  // `whatsapp_instances` não tem template HSM; pedir a lista dele ao fornecedor é
  // pedir algo que não existe. Tipo AUSENTE é aceito (linha antiga, gravada antes
  // de o campo existir, não pode parar de funcionar por um backstop novo).
  //
  // ⚠️ O PREDICADO É IMPORTADO, não reescrito. A versão anterior comparava com as
  // strings cruas "whatsapp"/"wa" — e o fornecedor declara
  // `whatsapp_business_account`. Medido em produção (19/08): a ÚNICA instância
  // oficial recebia 422 `templates_not_supported`, e o card de templates sumia da
  // tela de Ajustes em silêncio.
  //
  // O gêmeo em `whatsapp-client.ts` já tinha sido corrigido (3f60999f, "backstop
  // recusava o próprio WhatsApp oficial") e ESTE ficou para trás — exatamente o
  // que uma segunda cópia da regra produz. Agora existe uma só.
  if (isNonWhatsAppChannelType(readString(cfg.channel_type))) {
    return {
      ok: false,
      code: "templates_not_supported",
      status: 422,
      error: "Este canal não usa templates",
    };
  }

  const channelId = readString(cfg.channel_id);
  if (!channelId) {
    return {
      ok: false,
      code: "channel_missing_external_id",
      status: 422,
      error: "O canal não tem identificador do fornecedor",
    };
  }

  return { ok: true, channelId };
}
