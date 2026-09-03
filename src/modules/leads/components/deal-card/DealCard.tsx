import { useEffect, useState, type ReactNode } from "react";
import { CalendarCheck, Check, Loader2, MoreHorizontal, Trash2, Trophy, X } from "lucide-react";
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
import { contaDoNegocio } from "./conta-do-negocio";
import type { DealCardAba, DealCardComentario, DealCardData, ItemEditado } from "./types";

/**
 * O Card do Negócio — a coluna DIREITA do painel, no formato do print DataCrazy.
 *
 * ── O QUE MUDOU E POR QUÊ ─────────────────────────────────────────────────
 * A versão anterior era uma coluna só, empilhando sete seções (Lead, Tempo,
 * Negócio, Valor, Reunião, Movimentação, Anotação) numa rolagem longa. O print
 * do concorrente organiza o mesmo conteúdo em três camadas — três ladrilhos de
 * cabeçalho, um trilho de etapas com data, e um bloco de dinheiro — atrás de
 * abas. Duas consequências práticas, e é por elas que vale copiar:
 *
 *   1. **o que decide fica acima da dobra.** Tempo, valor e data de criação
 *      respondem "vale a pena mexer nisto agora" sem rolar;
 *   2. **o resto não some, muda de camada.** A movimentação vira aba irmã do
 *      trilho, em vez de sexto bloco de uma pilha que ninguém desce.
 *
 * ── O BLOCO DO LEAD SAIU DAQUI ────────────────────────────────────────────
 * Ele existia porque o painel era só o negócio, e abrir um negócio sem saber de
 * quem ele é não serve. Agora a pessoa ocupa a coluna da esquerda inteira, com
 * mais campo e mais métrica do que a grade de oito campos dava — repetir os
 * mesmos dados a 40cm de distância é onde as duas verdades começam.
 *
 * ── O PRIMEIRO LADRILHO NÃO É O "#75" DO PRINT ────────────────────────────
 * O DataCrazy abre com o número sequencial do negócio. O Torque **não tem esse
 * número** — não há coluna em `deals` nem sequence no Postgres — e a decisão do
 * dono do produto em 21/08 foi sair **sem migration**. No lugar dele entra o
 * dado que o próprio card já elegeu como manchete: **há quanto tempo isto está
 * aberto**. `value` existe em 1,1% dos negócios; tempo existe em 100%, e é o
 * único que aponta ação. O ladrilho acende em vermelho quando o negócio passa
 * do dobro da mediana da etapa na própria org.
 */

type Aba = DealCardAba;
type SubAba = "pipeline" | "jornada";
type AbaDinheiro = "produtos" | "anotacao";

function formatarData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const TOM = {
  azul: "border-sky-500/30 bg-sky-500/[0.07]",
  verde: "border-emerald-500/30 bg-emerald-500/[0.07]",
  roxo: "border-violet-500/30 bg-violet-500/[0.07]",
  alerta: "border-destructive/40 bg-destructive/[0.09]",
} as const;

const TINTA = {
  azul: "text-sky-400",
  verde: "text-emerald-400",
  roxo: "text-violet-400",
  alerta: "text-destructive",
} as const;

/** Os três cartões coloridos do topo do print. */
function Ladrilho({
  rotulo,
  valor,
  sufixo,
  tom,
  nota,
}: {
  rotulo: string;
  valor: string;
  sufixo?: string;
  tom: keyof typeof TOM;
  nota?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl border px-4 py-3", TOM[tom])}>
      <span className={cn("truncate text-[11.5px] font-medium tracking-[0.01em]", TINTA[tom])}>
        {rotulo}
      </span>
      <span className="truncate text-[21px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
        {valor}
        {sufixo && (
          <span className="ml-1 text-[13px] font-medium text-muted-foreground">{sufixo}</span>
        )}
      </span>
      {nota && <span className="truncate text-[11px] text-muted-foreground/75">{nota}</span>}
    </div>
  );
}

