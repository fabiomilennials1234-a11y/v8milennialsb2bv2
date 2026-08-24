import { useEffect, useRef, useState } from "react";
import { Check, Loader2, MessageSquare, Pencil, Send, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DealCardComentario } from "./types";

/**
 * Comentários do negócio — o bloco que voltou.
 *
 * ── O QUE ACONTECEU ───────────────────────────────────────────────────────
 * Até 04/08/2026 o funil abria o `DealDetailDialog`, e ele montava a coluna
 * `LeadActivityColumn`, com o composer e o feed de comentários. Os commits
 * `88f87146` e `9b351abb` trocaram aquele diálogo pelo painel de duas colunas
 * do formato DataCrazy nas cinco telas — e a coluna de comentários não foi
 * junto. O componente antigo continua no repositório, exportado pelo barril e
 * montado por ninguém: desde então **não havia caminho de tela algum, em lugar
 * nenhum do produto, para ler ou escrever um comentário**, embora 2.885 deles
 * seguissem gravados.
 *
 * ── POR QUE ELE É BURRO ───────────────────────────────────────────────────
 * `DealCard.tsx` está no grafo de `/preview.html`, e `preview-cards-sem-banco`
 * reprova qualquer arquivo alcançável dali que toque o cliente de banco ou o
 * react-query — a checagem é TEXTUAL, então nem o caminho de um import passa.
 * Por isso quem busca, grava, edita e apaga é o `DealCardPanel`; aqui chegam
 * uma lista e quatro callbacks. É o mesmo contorno que `AdicionarProdutoDialog`
 * já usa, e é o que mantém a bancada de desenho funcionando sem banco.
 *
 * ── AS DUAS REGRAS DE INTERAÇÃO QUE NÃO SÃO ENFEITE ──────────────────────
 * 1. **O texto nunca se perde.** A caixa só esvazia depois que a gravação
 *    volta. Falhou, o que a pessoa escreveu continua lá para ela reenviar —
 *    limpar antes de confirmar é a forma mais barata de perder um comentário.
 * 2. **Apagar confirma no lugar, sem diálogo.** O painel já é um `Dialog`, e
 *    empilhar outro por cima é o que `cards-nunca-empilham` proíbe. O botão
 *    vira "Confirmar/Cancelar" na própria linha.
 */

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

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  return partes
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

/** Mesma derivação do card antigo: cor estável por nome, sem tabela de cores. */
function corDoNome(nome: string): string {
  const soma = Array.from(nome).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return `hsl(${soma % 360}, 55%, 42%)`;
}

const CAMPO =
  "w-full resize-none rounded-lg border border-border bg-card px-3.5 py-2.5 " +
  "text-[13px] leading-relaxed placeholder:text-muted-foreground/70 " +
  "transition-colors hover:border-muted-foreground/30 " +
  "focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30";

