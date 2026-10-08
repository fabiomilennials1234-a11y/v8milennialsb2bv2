/**
 * ApiKeysPanel — admin panel for API key management.
 * Consumes useApiKeys, useCreateApiKey, useRevokeApiKey.
 */

import { useState } from "react";
import {
  Key,
  Plus,
  Copy,
  Check,
  Ban,
  Loader2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { FocusCard, FocusTile, InkPanel, InkRow, InkSplit } from "@/components/ui/bento";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
} from "@/modules/platform/hooks/useApiKeys";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AcaoDoCabecalho } from "./settings-ui";
import { botaoNoOuroSecundario } from "./settings-classes";

// ── Available scopes ──────────────────────────────────────────

// Mirrors API_SCOPES in supabase/functions/_shared/api/scopes.ts (ADR-0008).
const AVAILABLE_SCOPES = [
  { value: "lead:read", label: "Leads (leitura)", description: "Listar e ler leads, timeline e 360" },
  { value: "lead:write", label: "Leads (escrita)", description: "Editar campos, mover etapa, tags e custom fields" },
  { value: "lead:ingest", label: "Leads (ingestão)", description: "Criar leads via webhook" },
  { value: "pipeline:read", label: "Funis (leitura)", description: "Listar funis e etapas" },
  { value: "metadata:read", label: "Catálogos (leitura)", description: "Tags e campos customizados" },
  { value: "webhook:read", label: "Webhooks", description: "Consumir webhooks de saída" },
  // ADR-0030: Negócio é recurso próprio, com escopo próprio. `lead:write` NÃO
  // concede `deal:write` — permissão de editar a pessoa não é permissão de abrir
  // venda no funil dela. Sem estas duas entradas a tela não conseguia emitir
  // chave capaz de usar as rotas de Negócio (#1767–#1772), que estão em produção.
  { value: "deal:read", label: "Negócios (leitura)", description: "Listar e ler negócios" },
  { value: "deal:write", label: "Negócios (escrita)", description: "Abrir, editar e mover negócios" },
  { value: "team:read", label: "Equipe (leitura)", description: "Listar membros — resolve os IDs de responsável" },
  { value: "metadata:write", label: "Catálogos (escrita)", description: "Criar campos personalizados pela API" },
];

// ── Component ─────────────────────────────────────────────────

