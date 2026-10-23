/**
 * Importar inadimplentes por planilha — três passos, nada gravado até o último:
 *   1. o navegador lê o arquivo e acha as colunas (dá para corrigir);
 *   2. o banco faz um dry-run e diz o que vai acontecer e quais linhas não entram;
 *   3. importa de verdade.
 * Reimportar a mesma planilha não duplica: o banco reconhece o devedor pelo
 * CPF/CNPJ (ou telefone) e o título pelo número.
 */
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { notifyError } from "@/shared/errors";
import { cn } from "@/lib/utils";

import { recusaDaCobranca } from "../lib/erros";
import { plural } from "../lib/formato";
import { LIMITE_DE_LINHAS, lerPlanilha, type PlanilhaLida } from "../lib/ler-planilha";
import {
  CAMPOS_OBRIGATORIOS,
  ROTULO_DO_CAMPO,
  type CampoDaPlanilha,
  type MapaDeColunas,
  camposFaltando,
  detectarColunas,
  montarLinhas,
} from "../lib/planilha";
import type { ResultadoDaImportacao } from "../lib/tipos";
import { useImportarPlanilha } from "../hooks/useCobrancaMutacoes";

const ORDEM_DOS_CAMPOS: CampoDaPlanilha[] = [
  "nome", "documento", "telefone", "email", "valor", "vencimento", "numero", "descricao", "contato_nome", "cidade",
];

