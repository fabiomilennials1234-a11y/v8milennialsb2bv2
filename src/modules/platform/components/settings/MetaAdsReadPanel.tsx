import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMasterAuth, useOrganization } from "@/modules/identity";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCw } from "lucide-react";

interface AdAccount { account_id: string; name: string; currency: string | null }
interface Insight { campaign_id: string; campaign_name: string; impressions?: string; clicks?: string; spend?: string }
interface InsightPage { data: Insight[]; after: string | null }

/** Reads only the assets selected in Business Login; never uses the agency's global credentials. */
export function MetaAdsReadPanel() {
  const { organizationId, role, timezone } = useOrganization();
  const { isMaster } = useMasterAuth();
  const canRead = role === "admin" || isMaster;
  const initial = useMemo(() => {
    const until = new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return { until, since: new Date(Date.parse(until) - 6 * 86400000).toISOString().slice(0, 10) };
  }, [timezone]);
  const [selected, setSelected] = useState<{ org: string; account: string } | null>(null);
  const [since, setSince] = useState(initial.since);
  const [until, setUntil] = useState(initial.until);
  const accounts = useQuery({
    queryKey: ["meta_ad_accounts", organizationId],
    enabled: !!organizationId && canRead,
    staleTime: 30_000,
    placeholderData: () => undefined,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("meta-ad-insights", { body: { action: "accounts", organization_id: organizationId } });
      if (error || data?.error) throw new Error("Não foi possível consultar suas contas de anúncios.");
      return (data?.accounts ?? []) as AdAccount[];
    },
  });
  const available = accounts.data ?? [];
  const accountId = selected?.org === organizationId && available.some((account) => account.account_id === selected.account)
    ? selected.account : available[0]?.account_id ?? "";
  const account = available.find((item) => item.account_id === accountId);
  const days = (Date.parse(until) - Date.parse(since)) / 86400000;
  const validRange = /^\d{4}-\d{2}-\d{2}$/.test(since) && /^\d{4}-\d{2}-\d{2}$/.test(until) && Number.isFinite(days) && days >= 0 && days <= 92;
  const insights = useInfiniteQuery({
    queryKey: ["meta_ad_insights", organizationId, accountId, since, until],
    enabled: !!organizationId && canRead && !!accountId && validRange,
    initialPageParam: null as string | null,
    retry: false,
    staleTime: 30_000,
    placeholderData: () => undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.functions.invoke("meta-ad-insights", { body: { action: "insights", organization_id: organizationId, accountId, since, until, ...(pageParam ? { after: pageParam } : {}) } });
      if (error || data?.error) throw new Error("Não foi possível carregar as métricas desse período.");
      return data as InsightPage;
    },
    getNextPageParam: (page, _pages, previousCursor) => page.after && page.after !== previousCursor ? page.after : undefined,
  });
  if (!canRead || !organizationId) return null;
  const rows = insights.data?.pages.flatMap((page) => page.data) ?? [];
  const numeric = (value: string | undefined) => value !== undefined && Number.isFinite(Number(value)) ? new Intl.NumberFormat("pt-BR").format(Number(value)) : "—";
  const money = (value: string | undefined) => {
    if (value === undefined || !Number.isFinite(Number(value))) return "—";
    try { return new Intl.NumberFormat("pt-BR", account?.currency ? { style: "currency", currency: account.currency } : {}).format(Number(value)); }
    catch { return numeric(value); }
  };
  return (
    <section aria-label="Resultados dos anúncios" className="space-y-4 border-t border-border pt-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-medium">Resultados dos anúncios</h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Contas autorizadas nesta organização. Consulte investimento, impressões e cliques por campanha.</p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Atualizar contas de anúncios" disabled={accounts.isFetching} onClick={() => { void accounts.refetch(); if (accountId && validRange) void insights.refetch(); }}><RefreshCw className="h-4 w-4" /></Button>
      </div>
      {accounts.isPending ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Consultando contas autorizadas…</p>
        : accounts.isError ? <p role="alert" className="text-sm text-destructive">{accounts.error.message}</p>
        : !available.length ? <p className="text-sm text-muted-foreground">Nenhuma conta de anúncios autorizada. Reconecte o Facebook e selecione a conta desejada.</p>
        : <>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="space-y-2"><Label htmlFor="meta-ads-account">Conta de anúncios</Label><select id="meta-ads-account" value={accountId} onChange={(event) => setSelected({ org: organizationId!, account: event.target.value })} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="" disabled>Selecione uma conta</option>{available.map((item) => <option key={item.account_id} value={item.account_id}>{item.name}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="meta-ads-since">De</Label><Input id="meta-ads-since" type="date" value={since} onChange={(event) => setSince(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="meta-ads-until">Até</Label><Input id="meta-ads-until" type="date" value={until} onChange={(event) => setUntil(event.target.value)} /></div>
          </div>
          {!validRange ? <p role="alert" className="text-sm text-destructive">Escolha um período válido de até 93 dias.</p>
            : insights.isPending ? <p role="status" className="text-sm text-muted-foreground">Carregando métricas…</p>
            : insights.isError ? <p role="alert" className="text-sm text-destructive">{insights.error.message}</p>
            : !rows.length ? <p className="text-sm text-muted-foreground">Sem resultados para esta conta no período escolhido.</p>
            : <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full text-sm"><caption className="sr-only">Métricas das campanhas da conta selecionada</caption><thead className="bg-muted/30 text-xs text-muted-foreground"><tr><th scope="col" className="px-4 py-3 text-left font-medium">Campanha</th><th scope="col" className="px-4 py-3 text-right font-medium">Impressões</th><th scope="col" className="px-4 py-3 text-right font-medium">Cliques</th><th scope="col" className="px-4 py-3 text-right font-medium">Investimento</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.campaign_id}-${index}`} className="border-t border-border"><th scope="row" className="min-w-40 px-4 py-3 text-left font-normal">{row.campaign_name || row.campaign_id}</th><td className="px-4 py-3 text-right tabular-nums">{numeric(row.impressions)}</td><td className="px-4 py-3 text-right tabular-nums">{numeric(row.clicks)}</td><td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{money(row.spend)}</td></tr>)}</tbody></table></div>}
          {validRange && rows.length > 0 && <p className="text-xs text-muted-foreground sm:hidden">Deslize a tabela para ver todas as métricas.</p>}
          {validRange && insights.hasNextPage && <Button type="button" variant="outline" disabled={insights.isFetchingNextPage} onClick={() => { void insights.fetchNextPage(); }}>{insights.isFetchingNextPage ? "Carregando…" : "Carregar mais campanhas"}</Button>}
        </>}
    </section>
  );
}