export function ApiKeysPanel() {
  const { data: keys = [], isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();

  const [createOpen, setCreateOpen] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [focoId, setFocoId] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Create form
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["lead:read"]);
  const [rateLimit, setRateLimit] = useState(100);
  const [expiryDays, setExpiryDays] = useState("");

  const handleCreate = async () => {
    if (!name.trim()) return;

    const expiresAt = expiryDays
      ? new Date(Date.now() + Number(expiryDays) * 86400000).toISOString()
      : undefined;

    try {
      const result = await createKey.mutateAsync({
        name: name.trim(),
        scopes,
        rate_limit_per_minute: rateLimit,
        expires_at: expiresAt,
      });
      setNewKey(result.key);
      // Don't close dialog — show the key
    } catch {
      // handled by hook
    }
  };

  const handleCopyKey = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async () => {
    if (!revokeId) return;
    await revokeKey.mutateAsync(revokeId);
    setRevokeId(null);
  };

  const resetCreateForm = () => {
    setName("");
    setScopes(["read"]);
    setRateLimit(100);
    setExpiryDays("");
    setNewKey(null);
    setCopied(false);
  };

  const handleCloseCreate = (open: boolean) => {
    if (!open) resetCreateForm();
    setCreateOpen(open);
  };

  const toggleScope = (scope: string) => {
    setScopes((prev) =>
      prev.includes(scope)
        ? prev.filter((s) => s !== scope)
        : [...prev, scope]
    );
  };

  const activeKeys = keys.filter((k) => k.is_active);
  const revokedKeys = keys.filter((k) => !k.is_active);
  // V5: lista em tinta + a chave em foco no ouro. Seleção local; padrão = 1ª.
  const foco = activeKeys.find((k) => k.id === focoId) ?? activeKeys[0] ?? null;

  const desde = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
  const rotuloDoEscopo = (valor: string) => AVAILABLE_SCOPES.find((s) => s.value === valor)?.label ?? valor;

  return (
    <div className="space-y-4">
      <AcaoDoCabecalho>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus />
          Nova chave
        </Button>
      </AcaoDoCabecalho>

      {isLoading ? (
        <InkPanel title="Chaves de API">
          <div className="space-y-2" aria-busy>
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-14 rounded-2xl bg-white/[.06]" />
            ))}
          </div>
        </InkPanel>
      ) : !foco ? (
        <InkPanel title="Chaves de API" count="0 ativas">
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/[.07] text-primary">
              <Key className="h-6 w-6" aria-hidden />
            </span>
            <p className="mt-3 text-[15px] font-bold">Nenhuma chave ativa</p>
            <p className="mt-1 max-w-sm text-[12.5px] text-tinta-muted">
              Gere uma chave para o n8n, o Make ou o seu sistema falar com a API do Torque.
            </p>
            <Button variant="outline" className="mt-5 text-foreground" onClick={() => setCreateOpen(true)}>
              <Plus />
              Gerar chave
            </Button>
          </div>
        </InkPanel>
      ) : (
        <InkSplit
          title="Chaves de API"
          count={`${activeKeys.length} ${activeKeys.length === 1 ? "ativa" : "ativas"}`}
          actions={
            <span className="hidden text-[11.5px] text-tinta-muted sm:inline">
              A chave inteira só aparece uma vez, na criação
            </span>
          }
          listClassName="lg:max-h-[520px] lg:overflow-y-auto"
          list={
            <>
              {activeKeys.map((key) => {
                const selecionada = key.id === foco.id;
                return (
                  <InkRow key={key.id} selected={selecionada} onClick={() => setFocoId(key.id)}>
                    <span
                      className={cn(
                        "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px]",
                        selecionada ? "bg-primary-foreground text-primary" : "bg-white/[.07] text-primary",
                      )}
                    >
                      <Key className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold">{key.name}</span>
                      <span
                        className={cn(
                          "mt-0.5 block truncate font-mono text-[11px]",
                          selecionada ? "text-primary-foreground/70" : "text-tinta-muted",
                        )}
                      >
                        {key.key_prefix}••••
                      </span>
                    </span>
                    {key.last_used_at ? (
                      <span
                        className={cn(
                          "shrink-0 text-[11px] font-semibold",
                          selecionada ? "text-primary-foreground/75" : "text-tinta-muted",
                        )}
                      >
                        {desde(key.last_used_at)}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold",
                          selecionada ? "bg-tinta text-tinta-foreground" : "bg-primary-soft text-primary-soft-foreground",
                        )}
                      >
                        sem uso
                      </span>
                    )}
                  </InkRow>
                );
              })}
              {/* Revogadas: só registro, sem ação. */}
              {revokedKeys.length > 0 && (
                <div className="mt-3 border-t border-white/[.08] px-3 pt-3">
                  <p className="text-[10.5px] font-bold uppercase tracking-[.06em] text-tinta-muted">
                    Chaves revogadas ({revokedKeys.length})
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {revokedKeys.slice(0, 5).map((key) => (
                      <li key={key.id} className="flex items-center gap-2 text-[12px] text-tinta-muted">
                        <Key className="h-3 w-3 shrink-0" aria-hidden />
                        <span className="truncate line-through">{key.name}</span>
                        <code className="ml-auto shrink-0 font-mono text-[10.5px]">{key.key_prefix}...</code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          }
          detail={
            <FocusCard className="gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-primary-foreground/70">Chave selecionada</p>
                  <h3 className="mt-1 truncate text-[1.55rem] font-extrabold leading-[1.12] tracking-[-0.03em] max-sm:text-[1.3rem]">
                    {foco.name}
                  </h3>
                  <p className="mt-1 truncate font-mono text-[12.5px] font-semibold text-primary-foreground/80">
                    {foco.key_prefix}••••••••••••••••
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[1.6rem] font-extrabold leading-none tracking-[-0.03em] tabular-nums">
                    {foco.rate_limit_per_minute}
                    <span className="ml-1 text-[12px] font-bold text-primary-foreground/70">req/min</span>
                  </p>
                  <p className="mt-1 text-[11px] font-bold text-primary-foreground/65">limite</p>
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-bold text-primary-foreground/65">Escopos</p>
                <div className="flex flex-wrap gap-1.5">
                  {foco.scopes.length === 0 ? (
                    <span className="text-[12px] font-semibold text-primary-foreground/70">Nenhum escopo</span>
                  ) : (
                    foco.scopes.map((s) => (
                      <span
                        key={s}
                        title={rotuloDoEscopo(s)}
                        className="rounded-full bg-tinta px-2.5 py-1 font-mono text-[11px] font-bold text-tinta-foreground"
                      >
                        {s}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                <FocusTile>
                  <p className="text-[1rem] font-extrabold tabular-nums tracking-[-0.02em]">
                    {format(new Date(foco.created_at), "dd/MM/yyyy")}
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-primary-foreground/65">Criada em</p>
                </FocusTile>
                <FocusTile>
                  <p className="flex items-center gap-1.5 text-[1rem] font-extrabold tracking-[-0.02em]">
                    <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{foco.last_used_at ? desde(foco.last_used_at) : "Nunca"}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-primary-foreground/65">Último uso</p>
                </FocusTile>
                <FocusTile className="col-span-2 lg:col-span-1">
                  <p className="text-[1rem] font-extrabold tabular-nums tracking-[-0.02em]">
                    {foco.expires_at ? format(new Date(foco.expires_at), "dd/MM/yyyy") : "Não expira"}
                  </p>
                  <p className="mt-0.5 text-[11px] font-bold text-primary-foreground/65">Validade</p>
                </FocusTile>
              </div>

              <div className="mt-auto flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setRevokeId(foco.id)} className={botaoNoOuroSecundario}>
                  <Ban />
                  Revogar
                </button>
              </div>
            </FocusCard>
          }
        />
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={handleCloseCreate}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-4 h-4 text-primary" />
              {newKey ? "Chave criada" : "Nova API Key"}
            </DialogTitle>
          </DialogHeader>

          {newKey ? (
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/15 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-strong" />
                <div>
                  <p className="text-sm font-medium">Copie agora</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Esta chave não será exibida novamente. Armazene em local seguro.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-xl bg-muted p-3 font-mono text-sm">
                  {newKey}
                </code>
                <Button variant="outline" size="icon" onClick={handleCopyKey}>
                  {copied ? <Check className="w-4 h-4 text-success-strong" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>

              <DialogFooter>
                <Button onClick={() => handleCloseCreate(false)}>
                  Fechar
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="grid gap-2">
                <Label>Nome *</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Integração n8n"
                />
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label>Escopos</Label>
                  {/* Uma integração de CRM costuma precisar de quase tudo. Marcar
                      dez caixas uma a uma, por cliente, é onde se esquece a que
                      importa — e o esquecimento só aparece como 403 lá na frente. */}
                  <button
                    type="button"
                    onClick={() =>
                      setScopes(
                        scopes.length === AVAILABLE_SCOPES.length
                          ? []
                          : AVAILABLE_SCOPES.map((s) => s.value),
                      )
                    }
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {scopes.length === AVAILABLE_SCOPES.length ? "Limpar todos" : "Selecionar todos"}
                  </button>
                </div>
                <div className="space-y-2">
                  {AVAILABLE_SCOPES.map((scope) => (
                    <label
                      key={scope.value}
                      className="flex cursor-pointer items-center gap-3 rounded-xl p-2 hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={scopes.includes(scope.value)}
                        onCheckedChange={() => toggleScope(scope.value)}
                      />
                      <div>
                        <p className="text-sm font-medium">{scope.label}</p>
                        <p className="text-[10px] text-muted-foreground">{scope.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Rate limit (req/min)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10000}
                    value={rateLimit}
                    onChange={(e) => setRateLimit(Number(e.target.value) || 100)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Expira em (dias, vazio=nunca)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={expiryDays}
                    onChange={(e) => setExpiryDays(e.target.value)}
                    placeholder="365"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => handleCloseCreate(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreate} disabled={!name.trim() || createKey.isPending}>
                  {createKey.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Criar chave
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <AlertDialog open={!!revokeId} onOpenChange={() => setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              A chave será desativada imediatamente. Integrações usando essa chave deixarão de funcionar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revogar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
