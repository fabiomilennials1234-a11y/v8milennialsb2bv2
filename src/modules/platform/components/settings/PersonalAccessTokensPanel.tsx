/**
 * PersonalAccessTokensPanel — manage crm-mcp Personal Access Tokens
 * (.specs/features/crm-mcp/DESIGN.md §7.5). Distinct from ApiKeysPanel (org REST keys):
 * a PAT is PER-USER, read-only, and inherits exactly the creator's own RLS visibility — it
 * is the credential a customer pastes into their own AI/MCP client.
 */
import { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Loader2,
  Plug,
  Plus,
  ShieldAlert,
  Sparkles,
  Trash2,
  Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  type CreatedPat,
  useCreatePersonalAccessToken,
  usePersonalAccessTokens,
  useRevokePersonalAccessToken,
} from "@/modules/platform/hooks/usePersonalAccessTokens";
import { useIdentity } from "@/modules/identity";
import { buildMcpConfig, isExpired } from "@/modules/platform/lib/pat-display";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const MCP_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL ?? ""}/functions/v1/crm-mcp`;

const EXPIRY_PRESETS = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "60", label: "60 dias" },
  { value: "90", label: "90 dias" },
  { value: "365", label: "365 dias" },
];

const connectionSnippet = (token: string) => buildMcpConfig(MCP_ENDPOINT, token);

export function PersonalAccessTokensPanel() {
  const { data: tokens = [], isLoading } = usePersonalAccessTokens();
  const createPat = useCreatePersonalAccessToken();
  const revokePat = useRevokePersonalAccessToken();
  const { isAdmin } = useIdentity();

  const [createOpen, setCreateOpen] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [newPat, setNewPat] = useState<CreatedPat | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [expiryDays, setExpiryDays] = useState("90");

  const now = Date.now();
  const active = tokens.filter((t) => !t.revoked_at && !isExpired(t, now));
  const inactive = tokens.filter((t) => t.revoked_at || isExpired(t, now));

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      const result = await createPat.mutateAsync({
        name: name.trim(),
        expires_in_days: Number(expiryDays),
      });
      setNewPat(result); // keep dialog open → reveal token once
    } catch {
      // toast handled by hook
    }
  };

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const resetForm = () => {
    setName("");
    setExpiryDays("90");
    setNewPat(null);
    setCopied(null);
  };

  const handleClose = (open: boolean) => {
    if (!open) resetForm();
    setCreateOpen(open);
  };

  const handleRevoke = async () => {
    if (!revokeId) return;
    await revokePat.mutateAsync(revokeId);
    setRevokeId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Tokens de acesso (IA / MCP)
          </h3>
          <p className="text-sm text-muted-foreground max-w-xl">
            Conecte a sua própria IA (Claude e outros clientes MCP) aos seus dados do CRM.
            Cada token é pessoal, <strong>somente leitura</strong> e enxerga exatamente o que
            você já vê — nada além.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2 shrink-0">
          <Plus className="w-4 h-4" />
          Novo token
        </Button>
      </div>

      {/* Always-visible MCP info: what it is + the endpoint to point an MCP client at. */}
      <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Plug className="w-4 h-4 text-primary" />
          Servidor MCP do Torque
        </div>
        <p className="text-xs text-muted-foreground">
          O Torque expõe um servidor <strong>MCP (Model Context Protocol)</strong>. Aponte o
          Claude (ou outro cliente MCP) para o endpoint abaixo e autentique com um token pessoal
          criado aqui. Funciona via <span className="font-mono">Authorization: Bearer &lt;token&gt;</span>.
        </p>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Endpoint MCP</Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-background border border-border/60 rounded px-2 py-1.5 break-all">
              {MCP_ENDPOINT}
            </code>
            <Button variant="outline" size="icon" onClick={() => copy(MCP_ENDPOINT, "endpoint")}>
              {copied === "endpoint"
                ? <Check className="w-4 h-4 text-emerald-500" />
                : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            Você é admin — um token seu enxerga praticamente <strong>toda a organização</strong>.
            Crie apenas o necessário e revogue quando não usar mais.
          </p>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-500" />
            Ativos ({active.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading
            ? (
              <div className="space-y-2">
                {[1, 2].map((i) => <Skeleton key={i} className="h-16" />)}
              </div>
            )
            : active.length === 0
            ? (
              <div className="text-center py-8">
                <Unplug className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  Nenhum token ativo. Crie um para conectar a sua IA.
                </p>
              </div>
            )
            : (
              <div className="space-y-2">
                {active.map((t) => (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{t.name}</p>
                        <code className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                          {t.token_prefix}…
                        </code>
                        <Badge variant="secondary" className="text-[10px]">somente leitura</Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
                        {t.last_used_at
                          ? (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              usado {formatDistanceToNow(new Date(t.last_used_at), {
                                addSuffix: true,
                                locale: ptBR,
                              })}
                            </span>
                          )
                          : <span>nunca usado</span>}
                        <span>expira {format(new Date(t.expires_at), "dd/MM/yyyy")}</span>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs text-destructive shrink-0"
                      onClick={() => setRevokeId(t.id)}
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

      {inactive.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground">
              Inativos ({inactive.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {inactive.slice(0, 5).map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 opacity-50"
                >
                  <div>
                    <p className="text-sm line-through">{t.name}</p>
                    <code className="text-[10px] text-muted-foreground font-mono">
                      {t.token_prefix}… · {t.revoked_at ? "revogado" : "expirado"}
                    </code>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create / reveal dialog */}
      <Dialog open={createOpen} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              {newPat ? "Token criado" : "Novo token de acesso"}
            </DialogTitle>
          </DialogHeader>

          {newPat
            ? (
              <div className="space-y-4 py-2">
                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Copie agora</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Este token não será exibido novamente. Guarde-o em local seguro.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <code className="flex-1 text-sm font-mono bg-muted p-3 rounded-lg break-all">
                    {newPat.token}
                  </code>
                  <Button variant="outline" size="icon" onClick={() => copy(newPat.token, "token")}>
                    {copied === "token"
                      ? <Check className="w-4 h-4 text-emerald-500" />
                      : <Copy className="w-4 h-4" />}
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Como conectar (Claude Desktop)</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => copy(connectionSnippet(newPat.token), "config")}
                    >
                      {copied === "config"
                        ? <Check className="w-3 h-3 text-emerald-500" />
                        : <Copy className="w-3 h-3" />}
                      Copiar config
                    </Button>
                  </div>
                  <pre className="text-[11px] font-mono bg-muted p-3 rounded-lg overflow-x-auto leading-relaxed">
{connectionSnippet(newPat.token)}
                  </pre>
                </div>

                <DialogFooter>
                  <Button onClick={() => handleClose(false)}>Concluir</Button>
                </DialogFooter>
              </div>
            )
            : (
              <div className="space-y-4 py-2">
                <div className="grid gap-2">
                  <Label>Nome *</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Meu Claude Desktop"
                    autoFocus
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Expira em</Label>
                  <Select value={expiryDays} onValueChange={setExpiryDays}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_PRESETS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Acesso somente leitura, limitado à sua visão. Sem opção “nunca expira”.
                  </p>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => handleClose(false)}>Cancelar</Button>
                  <Button onClick={handleCreate} disabled={!name.trim() || createPat.isPending}>
                    {createPat.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Criar token
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
            <AlertDialogTitle>Revogar token?</AlertDialogTitle>
            <AlertDialogDescription>
              O token deixa de funcionar imediatamente. Qualquer IA conectada com ele perde o
              acesso. Esta ação não pode ser desfeita.
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
