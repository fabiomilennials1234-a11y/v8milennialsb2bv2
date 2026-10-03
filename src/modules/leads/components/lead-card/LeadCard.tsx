import { useEffect, useState } from "react";
import { Bot, CalendarPlus, Mail, MessageCircle, Trash2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { LeadCardMetrics } from "./LeadCardMetrics";
import { LeadCardDeals } from "./LeadCardDeals";
import { LeadCardNotes } from "./LeadCardNotes";
import { LeadCardFields } from "./LeadCardFields";
import { LeadCardHistory } from "./LeadCardHistory";
import type { LeadCardData } from "./types";

/**
 * O Card do Lead — a gaveta da pessoa no formato do mockup V5.
 *
 * Existem dois cards no Torque inteiro: este e o do Negócio — e no V5 eles
 * vivem na MESMA gaveta. **Lead e Cliente são o mesmo card** (decisão do CTO;
 * ADR-0023 §8): a mesma pessoa, com `relacao` diferente.
 *
 * ── ANATOMIA (mockup `leads.js`, `T.openLead`) ────────────────────────────
 * Cabeçalho  avatar, nome, empresa · relação · situação; a fileira de ações
 *            (Abrir conversa em tinta, Ligar, …) e a faixa do Copilot.
 * Abas       Dados · Negócios · Histórico, segmentadas. Abre em Dados.
 * Dados      relação (tinta para quem comprou), responsáveis e qualificação,
 *            etiquetas, anotações e o perfil chave-valor.
 * Negócios   o negócio mais avançado no cartão de ouro, os outros abaixo.
 * Histórico  filtro, linha do tempo e comentário da equipe.
 *
 * O cabeçalho NÃO rola: o interruptor do Copilot é a ação de urgência de
 * quando o agente responde o que não devia, e ele não pode ficar atrás de aba
 * nem abaixo da dobra (`lead-card-cabecalho.test.tsx`).
 *
 * ── O QUE NÃO ESTÁ AQUI ───────────────────────────────────────────────────
 * Etapa, mover, orçamento, reunião, ganhar/perder. Tudo isso é do Card do
 * Negócio (a aba do meio no modo `negocio`). O critério é tempo de vida: o
 * Lead sobrevive à venda, o Negócio morre com ela.
 */

/** O cartão branco da gaveta — a bancada fica atrás, os cartões na frente. */
const CARTAO = "rounded-[18px] border border-card-border bg-card px-3.5 py-3 shadow-relevo";
const ROTULO = "text-[10.5px] font-bold uppercase tracking-[.08em] text-muted-foreground";

function Avatar({ nome }: { nome: string }) {
  // Hue estável a partir do nome — mesma pessoa, mesma cor, sempre.
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
  return (
    <div
      style={{ "--h": h } as React.CSSProperties}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full text-[17px] font-bold",
        "bg-[hsl(var(--h)_70%_92%)] text-[hsl(var(--h)_55%_32%)]",
        "dark:bg-[hsl(var(--h)_42%_22%)] dark:text-[hsl(var(--h)_58%_74%)]",
      )}
      aria-hidden="true"
    >
      {(nome || "?").trim().charAt(0).toUpperCase()}
    </div>
  );
}

function AcaoRapida({
  icone: Icone,
  rotulo,
  onClick,
  desabilitado,
  perigo,
}: {
  icone: LucideIcon;
  rotulo: string;
  onClick?: () => void;
  desabilitado?: boolean;
  perigo?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      title={rotulo}
      aria-label={rotulo}
      className={cn(
        // V5: o botão de ícone é quadrado arredondado sobre o cartão, com relevo.
        "flex size-10 shrink-0 items-center justify-center rounded-xl border border-input bg-card text-muted-foreground shadow-relevo",
        "transition-[color,border-color,transform] hover:-translate-y-px hover:border-foreground/20 hover:text-foreground",
        perigo && "hover:border-destructive/40 hover:text-destructive",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-35 disabled:shadow-none",
      )}
    >
      <Icone className="size-4" />
    </button>
  );
}

/**
 * O alternador segmentado do mockup (`T.seg`) — em BOTÕES, não em `Tabs`.
 *
 * O primitivo `TabsList variant="segmented"` é Radix e dá `role="tab"`; as
 * abas desta ficha são `button` por contrato (os testes do card as acham assim
 * desde o primeiro desenho). Mesmo desenho do primitivo, mesmo papel de antes.
 */
