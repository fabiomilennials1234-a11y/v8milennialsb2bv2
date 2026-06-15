/**
 * MetaBindingTab — master-only Meta Asset Binding (ADR-0009, #809).
 * Org-centric: per organization, bind its Pages + Ad Accounts via a searchable
 * combobox (by name or id). Pages route leads; Ad Accounts optimize campaigns.
 */

import { useMemo, useState } from "react";
import { useMetaAssetAdmin, useBindAsset, useUnbindAsset, useSetDataset, type MetaAsset } from "../hooks/useMetaBindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Loader2, Plus, X, FileText, BarChart3, Lock, AlertTriangle, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";

function AssetIcon({ type, className }: { type: "page" | "ad_account"; className?: string }) {
  return type === "page"
    ? <FileText className={cn("w-3.5 h-3.5 text-sky-400", className)} />
    : <BarChart3 className={cn("w-3.5 h-3.5 text-primary", className)} />;
}

/** Chip for one bound asset under an org card. */
function AssetChip({ asset, onUnbind, onDataset }: {
  asset: MetaAsset;
  onUnbind: () => void;
  onDataset: (v: string) => void;
}) {
  const [ds, setDs] = useState(asset.datasetId ?? "");
  return (
    <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 pl-2 pr-1.5 py-1.5 text-sm">
      <AssetIcon type={asset.type} />
      <span className="text-foreground/90">{asset.name}</span>
      {asset.type === "page" && (
        <span className={cn("w-1.5 h-1.5 rounded-full", asset.lastError ? "bg-destructive" : asset.lastPolledAt ? "bg-emerald-500" : "bg-muted-foreground/40")}
          title={asset.lastError ?? (asset.lastPolledAt ? "Recebendo leads" : "Aguardando primeiro lead")} />
      )}
      {asset.type === "ad_account" && (
        <Input value={ds} onChange={(e) => setDs(e.target.value)} onBlur={() => ds !== (asset.datasetId ?? "") && onDataset(ds)}
          placeholder="Dataset ID" className="h-6 w-28 text-[11px] font-mono px-1.5" />
      )}
      <button onClick={onUnbind} className="ml-0.5 grid place-items-center w-5 h-5 rounded text-muted-foreground hover:text-foreground hover:bg-muted">
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}

/** Searchable combobox of unbound assets (pages + accounts mixed), by name or id. */
function AddAssetCombobox({ available, onPick }: { available: MetaAsset[]; onPick: (a: MetaAsset) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 border-dashed text-muted-foreground">
          <Plus className="w-3.5 h-3.5" /> Vincular ativo
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[340px]" align="start">
        <Command>
          <CommandInput placeholder="Buscar página ou conta por nome ou ID…" />
          <CommandList>
            <CommandEmpty>Nenhum ativo disponível.</CommandEmpty>
            <CommandGroup>
              {available.map((a) => (
                <CommandItem key={`${a.type}:${a.id}`} value={`${a.name} ${a.id}`} onSelect={() => { onPick(a); setOpen(false); }} className="gap-2.5">
                  <AssetIcon type={a.type} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{a.name} <span className="text-[11px] text-muted-foreground">{a.type === "page" ? "Página" : "Conta"}</span></div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">{a.id}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function MetaBindingTab() {
  const { data, isLoading, error, refetch, isFetching } = useMetaAssetAdmin();
  const bind = useBindAsset();
  const unbind = useUnbindAsset();
  const setDataset = useSetDataset();
  const [filter, setFilter] = useState("");

  const assets = data?.assets ?? [];
  const orgs = data?.orgs ?? [];
  const unbound = useMemo(() => assets.filter((a) => !a.boundOrgId), [assets]);
  const byOrg = useMemo(() => {
    const m = new Map<string, MetaAsset[]>();
    for (const a of assets) if (a.boundOrgId) (m.get(a.boundOrgId) ?? m.set(a.boundOrgId, []).get(a.boundOrgId)!).push(a);
    return m;
  }, [assets]);

  const shownOrgs = useMemo(
    () => orgs.filter((o) => o.name.toLowerCase().includes(filter.toLowerCase())),
    [orgs, filter],
  );

  if (isLoading) return <div className="grid place-items-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (error) return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 flex items-start gap-3">
      <AlertTriangle className="w-4 h-4 text-destructive mt-0.5" />
      <div>
        <p className="text-sm font-medium">Não foi possível carregar os ativos Meta</p>
        <p className="text-xs text-muted-foreground mt-1">{(error as Error).message}. Verifique o token em meta_app_config.</p>
        <Button variant="outline" size="sm" className="mt-2 h-7 gap-1" onClick={() => refetch()}><RefreshCw className="w-3 h-3" /> Tentar de novo</Button>
      </div>
    </div>
  );

  const boundCount = assets.filter((a) => a.boundOrgId).length;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Vínculo de Ativos Meta</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xl">
            Escolha a organização e vincule as Páginas e Contas de anúncio dela. Páginas trazem os leads; contas otimizam campanha.
          </p>
        </div>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} /> Atualizar
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar organização…" className="pl-9 h-9" />
        </div>
        <span className="text-xs text-muted-foreground ml-auto">
          <span className="text-foreground font-medium">{boundCount}</span> vinculados · {unbound.length} disponíveis
        </span>
      </div>

      <div className="space-y-3">
        {shownOrgs.map((org) => {
          const bound = byOrg.get(org.id) ?? [];
          return (
            <div key={org.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-3 mb-3">
                <span className="grid place-items-center w-8 h-8 rounded-lg bg-primary/15 text-primary text-xs font-bold">
                  {org.name.charAt(0).toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{org.name}</div>
                  <div className="text-[11.5px] text-muted-foreground">
                    {bound.length ? `${bound.length} ativo${bound.length > 1 ? "s" : ""} vinculado${bound.length > 1 ? "s" : ""}` : "Nenhum ativo ainda"}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {bound.map((a) => (
                  <AssetChip key={`${a.type}:${a.id}`} asset={a}
                    onUnbind={() => unbind.mutate({ asset_id: a.id, asset_type: a.type })}
                    onDataset={(v) => setDataset.mutate({ asset_id: a.id, dataset_id: v || null })} />
                ))}
                <AddAssetCombobox available={unbound}
                  onPick={(a) => bind.mutate({ asset_type: a.type, asset_id: a.id, asset_name: a.name, organization_id: org.id })} />
              </div>
            </div>
          );
        })}
        {shownOrgs.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhuma organização encontrada.</p>
        )}
      </div>

      <p className="text-[11.5px] text-muted-foreground flex items-center gap-1.5 pt-1">
        <Lock className="w-3 h-3" /> Cada ativo pertence a uma única organização. Conta de anúncio precisa do Dataset ID para otimizar.
      </p>
    </div>
  );
}
