/**
 * Títulos a receber do cliente — a lista por trás do selo de inadimplência.
 *
 * O selo no cabeçalho já dizia "Inadimplente · R$ X", mas parava aí: quem
 * atende o cliente precisa saber QUAIS títulos, de quando, e quanto falta em
 * cada um. Sem isso, a informação serve para julgar e não para cobrar.
 *
 * Ordena por vencimento crescente, com os atrasados no topo — é a ordem em que
 * a cobrança acontece.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type TituloStatus = "aberto" | "pago" | "atrasado";

interface TituloRow {
  id: string;
  valor: number | null;
  vencimento: string | null;
  status: TituloStatus;
  pago_em: string | null;
}

const STATUS_META: Record<TituloStatus, { label: string; className: string; Icon: typeof Clock }> = {
  atrasado: { label: "Atrasado", className: "text-red-400 bg-red-500/10", Icon: AlertTriangle },
  aberto: { label: "Em aberto", className: "text-amber-400 bg-amber-500/10", Icon: Clock },
  pago: { label: "Pago", className: "text-emerald-400 bg-emerald-500/10", Icon: CheckCircle2 },
};

/** Ordem de cobrança: atrasado primeiro, depois por vencimento. */
const STATUS_ORDER: Record<TituloStatus, number> = { atrasado: 0, aberto: 1, pago: 2 };

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** `aaaa-mm-dd` → `dd/mm/aaaa`, sem passar por Date para não deslocar fuso. */
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "—";
}

export function ClienteTitulos({ clientId }: { clientId: string | undefined }) {
  const { organizationId } = useOrganization();

  const { data: titulos = [], isLoading } = useQuery({
    queryKey: ["client-titulos", organizationId, clientId],
    queryFn: async (): Promise<TituloRow[]> => {
      if (!organizationId || !clientId) return [];
      const { data, error } = await supabase
        .from("titulos_receber")
        .select("id, valor, vencimento, status, pago_em")
        .eq("organization_id", organizationId)
        .eq("client_id", clientId)
        .order("vencimento", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TituloRow[];
    },
    enabled: !!organizationId && !!clientId,
    staleTime: 60_000,
  });

  const ordenados = useMemo(
    () =>
      [...titulos].sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          (a.vencimento ?? "").localeCompare(b.vencimento ?? ""),
      ),
    [titulos],
  );

  const emAberto = useMemo(
    () =>
      titulos
        .filter((t) => t.status !== "pago")
        .reduce((soma, t) => soma + (t.valor ?? 0), 0),
    [titulos],
  );

  return (
    <Card className="bg-card border-border">
      <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-semibold text-card-foreground">
          Títulos a receber
        </CardTitle>
        {emAberto > 0 && (
          <span className="text-xs font-bold tabular-nums text-amber-400">
            {formatBRL(emAberto)} em aberto
          </span>
        )}
      </CardHeader>

      <CardContent className="px-4 pb-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-3">Carregando…</p>
        ) : ordenados.length === 0 ? (
          /* Silêncio aqui é ambíguo: pode ser cliente em dia ou sincronização
             que ainda não alcançou este cliente. A frase não promete a primeira. */
          <p className="text-sm text-muted-foreground py-3">
            Nenhum título encontrado para este cliente.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {ordenados.map((t) => {
              const meta = STATUS_META[t.status] ?? STATUS_META.aberto;
              return (
                <li key={t.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <span
                    className={cn(
                      "flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium",
                      meta.className,
                    )}
                  >
                    <meta.Icon size={11} />
                    {meta.label}
                  </span>

                  <span className="text-xs text-muted-foreground shrink-0">
                    venc. {formatDate(t.vencimento)}
                  </span>

                  <span className="ml-auto text-sm font-semibold tabular-nums text-card-foreground">
                    {formatBRL(t.valor ?? 0)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* O ERP do Toth não devolve data de pagamento — só o saldo. Dizer isso
            aqui evita que a ausência da informação seja lida como atraso do
            sistema, e é honesto sobre o que a integração consegue afirmar. */}
        {ordenados.some((t) => t.status === "pago" && !t.pago_em) && (
          <p className="text-[11px] text-muted-foreground mt-3 pt-2 border-t border-border">
            O ERP não informa a data do pagamento, apenas o saldo — por isso títulos
            quitados aparecem sem data.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
