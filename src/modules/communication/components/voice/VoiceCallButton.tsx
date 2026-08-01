/**
 * Botão de ligar por WhatsApp.
 *
 * Some quando o vendedor não tem nenhum número de voz ao alcance — seja porque
 * a organização não conectou nenhum, seja porque os que existem pertencem a
 * colegas. Botão que sempre falha é pior que botão ausente: ele ensina o
 * vendedor a desconfiar da tela inteira, e o custo disso não fica restrito a
 * esta feature.
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
 */
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
}

export function VoiceCallButton({ leadId, leadName, className }: VoiceCallButtonProps) {
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
  // O cabeçalho do chat é clicável inteiro; sem isto, ligar também abriria a
  // conversa por baixo.
  const naoVazar = (e: React.PointerEvent) => e.stopPropagation();

  if (voice.numbers.length < 2) {
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
    <div
      className={cn(
        "inline-flex shrink-0 items-center overflow-hidden rounded-md border border-border",
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={voice.busy}
        className="rounded-none"
        title={titulo}
        onClick={discar}
        onPointerDown={naoVazar}
      >
        <PhoneCall className="mr-1.5 h-4 w-4" />
        Ligar
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={voice.busy}
            className="max-w-[9rem] rounded-none border-l border-border px-2 font-normal text-muted-foreground"
            aria-label={`Trocar o número que vai ligar. Agora: ${voice.selected.instanceName}.`}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={naoVazar}
          >
            <span className="truncate">{voice.selected.instanceName}</span>
            <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[12rem]">
          <DropdownMenuLabel>Ligar pelo número</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={voice.selected.tcSessionId}
            onValueChange={voice.selectNumber}
          >
            {voice.numbers.map((numero) => (
              <DropdownMenuRadioItem key={numero.tcSessionId} value={numero.tcSessionId}>
                {numero.instanceName}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
