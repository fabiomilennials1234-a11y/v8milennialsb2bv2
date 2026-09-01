/**
 * O que chega no bolso da pessoa.
 *
 * Separado do envio porque é a única parte que se testa sem rede: o service
 * worker (src/sw.ts) lê exatamente estes campos, e um `url` errado leva o
 * clique para lugar nenhum.
 */

export interface AvisoParaPush {
  aviso_id: string;
  user_id: string;
  organization_id: string;
  type: string;
  title: string;
  description: string | null;
  link: string | null;
  group_key: string | null;
}

export interface PayloadDePush {
  title: string;
  body: string;
  url: string;
  tag: string;
  icon: string;
}

const TITULO_POR_TIPO: Record<string, string> = {
  workflow_alert: "Automação parada",
  cron_drift: "O motor de automações parou",
  lead_new: "Lead novo para você",
};

export function montarPayload(aviso: AvisoParaPush): PayloadDePush {
  const rotulo = TITULO_POR_TIPO[aviso.type];

  return {
    // Mensagem de lead usa o nome de quem falou como título: no bolso, saber
    // QUEM falou vale mais que saber que "há uma mensagem".
    title: rotulo ?? aviso.title,
    body: rotulo ? aviso.title : (aviso.description ?? ""),
    url: aviso.link ?? "/",
    // A tag agrupa no sistema operacional pela mesma chave que agrupa no CRM:
    // a segunda mensagem do mesmo lead substitui a primeira em vez de empilhar.
    tag: aviso.group_key ?? aviso.aviso_id,
    icon: "/pwa-192x192.svg",
  };
}
