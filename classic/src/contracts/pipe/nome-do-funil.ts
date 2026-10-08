/**
 * Compatibilidade dos antigos aliases de destino. O nome exibido de qualquer
 * funil vem de `pipelines.name`; este arquivo mantém apenas traduções exigidas
 * por payloads antigos enquanto eles migram para UUID.
 */

import type { SystemPipeDisplay } from "./pipe-entities";

/**
 * Nome de fábrica por tipo, para quando a org tem o funil mas a linha de
 * display ainda não existe.
 *
 * ⚠️ Espelha `SYSTEM_PIPE_CATALOG` (usePipelineDisplayConfig). Duplicado aqui
 * de propósito: o catálogo é um hook-adjacent do módulo e este arquivo é puro,
 * importável de teste sem tocar em Supabase. Se um nome mudar lá, o teste
 * `catalogo em dia` abaixo quebra — que é exatamente o alarme desejado.
 */
export const NOME_DE_FABRICA: Readonly<Record<string, string>> = {
  whatsapp: "Oportunidades",
  confirmacao: "Agendamentos",
  propostas: "Orçamentos",
  upsell: "Carteira",
};

/**
 * O alias de destino usado no cadastro de lead ↔ o `pipe_type` do banco.
 *
 * É a INVERSA de `DEST_TO_PIPE_TYPE` (`@/lib/lead/lead-destinations`), e a
 * assimetria do par whatsapp↔qualificacao é a razão de ela existir escrita:
 * derivar "qualificacao" de "whatsapp" na mão é o tipo de conversão que alguém
 * eventualmente faz ao contrário.
 *
 * `upsell` NÃO está aqui de propósito — Carteira é consequência de venda
 * fechada, não destino de lead novo (ADR-0023 decisão 8). Oferecê-la no
 * cadastro criaria negócio numa etapa que a regra de negócio proíbe.
 */
export const PIPE_TYPE_PARA_DESTINO: Readonly<Record<string, string>> = {
  whatsapp: "qualificacao",
  confirmacao: "confirmacao",
  propostas: "propostas",
};

/**
 * Os funis de sistema que a org mostra na NAVEGAÇÃO, na ordem dela.
 *
 * As exclusões são regra de produto, não estética:
 *
 *   - **linha ausente = a org não tem o funil** (migration 20270902000000);
 *   - **`is_visible = false`** — escondido é escondido;
 *   - **Carteira (`upsell`) NUNCA entra.** Pelo D6/ADR-0034 ela é faceta do
 *     lead, não funil de negócio: tem porta própria (`/upsell`) e não tem linha
 *     em `pipelines`, então qualquer card apontaria para `/funil/upsell` — rota
 *     sem funil por trás;
 *   - **`confirmacao` some com o merge de oportunidades ligado** (ADR-0004).
 *
 * Existe porque a regra estava COPIADA em três telas (hub, lateral, seletor da
 * faixa) e a cópia divergiu: o hub `/funis` era o único que não filtrava
 * `upsell`, e listava um card "Carteira" com link morto. Uma cópia a menos é
 * uma divergência a menos.
 */
export function funisDeSistemaNavegaveis<T extends SystemPipeDisplay>(
  configs: readonly T[] | undefined,
  opts: { mergeDeOportunidadesAtivo: boolean },
): T[] {
  return (configs ?? [])
    .filter(
      (c) =>
        c.is_visible &&
        c.pipe_type !== "upsell" &&
        !(c.pipe_type === "confirmacao" && opts.mergeDeOportunidadesAtivo),
    )
    .slice()
    .sort((a, b) => a.position - b.position);
}

/** Um funil de sistema oferecível como destino de lead novo. */
export interface DestinoDeSistema {
  /** Valor do `<SelectItem>` e do payload — "qualificacao" | "confirmacao" | "propostas". */
  destination: string;
  /** `pipe_type` do banco — "whatsapp" | "confirmacao" | "propostas". */
  pipeType: string;
  /** O nome que ESTA organização usa. */
  label: string;
}

/**
 * O nome que a organização escolheu para um funil.
 *
 * Desde o ADR-0034, `pipelines` é o registro único e `pipelines.name` é o
 * nome canônico de qualquer funil. `pipeline_display_config` sobrevive apenas
 * como compatibilidade dos antigos seeds e não participa mais da exibição.
 * O primeiro argumento permanece para não quebrar consumidores durante a
 * retirada dessa compatibilidade.
 */
export function nomeDoFunil(
  _configs: readonly SystemPipeDisplay[] | undefined,
  funil: { name: string; slug?: string | null; type?: string | null },
): string {
  return funil.name;
}

/**
 * Os funis de sistema que a organização pode receber um lead novo, na ordem em
 * que ela os organizou.
 *
 * Duas exclusões, ambas deliberadas:
 *
 *   - **linha ausente = a org NÃO tem o funil.** Depois da migration
 *     20270902000000 não há mais auto-semeadura: excluir um funil de sistema é
 *     possível, e o cadastro precisa parar de oferecê-lo. Oferecer criaria
 *     negócio num funil que a org não tem — silenciosamente, porque o INSERT
 *     em si funciona;
 *   - **`is_visible = false`** — funil escondido da navegação não é destino de
 *     lead novo. Quem o escondeu não quer tráfego novo ali.
 *
 * Lista vazia é resposta legítima: significa "esta org não tem funil de
 * sistema algum", e a tela deve dizer isso em vez de inventar três opções.
 */
export function destinosDeSistema(
  configs: readonly SystemPipeDisplay[] | undefined,
): DestinoDeSistema[] {
  return (configs ?? [])
    .filter((c) => c.is_visible && PIPE_TYPE_PARA_DESTINO[c.pipe_type])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      destination: PIPE_TYPE_PARA_DESTINO[c.pipe_type],
      pipeType: c.pipe_type,
      label: c.display_name || NOME_DE_FABRICA[c.pipe_type] || c.pipe_type,
    }));
}
