import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { SeletorDeEtiquetas } from "../etiquetas/SeletorDeEtiquetas";
import { useEditorDeEtiquetas } from "../etiquetas/useEditorDeEtiquetas";

/**
 * A faixa de etiquetas do card do Lead — a que ESCREVE.
 *
 * ── POR QUE ESTE ARQUIVO EXISTE, EM VEZ DE UM `onClick` NO CARD ───────────
 * O botão "+ etiqueta" já estava desenhado no `LeadCard` desde o começo, e era
 * um botão morto: `<button type="button">+ etiqueta</button>`, sem `onClick`,
 * sem `disabled`. A coluna do painel do Negócio (`LeadCardAside`) nem isso
 * tinha — só a pílula "sem etiqueta", que é um convite para uma porta que não
 * existe. Etiqueta virou o único campo do card que se lia e não se escrevia.
 *
 * O conserto não podia ser um `onClick` dentro do card porque os dois arquivos
 * de desenho — `LeadCard.tsx` e `LeadCardAside.tsx` — são alcançáveis a partir
 * de `src/preview/main.tsx`, e `preview-cards-sem-banco.test.ts` (inv:H5-17)
 * reprova qualquer arquivo daquele grafo que importe react-query/supabase-js,
 * ou que sequer escreva a palavra `supabase` fora de comentário. A rota abre
 * sem login: o que ela alcança, qualquer visitante alcança.
 *
 * O escape é o idioma da casa e já tem dois precedentes na mesma pasta:
 * `LeadCardControles` (qualificação e responsáveis) e `painelChecklists` no
 * card do Negócio. O card recebe o controle PRONTO como `ReactNode`; quem monta
 * é o `LeadCardContainer`, que o próprio teste exige estar FORA do grafo do
 * preview (`preview-cards-sem-banco.test.ts:186`).
 *
 * ── ETIQUETA É DO LEAD, E ISSO É ESCOLHA DO SCHEMA, NÃO DESTA TELA ────────
 * Não existe etiqueta de Negócio: a única junção é `lead_tags(lead_id, tag_id)`
 * e o catálogo `tags` é por organização. `deals`, `pipeline_entries` e
 * `custom_pipe_entries` não têm coluna de etiqueta. Etiquetar "dentro do
 * negócio" etiqueta a PESSOA dona dele — e portanto aparece nos outros negócios
 * dela, no filtro do quadro e no gatilho `tag_added` das automações. É o
 * comportamento correto hoje; mudá-lo seria migration, não componente.
 *
 * ── O QUE ESTE ARQUIVO AINDA GUARDA ───────────────────────────────────────
 * Só o DESENHO da faixa: as pílulas com "×" e o gatilho. A mecânica (buscar,
 * pendurar, tirar, criar, e as cinco armadilhas que vêm com ela) mora em
 * `useEditorDeEtiquetas`, compartilhada com o botão do quadro e o da lista.
 */

export function LeadCardEtiquetas({
  leadId,
  podeCriar = false,
  className,
  alinhamento = "esquerda",
}: {
  leadId: string;
  /**
   * Oferece "Criar «nome»" quando a busca não casa com nenhuma etiqueta da org.
   * Só faz sentido para admin: `tags_insert_admin_only` exige `is_user_admin()`
   * para CRIAR, enquanto `lead_tags_insert_organization` deixa qualquer pessoa
   * da org PENDURAR uma que já existe.
   */
  podeCriar?: boolean;
  className?: string;
  /** A coluna do painel do Negócio centraliza; o card inteiro alinha à esquerda. */
  alinhamento?: "esquerda" | "centro";
}) {
  const [aberto, setAberto] = useState(false);
  const editor = useEditorDeEtiquetas(leadId, () => setAberto(false));
  const { presas, isLoading, gravando, removendo, tirar, setBusca } = editor;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        alinhamento === "centro" ? "justify-center" : "justify-start",
        className,
      )}
    >
      {presas.map((p) => {
        /**
         * `color-mix` em vez de sufixo de alpha no hex (`#rrggbb` + `1f`).
         * `tags.color` é texto livre — o banco não valida nada — e "red1f" ou
         * "#abc1f" não são cor nenhuma: o navegador descarta a regra inteira e
         * a pílula perde também a borda. `color-mix` aceita qualquer cor CSS
         * válida. É o mesmo tratamento de `LeadCardLabels`, a pílula que o card
         * do quadro já desenha — 12% de tinta assenta em qualquer tema.
         */
        const cor = p.tag!.color || "#888888";
        return (
          <span
            key={p.id}
            className="group inline-flex items-center gap-1 rounded-full border px-2.5 py-[3px] text-[11.5px]"
            style={{
              backgroundColor: `color-mix(in srgb, ${cor} 12%, transparent)`,
              borderColor: `color-mix(in srgb, ${cor} 24%, transparent)`,
              color: cor,
            }}
          >
            {p.tag!.name}
            <button
              type="button"
              aria-label={`Remover a etiqueta ${p.tag!.name}`}
              onClick={() => tirar(p.id, p.tag!.name)}
              disabled={removendo}
              className={cn(
                "-mr-0.5 rounded-full opacity-60 transition-opacity",
                "hover:opacity-100 focus-visible:opacity-100",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:pointer-events-none disabled:opacity-30",
              )}
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}

      {/* A pílula "sem etiqueta" continua existindo quando não há nenhuma: sumir
          a faixa vazia é o que faz ninguém nunca etiquetar. Ela some enquanto a
          leitura não voltou, para não piscar "sem etiqueta" num lead que tem. */}
      {presas.length === 0 && !isLoading && (
        <span className="inline-flex rounded-full border border-dashed border-border px-2.5 py-[3px] text-[11.5px] text-muted-foreground/70">
          sem etiqueta
        </span>
      )}

      <Popover
        open={aberto}
        onOpenChange={(v) => {
          setAberto(v);
          if (!v) setBusca("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={gravando}
            /* Rótulo explícito: o texto visível é só "etiqueta", e ao lado dele
               ficam os "Remover a etiqueta X" das pílulas. Sem isto, o botão que
               ADICIONA e os que REMOVEM se chamam quase igual para quem lê por
               leitor de tela — e para quem procura por nome no teste. */
            aria-label="Adicionar etiqueta"
            className={cn(
              "inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-[3px] text-[11.5px] text-muted-foreground",
              "transition-colors hover:border-muted-foreground/40 hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-45",
            )}
          >
            {gravando ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Plus className="size-3" />
            )}
            etiqueta
          </button>
        </PopoverTrigger>

        {/* O conteúdo do Popover do Radix tem `role="dialog"`, e diálogo sem
            nome é anunciado como "dialog" e mais nada. */}
        <PopoverContent align="start" aria-label="Escolher etiqueta" className="w-60 p-2">
          {/* `mostrarPresas={false}`: as pílulas já estão na faixa, a um
              centímetro daqui. Duas listas da mesma coisa lado a lado — uma que
              reage ao clique e outra que não — é pior do que uma só. */}
          <SeletorDeEtiquetas editor={editor} podeCriar={podeCriar} mostrarPresas={false} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
