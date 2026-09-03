/**
 * Botão de ligar por WhatsApp.
 *
 * Some quando o vendedor não tem nenhum número de voz ao alcance — seja porque
 * a organização não conectou nenhum, seja porque os que existem pertencem a
 * colegas. Botão que sempre falha é pior que botão ausente: ele ensina o
 * vendedor a desconfiar da tela inteira, e o custo disso não fica restrito a
 * esta feature.
 *
 * ─── Vê o lead → pode ligar ─────────────────────────────────────────────────
 * Sobre o LEAD não há pergunta aqui. Se ele está na tela, a RLS de `leads` já
 * disse que este vendedor o enxerga — e essa é a condição inteira, no front e
 * no servidor (`call-plane.ts`, `lead_not_visible`). Até 2026-09-02 o botão
 * exigia ser dono do lead; como só ~8% dos leads com conversa têm dono, ele
 * sumia justamente para o SDR que estava no chat. Medido na Milennials.
 *
 * ─── Por que botão dividido, e não um menu antes de ligar ───────────────────
 * O vendedor liga dezenas de vezes por dia, quase sempre pelo mesmo número. Um
 * menu que abre antes de discar cobraria um clique de TODA ligação para
 * reconfirmar uma escolha que ele já fez uma vez — o custo cairia no gesto mais
 * repetido do dia para servir o caso mais raro do dia. O botão dividido deixa o
 * caminho de sempre em um clique e põe a troca atrás da segunda metade, onde só
 * paga quem realmente troca.
 *
 * A segunda metade mostra o NOME do número em vez de só uma seta porque, com
 * dois números, "por qual número isto vai sair" é estado que decide o que o
 * cliente vê tocar no celular dele. Estado que decide não pode ficar escondido
 * atrás de um clique.
 *
 * E com UM número — o caso de toda a base hoje — não existe seta, não existe
 * menu, não existe escolha: o botão é exatamente o que era antes.
 *
 * ─── A variante `icon` ──────────────────────────────────────────────────────
 * O mesmo botão, sem rótulo, em 32px: é a família das ações rápidas do Card do
 * Lead (`AcaoRapida`) e o que cabe no cabeçalho de 48px do celular. Mesma
 * regra, mesmo contexto, mesma escolha de número — só o tamanho muda. Com dois
 * números a segunda metade vira uma seta estreita: o nome do número já não
 * cabe, mas continua a um clique, no menu.
 */
import type { ReactElement } from "react";
import { ChevronDown, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useVoiceCallContext } from "./VoiceCallProvider";

interface VoiceCallButtonProps {
  leadId?: string | null;
  leadName?: string | null;
  className?: string;
  /**
   * `default`: com o rótulo "Ligar", para o cabeçalho do chat.
   * `icon`: só o ícone, 32px, para o cabeçalho dos cards e o celular.
   */
  variant?: "default" | "icon";
}

type Voice = ReturnType<typeof useVoiceCallContext>;

/**
 * A família visual de `AcaoRapida` (Card do Lead), reproduzida e não
 * importada: aquele componente é privado do card e este botão precisa existir
 * em três telas. O anel de foco é `ring` com offset, desenhado fora da borda —
 * por isso o grupo de duas metades nunca leva `overflow-hidden`.
 */
const ICONE =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground " +
  "transition-[color,border-color,background-color] hover:bg-muted/60 hover:text-foreground " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
  "disabled:pointer-events-none disabled:opacity-35";

