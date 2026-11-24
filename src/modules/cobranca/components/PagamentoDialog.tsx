/**
 * Registrar pagamento: a equipe marca QUAIS títulos o cliente pagou.
 *
 * Antes o pagamento abatia do mais antigo para o mais novo, ou um título por
 * vez num select — com vencimentos iguais não dava para dizer qual foi pago
 * (relato de cliente, 24/11). Agora a lista é a decisão principal: o valor
 * acompanha a soma dos marcados e só se edita para baixo, no pagamento parcial
 * (abate do vencimento mais antigo entre os marcados). Um registro, um lote.
 */
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { notifyError } from "@/shared/errors";
import { cn } from "@/lib/utils";

import { diaCurto, isoDia } from "../lib/atraso";
import { recusaDaCobranca } from "../lib/erros";
import { plural, reais } from "../lib/formato";
import { erroDoPagamento, somaDosSaldos, titulosBaixaveis, titulosSoDoErp } from "../lib/pagamento";
import type { InadimplenteResumo, TituloSaldo } from "../lib/tipos";
import { useTitulosEmAberto } from "../hooks/useCobrancaDados";
import { useRegistrarPagamento } from "../hooks/useCobrancaMutacoes";
import { CampoDeReais } from "./atomos";
import { BotaoSalvar, Campo } from "./dialogos";