/** A barra de abas do print: sublinhado no ativo, sem moldura. */
function Abas<T extends string>({
  itens,
  ativa,
  onTrocar,
  compacta,
}: {
  /**
   * `contagem` é número; `contagemTexto` existe para a aba cuja medida é uma
   * FRAÇÃO — "3/7 feito" diz o que "7" sozinho não diz, e é a pergunta que se
   * faz de checklist.
   */
  itens: { chave: T; rotulo: string; contagem?: number; contagemTexto?: string }[];
  ativa: T;
  onTrocar: (chave: T) => void;
  compacta?: boolean;
}) {
  return (
    <nav className="flex items-center gap-1 border-b border-border">
      {itens.map((i) => {
        const acesa = i.chave === ativa;
        return (
          <button
            key={i.chave}
            type="button"
            onClick={() => onTrocar(i.chave)}
            className={cn(
              "relative px-3 transition-colors",
              compacta ? "py-2 text-[12.5px]" : "py-2.5 text-[13.5px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              acesa ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {i.rotulo}
            {(i.contagemTexto ?? i.contagem) !== undefined && (
              <span className="ml-1.5 text-[11px] tabular-nums text-muted-foreground/60">
                {i.contagemTexto ?? i.contagem}
              </span>
            )}
            {acesa && (
              <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary" />
            )}
          </button>
        );
      })}
    </nav>
  );
}

function AcaoPrimaria({
  icone: Icone,
  rotulo,
  tom,
  onClick,
  desabilitado,
}: {
  icone: typeof Check;
  rotulo: string;
  tom: "ganho" | "perda";
  onClick?: () => void;
  desabilitado?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      className={cn(
        "disabled:pointer-events-none disabled:opacity-45",
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        tom === "ganho"
          ? "border-success/40 text-success hover:bg-success/10"
          : "border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive",
      )}
    >
      <Icone className="size-3.5" />
      {rotulo}
    </button>
  );
}

export function DealCard({
  negocio,
  onSaveNote,
  onMoverEtapa,
  onDefinirDesfecho,
  decidindo,
  onOpenDeal,
  onNewDeal,
  onAdicionarProduto,
  onEditarItem,
  onRemoverItem,
  movendo,
  comentarios = [],
  onComentar,
  onEditarComentario,
  onApagarComentario,
  comentando,
  abaInicial,
  resumoChecklists,
  painelChecklists,
  onExcluir,
  excluindo,
  etiquetas,
  acaoLigar,
}: {
  negocio: DealCardData;
  onSaveNote?: (texto: string) => void;
  /** Move o negócio entre etapas. NÃO decide desfecho — ver `onDefinirDesfecho`. */
  onMoverEtapa?: (chave: string) => void;
  /**
   * Marca o negócio como ganho ou perdido, na etapa em que ele estiver
   * (ADR-0023 Emenda 1). Quem escreve é o `DealCardPanel`: este arquivo está no
   * grafo de `/preview.html` e não pode alcançar o banco (inv:H5-17).
   */
  onDefinirDesfecho?: (desfecho: "won" | "lost") => void;
  /** Desfecho em voo — trava os dois botões para não emitir venda duplicada. */
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
  onRemoverItem?: (itemId: string) => Promise<void>;
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
  onComentar?: (texto: string) => void | Promise<void>;
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
}) {
  const abaPedida: Aba =
    abaInicial === "checklists" && !painelChecklists ? "negocio" : abaInicial ?? "negocio";
  const [aba, setAba] = useState<Aba>(abaPedida);
  const [subAba, setSubAba] = useState<SubAba>("pipeline");
  const [abaDinheiro, setAbaDinheiro] = useState<AbaDinheiro>("produtos");
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
    setSubAba("pipeline");
    setAbaDinheiro("produtos");
    // `abaInicial` FORA da lista de propósito: ele é o pedido de QUEM ABRIU, e
    // reagir a ele arrastaria a pessoa de volta para a aba pedida no meio da
    // navegação — o provider zera o pedido só na próxima abertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [negocio.id]);

  const aberto = negocio.estado === "aberto";
  const estagnado =
    aberto &&
    negocio.diasNaEtapa !== null &&
    negocio.medianaDaEtapa !== null &&
    negocio.diasNaEtapa > negocio.medianaDaEtapa * 2;

  const { total } = contaDoNegocio(negocio.itens, negocio.valorDoNegocio, negocio.valor);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {/* ── Cabeçalho ─────────────────────────────────────────────────────
          Não está no print — o negócio do DataCrazy não tem título nem funil
          visível ali. Aqui tem, e some daqui seria perder o que identifica o
          negócio e os dois únicos botões que o encerram. Fica em uma linha. */}
      <header className="flex shrink-0 items-start gap-3 px-6 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="truncate text-[18px] font-semibold tracking-[-0.02em]">
              {negocio.titulo}
            </h1>
            {negocio.estado === "ganho" && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-2 py-0.5 text-[12px] font-semibold text-success">
                <Trophy className="size-3" />
                Ganho
              </span>
            )}
            {negocio.estado === "perdido" && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-destructive/35 bg-destructive/[0.08] px-2 py-0.5 text-[12px] font-semibold text-destructive">
                <X className="size-3" />
                Perdido
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="size-1.5 rounded-full"
                style={{ background: negocio.funilCor }}
                aria-hidden="true"
              />
              {negocio.funil}
            </span>
            {negocio.dono ? <span>{negocio.dono}</span> : <span className="opacity-70">sem dono</span>}
          </div>
          {etiquetas && <div className="mt-2">{etiquetas}</div>}
        </div>

        {/* Ganhar e perder são fatos do NEGÓCIO (ADR-0023 Emenda 1), não posições.
            O card NÃO se move: o desfecho pode ser dado em qualquer etapa.

            O bloco anterior condicionava os dois botões a `etapaGanha`/
            `etapaPerdida` e argumentava que "botão que não tem para onde ir
            mente". O argumento estava certo e a conclusão envelheceu: medido em
            2026-08-28, 283 dos 396 funis ativos (71%) não têm etapa `won` — em
            quase três quartos dos funis o vendedor não tinha botão nenhum para
            dizer que vendeu. Agora não há para onde ir, e é por isso que o botão
            aparece sempre.

            O `pr-8` da direita é o vão do "X" do `DialogContent` (`right-4
            top-4`), e ele abriga também o `⋯`. O cluster não depende do estado
            do negócio: excluir um negócio JÁ ganho ou perdido é o caso mais
            comum de faxina de funil. */}
        {(aberto || onExcluir || acaoLigar) && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 pr-8">
            {/* Ligar vem antes do desfecho: é o ato mais frequente sobre um
                negócio aberto, e o único que não o encerra. */}
            {acaoLigar}
            {aberto && (
              <AcaoPrimaria
                icone={Check}
                rotulo="Ganhou"
                tom="ganho"
                desabilitado={!!movendo || !!decidindo}
                onClick={() => onDefinirDesfecho?.("won")}
              />
            )}
            {aberto && (
              <AcaoPrimaria
                icone={X}
                rotulo="Perdeu"
                tom="perda"
                desabilitado={!!movendo || !!decidindo}
                onClick={() => onDefinirDesfecho?.("lost")}
              />
            )}
            {onExcluir && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={excluindo}
                    aria-label="Mais opções do negócio"
                    data-testid="deal-card-kebab"
                    className={cn(
                      "inline-flex size-8 shrink-0 items-center justify-center rounded-md",
                      "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      "disabled:pointer-events-none disabled:opacity-50",
                    )}
                  >
                    {excluindo ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <MoreHorizontal className="size-4" />
                    )}
                  </button>
                </DropdownMenuTrigger>
                {/* `z-[60]` pelo mesmo motivo da confirmação (ver o bloco no
                    `DealCardPanel`): no celular o painel é um `Sheet`, que é
                    `z-[51]`, e o `DropdownMenuContent` padrão é `z-50` — o
                    menu abriria DENTRO da área da folha e ficaria coberto por
                    ela. O gatilho responderia ao toque e nada apareceria. */}
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
      </header>

      {/* ── Barra de abas do print ────────────────────────────────────────
          O print tem seis: Histórico · Atividades · Negócios · Arquivos ·
          Atendimentos · Informações do Negócio. Entram as que têm fonte de dado
          ligada — as três do print, mais Checklists, que não está no print e
          tem tabela própria (`checklists`/`checklist_items`) mais o número que
          o card do funil já mostra. As outras ficam de fora em vez de entrar
          vazias — aba que abre num "nada aqui" ensina a não clicar em nenhuma:
            · Arquivos    — não existe anexo de negócio no schema. As três
                            tabelas de arquivo do produto prendem em ticket,
                            produto e agente; nenhuma tem `deal_id`.
            · Atendimentos— é o chat, e ele tem tela própria com muito mais
                            (busca, envio, mídia). Espelhar um pedaço aqui cria
                            um segundo lugar de ler conversa.
            · Histórico   — já está como "Jornada do Negócio", sub-aba do
                            trilho, que é onde ele responde a pergunta certa. */}
      <div className="shrink-0 px-6">
        <Abas
          ativa={aba}
          onTrocar={setAba}
          itens={[
            { chave: "negocio" as const, rotulo: "Informações do Negócio" },
            {
              chave: "atividades" as const,
              rotulo: "Atividades",
              contagem: negocio.atividades.length,
            },
            /* Checklists é aba, não bloco: é a única coisa aqui que a pessoa
               MARCA — e o número no selo é o mesmo que o card do funil anuncia
               como "N atividades em aberto". Até aqui o card prometia esse
               número e o painel não tinha onde cumpri-lo. */
            ...(painelChecklists
              ? [{
                  chave: "checklists" as const,
                  rotulo: "Checklists",
                  contagemTexto: resumoChecklists && resumoChecklists.total > 0
                    ? `${resumoChecklists.feitos}/${resumoChecklists.total}`
                    : undefined,
                }]
              : []),
            { chave: "negocios" as const, rotulo: "Negócios", contagem: negocio.outrosNegocios.length },
          ]}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
          <div className="flex flex-col gap-5">
            {/* Os três cartões do print. */}
            <div className="flex flex-wrap items-stretch gap-3">
              <Ladrilho
                tom={estagnado ? "alerta" : "azul"}
                rotulo={estagnado ? "Parado na etapa" : "Em aberto"}
                valor={
                  estagnado
                    ? String(negocio.diasNaEtapa)
                    : negocio.diasEmAberto === null
                      ? "—"
                      : String(negocio.diasEmAberto)
                }
                sufixo={
                  estagnado || negocio.diasEmAberto !== null ? "dias" : undefined
                }
                nota={
                  estagnado
                    ? `normal aqui: ${negocio.medianaDaEtapa} dias`
                    : negocio.diasNaEtapa !== null
                      ? `${negocio.diasNaEtapa} nesta etapa`
                      : undefined
                }
              />
              {/* O ladrilho FICA sempre, como no print — mas sem valor ele
                  mostra "—", não "R$ 0,00". `sale_value` existe em 1,1% dos
                  38.739 negócios: carimbar zero em 98,9% das aberturas é
                  afirmar que o negócio não vale nada, e não saber quanto vale
                  é outra coisa. Decisão do dono do produto em 22/08. */}
              <Ladrilho
                tom="verde"
                rotulo="Valor Total"
                valor={total > 0 ? formatBRL(total, 2) : "—"}
                nota={negocio.itens.length > 0 ? `${negocio.itens.length} produto(s)` : undefined}
              />
              <Ladrilho
                tom="roxo"
                rotulo="Data de Criação"
                valor={negocio.criadoEm ? formatarData(negocio.criadoEm) : "—"}
                nota={
                  negocio.previsaoFechamento
                    ? `previsão ${formatarData(negocio.previsaoFechamento)}`
                    : undefined
                }
              />
            </div>

            {/* Sub-abas do print: a régua e a jornada são a MESMA pergunta
                ("por onde ele andou") em duas formas — a régua responde onde
                está, a jornada responde quem o levou lá. */}
            <div className="flex flex-col gap-4">
              <Abas
                compacta
                ativa={subAba}
                onTrocar={setSubAba}
                itens={[
                  { chave: "pipeline" as const, rotulo: "Pipeline Completa" },
                  {
                    chave: "jornada" as const,
                    rotulo: "Jornada do Negócio",
                    contagem: negocio.movimentacoes.length,
                  },
                ]}
              />
              {subAba === "pipeline" ? (
                <DealCardStages
                  etapas={negocio.etapas}
                  atual={negocio.etapaAtual}
                  cor={negocio.funilCor}
                  movimentacoes={negocio.movimentacoes}
                  onMover={onMoverEtapa}
                  movendo={movendo}
                />
              ) : (
                <DealCardTimeline movimentacoes={negocio.movimentacoes} />
              )}
            </div>

            {/* Reunião — fora das abas porque é a única coisa aqui com HORA
                marcada; enterrar num painel é como se perde reunião. */}
            {negocio.reuniao && (
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md border",
                    negocio.reuniao.confirmada
                      ? "border-success/30 bg-success/10 text-success"
                      : "border-border bg-muted text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  <CalendarCheck className="size-3.5" />
                </span>
                <span className="text-[13px] font-medium tabular-nums">
                  {new Date(negocio.reuniao.data).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {negocio.reuniao.confirmada ? "confirmada" : "sem confirmação"}
                </span>
              </div>
            )}

            {/* Desfecho — só quando o negócio já morreu. */}
            {!aberto && negocio.desfecho && (
              <div
                className={cn(
                  "flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-3",
                  negocio.estado === "ganho"
                    ? "border-success/35 bg-success/[0.07]"
                    : "border-border bg-card",
                )}
              >
                <div className="flex flex-col">
                  <span className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                    {negocio.estado === "ganho" ? "Vendido em" : "Perdido em"}
                  </span>
                  <span className="text-[14px] font-semibold tabular-nums">
                    {formatarData(negocio.desfecho.quando)}
                  </span>
                </div>
                {negocio.desfecho.valorVenda ? (
                  <div className="flex flex-col">
                    <span className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                      Valor da venda
                    </span>
                    <span className="text-[14px] font-semibold tabular-nums text-success">
                      {formatBRL(negocio.desfecho.valorVenda)}
                    </span>
                  </div>
                ) : null}
                {negocio.desfecho.motivo && (
                  <div className="flex flex-col">
                    <span className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
                      Motivo
                    </span>
                    <span className="text-[14px] font-medium">{negocio.desfecho.motivo}</span>
                  </div>
                )}
              </div>
            )}

            {/* Segunda barra do print. Das cinco abas dele (Produtos e Valores ·
                Campos adicionais · Anexos · Histórico · Atividades), Campos
                adicionais e Anexos não existem para negócio em tabela nenhuma,
                e Histórico/Atividades já são a Jornada logo acima. Sobra a de
                dinheiro — e a Anotação, que precisava de casa. */}
            <div className="flex flex-col gap-4">
              <Abas
                compacta
                ativa={abaDinheiro}
                onTrocar={setAbaDinheiro}
                itens={[
                  { chave: "produtos" as const, rotulo: "Produtos e Valores" },
                  { chave: "anotacao" as const, rotulo: "Anotação" },
                ]}
              />
              {abaDinheiro === "produtos" ? (
                <DealCardMoney
                  itens={negocio.itens}
                  valorDoNegocio={negocio.valorDoNegocio}
                  valorDoFunil={negocio.valor}
                  onAdicionarProduto={onAdicionarProduto}
                  onEditarItem={onEditarItem}
                  onRemoverItem={onRemoverItem}
                />
              ) : (
                <textarea
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  onBlur={() => nota !== negocio.nota && onSaveNote?.(nota)}
                  placeholder="O que precisa ser lembrado sobre este negócio…"
                  rows={4}
                  className={cn(
                    "w-full resize-none rounded-lg border border-border bg-card px-3.5 py-2.5",
                    "text-[13px] leading-relaxed placeholder:text-muted-foreground/70",
                    "transition-colors hover:border-muted-foreground/30",
                    "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30",
                  )}
                />
              )}
            </div>

            {/* Comentários — bloco FIXO no pé da aba, não uma quarta sub-aba.
                A escolha é do dono do produto (24/08) e tem precedente medido:
                `leads.notes` está preenchido em 74,9% dos leads e `lead_comments`
                em 4,4%, e a diferença mais provável entre os dois nunca foi
                preferência por texto solto — é que a nota estava na cara e o
                comentário atrás de uma aba. Repetir a aba aqui seria repetir o
                experimento sabendo o resultado.

                Ele fica DEPOIS do dinheiro de propósito: quem abre o negócio
                abre para decidir, e o que decide (tempo, valor, etapa, produto)
                tem de vir antes da conversa sobre a decisão. */}
            <div className="border-t border-border pt-5">
              <DealCardComments
                comentarios={comentarios}
                onComentar={onComentar}
                onEditar={onEditarComentario}
                onApagar={onApagarComentario}
                enviando={comentando}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