/** O menu de escolha do número — o mesmo nas duas variantes. */
function EscolhaDeNumero({ voice, children }: { voice: Voice; children: ReactElement }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      {/* `z-[60]`: no celular o Card do Negócio é um `Sheet` (`z-[51]`) e o
          conteúdo padrão do menu é `z-50` — abriria por baixo da folha. Mesmo
          conserto do menu `⋯` do `DealCard`. Inofensivo no cabeçalho do chat. */}
      <DropdownMenuContent align="end" className="z-[60] min-w-[12rem]">
        <DropdownMenuLabel>Ligar pelo número</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={voice.selected!.tcSessionId} onValueChange={voice.selectNumber}>
          {voice.numbers.map((numero) => (
            <DropdownMenuRadioItem key={numero.tcSessionId} value={numero.tcSessionId}>
              {numero.instanceName}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function VoiceCallButton({
  leadId,
  leadName,
  className,
  variant = "default",
}: VoiceCallButtonProps) {
  const voice = useVoiceCallContext();

  // Sem lead não há como ligar: o destino é derivado do lead no servidor, e é
  // essa derivação que sustenta consentimento, fronteira e teto por número.
  // Sem `selected` não há número ao alcance dele — é o que faz o botão sumir.
  if (!voice.selected || !leadId) return null;

  const titulo = voice.busy ? "Você já está em uma chamada" : "Ligar por WhatsApp";
  const discar = (e: React.MouseEvent) => {
    e.stopPropagation();
    voice.startCall({ id: leadId, name: leadName });
  };
  // O cabeçalho do chat é clicável inteiro, e o card do lead tem container
  // que abre a ficha; sem isto, ligar também abriria a conversa por baixo.
  const naoVazar = (e: React.PointerEvent) => e.stopPropagation();
  const trocarNumero = `Trocar o número que vai ligar. Agora: ${voice.selected.instanceName}.`;
  const umNumero = voice.numbers.length < 2;

  if (variant === "icon") {
    const meia = (
      <button
        type="button"
        disabled={voice.busy}
        className={cn(
          ICONE,
          umNumero ? cn("border border-border", className) : "relative rounded-r-none focus-visible:z-10",
        )}
        title={titulo}
        aria-label="Ligar"
        onClick={discar}
        onPointerDown={naoVazar}
      >
        <PhoneCall className="size-[15px]" />
      </button>
    );

    if (umNumero) return meia;

    return (
      <div className={cn("inline-flex shrink-0 items-center rounded-lg border border-border", className)}>
        {meia}
        <EscolhaDeNumero voice={voice}>
          <button
            type="button"
            disabled={voice.busy}
            className={cn(ICONE, "relative w-5 rounded-l-none border-l border-border focus-visible:z-10")}
            aria-label={trocarNumero}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={naoVazar}
          >
            <ChevronDown className="size-3.5" aria-hidden />
          </button>
        </EscolhaDeNumero>
      </div>
    );
  }

  if (umNumero) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={voice.busy}
        className={cn("shrink-0", className)}
        title={titulo}
        onClick={discar}
        onPointerDown={naoVazar}
      >
        <PhoneCall className="mr-1.5 h-4 w-4" />
        Ligar
      </Button>
    );
  }

  return (
    // Sem `overflow-hidden`: o anel de foco dos botões é um `outline` com
    // `outline-offset-2`, desenhado FORA da borda — recortá-lo apaga o foco de
    // teclado, que o DESIGN.md §5 reprova. O `z-10` no foco é o que impede a
    // metade vizinha de cobrir o anel. `rounded-lg` é o raio da família (§4),
    // o mesmo do botão de um número só e do vizinho no cabeçalho.
    <div
      className={cn(
        "inline-flex shrink-0 items-center rounded-lg border border-border",
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={voice.busy}
        className="relative rounded-r-none focus-visible:z-10"
        title={titulo}
        onClick={discar}
        onPointerDown={naoVazar}
      >
        <PhoneCall className="mr-1.5 h-4 w-4" />
        Ligar
      </Button>

      <EscolhaDeNumero voice={voice}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={voice.busy}
          className="relative max-w-[9rem] rounded-l-none border-l border-border px-2 font-normal text-muted-foreground focus-visible:z-10"
          aria-label={trocarNumero}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={naoVazar}
        >
          <span className="truncate">{voice.selected.instanceName}</span>
          <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0" aria-hidden />
        </Button>
      </EscolhaDeNumero>
    </div>
  );
}
