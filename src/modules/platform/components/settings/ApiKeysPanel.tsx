/**
 * ApiKeysPanel — admin panel for API key management.
 * Consumes useApiKeys, useCreateApiKey, useRevokeApiKey.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Key,
  Plus,
  Copy,
  Check,
  Trash2,
  Loader2,
  Clock,
  Shield,
  AlertTriangle,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <Key className="w-5 h-5 text-primary" />
            API Keys
          </h3>
          <p className="text-sm text-muted-foreground">
            Gerencie chaves de acesso para integracoes externas
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          Nova chave
        </Button>
      </div>

      {/* Active keys */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-500" />
            Chaves ativas ({activeKeys.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : activeKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Nenhuma chave ativa
            </p>
          ) : (
            <div className="space-y-2">
              {activeKeys.map((key) => (
                <motion.div
                  key={key.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Key className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{key.name}</p>
                        <code className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                          {key.key_prefix}...
                        </code>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                        <span>Scopes: {key.scopes.join(", ")}</span>
                        <span>{key.rate_limit_per_minute} req/min</span>
                        {key.last_used_at && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDistanceToNow(new Date(key.last_used_at), { addSuffix: true, locale: ptBR })}
                          </span>
                        )}
                        {key.expires_at && (
                          <span>
                            Expira: {format(new Date(key.expires_at), "dd/MM/yyyy")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-destructive shrink-0"
                    onClick={() => setRevokeId(key.id)}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Revogar
                  </Button>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revoked keys */}
      {revokedKeys.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
              Chaves revogadas ({revokedKeys.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {revokedKeys.slice(0, 5).map((key) => (
                <div
                  key={key.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 opacity-50"
                >
                  <Key className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm line-through">{key.name}</p>
                    <code className="text-[10px] text-muted-foreground font-mono">{key.key_prefix}...</code>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={handleCloseCreate}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-4 h-4 text-primary" />
              {newKey ? "Chave criada" : "Nova API Key"}
            </DialogTitle>
          </DialogHeader>

          {newKey ? (
            <div className="space-y-4 py-2">
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">Copie agora</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Esta chave nao sera exibida novamente. Armazene em local seguro.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono bg-muted p-3 rounded-lg break-all">
                  {newKey}
                </code>
                <Button variant="outline" size="icon" onClick={handleCopyKey}>
                  {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
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
                  placeholder="Ex: Integracao n8n"
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
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
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
              A chave sera desativada imediatamente. Integracoes usando essa chave deixarao de funcionar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              className="bg-destructive hover:bg-destructive/90"
            >
              Revogar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