export function PagamentoDialog({
  aberto,
  onFechar,
  caso,
  titulos,
  tituloInicial,
}: {
  aberto: boolean;
  onFechar: () => void;
  caso: InadimplenteResumo;
  /** Os da ficha, quando a tela já os tem; sem eles, o diálogo busca. */
  titulos?: TituloSaldo[];
  /** Aberto pela linha do título: só ele vem marcado. Sem ele, todos. */
  tituloInicial?: string;
}) {
  const registrar = useRegistrarPagamento();
  const buscados = useTitulosEmAberto(aberto && !titulos ? caso.id : null);
  const lista = titulos ?? buscados.data;
  const baixaveis = useMemo(() => titulosBaixaveis(lista ?? []), [lista]);
  const doErp = useMemo(() => titulosSoDoErp(lista ?? []), [lista]);
  const carregou = lista !== undefined;

  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const [valor, setValor] = useState<number | null>(null);
  const [data, setData] = useState(isoDia(new Date()));

  // Inicia uma vez por abertura, quando os títulos chegam. Um refetch com o
  // diálogo aberto não pode apagar o que a pessoa marcou.
  const iniciado = useRef(false);
  useEffect(() => {
    if (!aberto) {
      iniciado.current = false;
      return;
    }
    if (iniciado.current || !carregou) return;
    iniciado.current = true;
    const daLinha = tituloInicial && baixaveis.some((t) => t.id === tituloInicial);
    const inicial = new Set(daLinha ? [tituloInicial] : baixaveis.map((t) => t.id));
    setMarcados(inicial);
    setValor(somaDosSaldos(baixaveis, inicial) || null);
    setData(isoDia(new Date()));
  }, [aberto, carregou, baixaveis, tituloInicial]);

  const escolhidos = baixaveis.filter((t) => marcados.has(t.id));
  const limite = somaDosSaldos(baixaveis, marcados);
  const erro = erroDoPagamento(valor, escolhidos.length, limite);
  const parcial = !erro && valor != null && limite - valor > 0.009;
  const todos = baixaveis.length > 0 && escolhidos.length === baixaveis.length;

  const marcar = (proximos: Set<string>) => {
    setMarcados(proximos);
    setValor(somaDosSaldos(baixaveis, proximos) || null);
  };
  const alternar = (id: string) => {
    const proximos = new Set(marcados);
    if (proximos.has(id)) proximos.delete(id);
    else proximos.add(id);
    marcar(proximos);
  };

  const enviar = (ev: FormEvent) => {
    ev.preventDefault();
    if (erro || !caso.casoId) return;
    registrar.mutate(
      { casoId: caso.casoId, valor: valor as number, pagoEm: data, tituloIds: escolhidos.map((t) => t.id) },
      {
        onSuccess: (r) => {
          const pagos = r.titulos.filter((t) => t.quitado).length;
          const feito = pagos > 0 ? plural(pagos, "título pago", "títulos pagos") : "Pagamento parcial registrado";
          toast.success(r.quitado ? "Saldo quitado. O caso foi para Recuperado." : `${feito}. Saldo: ${reais(r.saldoRestante)}.`);
          onFechar();
        },
        onError: (err) =>
          notifyError(err, {
            fallback: "Não foi possível registrar o pagamento.",
            message: recusaDaCobranca(err as { code?: string; message?: string }),
            context: { feature: "cobranca" },
          }),
      },
    );
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar pagamento</DialogTitle>
          <DialogDescription>
            Marque os títulos que o cliente pagou. Para dívida que não veio do ERP; saldo zero leva o caso para Recuperado.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4" noValidate>
          <div role="group" aria-labelledby="pg-titulos-rotulo" className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p id="pg-titulos-rotulo" className="text-sm font-medium leading-none">
                Títulos pagos
              </p>
              {baixaveis.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => marcar(new Set(todos ? [] : baixaveis.map((t) => t.id)))}
                >
                  {todos ? "Desmarcar todos" : "Marcar todos"}
                </Button>
              )}
            </div>

            {!carregou ? (
              <div className="grid h-20 place-items-center rounded-2xl border border-border bg-sunken text-xs text-muted-foreground">
                {buscados.isError ? (
                  "Não foi possível carregar os títulos."
                ) : (
                  <Loader2 className="size-4 animate-spin" aria-label="Carregando títulos" />
                )}
              </div>
            ) : baixaveis.length === 0 ? (
              <p className="rounded-2xl border border-border bg-sunken px-3 py-4 text-center text-xs text-muted-foreground">
                Nenhum título em aberto para baixar por aqui.
              </p>
            ) : (
              <div className="max-h-60 space-y-0.5 overflow-y-auto rounded-2xl border border-border bg-sunken p-1">
                {baixaveis.map((t) => {
                  const marcado = marcados.has(t.id);
                  return (
                    <label
                      key={t.id}
                      className={cn(
                        "grid cursor-pointer grid-cols-[16px_1fr_auto] items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-colors hover:bg-card/70",
                        marcado && "bg-card shadow-relevo hover:bg-card",
                      )}
                    >
                      <Checkbox checked={marcado} onCheckedChange={() => alternar(t.id)} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{t.numero ?? "Título sem número"}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          vence {diaCurto(t.vencimento)}
                          {t.valorPago > 0 && ` · já pago ${reais(t.valorPago)}`}
                          {t.descricao && ` · ${t.descricao}`}
                        </span>
                      </span>
                      <span className={cn("font-bold tabular-nums", !marcado && "text-muted-foreground")}>{reais(t.saldo)}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {carregou && baixaveis.length > 0 && escolhidos.length === 0 && (
              <p className="text-xs text-destructive">Marque ao menos um título.</p>
            )}
            {doErp > 0 && (
              <p className="text-xs text-muted-foreground">
                {doErp === 1 ? "1 título do ERP baixa" : `${doErp} títulos do ERP baixam`} pelo próprio ERP.
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              id="pg-valor"
              rotulo="Valor recebido"
              erro={erro && escolhidos.length > 0 && valor != null ? erro : undefined}
              dica={parcial ? "Parcial: abate do vencimento mais antigo entre os marcados." : undefined}
            >
              <CampoDeReais id="pg-valor" valor={valor} onValor={setValor} />
            </Campo>
            <Campo id="pg-data" rotulo="Data do pagamento">
              <Input id="pg-data" type="date" max={isoDia(new Date())} value={data} onChange={(e) => setData(e.target.value)} />
            </Campo>
          </div>

          <DialogFooter className="items-center gap-2 sm:justify-between">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {carregou && baixaveis.length > 0 && `${escolhidos.length} de ${plural(baixaveis.length, "título", "títulos")}`}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onFechar}>
                Cancelar
              </Button>
              <BotaoSalvar salvando={registrar.isPending} disabled={!!erro}>
                Registrar
              </BotaoSalvar>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
