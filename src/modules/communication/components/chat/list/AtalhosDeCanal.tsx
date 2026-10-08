/**
 * `AtalhosDeCanal` — as abas "WhatsApp | Instagram" do mockup, como ATALHOS.
 *
 * A decisão do CTO (02/10, D1): a caixa unificada continua sendo a casa de
 * todos os canais — nada muda nela. As abas não trocam de tela nem escondem
 * conversa; elas MARCAM no seletor de caixas o conjunto de um canal, num
 * clique. Quem quiser misturar continua misturando pelo seletor.
 *
 * Só aparece quando a org tem caixas dos DOIS canais: com um canal só, a
 * pílula seria um rótulo fingindo ser controle.
 *
 * O número ao lado do canal é o que `useNaoLidasPorCaixa` já conta — e ele só
 * alcança as caixas de `whatsapp_messages`. Canal sem fonte não ganha número:
 * um zero ali diria "em dia" sobre uma caixa que ninguém contou.
 */
import { cn } from "@/lib/utils";
import { ChannelBadge } from "@/modules/communication/components/chat/ChannelBadge";
import type { NaoLidasDaCaixa } from "@/modules/communication/hooks/chat/useNaoLidasPorCaixa";
import type { InboxBox } from "@/modules/communication/hooks/chat/types";

type Canal = InboxBox["kind"];

const ROTULO: Record<Canal, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
};

export interface AtalhosDeCanalProps {
  caixas: readonly InboxBox[];
  marcadas: readonly string[];
  naoLidas?: Map<string, NaoLidasDaCaixa>;
  onMarcarConjunto: (ids: string[]) => void;
}

export function AtalhosDeCanal({ caixas, marcadas, naoLidas, onMarcarConjunto }: AtalhosDeCanalProps) {
  const canais = (["whatsapp", "instagram"] as const).filter((k) => caixas.some((c) => c.kind === k));
  if (canais.length < 2) return null;

  const marcadasSet = new Set(marcadas);
  const caixasMarcadas = caixas.filter((c) => marcadasSet.has(c.id));

  return (
    <div role="group" aria-label="Atalhos por canal" className="flex gap-0.5 rounded-full bg-foreground/[.07] p-[3px]">
      {canais.map((canal) => {
        const doCanal = caixas.filter((c) => c.kind === canal);
        // Ativo = tudo que está marcado é deste canal. Misturado, nenhum acende:
        // acender um dos dois mentiria sobre o que a lista está mostrando.
        const ativo = caixasMarcadas.length > 0 && caixasMarcadas.every((c) => c.kind === canal);
        const contagens = doCanal.map((c) => naoLidas?.get(c.id));
        const contado = contagens.some((n) => n?.estado === "contada");
        const total = contagens.reduce((soma, n) => soma + (n?.estado === "contada" ? n.naoLidas ?? 0 : 0), 0);

        return (
          <button
            key={canal}
            type="button"
            aria-pressed={ativo}
            onClick={() => onMarcarConjunto(doCanal.map((c) => c.id))}
            title={`Marcar só as caixas de ${ROTULO[canal]}`}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-semibold transition-[background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              ativo ? "bg-primary text-primary-foreground shadow-brilho-ouro" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ChannelBadge channel={canal} size={14} />
            {ROTULO[canal]}
            {contado && total > 0 && (
              <span
                className={cn(
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-extrabold tabular-nums",
                  ativo ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground",
                )}
                aria-label={`${total} não lidas`}
              >
                {total > 99 ? "99+" : total}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