export function ImportarPlanilhaDialog({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const importar = useImportarPlanilha();
  const entrada = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [planilha, setPlanilha] = useState<PlanilhaLida | null>(null);
  const [mapa, setMapa] = useState<MapaDeColunas | null>(null);
  const [previa, setPrevia] = useState<ResultadoDaImportacao | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erroDeLeitura, setErroDeLeitura] = useState<string | null>(null);

  const montadas = useMemo(() => (planilha && mapa ? montarLinhas(planilha.linhas, mapa) : null), [planilha, mapa]);
  const faltando = mapa ? camposFaltando(mapa) : [];
  const grande = (montadas?.linhas.length ?? 0) > LIMITE_DE_LINHAS;

  const reiniciar = () => {
    setArquivo(null);
    setPlanilha(null);
    setMapa(null);
    setPrevia(null);
    setErroDeLeitura(null);
    if (entrada.current) entrada.current.value = "";
  };

  const fechar = () => {
    reiniciar();
    onFechar();
  };

  const escolher = async (f: File | undefined) => {
    if (!f) return;
    reiniciar();
    setLendo(true);
    try {
      const lida = await lerPlanilha(f);
      if (lida.cabecalhos.length === 0) throw new Error("A planilha está vazia.");
      setArquivo(f.name);
      setPlanilha(lida);
      setMapa(detectarColunas(lida.cabecalhos));
    } catch (e) {
      setErroDeLeitura(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    } finally {
      setLendo(false);
    }
  };

  const executar = (dryRun: boolean) => {
    if (!montadas) return;
    importar.mutate(
      { linhas: montadas.linhas, dryRun },
      {
        onSuccess: (r) => {
          if (dryRun) {
            setPrevia(r);
            return;
          }
          toast.success(
            `Importação concluída: ${plural(r.inadimplentesNovos, "inadimplente novo", "inadimplentes novos")}, ${plural(r.titulosNovos, "título novo", "títulos novos")}, ${plural(r.casosAbertos, "caso aberto", "casos abertos")}.`,
          );
          fechar();
        },
        onError: (err) =>
          notifyError(err, {
            fallback: "Não foi possível importar a planilha.",
            message: recusaDaCobranca(err as { code?: string; message?: string }),
            context: { feature: "cobranca" },
          }),
      },
    );
  };

  const linhaOriginal = (i: number) => montadas?.linhaNaPlanilha[i - 1] ?? i;

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar inadimplentes</DialogTitle>
          <DialogDescription>
            Uma linha por título em aberto. Colunas mínimas: nome, valor e vencimento; com CPF/CNPJ ou telefone para
            reconhecer o devedor. Até {LIMITE_DE_LINHAS.toLocaleString("pt-BR")} linhas por vez.
          </DialogDescription>
        </DialogHeader>

        {!planilha && (
          <button
            type="button"
            onClick={() => entrada.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void escolher(e.dataTransfer.files?.[0]);
            }}
            className="flex w-full flex-col items-center gap-2 rounded-card border border-dashed border-border bg-sunken px-6 py-10 text-center transition-colors hover:border-foreground/30"
          >
            {lendo ? <Loader2 className="size-6 animate-spin text-muted-foreground" /> : <Upload className="size-6 text-muted-foreground" />}
            <span className="text-sm font-semibold">{lendo ? "Lendo a planilha…" : "Escolher arquivo .xlsx ou .csv"}</span>
            <span className="text-xs text-muted-foreground">ou arraste aqui</span>
            {erroDeLeitura && <span className="text-xs font-semibold text-destructive">{erroDeLeitura}</span>}
          </button>
        )}
        <input
          ref={entrada}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => void escolher(e.target.files?.[0])}
        />

        {planilha && mapa && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-sunken px-3.5 py-2.5 text-sm">
              <FileSpreadsheet className="size-4 text-success-strong" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-semibold">{arquivo}</span>
              <span className="text-xs text-muted-foreground">{plural(montadas?.linhas.length ?? 0, "linha", "linhas")}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={reiniciar}>
                Trocar
              </Button>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Colunas encontradas</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {ORDEM_DOS_CAMPOS.map((campo) => (
                  <div key={campo} className="grid grid-cols-[1fr_1.2fr] items-center gap-2">
                    <span className={cn("text-[12.5px]", CAMPOS_OBRIGATORIOS.includes(campo) ? "font-semibold" : "text-muted-foreground")}>
                      {ROTULO_DO_CAMPO[campo]}
                      {CAMPOS_OBRIGATORIOS.includes(campo) && <span className="text-destructive"> *</span>}
                    </span>
                    <Select
                      value={String(mapa[campo])}
                      onValueChange={(v) => {
                        setPrevia(null);
                        setMapa((m) => (m ? { ...m, [campo]: Number(v) } : m));
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs" aria-label={`Coluna de ${ROTULO_DO_CAMPO[campo]}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="-1">Não usar</SelectItem>
                        {planilha.cabecalhos.map((h, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {h || `Coluna ${i + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              {faltando.length > 0 && (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-destructive">
                  <AlertTriangle className="size-3.5" aria-hidden />
                  Falta indicar: {faltando.map((c) => ROTULO_DO_CAMPO[c]).join(", ")}.
                </p>
              )}
              {grande && (
                <p className="mt-2 text-xs font-semibold text-destructive">
                  A planilha tem mais de {LIMITE_DE_LINHAS.toLocaleString("pt-BR")} linhas. Divida em partes.
                </p>
              )}
            </div>

            {previa && (
              <div className="space-y-2 rounded-2xl border border-border bg-card p-3.5 shadow-relevo">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <CheckCircle2 className="size-4 text-success-strong" aria-hidden />
                  Prévia: nada foi gravado ainda
                </p>
                <ul className="grid gap-1 text-[12.5px] sm:grid-cols-2">
                  <li>{plural(previa.inadimplentesNovos, "inadimplente novo", "inadimplentes novos")}</li>
                  <li>{plural(previa.inadimplentesExistentes, "já cadastrado", "já cadastrados")}</li>
                  <li>{plural(previa.titulosNovos, "título novo", "títulos novos")}</li>
                  <li>{plural(previa.titulosAtualizados, "título com valor ou data corrigidos", "títulos com valor ou data corrigidos")}</li>
                </ul>
                {previa.linhasInvalidas.length > 0 && (
                  <div className="rounded-xl bg-destructive/[.06] p-2.5">
                    <p className="mb-1 text-xs font-semibold text-destructive">
                      {previa.linhasInvalidas.length} {previa.linhasInvalidas.length === 1 ? "linha não entra" : "linhas não entram"}:
                    </p>
                    <ul className="max-h-28 space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
                      {previa.linhasInvalidas.slice(0, 50).map((l) => (
                        <li key={l.linha}>
                          Linha {linhaOriginal(l.linha)}: {l.motivo}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={fechar}>
            Cancelar
          </Button>
          {planilha && !previa && (
            <Button disabled={faltando.length > 0 || grande || importar.isPending || !montadas?.linhas.length} onClick={() => executar(true)}>
              {importar.isPending && <Loader2 className="animate-spin" />}
              Ver prévia
            </Button>
          )}
          {previa && (
            <Button disabled={importar.isPending || previa.titulosNovos + previa.titulosAtualizados === 0} onClick={() => executar(false)}>
              {importar.isPending && <Loader2 className="animate-spin" />}
              Importar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
