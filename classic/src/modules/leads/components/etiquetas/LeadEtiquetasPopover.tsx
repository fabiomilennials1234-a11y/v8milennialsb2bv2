import { memo, useState } from "react";
import { Tag as TagIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useOrganization } from "@/modules/identity";
import { SeletorDeEtiquetas } from "./SeletorDeEtiquetas";
import { useEditorDeEtiquetas } from "./useEditorDeEtiquetas";

/**
 * Etiquetar PELO card do quadro e PELA linha da lista, sem abrir a ficha.
 *
 * ── O QUE FALTAVA ─────────────────────────────────────────────────────────
 * As duas telas já DESENHAVAM as etiquetas — o card no rodapé, a lista na
 * coluna "Tags" — e nenhuma das duas tinha onde clicar. Ver sem poder mexer é
 * o mesmo defeito que o card do Lead tinha com o "+ etiqueta" morto: quem
 * varre uma coluna de 30 cards não vai abrir 30 fichas para tirar uma etiqueta
 * que não vale mais.
 *
 * ── O CONTEÚDO SÓ MONTA QUANDO ABRE, E ISSO É REQUISITO ───────────────────
 * O `PopoverContent` do Radix não renderiza fechado, então os hooks de banco
 * ficam DENTRO do miolo, e não aqui. Num board com 200 cards, chamar
 * `useLeadTagsAttached` no gatilho seriam 200 consultas a `lead_tags` para
 * desenhar 200 botões que ninguém clicou. As pílulas que o card mostra já vêm
 * de carona no `get_pipeline_page`; aqui só se busca quando alguém pede.
 *
 * O idioma é o dos vizinhos: `LeadCardQualificationPopover` e
 * `LeadCardChecklistPopover` também escrevem a partir do card, e param a
 * propagação do ponteiro pelo mesmo motivo — o card inteiro é clicável e
 * arrastável.
 */

export const LeadEtiquetasPopover = memo(function LeadEtiquetasPopover({
  leadId,
  quantidade = 0,
  className,
  rotulo,
  align = "start",
}: {
  leadId: string;
  /**
   * Quantas etiquetas o lead já tem, segundo quem chamou (o card e a lista já
   * têm esse dado de carona). Serve só para o gatilho dizer se está
   * adicionando a primeira ou mexendo nas que existem — o número de verdade é
   * lido quando o popover abre.
   */
  quantidade?: number;
  className?: string;
  /** Texto ao lado do ícone. Sem ele o gatilho é só o ícone. */
  rotulo?: string;
  align?: "start" | "end" | "center";
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          // dnd-kit: não iniciar arrasto ao abrir o popover.
          onPointerDown={(e) => e.stopPropagation()}
          // O card inteiro tem onClick → abre o negócio. Sem isto, um clique
          // aqui abriria o popover E o painel por cima dele.
          onClick={(e) => e.stopPropagation()}
          aria-label={quantidade > 0 ? "Editar etiquetas do lead" : "Adicionar etiqueta"}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border",
            "px-1.5 py-px text-[10px] leading-[16px] text-muted-foreground/70",
            "transition-colors hover:border-muted-foreground/40 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <TagIcon className="size-[11px]" aria-hidden />
          {rotulo}
        </button>
      </PopoverTrigger>

      {/* `role="dialog"` sem nome é anunciado como "dialog" e mais nada. */}
      <PopoverContent
        align={align}
        side="bottom"
        sideOffset={6}
        collisionPadding={8}
        aria-label="Etiquetas do lead"
        className="w-60 p-2"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <ConteudoDoSeletor leadId={leadId} />
      </PopoverContent>
    </Popover>
  );
});

/**
 * Separado do gatilho de propósito: é aqui que moram os hooks de banco, e este
 * nó só existe enquanto o popover está aberto. Ver o cabeçalho do arquivo.
 *
 * Marcar NÃO fecha o popover — diferente da faixa do card do Lead, onde as
 * pílulas ficam do lado de fora e fechar é o que mostra o resultado. Aqui a
 * lista de dentro é o único lugar onde o resultado aparece, e quem abriu quase
 * sempre quer mexer em mais de uma: fechar a cada clique obrigaria a reabrir
 * para tirar a etiqueta errada que acabou de entrar.
 */
function ConteudoDoSeletor({ leadId }: { leadId: string }) {
  /**
   * Só admin CRIA etiqueta nova: `tags_insert_admin_only` exige
   * `is_user_admin()` no INSERT em `tags`, enquanto pendurar uma existente
   * (`lead_tags_insert_organization`) vale para qualquer pessoa da org. A
   * pergunta é feita aqui, e não no gatilho, porque aqui ela custa uma vez por
   * abertura — no gatilho custaria uma por card desenhado.
   */
  const { role } = useOrganization();
  const editor = useEditorDeEtiquetas(leadId);

  return <SeletorDeEtiquetas editor={editor} podeCriar={role === "admin"} />;
}
