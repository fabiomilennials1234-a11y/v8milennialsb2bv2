import { memo, type ReactNode } from "react";
import { Building2, CalendarDays, Check, ClipboardList, Clock, Phone, PlusCircle, User, Wallet } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
// `Strict` e não `formatDistanceToNow`: a versão frouxa devolve "há cerca de
// 4 horas", e o "cerca de" sozinho estoura a linha dos badges.
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatFaturamento } from "@/lib/format/faturamento";
import { LeadCardAvatar } from "./LeadCardAvatar";
import { LeadCardLabels } from "./LeadCardLabels";
import { LeadEtiquetasPopover } from "../../etiquetas/LeadEtiquetasPopover";
import { LeadCardChecklistPopover } from "./LeadCardChecklistPopover";
import { LeadCardQualificationPopover } from "./LeadCardQualificationPopover";
// Mesma origem que o `LeadCardAvatar` usa: ele importa o tipo, não o reexporta.
import type { QualificationTier } from "../../lead-detail/modal/types";

/**
 * Card do funil na ANATOMIA DO DATACRAZY.
 *
 * Antes este arquivo era a tradução 1:1 do `.cd` do protótipo
 * `.specs/mockups/funis-redesign/` — três linhas de ~100px, cujo objetivo era
 * caber mais ficha por coluna. O pedido de 20/08 trocou o alvo: o card passa a
 * seguir o concorrente, lido do print real (protótipo em `funis-datacrazy/`).
 *
 * ⚠️ A troca tem um custo declarado, não um acidente: o card CRESCE. O desenho
 * antigo existia para caber mais ficha por coluna, e o do DataCrazy dá linha
 * própria a cada dado. Quem escolheu foi o Lucas, sabendo disso.
 *
 * A anatomia, na ordem do print:
 *   (inicial) Nome — Empresa                    [qualificação]
 *   produto, como link azul sublinhado
 *   👤 pré-venda · venda            ┐
 *   💰 valor                        │  WhatsApp e `⊕` na LATERAL direita,
 *   📅 data                         │  no MEIO da lista, como no concorrente
 *   🗒 atividades                    ┘
 *   ──────────────────────────────────
 *   etiquetas COM NOME, no rodapé
 *
 * Duas decisões que se afastam do print, de propósito:
 *
 *   1. A qualificação fica onde o DataCrazy põe o `#1` — canto superior
 *      direito — e MENOR que a inicial (20px contra 26px). É o pedido literal
 *      ("menores que o símbolo do cara"). Ganho de brinde: hoje `avatar_url`
 *      COBRE as metades de qualificação; separados, os dois convivem.
 *   2. Uma porta só de opções: o `⊕` da lateral, com os 15 itens em 3 grupos
 *      do protótipo (`funis-datacrazy/dados.js:219-246`). O `⋮` do topo
 *      chegou a coexistir e foi REMOVIDO em 21/08, olhando os dois no ar —
 *      os 4 itens dele já eram os `real: true` do menu do `⊕`.
 *
 * O padrão "campo vazio é link azul sublinhado" vem do print e é intencional:
 * é o convite a preencher. Vale para produto, responsáveis e valor.
 */

interface Responsavel {
  name: string | null;
  avatar_url?: string | null;
}

interface Tag {
  name: string;
  color: string;
}

