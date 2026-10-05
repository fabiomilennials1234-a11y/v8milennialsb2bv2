import type { CommentAttachment } from "../../lib/comment-attachments/files";
import { useEffect, useState, type ReactNode } from "react";
import { CalendarCheck, CalendarDays, CircleX, Hourglass, Loader2, MoreHorizontal, Trash2, Trophy, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { LeadCardDeals } from "../lead-card/LeadCardDeals";
import { DealCardActivities } from "./DealCardActivities";
import { DealCardComments } from "./DealCardComments";
import { DealCardStages } from "./DealCardStages";
import { DealCardTimeline } from "./DealCardTimeline";
import { DealCardMoney } from "./DealCardMoney";
import { NomeDoNegocio } from "./NomeDoNegocio";
import { AjustarPedidoGanho, type AjustePedidoGanho } from "./AjustarPedidoGanho";
import { CorrigirVendaHistorica } from "./CorrigirVendaHistorica";
import { diaDaVenda } from "./dia-da-venda";
import type { CorrecaoVendaHistorica } from "./useCorrigirVendaHistorica";
import { contaDoNegocio } from "./conta-do-negocio";
import { situacaoDaReuniao, type SituacaoDaReuniao } from "./reuniao-do-negocio";
import type { DealCardAba, DealCardComentario, DealCardData, ItemEditado } from "./types";

/**
 * O Card do Negócio — a aba "Negócio" da gaveta do V5.
 *
 * No mockup não há segundo painel: o cartão do funil abre a gaveta da pessoa,
 * e o negócio é o conteúdo da aba do meio. Este arquivo desenha esse conteúdo;
 * a pessoa (cabeçalho, Dados, Histórico) é do `LeadCard`, e quem monta os dois
 * juntos é o `DealCardPanel`.
 *
 * ── A COMPOSIÇÃO ──────────────────────────────────────────────────────────
 *   1. título do negócio (renomeável), funil e dono, com Copiar resumo e o ⋯;
 *   2. o CARTÃO DE OURO: valor total como manchete, a etapa, o tempo (que acende
 *      quando passa do dobro da mediana da etapa na org), a régua que move o
 *      negócio, a data de criação e — aberto — Ganhou/Perdeu; fechado, o
 *      desfecho. É o resumo que decide "vale a pena mexer nisto agora";
 *   3. abaixo, as abas do negócio: Informações · Atividades · Checklists ·
 *      Negócios. Ficam abas (e não cartões lado a lado, como no mockup) porque o
 *      menu do card do funil abre DIRETO em Checklists (`abaInicial`).
 *
 * ── A PESSOA NÃO É CONTEÚDO DAQUI ─────────────────────────────────────────
 * Nome, empresa e telefone moram no cabeçalho da gaveta. Repetir a pessoa
 * dentro do negócio é onde as duas verdades começam (`deal-card.test.tsx`).
 *
 * ── SEM NÚMERO SEQUENCIAL ─────────────────────────────────────────────────
 * O Torque não tem número de negócio (nem coluna, nem sequence) e a decisão de
 * 21/08 foi sair sem migration: a manchete de tempo é "há quanto tempo isto está
 * aberto", que existe em 100% dos negócios e é o único dado que aponta ação.
 */

type Aba = DealCardAba;

function formatarData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const ROTULO = "text-[10.5px] font-bold uppercase tracking-[.08em] text-muted-foreground";
const CARTAO = "rounded-[18px] border border-card-border bg-card px-3.5 py-3 shadow-relevo";

/** As abas do negócio: sublinhado — a hierarquia abaixo do segmentado da gaveta. */
function Abas<T extends string>({
  itens,
  ativa,
  onTrocar,
}: {
  /**
   * `contagem` é número; `contagemTexto` existe para a aba cuja medida é uma
   * FRAÇÃO — "3/7 feito" diz o que "7" sozinho não diz, e é a pergunta que se
   * faz de checklist.
   */
  itens: { chave: T; rotulo: string; contagem?: number; contagemTexto?: string }[];
  ativa: T;
  onTrocar: (chave: T) => void;
}) {
  return (
    // Rola na horizontal no celular em vez de quebrar em duas linhas de abas.
    <nav className="flex items-center gap-x-1 overflow-x-auto border-b border-border [scrollbar-width:none]">
      {itens.map((i) => {
        const acesa = i.chave === ativa;
        return (
          <button
            key={i.chave}
            type="button"
            onClick={() => onTrocar(i.chave)}
            className={cn(
              "relative shrink-0 whitespace-nowrap px-2.5 py-2.5 text-[13px] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              acesa ? "font-semibold text-foreground" : "font-medium text-muted-foreground hover:text-foreground/80",
            )}
          >
            {i.rotulo}
            {(i.contagemTexto ?? i.contagem) !== undefined && (
              <span className="ml-1.5 text-[11px] font-semibold tabular-nums text-muted-foreground/70">
                {i.contagemTexto ?? i.contagem}
              </span>
            )}
            {acesa && <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary" />}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Ganhou e Perdeu, no cartão de ouro (mockup: "btn-dark" + translúcido).
 * `data-desfecho` é de onde a celebração do painel lança o símbolo.
 */
function AcaoDeDesfecho({
  tom,
  onClick,
  desabilitado,
}: {
  tom: "ganho" | "perda";
  onClick?: () => void;
  desabilitado?: boolean;
}) {
  const ganho = tom === "ganho";
  const Icone = ganho ? Trophy : CircleX;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      data-desfecho={ganho ? "won" : "lost"}
      className={cn(
        "inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-bold",
        "transition-[background-color,transform] active:scale-[.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tinta focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
        "disabled:pointer-events-none disabled:opacity-45",
        ganho
          ? "bg-tinta text-tinta-foreground hover:bg-tinta-3"
          : "bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/[.16]",
      )}
    >
      <Icone className="size-3.5" aria-hidden="true" />
      {ganho ? "Ganhou" : "Perdeu"}
    </button>
  );
}

/** Um bloco translúcido dentro do ouro (o `FocusTile` do V5, em tamanho de gaveta). */
function BlocoNoOuro({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-2xl border border-primary-foreground/10 bg-primary-foreground/[.07] px-3 py-2">
      <span className="text-[10px] font-bold uppercase tracking-[.08em] text-primary-foreground/65">{rotulo}</span>
      <span className="min-w-0 break-words text-[14px] font-extrabold tracking-[-0.02em] tabular-nums">{children}</span>
    </div>
  );
}

/** Como cada situação da reunião pinta a linha. Chaves de `situacaoDaReuniao`. */
const TOM_DA_REUNIAO: Record<SituacaoDaReuniao["tom"], { selo: string; texto: string }> = {
  ok: { selo: "border-success/30 bg-success/10 text-success", texto: "text-success" },
  ruim: {
    selo: "border-destructive/35 bg-destructive/[0.08] text-destructive",
    texto: "text-destructive",
  },
  alerta: {
    selo: "border-warning/40 bg-warning/[0.10] text-warning-strong",
    texto: "text-warning-strong",
  },
  neutro: { selo: "border-border bg-muted text-muted-foreground", texto: "text-muted-foreground" },
};

/**
 * A linha da reunião.
 *
 * ── O QUE ELA PASSOU A DIZER, E POR QUÊ ───────────────────────────────────
 * Ela mostrava data e "confirmada / sem confirmação", e mais nada. Faltavam as
 * duas informações que decidem o que fazer com a reunião:
 *
 *   1. **já aconteceu?** Reunião passada sem desfecho é a pendência mais cara
 *      do funil — é dela que sai o no-show que ninguém registrou. Ela é a única
 *      situação que ACENDE aqui, porque é a única que pede ação;
 *   2. **quem sabe dela é a Agenda?** Uma data digitada no card do funil e uma
 *      reunião com linha em `meetings` se pareciam byte a byte, e só a segunda
 *      tem botão de compareceu / não compareceu do outro lado. O selo "Agenda"
 *      é o que diz onde ir mexer.
 *
 * O selo NÃO é link. A rota `/agenda` hoje não lê parâmetro de reunião
 * (verificado): mandar para lá sem foco seria prometer um destino que a outra
 * tela não cumpre. `reuniao.meetingId` já viaja até aqui para o dia em que ela
 * ler.
 */
function LinhaDaReuniao({ reuniao }: { reuniao: NonNullable<DealCardData["reuniao"]> }) {
  const situacao = situacaoDaReuniao(reuniao);
  const tom = TOM_DA_REUNIAO[situacao.tom];
  const quando = new Date(reuniao.data);

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-[18px] border border-card-border bg-card px-3.5 py-3 shadow-relevo">
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-[9px] border",
          tom.selo,
        )}
        aria-hidden="true"
      >
        <CalendarCheck className="size-3.5" />
      </span>
      <span
        className={cn(
          "text-[13px] font-medium tabular-nums",
          // Reunião que já passou não some nem apaga — ela recua, para a
          // próxima linha do card não competir com um compromisso vencido.
          situacao.passou && "text-muted-foreground",
        )}
      >
        {Number.isNaN(quando.getTime())
          ? "—"
          : quando.toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
      </span>
      <span className={cn("text-[12px]", tom.texto)}>{situacao.rotulo}</span>
      {situacao.daAgenda && (
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[.06em] text-muted-foreground">
          <CalendarDays className="size-3" aria-hidden="true" />
          Agenda
        </span>
      )}
    </div>
  );
}

export function DealCard({
  negocio,
  onRenomear,
  onSaveNote,
  onMoverEtapa,
  onDefinirDesfecho,
  decidindo,
  onOpenDeal,
  onNewDeal,
  onAdicionarProduto,
  onEditarItem,
  onAjustarPedido,
  onCorrigirVendaHistorica,
  ajustesPedido = [],
  onRemoverItem,
  onEditarValor,
  movendo,
  comentarios = [],
  onComentar,
  onBaixarAnexo,
  onEditarComentario,
  onApagarComentario,
  comentando,
  abaInicial,
  resumoChecklists,
  painelChecklists,
  painelPedidoErp,
  onExcluir,
  excluindo,
  etiquetas,
  acaoLigar,
  acaoCopiar,
}: {
  negocio: DealCardData;
  onRenomear?: (nome: string, alterarLead: boolean) => Promise<void>;
  onSaveNote?: (texto: string) => void;
  /** Move o negócio entre etapas. NÃO decide desfecho — ver `onDefinirDesfecho`. */
  onMoverEtapa?: (chave: string) => void;
  /**
   * Marca o negócio como ganho/perdido ou reabre, na etapa em que ele estiver
   * (ADR-0023 Emenda 1). Quem escreve é o `DealCardPanel`: este arquivo está no
   * grafo de `/preview.html` e não pode alcançar o banco (inv:H5-17).
   */
  onDefinirDesfecho?: (desfecho: "open" | "won" | "lost") => void;
  /** Desfecho em voo — trava as ações de fechamento e reabertura. */
  decidindo?: boolean;
  /** Abre OUTRO negócio do mesmo lead, na aba "Negócios". */
  onOpenDeal?: (entryId: string) => void;
  onNewDeal?: () => void;
  onAdicionarProduto?: () => void;
  /**
   * Editar e remover item chegam por callback pela mesma razão que
   * `onAdicionarProduto`: este arquivo está no grafo de `/preview.html` e não
   * pode alcançar o banco (inv:H5-17). Quem escreve é o `DealCardPanel`.
   */
  onEditarItem?: (edicao: ItemEditado) => Promise<void>;
  onAjustarPedido?: (ajuste: AjustePedidoGanho) => Promise<void>;
  onCorrigirVendaHistorica?: (correcao: CorrecaoVendaHistorica) => Promise<void>;
  ajustesPedido?: Array<{
    id: string;
    reason: string;
    before_value: number;
    after_value: number;
    created_at: string;
  }>;
  onRemoverItem?: (itemId: string) => Promise<void>;
  onEditarValor?: (valor: number, versao: string | null) => Promise<void>;
  movendo?: string | null;
  /**
   * ── Comentários entram por FORA de `negocio` ──────────────────────────
   * Eles não vêm de `useDealCardData`: têm consulta e chave de cache própria
   * (`["lead-comments", leadId]`), que é o que faz comentar/editar/apagar
   * refletir na hora sem refazer o painel inteiro. Enfiá-los em `DealCardData`
   * casaria as duas invalidações e um comentário passaria a custar uma
   * releitura de etapas, mediana e produtos.
   */
  comentarios?: DealCardComentario[];
  onComentar?: (texto: string, files?: File[]) => void | Promise<void>;
  onBaixarAnexo?: (file: CommentAttachment) => Promise<void>;
  onEditarComentario?: (id: string, texto: string) => void | Promise<void>;
  onApagarComentario?: (id: string) => void | Promise<void>;
  comentando?: boolean;
  /**
   * A aba pedida por quem abriu o painel. Sem isto, "Checklists" no menu do
   * card abria na primeira aba e o item parecia não fazer nada.
   */
  abaInicial?: DealCardAba | null;
  /**
   * Contagem de checklists só para o SELO da aba. O conteúdo busca por conta
   * própria — este número vem do painel, que já roda a query para o selo
   * aparecer sem exigir que a aba seja aberta primeiro.
   */
  resumoChecklists?: { feitos: number; total: number } | null;
  /**
   * ── Checklists entram por SLOT, não por import ─────────────────────────
   * O conteúdo da aba fala com banco (`@/modules/engagement` → supabase +
   * react-query). Importá-lo daqui poria esse caminho no grafo de quem monta
   * o `DealCard` — inclusive `/preview.html`, a tela de desenho que só é
   * segura porque NÃO tem de onde ler (`inv:H5-17`,
   * `preview-cards-sem-banco.test.ts`). Quem tem a dependência é o
   * `DealCardPanel`; aqui só se escolhe onde pendurar.
   *
   * Sem o slot a aba não existe — é a mesma regra das outras três do print:
   * aba que abre num "nada aqui" ensina a não clicar em nenhuma.
   */
  painelChecklists?: ReactNode;
  /** Conteúdo conectado fornecido pelo painel; mantém a prévia sem acesso ao banco. */
  painelPedidoErp?: ReactNode;
  /**
   * ── Excluir o negócio ──────────────────────────────────────────────────
   * Só ABRE a confirmação; quem confirma e quem apaga é o `DealCardPanel`.
   *
   * O diálogo mora lá porque o estado dele e o acesso a banco moram lá — este
   * arquivo é desenho. (Não porque aninhar quebraria o Radix: isso foi medido
   * em 27/08/2026 e **não** reproduz. Ver o bloco em `DealCardPanel`.)
   *
   * Ausente quando a pessoa não tem `pipeline.delete_cards`. Aqui o item SOME
   * em vez de cair num selo (o padrão do menu do card no kanban): o menu do
   * cabeçalho tem um item só, e um menu que abre para mostrar uma ação
   * indisponível é pior que menu nenhum.
   */
  onExcluir?: () => void;
  excluindo?: boolean;
  /**
   * A faixa de etiquetas — SÓ quando a coluna da pessoa não está na tela.
   *
   * Etiqueta é do LEAD (a única junção no schema é `lead_tags`), e por isso o
   * lugar dela é a coluna da esquerda: `deal-card.test.tsx` proíbe o card do
   * Negócio de reestampar quem é a pessoa, justamente para a tela não dizer a
   * mesma coisa duas vezes a 40cm de distância.
   *
   * No celular, porém, não há coluna: `DealCardPanel` monta `conteudo(false)` e
   * o negócio ocupa tudo. Sem este slot, etiquetar seria impossível no telefone
   * — a mesma ausência que este trabalho veio consertar. Quem decide é o painel,
   * que é quem sabe se a coluna existe; aqui só se escolhe onde pendurar.
   */
  etiquetas?: ReactNode;
  /**
   * O botão de LIGAR para a pessoa do negócio, montado pronto pelo painel
   * (`VoiceCallButton`, variante ícone). Slot, e não import, pela mesma razão
   * de `painelChecklists`: este arquivo é alcançável a partir de
   * `src/preview/main.tsx`, e o provider de voz lê react-query e Supabase.
   * Não reestampa a pessoa — é um ato sobre ela, não uma identidade.
   */
  acaoLigar?: ReactNode;
  acaoCopiar?: ReactNode;
}) {
  const abaPedida: Aba =
    abaInicial === "checklists" && !painelChecklists ? "negocio" : abaInicial ?? "negocio";
  const [aba, setAba] = useState<Aba>(abaPedida);
  const [nota, setNota] = useState(negocio.nota);

  // Repor o texto quando o que está salvo muda.
  useEffect(() => {
    setNota(negocio.nota);
  }, [negocio.nota]);

  /**
   * Voltar à primeira aba SÓ quando o negócio troca.
   *
   * Junto com o efeito de cima isto era um efeito só, com `negocio.nota` na
   * lista — e aí gravar a anotação resetava a navegação: o `onBlur` grava,
   * a query refaz, `negocio.nota` muda, e a textarea que a pessoa acabava de
   * usar sumia da tela. Acontecia em 100% das gravações.
   */
  useEffect(() => {
    setAba(abaPedida);
    // `abaInicial` FORA da lista de propósito: ele é o pedido de QUEM ABRIU, e
    // reagir a ele arrastaria a pessoa de volta para a aba pedida no meio da
    // navegação — o provider zera o pedido só na próxima abertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [negocio.id]);

  const aberto = negocio.estado === "aberto";
  const [ajustandoPedido, setAjustandoPedido] = useState(false);
  useEffect(() => setAjustandoPedido(false), [negocio.id, negocio.estado]);
  const [corrigindoVenda, setCorrigindoVenda] = useState(false);
  useEffect(() => setCorrigindoVenda(false), [negocio.id]);
  const estagnado =
    aberto &&
    negocio.diasNaEtapa !== null &&
    negocio.medianaDaEtapa !== null &&
    negocio.diasNaEtapa > negocio.medianaDaEtapa * 2;

  const { total, temValor } = contaDoNegocio(negocio.itens, negocio.valorDoNegocio, negocio.valor);
  const etapaAtual = negocio.etapas.find((e) => e.chaveEntry === negocio.etapaAtual)?.nome ?? null;

  return (
    <div data-summary-pending={nota !== negocio.nota} className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-[220px]">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <NomeDoNegocio key={negocio.id} titulo={negocio.titulo} nomeLead={negocio.lead.nome} onRenomear={onRenomear} />
              {negocio.estado === "ganho" && (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-success/40 bg-success/10 py-0.5 pl-1 pr-2.5 text-[12px] font-bold text-success-strong">
                  <button
                    type="button"
                    aria-label="Remover de ganho"
                    title="Remover de ganho"
                    disabled={!onDefinirDesfecho || !!movendo || !!decidindo}
                    onClick={() => onDefinirDesfecho?.("open")}
                    className="grid size-5 place-items-center rounded-full hover:bg-success/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                  Ganho
                </span>
              )}
              {negocio.estado === "perdido" && (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-destructive/35 bg-destructive/[0.08] py-0.5 pl-1 pr-2.5 text-[12px] font-bold text-destructive">
                  <button
                    type="button"
                    aria-label="Remover de perdido"
                    title="Remover de perdido"
                    disabled={!onDefinirDesfecho || !!movendo || !!decidindo}
                    onClick={() => onDefinirDesfecho?.("open")}
                    className="grid size-5 place-items-center rounded-full hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                  Perdido
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full" style={{ background: negocio.funilCor }} aria-hidden="true" />
                {negocio.funil}
              </span>
              {negocio.dono ? <span>{negocio.dono}</span> : <span className="opacity-70">sem dono</span>}
            </div>
            {etiquetas && <div className="mt-2">{etiquetas}</div>}
          </div>

          {(acaoCopiar || onExcluir) && (
            <div className="flex shrink-0 items-center gap-1.5">
              {acaoCopiar}
              {onExcluir && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={excluindo}
                      aria-label="Mais opções do negócio"
                      data-testid="deal-card-kebab"
                      className={cn(
                        "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-input bg-card shadow-relevo",
                        "text-muted-foreground transition-colors hover:text-foreground",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        "disabled:pointer-events-none disabled:opacity-50",
                      )}
                    >
                      {excluindo ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
                    </button>
                  </DropdownMenuTrigger>
                  {/* `z-[60]`: no celular o painel é um `Sheet` (`z-[51]`) e o
                      `z-50` padrão do menu abriria por baixo dele. */}
                  <DropdownMenuContent align="end" className="z-[60]">
                    <DropdownMenuItem
                      onClick={onExcluir}
                      className="text-destructive focus:text-destructive"
                      data-testid="deal-card-excluir"
                    >
                      <Trash2 className="mr-2 size-3.5" />
                      Excluir negócio
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </div>

        {/* ── O cartão de ouro ─────────────────────────────────────────────
            O que decide fica aqui, acima da dobra: valor, etapa, tempo, a régua
            e o desfecho. Um ouro por gaveta (README do V5). */}
        <section
          aria-label="Resumo do negócio"
          className="flex min-w-0 flex-col gap-3.5 rounded-card bg-primary p-4 text-primary-foreground shadow-brilho-ouro"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <span className="text-[10.5px] font-bold uppercase tracking-[.08em] text-primary-foreground/70">
                Valor total
              </span>
              {/* Sem valor vira "—", nunca "R$ 0,00": `sale_value` existe em
                  1,1% dos negócios, e zero afirma que o negócio não vale nada. */}
              <p className="mt-0.5 text-[1.65rem] font-extrabold leading-none tracking-[-0.035em] tabular-nums">
                {temValor ? formatBRL(total, 2) : "—"}
              </p>
              {negocio.itens.length > 0 && (
                <p className="mt-1 text-[11.5px] font-semibold text-primary-foreground/70">
                  {negocio.itens.length} produto(s)
                </p>
              )}
            </div>
            {etapaAtual && (
              <span className="inline-flex h-6 max-w-[45%] shrink-0 items-center truncate rounded-full bg-tinta px-2.5 text-[11.5px] font-bold text-tinta-foreground">
                {etapaAtual}
              </span>
            )}
          </div>

          {/* O tempo: acende quando passa do DOBRO da mediana da etapa na própria
              org — alarme que toca sempre não é alarme. Negócio fechado não
              tem tempo: parado não quer dizer nada depois da venda. */}
          {aberto && (
            <div
              className={cn(
                "inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 self-start rounded-2xl px-3 py-1.5 text-[12px]",
                estagnado ? "bg-tinta text-tinta-foreground" : "bg-primary-foreground/10",
              )}
            >
              <Hourglass className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="font-bold">{estagnado ? "Parado na etapa" : "Em aberto"}</span>
              <span className="font-extrabold tabular-nums">
                {estagnado
                  ? String(negocio.diasNaEtapa)
                  : negocio.diasEmAberto === null
                    ? "—"
                    : String(negocio.diasEmAberto)}
              </span>
              {(estagnado || negocio.diasEmAberto !== null) && <span className="font-semibold">dias</span>}
              {estagnado ? (
                <span className="opacity-75">· normal aqui: {negocio.medianaDaEtapa} dias</span>
              ) : negocio.diasNaEtapa !== null ? (
                <span className="opacity-75">· {negocio.diasNaEtapa} nesta etapa</span>
              ) : null}
            </div>
          )}

          <DealCardStages
            tom="ouro"
            etapas={negocio.etapas}
            atual={negocio.etapaAtual}
            cor={negocio.funilCor}
            movimentacoes={negocio.movimentacoes}
            onMover={onMoverEtapa}
            movendo={movendo}
          />

          <p className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] font-semibold text-primary-foreground/70">
            <CalendarDays className="size-3.5" aria-hidden="true" />
            {negocio.criadoEm ? `Criado em ${formatarData(negocio.criadoEm)}` : "Data de criação desconhecida"}
            {negocio.previsaoFechamento && <span>· previsão {formatarData(negocio.previsaoFechamento)}</span>}
          </p>

          {/* Desfecho — só quando o negócio já morreu. */}
          {!aberto && negocio.desfecho && (
            <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3">
              <BlocoNoOuro rotulo={negocio.estado === "ganho" ? "Vendido em" : "Perdido em"}>
                {formatarData(negocio.desfecho.quando)}
              </BlocoNoOuro>
              {negocio.desfecho.valorVenda ? (
                <BlocoNoOuro rotulo="Valor da venda">{formatBRL(negocio.desfecho.valorVenda)}</BlocoNoOuro>
              ) : null}
              {negocio.desfecho.motivo && <BlocoNoOuro rotulo="Motivo">{negocio.desfecho.motivo}</BlocoNoOuro>}
            </div>
          )}

          {/* Ganhar e perder são fatos do NEGÓCIO (ADR-0023 Emenda 1), não
              posições: aparecem em qualquer etapa — 71% dos funis não têm etapa
              de ganho. Ao GANHAR, quem leva o card para a etapa de ganho é o
              banco. Ligar vem antes: é o ato mais frequente e o único que não
              encerra o negócio — e por isso mora no mesmo grupo. */}
          {(aberto || acaoLigar) && (
            <div className="flex flex-wrap items-center gap-2">
              {acaoLigar}
              {aberto && (
                <AcaoDeDesfecho
                  tom="ganho"
                  desabilitado={!!movendo || !!decidindo}
                  onClick={() => onDefinirDesfecho?.("won")}
                />
              )}
              {aberto && (
                <AcaoDeDesfecho
                  tom="perda"
                  desabilitado={!!movendo || !!decidindo}
                  onClick={() => onDefinirDesfecho?.("lost")}
                />
              )}
            </div>
          )}
        </section>
      </header>

      {/* ── As abas do negócio ────────────────────────────────────────────
          Entram as que têm fonte de dado ligada. Ficam de fora em vez de entrar
          vazias: Arquivos (não há anexo de negócio no schema) e Atendimentos (é
          o chat, que tem tela própria). */}
      <Abas
        ativa={aba}
        onTrocar={setAba}
        itens={[
          { chave: "negocio" as const, rotulo: "Informações do Negócio" },
          { chave: "atividades" as const, rotulo: "Atividades", contagem: negocio.atividades.length },
          ...(painelChecklists
            ? [{
                chave: "checklists" as const,
                rotulo: "Checklists",
                contagemTexto:
                  resumoChecklists && resumoChecklists.total > 0
                    ? `${resumoChecklists.feitos}/${resumoChecklists.total}`
                    : undefined,
              }]
            : []),
          { chave: "negocios" as const, rotulo: "Negócios", contagem: negocio.outrosNegocios.length },
        ]}
      />

      <div className="relative min-w-0">
        {aba === "atividades" ? (
          <DealCardActivities atividades={negocio.atividades} />
        ) : aba === "checklists" ? (
          painelChecklists
        ) : aba === "negocios" ? (
          <LeadCardDeals
            negocios={negocio.outrosNegocios}
            atual={negocio.id}
            onOpenDeal={(id) => onOpenDeal?.(id)}
            onNewDeal={() => onNewDeal?.()}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {/* Reunião — fora de qualquer dobra: é a única coisa aqui com HORA
                marcada, e enterrar é como se perde reunião. */}
            {negocio.reuniao && <LinhaDaReuniao reuniao={negocio.reuniao} />}

            <section aria-label="Produtos e Valores" className="flex flex-col gap-3">
              {negocio.estado === "ganho" && onCorrigirVendaHistorica && negocio.desfecho && (corrigindoVenda ? (
                <CorrigirVendaHistorica
                  key={negocio.id}
                  valor={negocio.desfecho.valorVenda ?? negocio.valorDoNegocio ?? negocio.valor ?? 0}
                  data={diaDaVenda(negocio.desfecho.quando, negocio.timezone)}
                  versao={negocio.pedidoAtualizadoEm}
                  timezone={negocio.timezone}
                  valorDosProdutos={negocio.itens.length > 0}
                  onSalvar={onCorrigirVendaHistorica}
                  onCancelar={() => setCorrigindoVenda(false)}
                />
              ) : (
                <button
                  type="button"
                  className="inline-flex h-9 items-center self-start rounded-full border border-input bg-card px-4 text-sm font-semibold shadow-relevo transition-[border-color,transform] hover:-translate-y-px hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => { setAjustandoPedido(false); setCorrigindoVenda(true); }}
                >
                  Corrigir data e valor da venda
                </button>
              ))}
              {negocio.estado === "ganho" && onAjustarPedido && (ajustandoPedido ? (
                <AjustarPedidoGanho
                  key={negocio.id}
                  itens={negocio.itens}
                  valor={negocio.valorDoNegocio ?? negocio.valor ?? 0}
                  onSalvar={onAjustarPedido}
                  onCancelar={() => setAjustandoPedido(false)}
                />
              ) : (
                <button
                  type="button"
                  className="inline-flex h-9 items-center self-start rounded-full border border-input bg-card px-4 text-sm font-semibold shadow-relevo transition-[border-color,transform] hover:-translate-y-px hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => { setCorrigindoVenda(false); setAjustandoPedido(true); }}
                >
                  Ajustar pedido ganho
                </button>
              ))}
              {!ajustandoPedido && !corrigindoVenda && (
                <DealCardMoney
                  key={negocio.id}
                  itens={negocio.itens}
                  valorDoNegocio={negocio.valorDoNegocio}
                  versaoDoNegocio={negocio.pedidoAtualizadoEm}
                  valorDoFunil={negocio.valor}
                  onAdicionarProduto={negocio.estado === "ganho" ? undefined : onAdicionarProduto}
                  onEditarItem={negocio.estado === "ganho" ? undefined : onEditarItem}
                  onRemoverItem={negocio.estado === "ganho" ? undefined : onRemoverItem}
                  onEditarValor={negocio.estado === "aberto" ? onEditarValor : undefined}
                />
              )}
              {ajustesPedido.length > 0 && (
                <section className={cn(CARTAO, "space-y-2")}>
                  <h4 className="text-sm font-bold">Histórico de ajustes</h4>
                  {ajustesPedido.map((ajuste) => (
                    <div key={ajuste.id} className="border-b border-border pb-2 text-sm last:border-0">
                      <p className="tabular-nums">
                        {formatBRL(Number(ajuste.before_value), 2)} → {formatBRL(Number(ajuste.after_value), 2)}
                      </p>
                      <p className="whitespace-pre-wrap break-words text-muted-foreground">{ajuste.reason}</p>
                      <time className="text-xs text-muted-foreground" dateTime={ajuste.created_at}>
                        {new Date(ajuste.created_at).toLocaleString("pt-BR")}
                      </time>
                    </div>
                  ))}
                </section>
              )}
              {painelPedidoErp}
            </section>

            {/* A anotação saiu da sub-aba: é campo fixo, como no mockup. Uma
                aba que esconde o único campo livre do negócio custava um clique
                em toda leitura. */}
            <label className={cn(CARTAO, "flex flex-col gap-2")}>
              <span className={ROTULO}>Anotação do negócio</span>
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                onBlur={() => nota !== negocio.nota && onSaveNote?.(nota)}
                placeholder="O que precisa ser lembrado sobre este negócio…"
                rows={3}
                className={cn(
                  "w-full resize-none rounded-xl border border-input bg-background/60 px-3 py-2",
                  "text-[13px] leading-relaxed placeholder:text-muted-foreground/70",
                  "transition-colors hover:border-muted-foreground/30",
                  "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30",
                )}
              />
            </label>

            {negocio.movimentacoes.length > 0 && (
              <section className={cn(CARTAO, "flex flex-col gap-2.5")}>
                <h3 className={cn(ROTULO, "flex items-center gap-1.5")}>
                  <CalendarCheck className="size-3.5" aria-hidden="true" />
                  Jornada do Negócio
                  <span className="tabular-nums opacity-70">{negocio.movimentacoes.length}</span>
                </h3>
                <DealCardTimeline movimentacoes={negocio.movimentacoes} />
              </section>
            )}
          </div>
        )}
        {/* Rascunho e anexo subindo continuam montados ao trocar de aba. */}
        <div hidden={aba !== "negocio"} className="mt-4 border-t border-border pt-4">
          <DealCardComments
            key={negocio.id}
            comentarios={comentarios}
            onComentar={onComentar}
            onBaixarAnexo={onBaixarAnexo}
            onEditar={onEditarComentario}
            onApagar={onApagarComentario}
            enviando={comentando}
          />
        </div>
      </div>
    </div>
  );
}
