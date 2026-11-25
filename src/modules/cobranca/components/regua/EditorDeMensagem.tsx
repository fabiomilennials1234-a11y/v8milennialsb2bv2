/**
 * Texto de uma mensagem da cobrança (coluna do fluxo ou lembrete): campo com
 * variáveis clicáveis, aviso de variável inexistente e a prévia ao vivo.
 *
 * A prévia usa o MESMO renderizador da edge (lib/regua.ts ↔
 * _shared/cobranca-regua-mensagem.ts): o que aparece aqui é o que o devedor lê.
 */
import { AlertTriangle } from "lucide-react";
import { useMemo, useRef, type ReactNode } from "react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  VARIAVEIS_DA_REGUA,
  VARIAVEIS_DO_TITULO,
  renderizarMensagem,
  variaveisDeExemplo,
  variaveisDesconhecidas,
} from "../../lib/regua";
import { Campo } from "../dialogos";

function Variavel({ chave, rotulo, onInserir }: { chave: string; rotulo: string; onInserir: (chave: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onInserir(chave)}
      className="rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      title={`Insere {${chave}}`}
    >
      {rotulo}
    </button>
  );
}

/** Mensagem de coluna do fluxo. */
export const LIMITE_DA_MENSAGEM = 2000;
/** Lembrete de promessa/parcela. */
export const LIMITE_DO_LEMBRETE = 1000;

export function EditorDeMensagem({
  id,
  rotulo,
  valor,
  onChange,
  lembrete = false,
  comoPagar,
  empresa,
  semTexto,
  acima,
  diasDeAtraso,
}: {
  id: string;
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  /** Lembrete ganha as variáveis da parcela. */
  lembrete?: boolean;
  comoPagar: string | null;
  empresa?: string;
  /** O que a prévia diz quando o texto está vazio. */
  semTexto: string;
  /** Campos que vão acima do texto, na coluna da esquerda. */
  acima?: ReactNode;
  /** {dias_atraso} do exemplo — numa coluna de dias, os dias dela. */
  diasDeAtraso?: number;
}) {
  const texto = useRef<HTMLTextAreaElement>(null);
  const desconhecidas = useMemo(() => variaveisDesconhecidas(valor), [valor]);
  const previa = useMemo(
    () => renderizarMensagem(valor, variaveisDeExemplo(comoPagar, empresa, diasDeAtraso)),
    [valor, comoPagar, empresa, diasDeAtraso],
  );
  const limite = lembrete ? LIMITE_DO_LEMBRETE : LIMITE_DA_MENSAGEM;
  const longa = valor.length > limite;

  const inserir = (chave: string) => {
    const el = texto.current;
    const marca = `{${chave}}`;
    if (!el) return onChange(valor + marca);
    const ini = el.selectionStart ?? valor.length;
    const fim = el.selectionEnd ?? valor.length;
    onChange(valor.slice(0, ini) + marca + valor.slice(fim));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(ini + marca.length, ini + marca.length);
    });
  };

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
      <div className="space-y-4">
        {acima}
        <Campo id={id} rotulo={rotulo} erro={longa ? `Passa de ${limite} caracteres.` : undefined}>
          <Textarea
            id={id}
            ref={texto}
            rows={7}
            value={valor}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Olá, {primeiro_nome}! O pagamento de {valor}…"
          />
        </Campo>
        <div className="flex flex-wrap gap-1.5" aria-label="Variáveis">
          {VARIAVEIS_DA_REGUA.filter((v) => lembrete || !v.soLembrete).map((v) => (
            <Variavel key={v.chave} chave={v.chave} rotulo={v.rotulo} onInserir={inserir} />
          ))}
        </div>
        <div className="space-y-1.5">
          <p id={`${id}-por-titulo`} className="text-xs text-muted-foreground">
            <span className="font-semibold">Por título</span> · a linha com estas variáveis se repete para cada título em
            aberto
          </p>
          <div className="flex flex-wrap gap-1.5" aria-labelledby={`${id}-por-titulo`}>
            {VARIAVEIS_DO_TITULO.map((v) => (
              <Variavel key={v.chave} chave={v.chave} rotulo={v.rotulo} onInserir={inserir} />
            ))}
          </div>
        </div>
        {desconhecidas.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-warning-strong">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {desconhecidas.map((d) => `{${d}}`).join(", ")} não existe e vai sumir do texto.
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-xs font-semibold text-muted-foreground">Como chega no WhatsApp</p>
        <div className="min-h-[180px] flex-1 rounded-[18px] border border-border bg-sunken p-3">
          {previa ? (
            <div className="ml-auto w-fit max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-card px-3 py-2 text-[13px] leading-relaxed shadow-relevo">
              {previa}
            </div>
          ) : (
            <p className="grid h-full place-items-center text-center text-xs text-muted-foreground">{semTexto}</p>
          )}
        </div>
        <p className={cn("text-right text-[11px] tabular-nums text-muted-foreground", longa && "text-destructive")}>
          {valor.length}/{limite} · exemplo com dados fictícios
        </p>
      </div>
    </div>
  );
}
