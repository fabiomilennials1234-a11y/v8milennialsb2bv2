import { useState, useEffect, lazy, Suspense } from "react";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { useThemeTransition } from "@/contexts/ThemeTransitionContext";
import {
  Settings,
  Tag,
  Plus,
  Edit2,
  Trash2,
  Palette,
  Shield,
  Bell,
  Database,
  Globe,
  MoreHorizontal,
  MessageSquare,
  Calendar,
  Webhook,
  HelpCircle,
  Plug,
  Code,
  Timer,
  Key,
  FlaskConical,
  ClipboardList,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
import { useTags, useCreateTag, useUpdateTag, useDeleteTag, Tag as TagType } from "@/hooks/useTags";
import { useIsAdmin } from "@/hooks/useUserRole";
import { useOrganizationSettings } from "@/hooks/useOrganizationSettings";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";

// Lazy imports — cada tab carrega só quando ativada.
// Bundle inicial cai de ~948KB pra ~150KB.
const WhatsAppSettings = lazy(() =>
  import("@/components/settings/WhatsAppSettings").then((m) => ({
    default: m.WhatsAppSettings,
  }))
);
const WebhookSettings = lazy(() =>
  import("@/components/settings/WebhookSettings").then((m) => ({
    default: m.WebhookSettings,
  }))
);
const IntegrationsCatalog = lazy(() =>
  import("@/components/settings/IntegrationsCatalog")
);
const HelpCenter = lazy(() =>
  import("@/components/settings/help/HelpCenter").then((m) => ({
    default: m.HelpCenter,
  }))
);
const MilestonesConfig = lazy(() =>
  import("@/components/settings/MilestonesConfig").then((m) => ({
    default: m.MilestonesConfig,
  }))
);
const ApiDocsSettings = lazy(() =>
  import("@/components/settings/api-docs/ApiDocsSettings").then((m) => ({
    default: m.ApiDocsSettings,
  }))
);
const SlaConfigPanel = lazy(() =>
  import("@/components/settings/SlaConfigPanel").then((m) => ({
    default: m.SlaConfigPanel,
  }))
);
const LgpdPanel = lazy(() =>
  import("@/components/settings/LgpdPanel").then((m) => ({
    default: m.LgpdPanel,
  }))
);
const ApiKeysPanel = lazy(() =>
  import("@/components/settings/ApiKeysPanel").then((m) => ({
    default: m.ApiKeysPanel,
  }))
);
const SandboxPanel = lazy(() =>
  import("@/components/settings/SandboxPanel").then((m) => ({
    default: m.SandboxPanel,
  }))
);
const ApprovalRulesConfig = lazy(() =>
  import("@/components/approvals/ApprovalRulesConfig").then((m) => ({
    default: m.ApprovalRulesConfig,
  }))
);
const ChecklistTemplatesManager = lazy(() =>
  import("@/components/checklists/ChecklistTemplatesManager").then((m) => ({
    default: m.ChecklistTemplatesManager,
  }))
);

const colorOptions = [
  "#F5C518", "#22C55E", "#3B82F6", "#8B5CF6", "#EF4444",
  "#F97316", "#EC4899", "#14B8A6", "#6366F1", "#84CC16"
];

function TabFallback({ label }: { label: string }) {
  return (
    <div className="h-[400px] flex items-center justify-center text-sm text-muted-foreground">
      Carregando {label}...
    </div>
  );
}

function TagsSettings() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<TagType | null>(null);
  const [formData, setFormData] = useState({ name: "", color: "#F5C518" });
  const [deleteTagId, setDeleteTagId] = useState<string | null>(null);

  const { data: tags = [], isLoading } = useTags();
  const createTag = useCreateTag();
  const updateTag = useUpdateTag();
  const deleteTag = useDeleteTag();
  const { isAdmin } = useIsAdmin();

  const handleOpenDialog = (tag?: TagType) => {
    if (tag) {
      setEditingTag(tag);
      setFormData({ name: tag.name, color: tag.color || "#F5C518" });
    } else {
      setEditingTag(null);
      setFormData({ name: "", color: "#F5C518" });
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }

    try {
      if (editingTag) {
        await updateTag.mutateAsync({ id: editingTag.id, ...formData });
        toast.success("Tag atualizada!");
      } else {
        await createTag.mutateAsync(formData);
        toast.success("Tag criada!");
      }
      setIsDialogOpen(false);
      setFormData({ name: "", color: "#F5C518" });
      setEditingTag(null);
    } catch (error) {
      toast.error("Erro ao salvar tag");
      console.error(error);
    }
  };

  const handleDelete = async () => {
    if (!deleteTagId) return;
    try {
      await deleteTag.mutateAsync(deleteTagId);
      toast.success("Tag removida!");
      setDeleteTagId(null);
    } catch (error) {
      toast.error("Erro ao remover tag");
      console.error(error);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Tags de Leads</h3>
          <p className="text-sm text-muted-foreground">
            Crie e gerencie tags para organizar seus leads
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => handleOpenDialog()} size="sm" className="gap-2">
            <Plus className="w-4 h-4" />
            Nova Tag
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : tags.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
          Nenhuma tag cadastrada
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {tags.map((tag) => (
            <motion.div
              key={tag.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: tag.color || "#F5C518" }}
                />
                <span className="text-sm font-medium">{tag.name}</span>
              </div>
              {isAdmin && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleOpenDialog(tag)}>
                      <Edit2 className="w-4 h-4 mr-2" />
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      className="text-destructive"
                      onClick={() => setDeleteTagId(tag.id)}
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

      {/* Tag Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTag ? "Editar Tag" : "Nova Tag"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="tag-name">Nome</Label>
              <Input
                id="tag-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ex: Hot Lead, Prioritário..."
              />
            </div>
            <div className="grid gap-2">
              <Label>Cor</Label>
              <div className="flex flex-wrap gap-2">
                {colorOptions.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setFormData({ ...formData, color })}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      formData.color === color
                        ? "border-primary scale-110"
                        : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label>Preview:</Label>
              <Badge
                variant="outline"
                style={{
                  backgroundColor: `${formData.color}20`,
                  borderColor: `${formData.color}40`,
                  color: formData.color,
                }}
              >
                <Tag className="w-3 h-3 mr-1" />
                {formData.name || "Nome da tag"}
              </Badge>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={createTag.isPending || updateTag.isPending}>
              {editingTag ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTagId} onOpenChange={() => setDeleteTagId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Tag?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A tag será removida de todos os leads.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NotificationSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Notificações</h3>
        <p className="text-sm text-muted-foreground">
          Configure quando e como receber notificações
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-0.5">
            <Label>Novas reuniões agendadas</Label>
            <p className="text-sm text-muted-foreground">
              Receba uma notificação quando um lead agendar uma reunião
            </p>
          </div>
          <Switch defaultChecked />
        </div>

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-0.5">
            <Label>Vendas fechadas</Label>
            <p className="text-sm text-muted-foreground">
              Receba uma notificação quando uma venda for fechada
            </p>
          </div>
          <Switch defaultChecked />
        </div>

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-0.5">
            <Label>Lembrete de reuniões</Label>
            <p className="text-sm text-muted-foreground">
              Receba lembretes 1 hora antes das reuniões
            </p>
          </div>
          <Switch defaultChecked />
        </div>

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-0.5">
            <Label>Metas atingidas</Label>
            <p className="text-sm text-muted-foreground">
              Receba uma notificação quando atingir uma meta
            </p>
          </div>
          <Switch defaultChecked />
        </div>
      </div>
    </div>
  );
}

function ConfirmacaoOverdueSettings() {
  const { settings, isAdmin, updateSettings, isUpdating } = useOrganizationSettings();
  const [localDays, setLocalDays] = useState(settings.confirmacao_overdue_days);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLocalDays(settings.confirmacao_overdue_days);
  }, [settings.confirmacao_overdue_days]);

  const handleSave = async () => {
    const value = Math.min(365, Math.max(1, Number(localDays) || 5));
    try {
      await updateSettings({ confirmacao_overdue_days: value });
      setLocalDays(value);
      setSaved(true);
      toast.success("Configuração salva!");
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      toast.error("Erro ao salvar");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">Pipe de Confirmação</h3>
        <p className="text-sm text-muted-foreground">
          Quando um lead deve aparecer como &quot;Atrasada&quot; (dias sem interação)
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor="confirmacao-overdue-days">Dias sem interação para considerar atrasado</Label>
          <Input
            id="confirmacao-overdue-days"
            type="number"
            min={1}
            max={365}
            value={localDays}
            onChange={(e) => setLocalDays(Number(e.target.value) || 5)}
            disabled={!isAdmin}
            className="w-24"
          />
        </div>
        {isAdmin && (
          <Button
            onClick={handleSave}
            disabled={isUpdating || localDays === settings.confirmacao_overdue_days}
          >
            {isUpdating ? "Salvando..." : saved ? "Salvo!" : "Salvar"}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Leads que não tiverem nenhuma atualização (status, data, notas) há esse número de dias aparecem como &quot;Atrasadas&quot; no pipe. Itens em Remarcar com atividade recente não entram.
      </p>
    </div>
  );
}

function GeneralSettings() {
  const { setTheme, resolvedTheme } = useTheme();
  const transition = useThemeTransition();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark =
    mounted &&
    (resolvedTheme === "dark" ||
      (typeof document !== "undefined" && document.documentElement.classList.contains("dark")));

  const handleDarkModeChange = (checked: boolean) => {
    const newTheme = checked ? "dark" : "light";
    if (transition) transition.requestThemeChange(newTheme);
    else {
      setTheme(newTheme);
      const root = document.documentElement;
      if (newTheme === "light") root.classList.remove("dark");
      else root.classList.add("dark");
      localStorage.setItem("v8-theme", newTheme);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Configurações Gerais</h3>
        <p className="text-sm text-muted-foreground">
          Configurações gerais do sistema
        </p>
      </div>

      <div className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="company-name">Nome da Empresa</Label>
          <Input id="company-name" defaultValue="Torque CRM" />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="timezone">Fuso Horário</Label>
          <Input id="timezone" defaultValue="America/Sao_Paulo" disabled />
        </div>

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-0.5">
            <Label>Modo escuro</Label>
            <p className="text-sm text-muted-foreground">
              Ativar tema escuro no sistema
            </p>
          </div>
          <Switch
            checked={mounted ? !!isDark : false}
            onCheckedChange={handleDarkModeChange}
          />
        </div>

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-0.5">
            <Label>Animações</Label>
            <p className="text-sm text-muted-foreground">
              Ativar animações e transições
            </p>
          </div>
          <Switch defaultChecked />
        </div>
      </div>

      <div className="pt-6 border-t border-border">
        <ConfirmacaoOverdueSettings />
      </div>
    </div>
  );
}

export default function Configuracoes() {
  const { orgType } = useOrganization();
  const totalTabs = orgType === "outbound" ? 15 : 14;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-bold flex items-center gap-2"
        >
          <Settings className="w-6 h-6 text-primary" />
          Configurações
        </motion.h1>
        <p className="text-muted-foreground mt-1">
          Gerencie as configurações do sistema
        </p>
      </div>

      <Tabs defaultValue="tags" className="w-full">
        <TabsList className={`grid w-full max-w-5xl`} style={{ gridTemplateColumns: `repeat(${totalTabs}, minmax(0, 1fr))` }}>
          <TabsTrigger value="tags" className="gap-2">
            <Tag className="w-4 h-4" />
            Tags
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="w-4 h-4" />
            Notificações
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-2">
            <MessageSquare className="w-4 h-4" />
            WhatsApp
          </TabsTrigger>
          <TabsTrigger value="integracoes" className="gap-2">
            <Plug className="w-4 h-4" />
            Integrações
          </TabsTrigger>
          <TabsTrigger value="webhooks" className="gap-2">
            <Webhook className="w-4 h-4" />
            Webhooks
          </TabsTrigger>
          <TabsTrigger value="api" className="gap-2">
            <Code className="w-4 h-4" />
            API
          </TabsTrigger>
          <TabsTrigger value="sla" className="gap-2">
            <Timer className="w-4 h-4" />
            SLA
          </TabsTrigger>
          <TabsTrigger value="aprovacoes" className="gap-2">
            <Shield className="w-4 h-4" />
            Aprovacoes
          </TabsTrigger>
          <TabsTrigger value="lgpd" className="gap-2">
            <Shield className="w-4 h-4" />
            LGPD
          </TabsTrigger>
          <TabsTrigger value="api-keys" className="gap-2">
            <Key className="w-4 h-4" />
            API Keys
          </TabsTrigger>
          <TabsTrigger value="sandbox" className="gap-2">
            <FlaskConical className="w-4 h-4" />
            Sandbox
          </TabsTrigger>
          <TabsTrigger value="checklists" className="gap-2">
            <ClipboardList className="w-4 h-4" />
            Checklists
          </TabsTrigger>
          <TabsTrigger value="general" className="gap-2">
            <Settings className="w-4 h-4" />
            Geral
          </TabsTrigger>
          {orgType === "outbound" && (
            <TabsTrigger value="marcos">Marcos & Badges</TabsTrigger>
          )}
          <TabsTrigger value="ajuda" className="gap-2">
            <HelpCircle className="w-4 h-4" />
            Ajuda
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="tags">
            <Card className="glass-card">
              <CardContent className="pt-6">
                <TagsSettings />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications">
            <Card className="glass-card">
              <CardContent className="pt-6">
                <NotificationSettings />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="whatsapp">
            <Suspense fallback={<TabFallback label="WhatsApp" />}>
              <Card className="glass-card">
                <CardContent className="pt-6">
                  <WhatsAppSettings />
                </CardContent>
              </Card>
            </Suspense>
          </TabsContent>

          <TabsContent value="integracoes">
            <Suspense fallback={<TabFallback label="Integrações" />}>
              <IntegrationsCatalog />
            </Suspense>
          </TabsContent>

          <TabsContent value="webhooks">
            <Suspense fallback={<TabFallback label="Webhooks" />}>
              <Card className="glass-card">
                <CardContent className="pt-6">
                  <WebhookSettings />
                </CardContent>
              </Card>
            </Suspense>
          </TabsContent>

          <TabsContent value="api">
            <Suspense fallback={<TabFallback label="documentação" />}>
              <ApiDocsSettings />
            </Suspense>
          </TabsContent>

          <TabsContent value="sla">
            <Suspense fallback={<TabFallback label="SLA" />}>
              <Card className="glass-card">
                <CardContent className="pt-6">
                  <SlaConfigPanel />
                </CardContent>
              </Card>
            </Suspense>
          </TabsContent>

          <TabsContent value="aprovacoes">
            <Suspense fallback={<TabFallback label="Aprovacoes" />}>
              <Card className="glass-card">
                <CardContent className="pt-6">
                  <ApprovalRulesConfig />
                </CardContent>
              </Card>
            </Suspense>
          </TabsContent>

          <TabsContent value="lgpd">
            <Suspense fallback={<TabFallback label="LGPD" />}>
              <Card className="glass-card">
                <CardContent className="pt-6">
                  <LgpdPanel />
                </CardContent>
              </Card>
            </Suspense>
          </TabsContent>

          <TabsContent value="api-keys">
            <Suspense fallback={<TabFallback label="API Keys" />}>
              <Card className="glass-card">
                <CardContent className="pt-6">
                  <ApiKeysPanel />
                </CardContent>
              </Card>
            </Suspense>
          </TabsContent>

          <TabsContent value="sandbox">
            <Suspense fallback={<TabFallback label="Sandbox" />}>
              <Card className="glass-card">
                <CardContent className="pt-6">
                  <SandboxPanel />
                </CardContent>
              </Card>
            </Suspense>
          </TabsContent>

          <TabsContent value="checklists">
            <Suspense fallback={<TabFallback label="Checklists" />}>
              <Card className="glass-card">
                <CardContent className="pt-6">
                  <ChecklistTemplatesManager />
                </CardContent>
              </Card>
            </Suspense>
          </TabsContent>

          <TabsContent value="general">
            <Card className="glass-card">
              <CardContent className="pt-6">
                <GeneralSettings />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ajuda">
            <Suspense fallback={<TabFallback label="Central de Ajuda" />}>
              <Card className="glass-card">
                <CardContent className="pt-6">
                  <HelpCenter />
                </CardContent>
              </Card>
            </Suspense>
          </TabsContent>

          {orgType === "outbound" && (
            <TabsContent value="marcos">
              <Suspense fallback={<TabFallback label="Marcos" />}>
                <MilestonesConfig />
              </Suspense>
            </TabsContent>
          )}

        </div>
      </Tabs>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="w-4 h-4 text-primary" />
              Banco de Dados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Status: Conectado</p>
            <Badge className="mt-2 bg-success/20 text-success border-success/30">
              Online
            </Badge>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" />
              Segurança
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">RLS: Ativo</p>
            <Badge className="mt-2 bg-success/20 text-success border-success/30">
              Protegido
            </Badge>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              API
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Latência: {"<"}50ms</p>
            <Badge className="mt-2 bg-success/20 text-success border-success/30">
              Rápido
            </Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
