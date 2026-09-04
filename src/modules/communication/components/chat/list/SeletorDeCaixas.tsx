/**
 * `SeletorDeCaixas` — o controle "Caixa de entrada", agora de múltipla escolha.
 *
 * Evolução do `Select` de uma caixa só, e não um controle novo: mesma posição,
 * mesmo rótulo, mesma linguagem visual (selo do canal, bolinha de status, pílula
 * "Oficial"). Quem tem UM número precisa continuar sem perceber que algo mudou —
 * são 42 das 62 organizações.
 *
 * ─── O QUE O MENU PRECISA DIZER ─────────────────────────────────────────────
 *
 * 1. Quais caixas estão marcadas (a lista mistura o que está marcado).
 * 2. ONDE está a mensagem que a lista não está mostrando. O contador de não
 *    lidas segue o ACESSO, não a seleção (D8): desmarcar caixa não pode apagar
 *    do radar a mensagem que chega nela. A caixa DESMARCADA com novidade acende
 *    aqui — é o único lugar da tela onde essa lacuna se resolve.
 * 3. O canal social é uma caixa como as outras desde a W5 — ele deixou de abrir
 *    sozinho quando a lista dele passou a respeitar o responsável.
 *
 * ─── O PONTO COLORIDO É O MESMO DA BOLHA ────────────────────────────────────
 *
 * `instanceColor` já pinta o número na bolha de chat. Reusar faz o mesmo número
 * ter a mesma cor nas duas telas; uma segunda derivação daria duas cores para a
 * mesma coisa, que é pior que nenhuma cor.
 */
import { Check, ChevronDown, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ChannelBadge } from "@/modules/communication/components/chat/ChannelBadge";
import { instanceColor } from "@/modules/communication/components/chat/bubble/utils/instanceColor";
import { boxUsesChannelMessages } from "@/modules/communication/hooks/chat/inbox-box-source";
import type { NaoLidasDaCaixa } from "@/modules/communication/hooks/chat/useNaoLidasPorCaixa";
import type { InboxBox } from "@/modules/communication/hooks/chat/types";

export interface SeletorDeCaixasProps {
  caixas: InboxBox[];
  /** Ids marcados. Nunca vazio — ver `useCaixasSelecionadas`. */
  marcadas: string[];
  onAlternar: (id: string) => void;
  onSomente: (id: string) => void;
  onTodas: () => void;
  /**
   * Não lidas por caixa, incluindo as DESMARCADAS. Ausente = sem sinal, que é o
   * comportamento correto quando não há fonte: um zero inventado diria "está em
   * dia" sobre uma caixa que ninguém leu.
   */
  naoLidas?: Map<string, NaoLidasDaCaixa>;
  isAdmin?: boolean;
  onOpenInstances?: () => void;
}

function ehOficial(box: InboxBox): boolean {
  return box.kind === "whatsapp" && boxUsesChannelMessages(box);
}

function corDoStatus(status: string): string {
  if (status === "connected") return "bg-emerald-500";
  if (status === "connecting") return "bg-amber-500";
  return "bg-muted-foreground/40";
}

export function SeletorDeCaixas({
  caixas,
  marcadas,
  onAlternar,
  onSomente,
  onTodas,
  naoLidas,
  isAdmin,
  onOpenInstances,
}: SeletorDeCaixasProps) {
  if (caixas.length === 0) return null;

  const marcadasSet = new Set(marcadas);
  const primeira = caixas.find((c) => marcadasSet.has(c.id)) ?? caixas[0];
  const podeMarcarTodas = caixas.length > 1;

  /**
   * O rótulo do gatilho. Com uma caixa é o NOME dela, como sempre foi — trocar
   * por "1 caixa" faria a org de um número perder a informação que ela usa todo
   * dia para saber por qual número está falando.
   */
  const rotulo = marcadas.length === 1 ? primeira.name : `${marcadas.length} caixas`;

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Caixa de entrada
        </p>
        {isAdmin && onOpenInstances && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenInstances}
            className="h-6 gap-1 text-xs text-muted-foreground hover:text-foreground px-2"
            title="Gerenciar instâncias WhatsApp"
          >
            <Settings className="w-3.5 h-3.5" />
            Instâncias
          </Button>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="h-9 w-full justify-between bg-background font-normal"
            aria-label={
              marcadas.length === 1
                ? `Caixa de entrada: ${primeira.name}`
                : `Caixa de entrada: ${marcadas.length} caixas marcadas`
            }
          >
            <span className="flex min-w-0 items-center gap-2">
              <ChannelBadge
                channel={ehOficial(primeira) ? "whatsapp_oficial" : primeira.kind}
                size={14}
              />
              {marcadas.length === 1 && (
                <span
                  className={cn("w-1.5 h-1.5 rounded-full shrink-0", corDoStatus(primeira.status))}
                />
              )}
              <span className="truncate">{rotulo}</span>
            </span>
            <ChevronDown className="w-4 h-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          className="w-[--radix-dropdown-menu-trigger-width] min-w-64"
        >
          {podeMarcarTodas && (
            <>
              <DropdownMenuItem
                onSelect={(e) => {
                  // Sem o preventDefault o menu fecha a cada clique, e marcar
                  // três caixas viraria três aberturas do menu.
                  e.preventDefault();
                  onTodas();
                }}
                className="text-xs text-muted-foreground"
              >
                Marcar todas
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {caixas.map((box) => {
            const marcada = marcadasSet.has(box.id);
            const contagem = naoLidas?.get(box.id);
            // Só acende o que a lista NÃO está mostrando: novidade em caixa
            // marcada já aparece na própria lista, e repeti-la aqui treinaria a
            // pessoa a ignorar o sinal.
            const acende =
              !marcada && contagem?.estado === "contada" && (contagem.naoLidas ?? 0) > 0;

            return (
              <DropdownMenuItem
                key={box.id}
                onSelect={(e) => {
                  e.preventDefault();
                  onAlternar(box.id);
                }}
                className="gap-2"
                aria-checked={marcada}
                role="menuitemcheckbox"
              >
                <span className="flex w-4 shrink-0 items-center justify-center">
                  {marcada && <Check className="h-4 w-4" aria-hidden />}
                </span>

                <span
                  className="w-1.5 h-4 rounded-full shrink-0"
                  style={{ backgroundColor: instanceColor(box.id) }}
                  aria-hidden
                />

                <ChannelBadge
                  channel={ehOficial(box) ? "whatsapp_oficial" : box.kind}
                  size={14}
                />

                <span
                  className={cn("w-1.5 h-1.5 rounded-full shrink-0", corDoStatus(box.status))}
                  aria-hidden
                />

                <span className="min-w-0 flex-1 truncate">{box.name}</span>

                {ehOficial(box) && (
                  <span className="rounded-sm border border-border/60 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Oficial
                  </span>
                )}

                {acende && (
                  // Número, e não só um ponto: "tem algo lá" não ajuda a decidir
                  // entre marcar agora e deixar para depois. O rótulo acessível
                  // repete o que a cor diz, porque cor sozinha não comunica.
                  <span
                    className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary"
                    aria-label={`${contagem?.naoLidas} não lidas nesta caixa, que não está marcada`}
                  >
                    {contagem?.naoLidas}
                  </span>
                )}

                {marcadas.length > 1 && marcada && (
                  <button
                    type="button"
                    className="rounded px-1 text-[10px] text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSomente(box.id);
                    }}
                  >
                    só esta
                  </button>
                )}
              </DropdownMenuItem>
            );
          })}

        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
