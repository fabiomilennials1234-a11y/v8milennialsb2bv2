import { useState, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Webhook as WebhookIcon,
  Plus,
  Edit2,
  Trash2,
  MoreHorizontal,
  Send,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  useWebhooks,
  useCreateWebhook,
  useUpdateWebhook,
  useDeleteWebhook,
  useWebhookDeliveryLogs,
  WEBHOOK_EVENTS,
  HTTP_METHODS,
  Webhook,
  WebhookInsert,
} from "@/modules/platform/hooks/useWebhooks";
import { useOrganization } from "@/modules/identity";
import { useIdentity } from "@/modules/identity";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AlertsBanner } from "@/modules/platform/components/system-alerts/AlertsBanner";

const DEFAULT_HEADERS = [{ key: "", value: "" }];

function parseHeaders(obj: Record<string, string> | null): { key: string; value: string }[] {
  if (!obj || typeof obj !== "object") return [...DEFAULT_HEADERS];
  const entries = Object.entries(obj).filter(([k]) => k.trim() !== "");
  if (entries.length === 0) return [...DEFAULT_HEADERS];
  return entries.map(([key, value]) => ({ key, value }));
}

function headersToObject(arr: { key: string; value: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, value } of arr) {
    if (key.trim()) out[key.trim()] = value;
  }
  return out;
}

/**
 * Uma linha da tabela de webhooks: endpoint + eventos, a última entrega
 * registrada (`webhook_delivery_logs`, o mesmo `useWebhookDeliveryLogs`) e o
 * estado. Sem entrega registrada, diz isso — não inventa sucesso.
 */
