import { useEffect, useState } from "react";
import {
  Bot,
  CalendarPlus,
  Mail,
  MapPin,
  MessageCircle,
  Trash2,
  Phone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LeadCardMetrics } from "./LeadCardMetrics";
import { LeadCardDeals } from "./LeadCardDeals";
import { LeadCardNotes } from "./LeadCardNotes";
import { LeadCardFields } from "./LeadCardFields";
import { LeadCardHistory } from "./LeadCardHistory";
import type { LeadCardData } from "./types";

/**
 * O Card do Lead — o centro do sistema.
 *
 * Existem dois cards no Torque inteiro: este e o do Negócio.
 * **Lead e Cliente são o mesmo card** (decisão do CTO; ADR-0023 §8 já pedia
 * isso ao aposentar a Carteira como módulo). Não há segunda tela de gente:
 * a mesma pessoa, com `relacao` diferente.
 *
 * ── ANATOMIA ──────────────────────────────────────────────────────────────
 * Cabeçalho    quem é + os dois fatos + como falar
 * Trilho       a relação (métricas) · negócios · anotações
 * Painel       histórico · dados
 *
 * O trilho carrega o que se consulta de relance e não muda de assunto; o painel
 * carrega o que se lê com atenção. Anotação fica no trilho, sempre aberta, e
 * não numa aba — `notes` está em 74,9% dos leads e `lead_comments` em 4,4%; a
 * diferença mais provável entre os dois é que um está na cara e o outro está
 * atrás de um clique.
 *
 * ── O QUE NÃO ESTÁ AQUI ───────────────────────────────────────────────────
 * Etapa, mover, orçamento, reunião, ganhar/perder. Tudo isso é do Card do
 * Negócio. O critério é tempo de vida: o Lead sobrevive à venda, o Negócio
 * morre com ela.
 */

function Avatar({ nome }: { nome: string }) {
  // Hue estável a partir do nome — mesma pessoa, mesma cor, sempre.
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
  return (
    <div
      style={{ "--h": h } as React.CSSProperties}
      className={cn(
        "flex size-[52px] shrink-0 items-center justify-center rounded-full text-[21px] font-semibold",
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
}: {
  icone: typeof Phone;
  rotulo: string;
  onClick?: () => void;
  desabilitado?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desabilitado}
      title={rotulo}
      aria-label={rotulo}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground",
        "transition-[color,border-color,background-color] hover:border-muted-foreground/40 hover:bg-muted/60 hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-35",
      )}
    >
      <Icone className="size-[15px]" />
    </button>
  );
}

type Aba = "historico" | "negocios" | "dados";