function Segmentado<T extends string>({
  itens,
  ativa,
  onTrocar,
  rotulo,
}: {
  itens: { chave: T; rotulo: string; contagem?: number }[];
  ativa: T;
  onTrocar: (chave: T) => void;
  rotulo: string;
}) {
  return (
    <div role="group" aria-label={rotulo} className="inline-flex items-center gap-0.5 rounded-full bg-muted p-[3px]">
      {itens.map((i) => {
        const acesa = i.chave === ativa;
        return (
          <button
            key={i.chave}
            type="button"
            aria-pressed={acesa}
            onClick={() => onTrocar(i.chave)}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold",
              "transition-[background-color,color,box-shadow] duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              acesa ? "bg-card text-foreground shadow-relevo" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {i.rotulo}
            {i.contagem !== undefined && i.contagem > 0 && (
              <span className="text-[11px] font-bold tabular-nums opacity-55">{i.contagem}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A faixa do Copilot — interruptor, não rótulo.
 *
 * É um `button` (e não `role="switch"`) porque o contrato do card o acha assim,
 * e o nome acessível diz o ESTADO ATUAL ("Copilot ativo" / "Copilot desligado"):
 * quem lê "ativo" tem de estar vendo a IA ligada. `aria-pressed` carrega o
 * mesmo estado para o leitor de tela. O clique manda o estado NOVO — a dupla
 * negação até `useToggleLeadAI` é guardada em `lead-card-cabecalho.test.tsx`.
 */
function FaixaCopilot({ ativo, onToggle }: { ativo: boolean; onToggle?: (ativo: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle?.(!ativo)}
      disabled={!onToggle}
      aria-pressed={ativo}
      title={ativo ? "Desligar o Copilot neste lead" : "Ligar o Copilot neste lead"}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-2xl border border-card-border bg-card px-3.5 py-2.5 text-left shadow-relevo",
        "transition-[border-color] hover:border-foreground/15",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-default disabled:hover:border-card-border",
      )}
    >
      <Bot className={cn("size-4 shrink-0", ativo ? "text-foreground" : "text-muted-foreground")} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[13px]">
        {/* O nome acessível vem inteiro do `sr-only`: o cálculo de nome junta
            os nós sem espaço, e "Copilot" + "ativo" virava "Copilotativo". */}
        <span className="sr-only">{ativo ? "Copilot ativo" : "Copilot desligado"}</span>
        <span aria-hidden="true" className="font-bold">Copilot</span>
        <span aria-hidden="true" className="text-muted-foreground">
          {" "}· {ativo ? "atendendo este lead" : "desligado para este lead"}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200",
          ativo ? "bg-primary" : "bg-input",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-background shadow-sm transition-transform duration-200 ease-standard",
            ativo ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

type Aba = "dados" | "negocios" | "historico";

export function LeadCard({
  lead,
  onSaveNote,
  onOpenDeal,
  onNewDeal,
  registrarVenda,
  onSaveField,
  onToggleCopilot,
  onDelete,
  onComentar,
  onEditarComentario,
  onApagarComentario,
  comentando,
  editorDeEtiquetas,
  acaoLigar,
  onOpenChat,
  controles,
  modo = "ficha",
  abaInicial,
  painelNegocios,
}: {
  lead: LeadCardData;
  /** Persiste a anotação. Sem ela o campo edita mas não grava (visualização). */
  onSaveNote?: (texto: string) => void;
  /** Recebe o `pipeline_entries.id` — abre o card do Negócio. */
  onOpenDeal?: (entryId: string) => void;
  onNewDeal?: () => void;
  registrarVenda?: React.ReactNode;
  /** Persiste um campo do bloco Dados. Sem ela o bloco fica só de leitura. */
  onSaveField?: (chave: string, valor: string) => Promise<void>;
  onToggleCopilot?: (ativo: boolean) => void;
  onDelete?: () => void;
  /**
   * Comentário da equipe, dentro do Histórico. As três são opcionais pela mesma
   * razão das de cima: sem elas a ficha continua mostrando o histórico inteiro,
   * só não deixa escrever — que é o certo quando não se sabe sob qual org
   * gravar.
   */
  onComentar?: (texto: string) => void | Promise<void>;
  onEditarComentario?: (id: string, texto: string) => void | Promise<void>;
  onApagarComentario?: (id: string) => void | Promise<void>;
  comentando?: boolean;
  /**
   * A faixa de etiquetas QUE ESCREVE, montada pronta pelo `LeadCardContainer`.
   *
   * Aqui havia um `+ etiqueta` sem `onClick` — botão morto desde o primeiro
   * commit do card. Ele não podia ser ligado neste arquivo: `LeadCard.tsx` é
   * alcançável a partir de `src/preview/main.tsx`, e
   * `preview-cards-sem-banco.test.ts` reprova qualquer arquivo daquele grafo
   * que alcance react-query ou o Supabase. Mesmo escape de `onSaveField`: quem
   * tem o banco entrega o controle pronto. Sem a prop ficam só as pílulas de
   * leitura — e nenhum botão, porque botão que não faz nada é pior que a
   * ausência dele.
   */
  editorDeEtiquetas?: React.ReactNode;
  /**
   * O botão de LIGAR, montado pronto por quem tem o banco (`VoiceCallButton`,
   * variante ícone) — mesmo escape de `editorDeEtiquetas`: este arquivo é
   * alcançável a partir de `src/preview/main.tsx` e não pode importar o
   * provider de voz, que lê react-query e Supabase.
   *
   * Aqui havia um `AcaoRapida` "Ligar" sem `onClick` — botão morto desde o
   * primeiro commit do card, desabilitado por `!lead.telefone` e nada mais.
   * Sem a prop não fica nada no lugar: botão que não faz nada é pior que a
   * ausência dele, e o `VoiceCallButton` já some sozinho quando não há número
   * de voz ao alcance — a mesma regra do chat.
   */
  acaoLigar?: React.ReactNode;
  onOpenChat?: () => void;
  /**
   * Responsáveis e qualificação QUE ESCREVEM (`LeadCardControles` em grade),
   * montados por quem tem banco — mesmo escape de `editorDeEtiquetas`. Sem a
   * prop, a aba Dados mostra só o dono, de leitura.
   */
  controles?: React.ReactNode;
  /**
   * `ficha` é a gaveta da pessoa (a lista de Leads abre esta). `negocio` é a
   * MESMA gaveta aberta pelo cartão do funil: o nome da pessoa deixa de ser o
   * `h1` (o título da tela é o do negócio), a lixeira do lead sai do cabeçalho
   * — excluir ali tem de ser do negócio — e a aba do meio passa a ser o
   * negócio aberto (`painelNegocios`).
   */
  modo?: "ficha" | "negocio";
  abaInicial?: Aba;
  /** O conteúdo da aba do meio no modo `negocio` — o card do Negócio. */
  painelNegocios?: React.ReactNode;
}) {
  const inicial: Aba = abaInicial ?? "dados";
  const [aba, setAba] = useState<Aba>(inicial);
  const [nota, setNota] = useState(lead.nota);

  /**
   * A nota é estado local (para não piscar a cada tecla), então ela PRECISA ser
   * reposta quando o card troca de pessoa. Sem isto, abrir um lead e depois
   * outro mostra a anotação do primeiro no card do segundo — e, no momento em
   * que o campo perde o foco, grava a anotação errada na pessoa errada.
   */
  useEffect(() => {
    setNota(lead.nota);
  }, [lead.id, lead.nota]);

  /**
   * A aba volta ao início SÓ quando a pessoa troca. Juntas com a nota, gravar
   * a anotação (que refaz a leitura) jogaria quem está no Negócio de volta
   * para Dados no meio do trabalho.
   */
  useEffect(() => {
    setAba(inicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  const noNegocio = modo === "negocio";
  const Titulo = noNegocio ? "h2" : "h1";

  const abas: { chave: Aba; rotulo: string; contagem?: number }[] = [
    { chave: "dados", rotulo: "Dados" },
    noNegocio
      ? { chave: "negocios", rotulo: "Negócio" }
      : { chave: "negocios", rotulo: "Negócios", contagem: lead.negocios.length },
    { chave: "historico", rotulo: "Histórico", contagem: lead.historico.length },
  ];

  return (
    // Sem moldura própria: quem emoldura é a casca (`GavetaLateral`, raio 28).
    // O fundo é a BANCADA; os blocos da gaveta são cartões brancos sobre ela.
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[inherit] bg-background">
      <header className="flex shrink-0 flex-col gap-3 px-4 pb-3 pt-4 sm:px-5">
        {/* `pr-10`: o "×" da casca mora em `right-4 top-4`. */}
        <div className="flex items-center gap-3 pr-10">
          <Avatar nome={lead.nome} />
          <div className="min-w-0 flex-1">
            <Titulo className="truncate text-[17px] font-bold leading-tight tracking-[-0.02em]">
              {lead.nome}
            </Titulo>
            <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-muted-foreground">
              {lead.empresa && <span className="max-w-full truncate">{lead.empresa}</span>}
              {/* Relação e Situação, sempre as duas (ADR-0023 §6): 180 leads em
                  prod são Cliente E estão em negociação. A pílula vai só em
                  Cliente e Perdido — "Lead" é 94% da base, selo ali é enfeite. */}
              {lead.relacao === "cliente" && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-2 py-px text-[11px] font-bold text-primary-soft-foreground"
                  title={
                    lead.prova === "ambas"
                      ? "Comprou pelo funil e tem pedido no ERP"
                      : lead.prova === "erp"
                        ? "Tem pedido no ERP"
                        : "Fechou negócio no funil"
                  }
                >
                  <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                  Cliente
                </span>
              )}
              {lead.relacao === "perdido" && (
                <span className="inline-flex shrink-0 rounded-full bg-muted px-2 py-px text-[11px] font-bold text-foreground/75">
                  Perdido
                </span>
              )}
              {lead.situacao ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: lead.situacao.funilCor }}
                    aria-hidden="true"
                  />
                  <span className="truncate">Em negociação · {lead.situacao.funil}</span>
                </span>
              ) : (
                <span className="shrink-0 text-muted-foreground/80">Sem negócio aberto</span>
              )}
            </p>
          </div>
          {!noNegocio && (
            <AcaoRapida icone={Trash2} rotulo="Excluir lead" onClick={onDelete} desabilitado={!onDelete} perigo />
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenChat}
            disabled={!onOpenChat || !lead.telefone?.trim()}
            className={cn(
              "inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-tinta px-4 text-[13px] font-bold text-tinta-foreground",
              "transition-[background-color,transform] hover:bg-tinta-3 active:scale-[.98]",
              "dark:bg-foreground dark:text-background dark:hover:bg-foreground/90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            Abrir conversa
          </button>
          {acaoLigar}
          {/* Os dois abaixo vieram do card antigo sem ação ligada (HERDADO).
              Ficam só na ficha — o painel do Negócio não ganha botão morto. */}
          {!noNegocio && <AcaoRapida icone={CalendarPlus} rotulo="Agendar mensagem" />}
          {!noNegocio && <AcaoRapida icone={Mail} rotulo="Enviar e-mail" desabilitado={!lead.email} />}
        </div>

        <FaixaCopilot ativo={lead.copilotAtivo} onToggle={onToggleCopilot} />
      </header>

      <nav className="shrink-0 px-4 pb-3 sm:px-5">
        <Segmentado rotulo="Seções da ficha" itens={abas} ativa={aba} onTrocar={setAba} />
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 sm:px-5">
        {aba === "dados" && (
          <div className="flex flex-col gap-3">
            <LeadCardMetrics metricas={lead.metricas} />

            {controles ?? (
              <div className={CARTAO}>
                <span className={ROTULO}>Responsável</span>
                <p className={cn("mt-1.5 truncate text-[13.5px]", lead.dono ? "font-bold" : "text-muted-foreground")}>
                  {lead.dono ? lead.dono.nome : "Sem dono"}
                </p>
              </div>
            )}

            <section className={cn(CARTAO, "flex flex-col gap-2")}>
              <h3 className={ROTULO}>Etiquetas</h3>
              {/* Com o editor, as pílulas saem daqui e vêm de lá: duas listas
                  da mesma coisa, uma que reage e outra não, é o defeito. Sem
                  ele, só leitura — e nenhum botão que não faz nada. */}
              {editorDeEtiquetas ?? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {lead.tags.map((t) => (
                    <span
                      key={t.id}
                      className="inline-flex rounded-full bg-muted px-2.5 py-[3px] text-[12px] font-medium text-foreground/80"
                    >
                      {t.nome}
                    </span>
                  ))}
                  {lead.tags.length === 0 && (
                    <span className="text-[12px] text-muted-foreground">sem etiqueta</span>
                  )}
                </div>
              )}
            </section>

            {/* A anotação fica na aba que ABRE: `notes` está em 74,9% dos leads,
                o campo mais escrito do produto depois de nome e telefone. */}
            <div className={CARTAO}>
              <LeadCardNotes
                valor={nota}
                onSave={(texto) => {
                  setNota(texto);
                  onSaveNote?.(texto);
                }}
              />
            </div>

            <div className={CARTAO}>
              {/* `key`: a edição em linha guarda o valor salvo até o refetch;
                  sem reiniciar por pessoa, o nome gravado em um lead aparecia
                  no campo do próximo (a aba Dados agora fica aberta na troca). */}
              <LeadCardFields key={lead.id} grupos={lead.campos} onSave={onSaveField} />
            </div>
          </div>
        )}
        {/* O negócio fica MONTADO quando se troca de aba: o rascunho de
            comentário e o anexo subindo vivem nele, e ir conferir um dado da
            pessoa não pode apagar o que se estava escrevendo. */}
        {painelNegocios ? (
          <div hidden={aba !== "negocios"} className="h-full">
            {painelNegocios}
          </div>
        ) : (
          aba === "negocios" && (
            <LeadCardDeals
              negocios={lead.negocios}
              principal={lead.situacao?.negocioId}
              registrarVenda={registrarVenda}
              onOpenDeal={(id) => onOpenDeal?.(id)}
              onNewDeal={() => onNewDeal?.()}
            />
          )
        )}
        {aba === "historico" && (
          <LeadCardHistory
            eventos={lead.historico}
            onComentar={onComentar}
            onEditarComentario={onEditarComentario}
            onApagarComentario={onApagarComentario}
            comentando={comentando}
          />
        )}
      </div>
    </div>
  );
}