function BotaoIcone({
  icone: Icone,
  rotulo,
  onClick,
  tom,
}: {
  icone: typeof Pencil;
  rotulo: string;
  onClick: () => void;
  tom?: "perigo";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      title={rotulo}
      className={cn(
        "rounded p-1 text-muted-foreground/50 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tom === "perigo" ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      <Icone className="size-3.5" />
    </button>
  );
}

function Comentario({
  comentario,
  onEditar,
  onApagar,
}: {
  comentario: DealCardComentario;
  onEditar?: (id: string, texto: string) => void | Promise<void>;
  onApagar?: (id: string) => void | Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(comentario.corpo);
  const [confirmandoApagar, setConfirmandoApagar] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  // Se o comentário mudar por baixo (outra aba gravou, a query refez), a caixa
  // de edição segue o que está salvo em vez de guardar um texto órfão.
  useEffect(() => {
    if (!editando) setRascunho(comentario.corpo);
  }, [comentario.corpo, editando]);

  const salvar = async () => {
    const texto = rascunho.trim();
    if (!texto || texto === comentario.corpo) {
      setEditando(false);
      setRascunho(comentario.corpo);
      return;
    }
    setOcupado(true);
    try {
      await onEditar?.(comentario.id, texto);
      setEditando(false);
    } catch {
      // Quem grava é que avisa (toast no painel). Aqui a caixa fica aberta com
      // o texto novo, que é o que a pessoa precisa para tentar de novo.
    } finally {
      setOcupado(false);
    }
  };

  const apagar = async () => {
    setOcupado(true);
    try {
      await onApagar?.(comentario.id);
      setConfirmandoApagar(false);
    } catch {
      // idem: a confirmação continua aberta em vez de sumir sem ter apagado.
    } finally {
      setOcupado(false);
    }
  };

  const podeEditar = comentario.podeEditar && !!onEditar;
  const podeApagar = comentario.podeApagar && !!onApagar;

  return (
    <li className="group flex gap-2.5" data-comentario-id={comentario.id}>
      <span
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full"
        style={comentario.autorAvatar ? undefined : { background: corDoNome(comentario.autor) }}
        aria-hidden="true"
      >
        {comentario.autorAvatar ? (
          <img src={comentario.autorAvatar} alt="" className="size-full object-cover" />
        ) : (
          <span className="text-[10px] font-semibold text-white">
            {iniciais(comentario.autor)}
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[12.5px] font-medium text-foreground">{comentario.autor}</span>
          {/* Data e hora absolutas, não "há 3 dias": o painel é lido para
              decidir o que fazer hoje, e "há 3 dias" obriga a fazer a conta. */}
          <span className="text-[11.5px] tabular-nums text-muted-foreground/75">
            {quando(comentario.criadoEm)}
          </span>
          {comentario.editadoEm && (
            <span className="text-[11px] text-muted-foreground/60">editado</span>
          )}
          {comentario.deOutroNegocio && (
            <span
              className="max-w-[200px] shrink-0 truncate rounded border border-border bg-muted px-1.5 text-[10.5px] font-medium text-muted-foreground"
              title={`Escrito no negócio "${comentario.deOutroNegocio}"`}
            >
              {comentario.deOutroNegocio}
            </span>
          )}

          {(podeEditar || podeApagar) && !editando && !confirmandoApagar && (
            <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              {podeEditar && (
                <BotaoIcone icone={Pencil} rotulo="Editar comentário" onClick={() => setEditando(true)} />
              )}
              {podeApagar && (
                <BotaoIcone
                  icone={Trash2}
                  rotulo="Apagar comentário"
                  tom="perigo"
                  onClick={() => setConfirmandoApagar(true)}
                />
              )}
            </span>
          )}
        </div>

        {editando ? (
          <div className="mt-1 flex flex-col gap-2">
            <textarea
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              rows={3}
              autoFocus
              aria-label="Editar comentário"
              className={CAMPO}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setRascunho(comentario.corpo);
                  setEditando(false);
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void salvar();
                }
              }}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void salvar()}
                disabled={ocupado}
                className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 px-2.5 py-1 text-[12px] font-medium text-success transition-colors hover:bg-success/10 disabled:pointer-events-none disabled:opacity-45"
              >
                {ocupado ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                Salvar
              </button>
              <button
                type="button"
                onClick={() => {
                  setRascunho(comentario.corpo);
                  setEditando(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3" />
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-border bg-card px-3 py-2 text-[13px] leading-relaxed text-foreground/90">
            {comentario.corpo}
          </p>
        )}

        {confirmandoApagar && (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="text-muted-foreground">Apagar este comentário?</span>
            <button
              type="button"
              onClick={() => void apagar()}
              disabled={ocupado}
              className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-2.5 py-1 font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-45"
            >
              {ocupado ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
              Apagar
            </button>
            <button
              type="button"
              onClick={() => setConfirmandoApagar(false)}
              className="rounded-lg px-2 py-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

export function DealCardComments({
  comentarios,
  onComentar,
  onEditar,
  onApagar,
  enviando,
}: {
  comentarios: DealCardComentario[];
  /**
   * Ausente quando não há onde gravar — o negócio sem lead. Mesma regra do
   * "+ Adicionar produto" no bloco de dinheiro: caixa de escrever cujo envio
   * falharia é pior que caixa nenhuma.
   */
  onComentar?: (texto: string) => void | Promise<void>;
  onEditar?: (id: string, texto: string) => void | Promise<void>;
  onApagar?: (id: string) => void | Promise<void>;
  enviando?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);

  const enviar = async () => {
    const limpo = texto.trim();
    if (!limpo || enviando) return;
    // Só esvazia depois do sucesso — ver a regra 1 no topo do arquivo.
    try {
      await onComentar?.(limpo);
    } catch {
      return;
    }
    setTexto("");
    campo.current?.focus();
  };

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
          Comentários
        </h2>
        {comentarios.length > 0 && (
          <span className="text-[11px] tabular-nums text-muted-foreground/60">
            {comentarios.length}
          </span>
        )}
      </div>

      {onComentar && (
        <div className="flex flex-col gap-2">
          <textarea
            ref={campo}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={2}
            aria-label="Escrever comentário"
            placeholder="Escreva um comentário para a equipe…"
            className={CAMPO}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void enviar();
              }
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10.5px] text-muted-foreground/55">
              Ctrl + Enter para publicar
            </span>
            <button
              type="button"
              onClick={() => void enviar()}
              disabled={!texto.trim() || !!enviando}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5",
                "text-[12.5px] font-medium transition-colors",
                "hover:border-primary/45 hover:text-primary",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                "disabled:pointer-events-none disabled:opacity-45",
              )}
            >
              {enviando ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Comentar
            </button>
          </div>
        </div>
      )}

      {comentarios.length === 0 ? (
        <p className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border py-7 text-center text-[12.5px] text-muted-foreground">
          <MessageSquare className="size-4 text-muted-foreground/40" aria-hidden="true" />
          Nenhum comentário ainda.
        </p>
      ) : (
        <ol className="flex flex-col gap-3.5">
          {comentarios.map((c) => (
            <Comentario key={c.id} comentario={c} onEditar={onEditar} onApagar={onApagar} />
          ))}
        </ol>
      )}
    </section>
  );
}