export function LeadCard({
  lead,
  onSaveNote,
  onOpenDeal,
  onNewDeal,
  onSaveField,
  onToggleCopilot,
  onDelete,
  onComentar,
  onEditarComentario,
  onApagarComentario,
  comentando,
  editorDeEtiquetas,
  acaoLigar,
}: {
  lead: LeadCardData;
  /** Persiste a anotação. Sem ela o campo edita mas não grava (visualização). */
  onSaveNote?: (texto: string) => void;
  /** Recebe o `pipeline_entries.id` — abre o card do Negócio. */
  onOpenDeal?: (entryId: string) => void;
  onNewDeal?: () => void;
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
}) {
  const [aba, setAba] = useState<Aba>("historico");
  const [nota, setNota] = useState(lead.nota);

  /**
   * A nota é estado local (para não piscar a cada tecla), então ela PRECISA ser
   * reposta quando o card troca de pessoa. Sem isto, abrir um lead e depois
   * outro mostra a anotação do primeiro no card do segundo — e, no momento em
   * que o campo perde o foco, grava a anotação errada na pessoa errada.
   * Pego na visualização trocando de exemplo.
   */
  useEffect(() => {
    setNota(lead.nota);
    setAba("historico");
  }, [lead.id, lead.nota]);

  const abas: { chave: Aba; rotulo: string; contagem?: number }[] = [
    { chave: "historico", rotulo: "Histórico", contagem: lead.historico.length },
    { chave: "negocios", rotulo: "Negócios", contagem: lead.negocios.length },
    {
      chave: "dados",
      rotulo: "Dados",
      contagem: lead.campos.reduce((s, g) => s + g.campos.length, 0),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
      {/* ── Cabeçalho ─────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-col gap-4 border-b border-border px-6 py-5">
        <div className="flex items-start gap-4">
          <Avatar nome={lead.nome} />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="truncate text-[19px] font-semibold tracking-[-0.02em]">{lead.nome}</h1>

              {/* Relação e Situação, sempre as duas, nunca colapsadas —
                  ADR-0023 §6. 180 leads em prod são Cliente E estão em
                  negociação; um status de valor único esconderia metade da
                  verdade exatamente neles. A tinta vai só no Cliente: "Lead" é
                  94% da base e selo ali seria decoração. */}
              {lead.relacao === "cliente" ? (
                <span
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[12px] font-semibold text-primary"
                  title={
                    lead.prova === "ambas"
                      ? "Comprou pelo funil e tem pedido no ERP"
                      : lead.prova === "erp"
                        ? "Tem pedido no ERP"
                        : "Fechou negócio no funil"
                  }
                >
                  <span className="size-1.5 rounded-full bg-primary" />
                  Cliente
                </span>
              ) : (
                <span className="shrink-0 text-[13px] text-muted-foreground">Lead</span>
              )}

              <span className="h-3 w-px shrink-0 bg-border" aria-hidden="true" />

              {lead.situacao ? (
                <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px]">
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ background: lead.situacao.funilCor }}
                    aria-hidden="true"
                  />
                  <span className="shrink-0 text-foreground/85">Em negociação</span>
                  <span className="truncate text-muted-foreground">· {lead.situacao.funil}</span>
                </span>
              ) : (
                <span className="inline-flex shrink-0 rounded-md border border-dashed border-border px-2 py-0.5 text-[12px] text-muted-foreground">
                  Sem negócio aberto
                </span>
              )}
            </div>

            {lead.empresa && (
              <p className="mt-1 truncate text-[13.5px] text-muted-foreground">{lead.empresa}</p>
            )}

            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-muted-foreground">
              {lead.telefone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5" />
                  {lead.telefone}
                </span>
              )}
              {lead.email && (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Mail className="size-3.5 shrink-0" />
                  <span className="truncate">{lead.email}</span>
                </span>
              )}
              {lead.uf && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5" />
                  {lead.uf}
                </span>
              )}
              {/* O Copilot é interruptor, não rótulo: desligar a IA num lead é
                  a ação de urgência quando o agente responde o que não devia. */}
              <button
                type="button"
                onClick={() => onToggleCopilot?.(!lead.copilotAtivo)}
                disabled={!onToggleCopilot}
                title={lead.copilotAtivo ? "Desligar o Copilot neste lead" : "Ligar o Copilot"}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  onToggleCopilot && "hover:bg-muted hover:text-foreground",
                  !onToggleCopilot && "cursor-default",
                )}
              >
                <Bot
                  className={cn("size-3.5", lead.copilotAtivo ? "text-primary" : "opacity-50")}
                />
                Copilot {lead.copilotAtivo ? "ativo" : "desligado"}
              </button>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <AcaoRapida icone={MessageCircle} rotulo="Abrir conversa" />
            {acaoLigar}
            <AcaoRapida icone={Mail} rotulo="Enviar e-mail" desabilitado={!lead.email} />
            <AcaoRapida icone={CalendarPlus} rotulo="Agendar mensagem" />
            <AcaoRapida
              icone={Trash2}
              rotulo="Excluir lead"
              onClick={onDelete}
              desabilitado={!onDelete}
            />
          </div>
        </div>

        {/* Sempre visível, mesmo sem dono e sem etiqueta. Escondendo a faixa
            quando está vazia, o lead novo — 94% da base — perde justamente os
            dois convites que ele mais precisa: atribuir dono e etiquetar.

            O convite de etiquetar só é convite quando `editorDeEtiquetas` vem:
            até então este lugar tinha um "+ etiqueta" que não abria nada. */}
        <div className="flex flex-wrap items-center gap-1.5">
            {lead.dono ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-[3px] text-[12px]"
                title={lead.dono.papel}
              >
                <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
                {lead.dono.nome}
              </span>
            ) : (
              <span className="inline-flex rounded-full border border-dashed border-border px-2.5 py-[3px] text-[12px] text-muted-foreground">
                Sem dono
              </span>
            )}
            {editorDeEtiquetas ??
              lead.tags.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex rounded-full border border-border bg-muted/50 px-2.5 py-[3px] text-[12px] text-muted-foreground"
                >
                  {t.nome}
                </span>
              ))}
        </div>
      </header>

      {/* ── Corpo ─────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Trilho: consulta de relance, assunto fixo.
            A anotação NÃO rola junto. Ela mora ancorada no pé, sempre visível e
            sempre editável — se ela some abaixo da dobra, "espaço para
            anotação" vira promessa. Rola só o que está acima dela.

            Negócios saiu daqui para a aba própria: a linha do negócio carrega
            funil, barra de etapa, tempo em aberto e tempo parado, e isso não
            cabe em 348px sem truncar justo o que é acionável. O cabeçalho já
            responde "o que está acontecendo" com a Situação. */}
        <aside className="flex w-[348px] shrink-0 flex-col border-r border-border">
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
            <LeadCardMetrics metricas={lead.metricas} />
          </div>
          <div className="shrink-0 border-t border-border px-5 py-4">
            <LeadCardNotes
              valor={nota}
              onSave={(texto) => {
                setNota(texto);
                onSaveNote?.(texto);
              }}
            />
          </div>
        </aside>

        {/* Painel: leitura com atenção */}
        <div className="flex min-w-0 flex-1 flex-col">
          <nav className="flex shrink-0 items-center gap-1 border-b border-border px-5">
            {abas.map((a) => {
              const ativo = aba === a.chave;
              return (
                <button
                  key={a.chave}
                  type="button"
                  onClick={() => setAba(a.chave)}
                  className={cn(
                    "relative px-3 py-3 text-[13.5px] transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    ativo ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {a.rotulo}
                  {a.contagem !== undefined && (
                    <span className="ml-1.5 text-[11.5px] tabular-nums text-muted-foreground/60">
                      {a.contagem}
                    </span>
                  )}
                  {/* O ouro só aparece no que está valendo. */}
                  {ativo && (
                    <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {aba === "historico" && (
              <LeadCardHistory
                eventos={lead.historico}
                onComentar={onComentar}
                onEditarComentario={onEditarComentario}
                onApagarComentario={onApagarComentario}
                comentando={comentando}
              />
            )}
            {aba === "negocios" && (
              <LeadCardDeals
                negocios={lead.negocios}
                onOpenDeal={(id) => onOpenDeal?.(id)}
                onNewDeal={() => onNewDeal?.()}
              />
            )}
            {aba === "dados" && <LeadCardFields grupos={lead.campos} onSave={onSaveField} />}
          </div>
        </div>
      </div>
    </div>
  );
}
