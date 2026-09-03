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
 * ─── Por que "Ligar ▾", e não um menu antes de ligar ────────────────────────
 * O vendedor liga dezenas de vezes por dia, quase sempre pelo mesmo número. Um
 * menu que abre antes de discar cobraria um clique de TODA ligação para
 * reconfirmar uma escolha que ele já fez uma vez — o custo cairia no gesto mais
 * repetido do dia para servir o caso mais raro do dia. O corpo do botão disca
 * pelo número lembrado, em um clique; a seta à direita do rótulo abre a troca,
 * onde só paga quem realmente troca.
 *
 * ─── Por que o nome do número NÃO fica no cabeçalho ─────────────────────────
 * Até 2026-09-03 a segunda metade mostrava o nome do número ("Gabrielly-SDR"),
 * e o botão passava de 200 px. O cabeçalho do chat tem sete controles de largura
 * fixa e um só bloco que encolhe — o contato. Na Milennials, com dois números,
 * o nome e o telefone do contato sumiam e sobrava o avatar. O estado "por qual
 * número isto sai" continua a um gesto de distância: no tooltip do botão
 * ("Ligar por Gabrielly-SDR") e no menu, com nome e telefone de cada número.
 * O cabeçalho não tem largura para carregá-lo sem apagar o nome do contato —
 * que é o estado mais importante da tela.
 *
 * E com UM número — o caso de quase toda a base — não existe seta, não existe
 * menu, não existe escolha: o botão é exatamente "Ligar", na mesma largura.
 *
 * ─── A variante `icon` ──────────────────────────────────────────────────────
 * O mesmo botão, sem rótulo, em 32px: é a família das ações rápidas do Card do
 * Lead (`AcaoRapida`) e o que cabe no cabeçalho de 48px do celular. Mesma
 * regra, mesmo contexto, mesma escolha de número — só o tamanho muda. Com dois
 * números a segunda metade é uma seta estreita que abre o mesmo menu.
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
import { formatPhoneBR } from "@/shared/format/phone";
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

/**
 * O menu de escolha do número — o mesmo nas duas variantes. Cada item traz o
 * nome da instância e, quando o banco sabe, o telefone dela em mono: é o que o
 * cliente vê tocar no celular, e é por isso que a escolha existe.
 */
function EscolhaDeNumero({ voice, children }: { voice: Voice; children: ReactElement }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      {/* `z-[60]`: no celular o Card do Negócio é um `Sheet` (`z-[51]`) e o
          conteúdo padrão do menu é `z-50` — abriria por baixo da folha. Mesmo
          conserto do menu `⋯` do `DealCard`. Inofensivo no cabeçalho do chat. */}
      <DropdownMenuContent align="end" className="z-[60] min-w-[14rem]">
        <DropdownMenuLabel>Ligar pelo número</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={voice.selected!.tcSessionId} onValueChange={voice.selectNumber}>
          {voice.numbers.map((numero) => (
            <DropdownMenuRadioItem key={numero.tcSessionId} value={numero.tcSessionId}>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate">{numero.instanceName}</span>
                {numero.phoneNumber && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {formatPhoneBR(numero.phoneNumber)}
                  </span>
                )}
              </span>
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

  // O nome do número saiu do cabeçalho; o tooltip é onde ele mora agora.
  const titulo = voice.busy
    ? "Você já está em uma chamada"
    : `Ligar por ${voice.selected.instanceName}`;
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

  // O rótulo cede antes do nome do contato: abaixo de `lg` sobra o ícone, e o
  // `title` faz o papel do rótulo. `lg:mr-1.5` porque sem rótulo não há o que
  // separar.
  const conteudo = (
    <>
      <PhoneCall className="h-4 w-4 lg:mr-1.5" />
      <span className="hidden lg:inline">Ligar</span>
    </>
  );

  if (umNumero) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={voice.busy}
        className={cn("shrink-0 gap-0", className)}
        title={titulo}
        onClick={discar}
        onPointerDown={naoVazar}
      >
        {conteudo}
      </Button>
    );
  }

  return (
    // Um botão só aos olhos — "Ligar ▾" — feito de duas partes porque um
    // `<button>` não pode conter outro. Sem `overflow-hidden`: o anel de foco
    // dos botões é um `outline` com `outline-offset-2`, desenhado FORA da
    // borda — recortá-lo apaga o foco de teclado, que o DESIGN.md §5 reprova.
    // O `z-10` no foco é o que impede a parte vizinha de cobrir o anel.
    // `rounded-lg` é o raio da família (§4), o mesmo do botão de um número só.
    <div
      className={cn(
        "inline-flex shrink-0 items-center rounded-lg border border-input bg-background shadow-sm shadow-black/5",
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={voice.busy}
        className="relative gap-0 rounded-r-none pr-1.5 focus-visible:z-10"
        title={titulo}
        onClick={discar}
        onPointerDown={naoVazar}
      >
        {conteudo}
      </Button>

      <EscolhaDeNumero voice={voice}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={voice.busy}
          className="relative rounded-l-none px-1.5 text-muted-foreground focus-visible:z-10"
          aria-label={trocarNumero}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={naoVazar}
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </EscolhaDeNumero>
    </div>
  );
}
