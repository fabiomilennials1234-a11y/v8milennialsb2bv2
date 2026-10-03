import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageSquarePlus, Pencil, Send, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadCardEvent, TipoDeEvento } from "./types";

/**
 * Histórico — a coisa mais densa que o sistema sabe sobre uma pessoa.
 *
 * Medido em prod: `lead_history` tem **321.721 linhas em 75,6% dos leads**,
 * mais 48.555 movimentações de negócio em 95%. Ganha a maior área do card.
 *
 * ⚠️ **73% dessas linhas são tráfego de WhatsApp** — `whatsapp_sent` e
 * `whatsapp_received` somam 235.484. Sem filtro, a história de qualquer lead
 * vira parede de mensagem e a pessoa desiste de ler. Os chips não são conforto,
 * são o que torna a seção utilizável.
 *
 * Movimentação de negócio aparece AQUI, e não é contradição com o corte
 * Lead↔Negócio: narrativa é da relação, controle é do negócio. Você lê "movido
 * para Proposta enviada" na história da pessoa; você move no card dele.
 *
 * ── COMENTÁRIO É EVENTO DE PRIMEIRA CLASSE ────────────────────────────────
 * O chip "Comentários" existe desde o primeiro dia desta ficha, mas as linhas
 * que ele filtrava vinham de `lead_history` e diziam só **"Comentário
 * adicionado"** — o texto que a equipe escreveu não estava em lugar nenhum da
 * tela. Quem trabalha pela aba de Leads perdeu o histórico inteiro no corte
 * Lead↔Negócio, porque o bloco de comentário passou a existir só dentro do
 * painel do Negócio.
 *
 * Agora o evento de comentário chega com o corpo INTEIRO (`evento.comentario`)
 * e é o único que ganha ação dentro do histórico: editar e apagar. É uma
 * exceção deliberada à regra "histórico é leitura" — o comentário é a única
 * linha daqui que uma pessoa escreveu à mão e portanto a única que ela pode ter
 * escrito errado.
 */

/**
 * O ponto de cada evento na linha do tempo (mockup V5, `.tl`) — cor por tipo,
 * semântica e não decorativa: dá para varrer sem ler. Só tokens. O ouro marca o
 * que a automação/Copilot fez; tinta, o que mexeu no negócio; âmbar cheio, o que
 * uma pessoa escreveu à mão — numa parede de tráfego de WhatsApp, é o que
 * precisa saltar.
 */
const PONTO: Record<TipoDeEvento, string> = {
  lead: "border-foreground/45 bg-card",
  negocio: "border-foreground bg-card",
  campo: "border-muted-foreground/35 bg-card",
  mensagem: "border-insights bg-card",
  comentario: "border-warning bg-warning",
  automacao: "border-primary bg-primary",
};

const FILTROS: { chave: TipoDeEvento | "todos"; rotulo: string }[] = [
  { chave: "todos", rotulo: "Tudo" },
  { chave: "negocio", rotulo: "Negócios" },
  { chave: "campo", rotulo: "Campos" },
  { chave: "mensagem", rotulo: "Mensagens" },
  { chave: "comentario", rotulo: "Comentários" },
  { chave: "automacao", rotulo: "Automações" },
];

function quando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Monta a frase com os realces em destaque. O evento traz `texto` com `{0}` e
 * a lista `realces` separada — o card nunca faz parsing de frase pronta, que é
 * como nasce bug de exibição com chave dentro.
 */
function Frase({ evento }: { evento: LeadCardEvent }) {
  const partes = useMemo(() => {
    const out: Array<{ t: string; realce: boolean }> = [];
    const regex = /\{(\d+)\}/g;
    let ultimo = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(evento.texto)) !== null) {
      if (m.index > ultimo) out.push({ t: evento.texto.slice(ultimo, m.index), realce: false });
      out.push({ t: evento.realces?.[Number(m[1])] ?? "", realce: true });
      ultimo = m.index + m[0].length;
    }
    if (ultimo < evento.texto.length) out.push({ t: evento.texto.slice(ultimo), realce: false });
    return out;
  }, [evento]);

  return (
    <span className="text-[13px] leading-snug">
      {partes.map((p, i) =>
        p.realce ? (
          <span key={i} className="font-semibold text-foreground">
            {p.t}
          </span>
        ) : (
          <span key={i} className="text-muted-foreground">
            {p.t}
          </span>
        ),
      )}
    </span>
  );
}

