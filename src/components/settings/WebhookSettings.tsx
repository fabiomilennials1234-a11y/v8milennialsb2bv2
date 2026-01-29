import { useState } from "react";
import { motion } from "framer-motion";
import {
  Webhook as WebhookIcon,
  Plus,
  Edit2,
  Trash2,
  MoreHorizontal,
  Send,
  Loader2,
  Copy,
  Inbox,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  useWebhooks,
  useCreateWebhook,
  useUpdateWebhook,
  useDeleteWebhook,
  WEBHOOK_EVENTS,
  HTTP_METHODS,
  Webhook,
  WebhookInsert,
} from "@/hooks/useWebhooks";
import { useOrganization } from "@/hooks/useOrganization";
import { useIsAdmin } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

export function WebhookSettings() {
  const { organizationId, isReady } = useOrganization();
  const { isAdmin } = useIsAdmin();
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

    const payload: WebhookInsert = {
      name: formData.name.trim(),
      url: formData.url.trim(),
      events: formData.events,
      http_method: formData.http_method,
      custom_headers: headersToObject(formData.custom_headers),
      is_active: formData.is_active,
    };
    if (editingWebhook) {
      payload.organization_id = editingWebhook.organization_id;
    } else {
      payload.organization_id = organizationId!;
    }

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

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
  const leadWebhookUrl = supabaseUrl ? `${supabaseUrl}/functions/v1/lead-webhook` : "";
  const leadWebhookPayloadExample = JSON.stringify(
    {
      source: "meta_ads",
      organization_id: organizationId ?? "<uuid-da-organizacao>",
      campaign_id: "opcional",
      campaign_name: "opcional",
      tags: ["tag1"],
      fields: {
        name: "Nome do lead",
        phone: "5511999999999",
        email: "lead@email.com",
        company: "Empresa",
      },
    },
    null,
    2
  );

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copiado`),
      () => toast.error("Falha ao copiar")
    );
  };

  return (
    <div className="space-y-4">
      {/* Webhook inbound: integrar fontes externas */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Inbox className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-medium">Integrar fontes externas</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Use esta URL para enviar leads ao sistema (Facebook Lead Ads, Zapier, formulários, etc.). Os leads serão criados ou atualizados conforme phone/email.
        </p>
        {leadWebhookUrl ? (
          <>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">URL</Label>
              <div className="flex gap-2 items-center">
                <code className="flex-1 text-xs bg-muted px-2 py-1.5 rounded truncate">
                  {leadWebhookUrl}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(leadWebhookUrl, "URL")}
                  className="shrink-0"
                >
                  <Copy className="w-4 h-4 mr-1" />
                  Copiar URL
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Método e header</Label>
              <p className="text-xs text-muted-foreground">
                Método: <strong>POST</strong>. Envie o header <code className="bg-muted px-1 rounded">x-webhook-key</code> com a chave fornecida pelo administrador; use o mesmo valor ao chamar de Facebook, Zapier ou outras integrações.
              </p>
            </div>
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="text-xs">
                  Ver exemplo de payload
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 flex gap-2">
                  <pre className="flex-1 text-xs bg-muted p-3 rounded overflow-auto max-h-48">
                    {leadWebhookPayloadExample}
                  </pre>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(leadWebhookPayloadExample, "Exemplo")}
                    className="shrink-0 self-start"
                  >
                    <Copy className="w-4 h-4 mr-1" />
                    Copiar
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">URL não disponível (configure VITE_SUPABASE_URL).</p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Webhooks</h3>
          <p className="text-sm text-muted-foreground">
            Configure endpoints para receber eventos (leads criados/atualizados, etc.)
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => openDialog()} size="sm" className="gap-2">
            <Plus className="w-4 h-4" />
            Novo webhook
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : webhooks.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
          Nenhum webhook configurado
        </div>
      ) : (
        <div className="grid gap-3">
          {webhooks.map((wh) => (
            <motion.div
              key={wh.id}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <WebhookIcon className="w-5 h-5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium truncate">{wh.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{wh.url}</p>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {(wh.events ?? []).slice(0, 3).map((e) => (
                      <span key={e} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {e}
                      </span>
                    ))}
                    {(wh.events?.length ?? 0) > 3 && (
                      <span className="text-xs text-muted-foreground">
                        +{(wh.events?.length ?? 0) - 3}
                      </span>
                    )}
                  </div>
                </div>
                {!wh.is_active && (
                  <Badge variant="secondary" className="shrink-0">
                    Inativo
                  </Badge>
                )}
              </div>
              {isAdmin && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
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
              )}
            </motion.div>
          ))}
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
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
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
              <div className="rounded-md border p-3 text-sm">
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
                  <pre className="mt-2 overflow-auto max-h-24 text-xs bg-muted p-2 rounded">
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