function LinhaDeWebhook({ webhook: wh, acoes }: { webhook: Webhook; acoes: ReactNode }) {
  const { data: entregas = [], isLoading } = useWebhookDeliveryLogs(wh.id);
  const ultima = entregas[0];
  const ok = ultima?.status_code != null && ultima.status_code >= 200 && ultima.status_code < 300;
  const eventos = wh.events ?? [];

  return (
    <li className="grid gap-3 px-5 py-3.5 sm:px-6 md:grid-cols-[minmax(0,1fr)_170px_96px_36px] md:items-center md:gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-muted text-foreground/70">
            <WebhookIcon className="h-3.5 w-3.5" aria-hidden />
          </span>
          <p className="truncate text-sm font-bold">{wh.name}</p>
          <span className="ml-auto md:hidden">{acoes}</span>
        </div>
        <p className="mt-1 truncate font-mono text-[12px] text-muted-foreground" title={wh.url}>
          {wh.url}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {eventos.slice(0, 3).map((e) => (
            <span key={e} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-foreground/75">
              {e}
            </span>
          ))}
          {eventos.length > 3 && (
            <span className="px-1 text-[11px] font-semibold text-muted-foreground">+{eventos.length - 3}</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 md:block">
        <span className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground md:hidden">Última entrega</span>
        {isLoading ? (
          <span className="inline-block h-5 w-24 animate-pulse rounded-full bg-muted" />
        ) : ultima ? (
          <span
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-bold tabular-nums",
              ok ? "bg-success/10 text-success-strong" : "bg-destructive/10 text-destructive",
            )}
            title={ultima.error_message ?? undefined}
          >
            <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", ok ? "bg-success" : "bg-destructive")} />
            <span className="truncate">
              {ultima.status_code ?? "falhou"} · {formatDistanceToNow(new Date(ultima.delivered_at), { addSuffix: true, locale: ptBR })}
            </span>
          </span>
        ) : (
          <span className="text-[12px] text-muted-foreground">Sem entregas</span>
        )}
        {wh.consecutive_failures > 0 && (
          <p className="text-[11px] font-semibold text-destructive md:mt-1">
            {wh.consecutive_failures} {wh.consecutive_failures === 1 ? "falha seguida" : "falhas seguidas"}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 md:block">
        <span className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground md:hidden">Estado</span>
        <Badge variant={wh.is_active ? "success" : "soft"} title={wh.disabled_reason ?? undefined}>
          {wh.is_active ? "Ativo" : "Inativo"}
        </Badge>
      </div>

      <div className="hidden justify-end md:flex">{acoes}</div>
    </li>
  );
}

export function WebhookSettings() {
  const { organizationId, isReady } = useOrganization();
  const { isAdmin } = useIdentity();
  const { data: webhooks = [], isLoading } = useWebhooks();
  const createWebhook = useCreateWebhook();
  const updateWebhook = useUpdateWebhook();
  const deleteWebhook = useDeleteWebhook();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<Webhook | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    webhookId: string;
    success: boolean;
    status_code: number | null;
    response_body: string;
    error_message: string | null;
  } | null>(null);
  const [sendingTestId, setSendingTestId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    url: "",
    events: [] as string[],
    http_method: "POST" as "POST" | "PUT" | "PATCH",
    custom_headers: [...DEFAULT_HEADERS],
    is_active: true,
  });

  const openDialog = (webhook?: Webhook) => {
    if (webhook) {
      setEditingWebhook(webhook);
      setFormData({
        name: webhook.name,
        url: webhook.url,
        events: webhook.events ?? [],
        http_method: (webhook.http_method as "POST" | "PUT" | "PATCH") || "POST",
        custom_headers: parseHeaders(webhook.custom_headers as Record<string, string> | null),
        is_active: webhook.is_active ?? true,
      });
    } else {
      setEditingWebhook(null);
      setFormData({
        name: "",
        url: "",
        events: [],
        http_method: "POST",
        custom_headers: [...DEFAULT_HEADERS],
        is_active: true,
      });
    }
    setTestResult(null);
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    if (!formData.url.trim()) {
      toast.error("URL é obrigatória");
      return;
    }
    if (!formData.url.startsWith("https://")) {
      toast.error("A URL deve usar HTTPS");
      return;
    }
    if (formData.events.length === 0) {
      toast.error("Selecione pelo menos um evento");
      return;
    }
    if (!organizationId && !editingWebhook) {
      toast.error("Organização não disponível");
      return;
    }

    // organization_id entra na construção, não depois: o tipo do insert o exige,
    // e preenchê-lo em seguida deixava o literal inválido perante o compilador.
    const payload: WebhookInsert = {
      name: formData.name.trim(),
      url: formData.url.trim(),
      events: formData.events,
      http_method: formData.http_method,
      custom_headers: headersToObject(formData.custom_headers),
      is_active: formData.is_active,
      organization_id: editingWebhook ? editingWebhook.organization_id : organizationId!,
    };

    try {
      if (editingWebhook) {
        await updateWebhook.mutateAsync({ id: editingWebhook.id, ...payload });
        toast.success("Webhook atualizado!");
      } else {
        await createWebhook.mutateAsync(payload);
        toast.success("Webhook criado!");
      }
      setIsDialogOpen(false);
      setEditingWebhook(null);
    } catch (err) {
      toast.error("Erro ao salvar webhook");
      console.error(err);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteWebhook.mutateAsync(deleteId);
      toast.success("Webhook removido!");
      setDeleteId(null);
    } catch (err) {
      toast.error("Erro ao remover webhook");
      console.error(err);
    }
  };

  const handleSendTest = async (webhookId: string) => {
    setSendingTestId(webhookId);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("webhook-send-test", {
        body: { webhook_id: webhookId },
      });
      if (error) throw error;
      setTestResult({
        webhookId,
        success: data?.success ?? false,
        status_code: data?.status_code ?? null,
        response_body: data?.response_body ?? "",
        error_message: data?.error_message ?? null,
      });
      if (data?.success) toast.success("Teste enviado com sucesso");
      else toast.error(data?.error_message || "Falha no envio");
    } catch (err) {
      toast.error("Erro ao enviar teste");
      setTestResult({
        webhookId,
        success: false,
        status_code: null,
        response_body: "",
        error_message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSendingTestId(null);
    }
  };

  const addHeaderRow = () => {
    setFormData((prev) => ({
      ...prev,
      custom_headers: [...prev.custom_headers, { key: "", value: "" }],
    }));
  };

  const updateHeaderRow = (index: number, field: "key" | "value", value: string) => {
    setFormData((prev) => {
      const next = [...prev.custom_headers];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, custom_headers: next };
    });
  };

  const removeHeaderRow = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      custom_headers: prev.custom_headers.filter((_, i) => i !== index),
    }));
  };

  if (!isReady && !organizationId) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        Carregando organização...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Onda 2: alerts críticos webhook circuit breaker */}
      <AlertsBanner category="webhook_circuit_breaker" organizationId={organizationId} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold tracking-tight">Webhooks</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Eventos do CRM enviados para as suas URLs (leads criados/atualizados, etc.)
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => openDialog()} size="sm" variant="ink">
            <Plus />
            Novo webhook
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : webhooks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          Nenhum webhook configurado
        </div>
      ) : (
        <div className="-mx-5 sm:-mx-6">
          {/* Cabeçalho de coluna — some no celular, onde cada linha empilha. */}
          <div
            aria-hidden
            className="hidden grid-cols-[minmax(0,1fr)_170px_96px_36px] gap-4 border-y border-border bg-muted/40 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground sm:px-6 md:grid"
          >
            <span>Endpoint</span>
            <span>Última entrega</span>
            <span>Estado</span>
            <span />
          </div>
          <ul className="divide-y divide-border border-b border-border max-md:border-t">
            {webhooks.map((wh) => (
              <LinhaDeWebhook
                key={wh.id}
                webhook={wh}
                acoes={
                  isAdmin ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Ações do webhook ${wh.name}`}>
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openDialog(wh)}>
                          <Edit2 className="w-4 h-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleSendTest(wh.id)}
                          disabled={sendingTestId === wh.id}
                        >
                          {sendingTestId === wh.id ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4 mr-2" />
                          )}
                          Enviar teste
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setDeleteId(wh.id)}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Remover
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null
                }
              />
            ))}
          </ul>
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingWebhook ? "Editar webhook" : "Novo webhook"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="wh-name">Nome</Label>
              <Input
                id="wh-name"
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder="Ex: Integração CRM"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wh-url">URL (HTTPS)</Label>
              <Input
                id="wh-url"
                type="url"
                value={formData.url}
                onChange={(e) => setFormData((p) => ({ ...p, url: e.target.value }))}
                placeholder="https://seu-endpoint.com/webhook"
              />
            </div>
            <div className="grid gap-2">
              <Label>Eventos</Label>
              <div className="flex flex-wrap gap-2">
                {WEBHOOK_EVENTS.map((ev) => (
                  <label key={ev.value} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={formData.events.includes(ev.value)}
                      onCheckedChange={(checked) => {
                        setFormData((p) => ({
                          ...p,
                          events: checked
                            ? [...p.events, ev.value]
                            : p.events.filter((e) => e !== ev.value),
                        }));
                      }}
                    />
                    <span className="text-sm">{ev.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Método HTTP</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
                value={formData.http_method}
                onChange={(e) =>
                  setFormData((p) => ({
                    ...p,
                    http_method: e.target.value as "POST" | "PUT" | "PATCH",
                  }))
                }
              >
                {HTTP_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label>Headers customizados (opcional)</Label>
              {formData.custom_headers.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder="Nome (ex: Authorization)"
                    value={row.key}
                    onChange={(e) => updateHeaderRow(i, "key", e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    placeholder="Valor"
                    value={row.value}
                    onChange={(e) => updateHeaderRow(i, "value", e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeHeaderRow(i)}
                    className="shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addHeaderRow}>
                Adicionar header
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="wh-active"
                checked={formData.is_active}
                onCheckedChange={(v) => setFormData((p) => ({ ...p, is_active: v }))}
              />
              <Label htmlFor="wh-active">Ativo</Label>
            </div>
            {testResult && testResult.webhookId === editingWebhook?.id && (
              <div className="rounded-xl border border-border p-3 text-sm">
                <p className="font-medium">
                  {testResult.success ? "Teste enviado com sucesso" : "Falha no teste"}
                </p>
                {testResult.status_code != null && (
                  <p>Status: {testResult.status_code}</p>
                )}
                {testResult.error_message && (
                  <p className="text-destructive">{testResult.error_message}</p>
                )}
                {testResult.response_body && (
                  <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-muted p-2 text-xs">
                    {testResult.response_body}
                  </pre>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="flex-wrap gap-2">
            {editingWebhook && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleSendTest(editingWebhook.id)}
                disabled={sendingTestId === editingWebhook.id}
                className="mr-auto"
              >
                {sendingTestId === editingWebhook.id ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                Enviar teste
              </Button>
            )}
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit}>
              {editingWebhook ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O endpoint deixará de receber eventos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