interface LeadCardCompactProps {
  lead: {
    id: string;
    /** Id do LEAD (o `id` acima é o da ENTRADA no funil). O chat precisa deste. */
    leadId?: string | null;
    name: string;
    company?: string | null;
    phone?: string | null;
    email?: string | null;
    tags?: Tag[] | null;
    value?: number | null;
    faturamento?: string | number | null;
    notes?: string | null;
    /** Rótulo do compromisso ("Reunião", "Entrega"). Prefixa o badge de data. */
    dateLabel?: string | null;
    meetLink?: string | null;
    products?: Array<{ name: string; type?: string; value: number }>;
    createdAt?: string | null;
    stageEnteredAt?: string | null;
    isInactive?: boolean;
    potencial?: string | null;
    preSaleResponsible?: Responsavel | null;
    saleResponsible?: Responsavel | null;
    /** As duas metades da qualificação — pré-venda (SDR) e venda. */
    preQualTier?: QualificationTier | null;
    qualTier?: QualificationTier | null;
    avatarUrl?: string | null;
    metrics?: { commentsCount?: number; checklistsCompleted?: number; checklistsTotal?: number } | null;
  };
  config: {
    showContact: boolean; showValue: boolean; showDate: boolean;
    showProducts: boolean; showMeetLink: boolean; showNotes: boolean;
  };
  origin: { bg: string; text: string; label: string };
  urgency: { label: string; className: string } | null;
  dateIndicator: { label: string; className: string } | null;
  parsedDate: Date | null;
  /**
   * O botão de WhatsApp, montado PRONTO pelo `LeadCard`.
   *
   * Não é preciosismo: importar `AbrirConversaButton` (ou
   * `communication/lib/whatsapp`) daqui fecha um ciclo entre os módulos
   * `leads` e `communication`, e o dependency-cruiser barra
   * (`no-circular-dynamic`). Quem já tem essa dependência é o `LeadCard`;
   * este arquivo só recebe o nó e escolhe ONDE pendurar. Vem `null` quando o
   * telefone não passa em `formatPhoneForWhatsApp` — aí o botão some.
   */
  acaoWhatsapp?: ReactNode;
  selected?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  onClick?: () => void;
  menuItems: ReactNode;
  /**
   * O menu do "⊕" da lateral: os 15 itens em 3 grupos do protótipo. Vem
   * montado do `LeadCard`, que tem os handlers, o estado dos modais e o
   * `pipeOps`. NÃO é o mesmo nó de `menuItems` — botões diferentes, menus
   * diferentes.
   */
  menuAdicionar?: ReactNode;
  /**
   * Slot de domínio (ex.: confirmar reunião no funil mergeado).
   */
  extraActions?: ReactNode;
}

/**
 * Cor da inicial. Mesma função do ramo confortável (`corDaInicial` em
 * LeadCard.tsx) e de `colorFromName` em LeadCardMetrics: soma os charCodes e
 * gira o matiz, para duas pessoas não caírem na mesma cor por acidente.
 */
function corDaInicial(nome?: string | null): string {
  if (!nome) return "hsl(0 0% 45%)";
  const h = Array.from(nome).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return `hsl(${h % 360} 55% 55%)`;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL", minimumFractionDigits: 0,
  }).format(value);
}

/**
 * `12/08 · 14:00`. Ano fica de fora (compromisso de funil é sempre perto) e a
 * hora só aparece quando existe: data sem hora vem como meia-noite, e
 * "· 00:00" leria como reunião de madrugada.
 */
