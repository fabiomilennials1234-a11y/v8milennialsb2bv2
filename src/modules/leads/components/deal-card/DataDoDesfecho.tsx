import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { CorrecaoDataDoDesfecho } from "./types";
import { diaDaVenda } from "./dia-da-venda";

/**
 * "Vendido em" / "Perdido em" no cartão de ouro — e, com `onSalvar`, o lugar
 * de corrigir essa data.
 *
 * O bloco É o botão: a data está errada exatamente onde a pessoa a lê, e um
 * botão "editar data" em outro canto do card seria um segundo lugar para a
 * mesma verdade. Sem `onSalvar` (sem permissão, ou `/preview.html`) ele volta
 * a ser só leitura, idêntico ao bloco vizinho.
 *
 * O motivo é obrigatório: mexer na data move receita, comissão e relatório de
 * um mês para outro, e a auditoria guarda quem, quando e por quê.
 *
 * Este arquivo não fala com o banco (inv:H5-17) — quem escreve é o
 * `DealCardPanel`, por callback.
 */
export function DataDoDesfecho({
  estado,
  quando,
  timezone = "America/Sao_Paulo",
  versao,
  onSalvar,
  children,
}: {
  estado: "ganho" | "perdido";
  /** ISO do desfecho, como o card exibe. */
  quando: string;
  timezone?: string;
  versao?: string | null;
  onSalvar?: (correcao: CorrecaoDataDoDesfecho) => Promise<unknown>;
  /** A data formatada, como o bloco já mostrava. */
  children: ReactNode;
}) {
  const ganho = estado === "ganho";
  const rotulo = ganho ? "Vendido em" : "Perdido em";
  const original = Number.isNaN(new Date(quando).getTime()) ? "" : diaDaVenda(quando, timezone);

  const [aberto, setAberto] = useState(false);
  const [data, setData] = useState(original);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  // A versão é a do card que a pessoa via ao abrir, não a de um refetch no meio.
  const [versaoAberta, setVersaoAberta] = useState(versao ?? null);

  const hoje = diaDaVenda(new Date().toISOString(), timezone);
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(data) && data <= hoje;
  const pronto = valida && data !== original && motivo.trim().length > 0 && !salvando;

  const trocarAberto = (abrir: boolean) => {
    if (salvando) return;
    if (abrir) {
      setData(original);
      setMotivo("");
      setErro("");
      setVersaoAberta(versao ?? null);
    }
    setAberto(abrir);
  };

  const salvar = async () => {
    if (!pronto || !onSalvar) return;
    setSalvando(true);
    setErro("");
    try {
      await onSalvar({ data, motivo: motivo.trim(), ...(versaoAberta && { versao: versaoAberta }) });
      setAberto(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível corrigir a data. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  };

  const conteudo = (editavel: boolean) => (
    <>
      <span className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[.08em] text-primary-foreground/65">
        {rotulo}
        {editavel && (
          <Pencil
            className="size-3 shrink-0 opacity-70 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden="true"
          />
        )}
      </span>
      <span className="min-w-0 break-words text-[14px] font-extrabold tracking-[-0.02em] tabular-nums">{children}</span>
    </>
  );

  const bloco =
    "flex min-w-0 flex-col gap-0.5 rounded-2xl border border-primary-foreground/10 bg-primary-foreground/[.07] px-3 py-2";

  if (!onSalvar) return <div className={bloco}>{conteudo(false)}</div>;

  return (
    // `modal` + `z-[70]`: no celular o card vive num `SheetContent` (`z-[51]`)
    // — ver `popover-em-dialogo-contract.test.ts`.
    <Popover open={aberto} onOpenChange={trocarAberto} modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${rotulo} ${original ? original.split("-").reverse().join("/") : ""} — corrigir data`}
          data-testid="desfecho-data"
          className={cn(
            bloco,
            "group text-left transition-colors hover:bg-primary-foreground/[.13]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tinta focus-visible:ring-offset-2 focus-visible:ring-offset-primary",
            aberto && "bg-primary-foreground/[.13]",
          )}
        >
          {conteudo(true)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="z-[70] w-[min(20rem,calc(100vw-2rem))]">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
        >
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{ganho ? "Corrigir data da venda" : "Corrigir data da perda"}</h3>
            <p className="text-[12.5px] leading-snug text-muted-foreground">
              {ganho
                ? "Receita, pedido e comissão passam para o novo dia. O valor não muda."
                : "Os relatórios de perda passam a contar este negócio no novo dia."}
            </p>
          </div>
          <fieldset disabled={salvando} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              {ganho ? "Data da venda" : "Data da perda"}
              <Input
                type="date"
                className="tabular-nums"
                max={hoje}
                value={data}
                onChange={(e) => setData(e.target.value)}
                aria-invalid={!valida}
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Motivo
              <Textarea
                rows={2}
                maxLength={1000}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder={ganho ? "Ex.: a venda foi fechada no dia 12" : "Ex.: o cliente desistiu na semana passada"}
                className="min-h-16 resize-none text-[13px]"
              />
            </label>
          </fieldset>
          {!valida && data !== "" && <p className="text-[12.5px] text-destructive">A data não pode ser futura.</p>}
          {erro && (
            <p role="alert" className="text-[12.5px] text-destructive">
              {erro}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={salvando} onClick={() => trocarAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={!pronto}>
              {salvando ? "Salvando…" : "Salvar data"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
