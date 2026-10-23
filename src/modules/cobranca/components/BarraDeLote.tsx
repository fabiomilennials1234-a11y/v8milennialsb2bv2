/**
 * Ações em lote sobre os casos marcados — a pílula de tinta no rodapé, como
 * em Leads. Na entrega 1: mover de etapa, atribuir e exportar.
 */
import { ArrowRightLeft, FileDown, UserCheck, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTeamMembers } from "@/modules/identity";
import { notifyError } from "@/shared/errors";

import { formatarDocumento, formatarTelefone } from "../lib/documento";
import { recusaDaCobranca } from "../lib/erros";
import type { Etapa, InadimplenteResumo } from "../lib/tipos";
import { useAtribuirCasos, useMoverCaso } from "../hooks/useCobrancaMutacoes";

function baixarCsv(linhas: InadimplenteResumo[]) {
  const cab = ["Nome", "CPF/CNPJ", "Telefone", "E-mail", "Saldo em aberto", "Títulos", "Vencimento mais antigo", "Etapa", "Responsável"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const corpo = linhas.map((r) =>
    [
      r.nome,
      r.documento ? formatarDocumento(r.documento) : "",
      r.telefone ? formatarTelefone(r.telefone) : "",
      r.email ?? "",
      r.saldoAberto.toFixed(2).replace(".", ","),
      r.titulosAbertos,
      r.vencimentoMaisAntigo ? r.vencimentoMaisAntigo.split("-").reverse().join("/") : "",
      r.etapaNome ?? "",
      r.responsavelNome ?? "",
    ]
      .map(esc)
      .join(";"),
  );
  // BOM para o Excel abrir acentos certos.
  const blob = new Blob(["﻿" + [cab.map(esc).join(";"), ...corpo].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `inadimplentes-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function BarraDeLote({
  selecionados,
  etapas,
  onLimpar,
}: {
  selecionados: InadimplenteResumo[];
  etapas: Etapa[];
  onLimpar: () => void;
}) {
  const mover = useMoverCaso();
  const atribuir = useAtribuirCasos();
  const { data: membros = [] } = useTeamMembers();
  if (selecionados.length === 0) return null;
  const abertas = etapas.filter((e) => e.papel === "aberta");
  const casos = selecionados.map((r) => r.casoId).filter((c): c is string => !!c);
  const falha = (fallback: string) => (err: unknown) =>
    notifyError(err, { fallback, message: recusaDaCobranca(err as { code?: string; message?: string }), context: { feature: "cobranca" } });

  const moverTodos = async (etapa: Etapa) => {
    try {
      for (const casoId of casos) await mover.mutateAsync({ casoId, etapaId: etapa.id });
      toast.success(`${casos.length} ${casos.length === 1 ? "caso movido" : "casos movidos"} para ${etapa.nome}.`);
      onLimpar();
    } catch (err) {
      falha("Nem todos os casos puderam ser movidos.")(err);
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Ações em lote"
      className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full bg-tinta px-2 py-1.5 text-tinta-foreground shadow-relevo-alto"
    >
      <span className="flex items-center gap-2 px-2 text-sm font-bold">
        <span className="grid h-6 min-w-6 place-items-center rounded-full bg-primary px-1.5 text-xs font-extrabold text-primary-foreground">
          {selecionados.length}
        </span>
        {selecionados.length === 1 ? "selecionado" : "selecionados"}
      </span>
      <span aria-hidden className="mx-1 h-5 w-px bg-tinta-line" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="rounded-full text-tinta-foreground hover:bg-white/10 hover:text-tinta-foreground" disabled={mover.isPending}>
            <ArrowRightLeft />
            Mover no fluxo
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top" className="w-56">
          <DropdownMenuLabel>Mover para</DropdownMenuLabel>
          {abertas.map((e) => (
            <DropdownMenuItem key={e.id} onSelect={() => void moverTodos(e)}>
              <span aria-hidden className="mr-2 size-2 rounded-full" style={{ background: e.cor }} />
              {e.nome}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="rounded-full text-tinta-foreground hover:bg-white/10 hover:text-tinta-foreground" disabled={atribuir.isPending}>
            <UserCheck />
            Atribuir
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" side="top" className="max-h-72 w-56 overflow-y-auto">
          <DropdownMenuLabel>Responsável</DropdownMenuLabel>
          {membros
            .filter((m) => m.is_active !== false && m.id)
            .map((m) => (
              <DropdownMenuItem
                key={m.id}
                onSelect={() =>
                  atribuir.mutate(
                    { casoIds: casos, responsavelId: m.id },
                    {
                      onSuccess: (n) => {
                        toast.success(`${n} ${n === 1 ? "caso atribuído" : "casos atribuídos"} a ${m.name}.`);
                        onLimpar();
                      },
                      onError: falha("Não foi possível atribuir."),
                    },
                  )
                }
              >
                {m.name}
              </DropdownMenuItem>
            ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() =>
              atribuir.mutate({ casoIds: casos, responsavelId: null }, { onSuccess: () => onLimpar(), onError: falha("Não foi possível tirar o responsável.") })
            }
          >
            Tirar responsável
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="sm"
        className="rounded-full text-tinta-foreground hover:bg-white/10 hover:text-tinta-foreground"
        onClick={() => baixarCsv(selecionados)}
      >
        <FileDown />
        Exportar
      </Button>
      <span aria-hidden className="mx-1 h-5 w-px bg-tinta-line" />
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 rounded-full text-tinta-foreground hover:bg-white/10 hover:text-tinta-foreground"
        onClick={onLimpar}
        aria-label="Limpar seleção"
      >
        <X />
      </Button>
    </div>
  );
}