function formatarCompromisso(d: Date): string {
  const dia = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  if (d.getHours() === 0 && d.getMinutes() === 0) return dia;
  return `${dia} · ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Badge de 16px — o `.bdg` do protótipo. */
function Badge({ children, className, style }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[3px] rounded border border-transparent",
        "px-[5px] text-[9px] font-semibold leading-[1.65] tracking-[0.01em]",
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}

/**
 * Uma das 4 linhas com ícone. `vazio` é o texto do convite a preencher — e,
 * quando o valor falta, a linha vira link azul sublinhado, como no print.
 */
function Linha({ icone, children, vazio }: {
  icone: ReactNode; children?: ReactNode; vazio: string;
}) {
  const preenchida = children !== null && children !== undefined && children !== false;
  return (
    <div className="flex min-w-0 items-center gap-2 text-[11px] leading-[1.45]">
      <span className="grid size-[13px] shrink-0 place-items-center text-muted-foreground/70" aria-hidden>
        {icone}
      </span>
      {preenchida ? (
        <span className="min-w-0 truncate text-muted-foreground">{children}</span>
      ) : (
        <span className="min-w-0 truncate text-[#3da8f5] underline decoration-[#3da8f5]/40 underline-offset-2">
          {vazio}
        </span>
      )}
    </div>
  );
}

export const LeadCardCompact = memo(function LeadCardCompact({
  lead, config, origin, urgency, dateIndicator, parsedDate, acaoWhatsapp, menuAdicionar,
  selected, onSelect, onClick, menuItems, extraActions,
}: LeadCardCompactProps) {
  const preVenda = lead.preSaleResponsible?.name ?? null;
  const venda = lead.saleResponsible?.name ?? null;

  const diasParado = lead.stageEnteredAt
    ? Math.floor((Date.now() - new Date(lead.stageEnteredAt).getTime()) / 86400000)
    : null;

  const valorExibido = config.showValue
    ? lead.value != null
      ? formatCurrency(lead.value)
      : lead.faturamento
      ? formatFaturamento(lead.faturamento)
      : null
    : null;

  // O `LeadCard` só monta o slot quando o telefone é celular BR válido.
  const temZap = config.showContact && !!acaoWhatsapp;

  const produto = lead.products?.[0]?.name ?? null;

  const feitos = lead.metrics?.checklistsCompleted ?? 0;
  const totalCk = lead.metrics?.checklistsTotal ?? 0;
  const tudoFeito = totalCk > 0 && feitos === totalCk;
  const emAberto = totalCk - feitos;
  /**
   * A copy do print é PROSA e muda de estado — "N atividade em aberto" contra
   * "N atividades concluídas" — em vez da fração crua `N/M`. A diferença não é
   * estética: quem varre a coluna quer saber se sobrou coisa para fazer, e
   * `3/4` obriga a fazer a conta de cabeça.
   */
  const atividades = totalCk === 0
    ? null
    : tudoFeito
    ? `${feitos} atividade${feitos > 1 ? "s" : ""} concluída${feitos > 1 ? "s" : ""}`
    : `${emAberto} atividade${emAberto > 1 ? "s" : ""} em aberto`;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        data-lead-id={lead.id}
        onClick={onClick}
        className={cn(
          // `p-0` anula o `p-4` que `.kanban-card` aplica no CSS global.
          "kanban-card group relative cursor-pointer p-0",
          "flex flex-col rounded-[10px]",
          lead.isInactive && "opacity-60",
          selected && "ring-2 ring-primary/50",
        )}
      >
        <div className="flex flex-col gap-1.5 px-2.5 py-2">

          {/* ── 1. inicial · nome + empresa · QUALIFICAÇÃO · menu ── */}
          <div className="flex items-start gap-2">
            {onSelect && (
              <button
                type="button"
                role="checkbox"
                aria-checked={!!selected}
                aria-label={`Selecionar ${lead.name}`}
                onClick={(e) => { e.stopPropagation(); onSelect(e); }}
                className={cn(
                  "mt-px flex size-[15px] shrink-0 items-center justify-center rounded border transition-all",
                  selected
                    ? "border-primary bg-primary text-primary-foreground opacity-100"
                    : "border-muted-foreground/40 bg-background/80 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                {selected && <Check className="size-[9px]" />}
              </button>
            )}

            {/* o "símbolo do cara": a inicial, 26px */}
            <div
              className="grid size-[26px] shrink-0 place-items-center overflow-hidden rounded-full text-[11px] font-semibold"
              style={{
                color: corDaInicial(lead.name),
                backgroundColor: `color-mix(in srgb, ${corDaInicial(lead.name)} 18%, transparent)`,
              }}
              aria-hidden
            >
              {lead.avatarUrl
                ? <img src={lead.avatarUrl} alt="" className="size-full object-cover" />
                : (lead.name?.trim()?.[0]?.toUpperCase() ?? "?")}
            </div>

            <div className="min-w-0 flex-1">
              <h4 className="truncate text-[12.5px] font-semibold leading-[1.18] tracking-[-0.012em] transition-colors group-hover:text-primary">
                {lead.name}
              </h4>
              {lead.company && (
                <div className="mt-px flex min-w-0 items-center gap-1 text-[10.5px] leading-[1.3] text-muted-foreground">
                  <Building2 className="size-[10px] shrink-0 opacity-60" />
                  <span className="truncate">{lead.company}</span>
                </div>
              )}
            </div>

            {/* Onde o DataCrazy põe o "#1": 22px, MENOR que a inicial de 26px.
                Desenhado SEMPRE — sem a guarda `preQual || qual` de antes.
                Duas razões: lead não qualificado é justamente quem precisa do
                convite (o símbolo desenha `?` na metade vazia sozinho), e sem
                render não há onde clicar para qualificar.
                22 e não 20: abaixo de 26px o ícone cai para 0,46 do tamanho, e
                a 20px isso dá 9px — ilegível no meio a meio. */}
            {lead.leadId ? (
              <LeadCardQualificationPopover
                leadId={lead.leadId}
                preQualTier={lead.preQualTier}
                qualTier={lead.qualTier}
                name={lead.name}
                size={22}
                className="mt-px"
              />
            ) : (
              <LeadCardAvatar
                preQualTier={lead.preQualTier}
                qualTier={lead.qualTier}
                name={lead.name}
                size={22}
                className="mt-px shrink-0"
              />
            )}

            {/* Sem "⋮" no topo — decisão do Lucas em 21/08, depois de ver os
                dois no ar. É o que o print do DataCrazy mostra: o card tem UMA
                porta de opções, o "⊕" da lateral, e o "⋯" mora no cabeçalho da
                COLUNA. Nada se perde: os 4 itens que o "⋮" tinha (WhatsApp,
                Agendar mensagem, Adicionar a funil, Remover do funil) são os
                mesmos `real: true` que o menu do "⊕" já traz, agrupados. */}
          </div>

          {/* ── 2. o produto, como link azul sublinhado ── */}
          {config.showProducts && (
            <a
              onClick={(e) => e.stopPropagation()}
              className="block min-w-0 truncate text-[11px] leading-[1.35] text-[#3da8f5] underline decoration-[#3da8f5]/40 underline-offset-2"
            >
              {produto ?? "Sem produto"}
            </a>
          )}

          {/* ── 3. as linhas com ícone + as ações na LATERAL direita ── */}
          <div className="flex items-stretch gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <Linha icone={<User className="size-[13px]" />} vazio="Sem responsável">
                {/* Só os nomes que EXISTEM, unidos por "·". A versão anterior
                    imprimia um travessão no lugar do ausente e saía
                    "—Bruna Ricci" grudado: metade vazia não é informação,
                    é sujeira. Quem tem um responsável só mostra um. */}
                {preVenda || venda
                  ? [preVenda, venda].filter(Boolean).join(" · ")
                  : null}
              </Linha>

              {/* O telefone não está no print do DataCrazy, mas `showContact`
                  é ajuste POR ORG e havia orgs com ele ligado: o redesenho o
                  tinha derrubado em silêncio, e ajuste que não faz mais nada é
                  pior do que ajuste que não existe. Volta atrás da mesma
                  chave que já governa o slot de WhatsApp. */}
              {config.showContact && lead.phone && (
                <Linha icone={<Phone className="size-[13px]" />} vazio="Sem telefone">
                  <span className="tabular-nums">{lead.phone}</span>
                </Linha>
              )}

              {config.showValue && (
                /* `vazio` era "R$ 0,00" — carimbava zero em lead sem valor, que
                   é afirmar que ele não vale nada em vez de dizer que não se
                   sabe. Mesma regra do painel do Negócio (decisão de 22/08). */
                <Linha icone={<Wallet className="size-[13px]" />} vazio="Sem valor">
                  {valorExibido ? (
                    <span className="font-semibold tabular-nums text-emerald-500">{valorExibido}</span>
                  ) : null}
                </Linha>
              )}

              {config.showDate && (
                <Linha icone={<CalendarDays className="size-[13px]" />} vazio="Sem data">
                  {parsedDate ? (
                    <>
                      {lead.dateLabel && <b className="font-semibold text-foreground">{lead.dateLabel} </b>}
                      {formatarCompromisso(parsedDate)}
                    </>
                  ) : null}
                </Linha>
              )}

              {/* A linha de atividades ABRE o painel de checklists.
                  Ela era texto morto: o `LeadCardChecklistPopover` existe
                  completo (cabeçalho sticky, seções colapsáveis, itens
                  marcáveis) mas só era montado pelo ramo confortável, que
                  funil nenhum renderiza — ou seja, checklist não existia nos
                  funis.

                  O portão é só o `leadId`. Exigir `totalCk > 0` — como aqui se
                  fazia — deixava justamente o card SEM checklist sem porta: a
                  linha "Sem atividades" era o convite a aplicar o primeiro, e
                  não abria nada. O ramo confortável já tinha corrigido isso
                  (`LeadCardMetrics`, `checklistInteractive = !!leadId`); o card
                  do funil ficou para trás. E checklist com zero itens conta
                  0/0: existia no banco e sumia da tela. */}
              {lead.leadId ? (
                <LeadCardChecklistPopover
                  leadId={lead.leadId}
                  completed={feitos}
                  total={totalCk}
                  triggerClassName="rounded hover:bg-muted/50"
                >
                  <Linha icone={<ClipboardList className="size-[13px]" />} vazio="Sem atividades">
                    <span className={cn(tudoFeito && "text-emerald-500")}>{atividades}</span>
                  </Linha>
                </LeadCardChecklistPopover>
              ) : (
                <Linha icone={<ClipboardList className="size-[13px]" />} vazio="Sem atividades">
                  {atividades}
                </Linha>
              )}
            </div>

            {/* ── A LATERAL DE AÇÕES ──
                No print os dois botões ficam no MEIO da lista, à direita — não
                no topo. São eles: WhatsApp e o "⊕" de opções.

                A coluna é INCONDICIONAL. Antes ela só existia com telefone
                válido (`temZap`), e sumia inteira num lead sem celular — o que
                no print não acontece, porque é o "⊕" que segura a coluna. */}
            <div className="flex shrink-0 flex-col items-center justify-center gap-1">
              {temZap && acaoWhatsapp}

              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    // dnd-kit: abrir o menu não pode iniciar arrasto.
                    onPointerDown={(e) => e.stopPropagation()}
                    aria-label={`Opções de ${lead.name}`}
                    title="Opções"
                    className={cn(
                      "grid size-[26px] shrink-0 place-items-center rounded-md",
                      "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                      "data-[state=open]:bg-muted data-[state=open]:text-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
                    )}
                  >
                    <PlusCircle className="size-[15px]" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="max-h-[min(420px,70vh)] w-56 overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  {menuAdicionar ?? menuItems}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* ── 4. os badges que o produto já tinha (origem, tempo, alertas) ── */}
          <div className="flex flex-wrap items-center gap-1">
            <Badge style={{ backgroundColor: origin.bg, color: origin.text, borderColor: `${origin.text}40` }}>
              {origin.label}
            </Badge>

            {urgency && <Badge className={urgency.className}>{urgency.label}</Badge>}

            {lead.potencial && (
              <Badge className="border-primary/25 bg-primary/10 text-primary">
                {lead.potencial.charAt(0).toUpperCase() + lead.potencial.slice(1)}
              </Badge>
            )}

            {lead.isInactive && (
              <Badge className="border-destructive/30 bg-destructive/10 text-destructive">Inativo</Badge>
            )}

            {dateIndicator && <Badge className={dateIndicator.className}>{dateIndicator.label}</Badge>}

            {diasParado != null && diasParado >= 3 && (
              <Badge
                className={cn(
                  diasParado >= 14 ? "border-red-500/30 bg-red-500/10 text-red-500"
                    : diasParado >= 7 ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
                    : "border-blue-500/30 bg-blue-500/10 text-blue-500",
                )}
              >
                {diasParado}d parado
              </Badge>
            )}

            {lead.createdAt && (
              <Badge className="border-muted-foreground/20 bg-muted-foreground/10 font-medium text-muted-foreground">
                <Clock className="size-[9px]" />
                {formatDistanceToNowStrict(new Date(lead.createdAt), { addSuffix: true, locale: ptBR })}
              </Badge>
            )}

            {/* A porta das etiquetas fica NESTA linha, e não junto das pílulas
                do rodapé, por uma razão de layout: a linha de badges existe
                sempre (a origem nunca falta), enquanto o rodapé só aparece
                quando o lead já tem etiqueta. No rodapé, o botão obrigaria a
                desenhar uma faixa vazia em todo card sem etiqueta — mais 22px
                em cada um dos 30 de uma coluna — ou a mudar de lugar conforme
                o lead, que é pior: some a posição que a mão já decorou.

                Sem `leadId` não há em quem pendurar: `id` aqui é da ENTRADA no
                funil, não do lead. Botão que escreveria no id errado é pior que
                botão ausente. */}
            {lead.leadId && (
              <LeadEtiquetasPopover
                leadId={lead.leadId}
                quantidade={lead.tags?.length ?? 0}
                rotulo={lead.tags?.length ? undefined : "etiqueta"}
              />
            )}
          </div>

          {config.showNotes && lead.notes && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="max-w-full truncate text-[10px] leading-[1.4] text-muted-foreground">
                  {lead.notes}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-[10px]">{lead.notes}</TooltipContent>
            </Tooltip>
          )}

          {config.showMeetLink && lead.meetLink && (
            <a
              href={lead.meetLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[10px] font-semibold text-primary hover:underline"
            >
              Entrar no Meet
            </a>
          )}

          {extraActions}

          {/* ── 5. divisória + etiquetas COM NOME, no rodapé ── */}
          {lead.tags && lead.tags.length > 0 && (
            <div className="mt-px border-t border-border/40 pt-1.5">
              <LeadCardLabels tags={lead.tags} />
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
});