const CAMPO = cn(
  "w-full resize-none rounded-xl border border-input bg-card px-3 py-2",
  "text-[13px] leading-relaxed placeholder:text-muted-foreground/70",
  "transition-colors hover:border-muted-foreground/30",
  "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30",
);

/**
 * O corpo do comentário, e as duas ações que só ele tem.
 *
 * `whitespace-pre-wrap` não é detalhe: comentário de vendedor vem com quebra de
 * linha e lista, e 411 dos 2.909 de prod passam de 200 caracteres. Colapsar
 * quebra devolveria um parágrafo ilegível.
 */
function CorpoDoComentario({
  evento,
  onEditar,
  onApagar,
}: {
  evento: LeadCardEvent;
  onEditar?: (id: string, texto: string) => void | Promise<void>;
  onApagar?: (id: string) => void | Promise<void>;
}) {
  const c = evento.comentario!;
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(c.corpo);
  const [ocupado, setOcupado] = useState(false);

  // O corpo é estado local durante a edição; quando a query volta com o texto
  // novo (ou com outro lead), ele precisa acompanhar — senão a caixa reabre com
  // a versão velha.
  useEffect(() => {
    if (!editando) setRascunho(c.corpo);
  }, [c.corpo, editando]);

  const salvar = async () => {
    const limpo = rascunho.trim();
    if (!limpo || limpo === c.corpo) {
      setEditando(false);
      return;
    }
    setOcupado(true);
    try {
      await onEditar?.(c.id, limpo);
      setEditando(false);
    } catch {
      // O container já avisou. A caixa fica aberta com o texto — fechar aqui
      // apagaria a edição que a pessoa acabou de digitar.
    } finally {
      setOcupado(false);
    }
  };

  if (editando) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          rows={3}
          aria-label="Editar comentário"
          className={CAMPO}
        />
        <div className="flex items-center justify-end gap-2 text-[12px]">
          <button
            type="button"
            onClick={() => {
              setRascunho(c.corpo);
              setEditando(false);
            }}
            className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={ocupado || !rascunho.trim()}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-input bg-card px-2.5 py-1 font-semibold shadow-relevo",
              "transition-colors hover:border-foreground/20",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-45",
            )}
          >
            {ocupado && <Loader2 className="size-3 animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-xl bg-warning/[0.08] px-3 py-2">
      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground">
        {c.corpo}
      </p>
      {(c.podeEditar || c.podeApagar) && (
        <div className="flex shrink-0 items-center gap-0.5">
          {c.podeEditar && onEditar && (
            <button
              type="button"
              onClick={() => setEditando(true)}
              aria-label="Editar comentário"
              className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          {c.podeApagar && onApagar && (
            <button
              type="button"
              onClick={() => void onApagar(c.id)}
              aria-label="Apagar comentário"
              className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function LeadCardHistory({
  eventos,
  onComentar,
  onEditarComentario,
  onApagarComentario,
  comentando,
}: {
  eventos: LeadCardEvent[];
  /**
   * Ausente quando não há onde gravar — sem org conhecida o INSERT falharia na
   * policy. O histórico continua inteiro e legível; some só a caixa de
   * escrever, pela mesma regra do "+ Adicionar produto" no painel do Negócio.
   */
  onComentar?: (texto: string) => void | Promise<void>;
  onEditarComentario?: (id: string, texto: string) => void | Promise<void>;
  onApagarComentario?: (id: string) => void | Promise<void>;
  comentando?: boolean;
}) {
  const [filtro, setFiltro] = useState<TipoDeEvento | "todos">("todos");
  const [escrevendo, setEscrevendo] = useState(false);
  const [texto, setTexto] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);
  const visiveis = filtro === "todos" ? eventos : eventos.filter((e) => e.tipo === filtro);

  const publicar = async () => {
    const limpo = texto.trim();
    if (!limpo || comentando) return;
    // Só esvazia depois do sucesso: engolir o erro e limpar a caixa apagaria o
    // que a pessoa escreveu, que é o pior desfecho possível aqui.
    try {
      await onComentar?.(limpo);
    } catch {
      return;
    }
    setTexto("");
    setEscrevendo(false);
  };

  const quantos = (chave: TipoDeEvento | "todos") =>
    chave === "todos" ? eventos.length : eventos.filter((e) => e.tipo === chave).length;

  return (
    <div className="flex flex-col gap-3">
      {/* O filtro segmentado do mockup. Tipo sem evento some — chip que filtra
          para o vazio ensina a não clicar em nenhum. */}
      <div
        role="group"
        aria-label="Filtrar histórico"
        className="flex flex-wrap items-center gap-0.5 self-start rounded-[18px] bg-muted p-[3px]"
      >
        {FILTROS.map((f) => {
          const ativo = filtro === f.chave;
          const n = quantos(f.chave);
          if (n === 0 && f.chave !== "todos") return null;
          return (
            <button
              key={f.chave}
              type="button"
              aria-pressed={ativo}
              onClick={() => setFiltro(f.chave)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-[background-color,color,box-shadow]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ativo ? "bg-card text-foreground shadow-relevo" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.rotulo}
              <span className="tabular-nums opacity-55">{n}</span>
            </button>
          );
        })}
      </div>

      {visiveis.length > 0 ? (
        <ol className="relative flex flex-col gap-3.5 rounded-[18px] border border-card-border bg-card px-3.5 py-3.5 shadow-relevo">
          {/* O fio da linha do tempo vive no container, não em cada evento:
              assim não sobra antes do primeiro nem depois do último. */}
          <span
            className="pointer-events-none absolute bottom-5 left-[21px] top-5 w-0.5 rounded-full bg-border"
            aria-hidden="true"
          />
          {visiveis.map((e) => (
            <li key={e.id} className="relative flex gap-3 pl-6">
              <span
                className={cn("absolute left-0 top-1 size-3 rounded-full border-[2.5px]", PONTO[e.tipo])}
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {e.comentario ? (
                  <CorpoDoComentario
                    evento={e}
                    onEditar={onEditarComentario}
                    onApagar={onApagarComentario}
                  />
                ) : (
                  <Frase evento={e} />
                )}
                <span className="flex min-w-0 items-center gap-1 text-[11.5px] text-muted-foreground">
                  <span className="truncate">{e.autor ?? "Sistema"}</span>
                  {e.comentario?.editadoEm && <span className="shrink-0 opacity-70">· editado</span>}
                </span>
              </div>
              <time
                dateTime={e.quando}
                className="shrink-0 pt-px text-[11px] tabular-nums text-muted-foreground/80"
              >
                {quando(e.quando)}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-[18px] border border-dashed border-border py-8 text-center text-[13px] text-muted-foreground">
          Nada deste tipo no histórico.
        </p>
      )}

      {/* O campo de comentar fica no PÉ, como no mockup — é onde se escreve
          depois de ler. Começa como um campo fechado (o botão "Comentário") e
          abre a caixa no clique; o resto é o mesmo de antes. */}
      {onComentar && !escrevendo && (
        <button
          type="button"
          onClick={() => {
            setEscrevendo(true);
            // O foco tem de esperar o campo existir.
            window.setTimeout(() => campo.current?.focus(), 0);
          }}
          className={cn(
            "flex h-11 w-full items-center gap-2.5 rounded-2xl border border-input bg-card px-3.5 text-left text-[13px] shadow-relevo",
            "transition-colors hover:border-foreground/20",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <MessageSquarePlus className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-semibold">Comentário</span>
          <span aria-hidden="true" className="truncate text-muted-foreground">
            · escreva para a equipe
          </span>
        </button>
      )}

      {onComentar && escrevendo && (
        <div className="flex flex-col gap-2 rounded-2xl border border-card-border bg-card p-3 shadow-relevo">
          <textarea
            ref={campo}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            aria-label="Escrever comentário"
            placeholder="Escreva um comentário para a equipe…"
            className={CAMPO}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void publicar();
              }
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10.5px] text-muted-foreground/55">Ctrl + Enter para publicar</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setTexto("");
                  setEscrevendo(false);
                }}
                aria-label="Cancelar comentário"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void publicar()}
                disabled={!texto.trim() || !!comentando}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-primary-foreground shadow-brilho-ouro",
                  "text-[12.5px] font-semibold transition-colors hover:bg-primary/90",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none",
                )}
              >
                {comentando ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                Comentar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
