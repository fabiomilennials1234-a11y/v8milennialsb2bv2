import { useState, useEffect, useMemo, lazy, Suspense, type ElementType, type ReactNode } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { usePipelineDisplayConfig } from "@/modules/pipelines";
import { NOME_DE_FABRICA } from "@/contracts/pipe";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { useThemeTransition } from "@/contexts/ThemeTransitionContext";
import {
  Tag,
  Plus,
  Edit2,
  Trash2,
  Shield,
  Database,
  Globe,
  MoreHorizontal,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PreferenciasDeAviso } from "@/modules/platform/components/notifications/PreferenciasDeAviso";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTags, useCreateTag, useUpdateTag, useDeleteTag, Tag as TagType } from "@/modules/leads/hooks/useTags";
import { useFunisDaOrg } from "@/modules/pipelines";
import { useIdentity } from "@/modules/identity";
import { useOrganizationSettings } from "@/modules/identity";
import { useOrganization } from "@/modules/identity";
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_BASE_PATH,
  SETTINGS_OTHERS_PATH,
  SETTINGS_OTHERS_SLUG,
  isPrimarySettingsTab,
  resolveSettingsTab,
  settingsTabPath,
  visibleOtherSettingsTabs,
  visibleSettingsTabs,
} from "@/modules/platform/lib/settings-tabs";
import { toast } from "sonner";
import { useSupportPanel } from "../components/support/SupportPanelContext";
import { useSupportAvailable } from "../components/support/useSupportAvailable";

const BillingSettings = lazy(() => import("@/modules/billing").then(m => ({ default: m.BillingSettings })));

// Lazy imports — cada tab carrega só quando ativada.
// Bundle inicial cai de ~948KB pra ~150KB.
const WhatsAppSettings = lazy(() =>
  import("@/modules/platform/components/settings/WhatsAppSettings").then((m) => ({
    default: m.WhatsAppSettings,
  }))
);
const WebhookSettings = lazy(() =>
  import("@/modules/platform/components/settings/WebhookSettings").then((m) => ({
    default: m.WebhookSettings,
  }))
);
const IntegrationsCatalog = lazy(() =>
  import("@/modules/platform/components/settings/IntegrationsCatalog")
);
const HelpAdminPanel = lazy(() =>
  import("@/modules/platform/components/settings/help/HelpAdminPanel").then((m) => ({
    default: m.HelpAdminPanel,
  }))
);
const MilestonesConfig = lazy(() =>
  import("@/modules/platform/components/settings/MilestonesConfig").then((m) => ({
    default: m.MilestonesConfig,
  }))
);
const ApiDocsSettings = lazy(() =>
  import("@/modules/platform/components/settings/api-docs/ApiDocsSettings").then((m) => ({
    default: m.ApiDocsSettings,
  }))
);
const SlaConfigPanel = lazy(() =>
  import("@/modules/platform/components/settings/SlaConfigPanel").then((m) => ({
    default: m.SlaConfigPanel,
  }))
);
const SandboxPanel = lazy(() =>
  import("@/modules/platform/components/settings/SandboxPanel").then((m) => ({
    default: m.SandboxPanel,
  }))
);
const ChecklistTemplatesManager = lazy(() =>
  import("@/modules/engagement/components/checklists/ChecklistTemplatesManager").then((m) => ({
    default: m.ChecklistTemplatesManager,
  }))
);
const OraculoPerfilSettings = lazy(() =>
  import("@/modules/copilot").then((m) => ({ default: m.OraculoPerfilSettings }))
);
const ApiKeysPanel = lazy(() =>
  import("@/modules/platform/components/settings/ApiKeysPanel").then((m) => ({
    default: m.ApiKeysPanel,
  }))
);

const colorOptions = [
  "#F5C518", "#22C55E", "#3B82F6", "#8B5CF6", "#EF4444",
  "#F97316", "#EC4899", "#14B8A6", "#6366F1", "#84CC16"
];

function TabFallback({ label }: { label: string }) {
  return (
    <div className="flex h-[400px] items-center justify-center rounded-card border border-card-border bg-card text-sm text-muted-foreground shadow-relevo">
      Carregando {label}…
    </div>
  );
}

/**
 * Cartão de bento de cada aba. Antes era `glass-card` + `pt-6` repetido em
 * treze lugares; o respiro e o raio passam a morar aqui.
 */
function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-5 sm:p-6">{children}</CardContent>
    </Card>
  );
}

/** Título de seção dentro de uma aba — mesmo ritmo nas abas inline. */
function SectionHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="text-base font-bold tracking-tight">{title}</h3>
      {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
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
  const { isAdmin } = useIdentity();

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeading
          title="Tags de leads"
          description="Crie e gerencie tags para organizar seus leads"
        />
        {isAdmin && (
          <Button onClick={() => handleOpenDialog()} size="sm">
            <Plus />
            Nova Tag
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : tags.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
          Nenhuma tag cadastrada
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {tags.map((tag) => (
            <motion.div
              key={tag.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-border bg-card py-2 pl-3 pr-1.5 transition-colors hover:border-foreground/20"
            >
              <div className="flex min-w-0 items-center gap-2">
                {/* Cor da tag é dado do usuário — fica inline. */}
                <div
                  className="h-3.5 w-3.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color || "#F5C518" }}
                />
                <span className="truncate text-sm font-semibold">{tag.name}</span>
              </div>
              {isAdmin && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg" aria-label={`Ações da tag ${tag.name}`}>
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
                    aria-label={`Cor ${color}`}
                    aria-pressed={formData.color === color}
                    className={`h-8 w-8 rounded-full ring-offset-2 ring-offset-background transition-all ${
                      formData.color === color
                        ? "scale-110 ring-2 ring-foreground"
                        : "hover:scale-105"
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
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConfirmacaoOverdueSettings() {
  const { settings, isAdmin, updateSettings, isUpdating } = useOrganizationSettings();
  // Nome do funil de reuniões como a ORG o vê (SCRUM-641).
  const { data: displayConfigs } = usePipelineDisplayConfig();
  const nomeConfirmacao = (() => {
    const c = displayConfigs?.find((x) => x.pipe_type === "confirmacao");
    return c ? c.display_name || NOME_DE_FABRICA.confirmacao : "Funil removido";
  })();
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
      <SectionHeading
        title={`Funil ${nomeConfirmacao}`}
        description={<>Quando um lead deve aparecer como &quot;Atrasada&quot; (dias sem interação)</>}
      />
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
        Leads que não tiverem nenhuma atualização (status, data, notas) há esse número de dias aparecem como &quot;Atrasadas&quot; no funil. Itens em Remarcar com atividade recente não entram.
      </p>
    </div>
  );
}

/**
 * Funil padrão da org (SCRUM-624, ADR-0034 D4) — o fallback único das portas de
 * entrada sem destino declarado (ex.: lead-webhook sem `place_in_pipe`).
 * "Sem funil padrão" é estado válido: o lead entra na lista de Leads sem card.
 * A deleção do funil apontado é recusada pelo banco (trigger) até o admin
 * escolher um substituto aqui.
 */
function DefaultPipelineSettings() {
  const { settings, isAdmin, updateSettings, isUpdating, isLoading: settingsLoading } = useOrganizationSettings();
  // Nome que a ORG usa — ver `useFunisDaOrg`.
  const { data: pipelines = [], isLoading: pipelinesLoading } = useFunisDaOrg();

  const NONE = "__none__";
  const current = settings.default_pipeline_id ?? NONE;
  const loading = settingsLoading || pipelinesLoading;

  const handleChange = async (value: string) => {
    const next = value === NONE ? null : value;
    if (next === settings.default_pipeline_id) return;
    try {
      await updateSettings({ default_pipeline_id: next });
      toast.success(next ? "Funil padrão atualizado!" : "Funil padrão removido");
    } catch {
      toast.error("Erro ao salvar o funil padrão");
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Funil padrão"
        description="Onde entra um lead que chega por integração sem funil de destino declarado"
      />
      <div className="grid gap-2 max-w-sm">
        <Label htmlFor="default-pipeline">Funil de entrada</Label>
        <Select
          value={loading ? undefined : current}
          onValueChange={handleChange}
          disabled={!isAdmin || isUpdating || loading}
        >
          <SelectTrigger id="default-pipeline">
            <SelectValue placeholder={loading ? "Carregando…" : "Escolha um funil"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Sem funil padrão</SelectItem>
            {pipelines.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
                {p.is_active === false ? " (inativo)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground">
        Leads de webhooks e integrações que não declaram destino caem na primeira etapa ativa
        deste funil. Sem funil padrão, o lead é criado apenas na lista de Leads, sem card.
      </p>
    </div>
  );
}

function ReorderCycleSettings() {
  const { settings, isAdmin, updateSettings, isUpdating } = useOrganizationSettings();
  const [localDays, setLocalDays] = useState(settings.default_reorder_cycle_days);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLocalDays(settings.default_reorder_cycle_days);
  }, [settings.default_reorder_cycle_days]);

  const handleSave = async () => {
    const value = Math.min(365, Math.max(1, Number(localDays) || 30));
    try {
      await updateSettings({ default_reorder_cycle_days: value });
      setLocalDays(value);
      setSaved(true);
      toast.success("Ciclo de recompra salvo!");
      setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error("Erro ao salvar");
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Carteira de clientes"
        description="Ciclo padrão de recompra para clientes novos (com menos de 2 pedidos)"
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-2">
          <Label htmlFor="reorder-cycle-days">Dias entre recompras (padrão)</Label>
          <Input
            id="reorder-cycle-days"
            type="number"
            min={1}
            max={365}
            value={localDays}
            onChange={(e) => setLocalDays(Number(e.target.value) || 30)}
            disabled={!isAdmin}
            className="w-24"
          />
        </div>
        {isAdmin && (
          <Button
            onClick={handleSave}
            disabled={isUpdating || localDays === settings.default_reorder_cycle_days}
          >
            {isUpdating ? "Salvando..." : saved ? "Salvo!" : "Salvar"}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Clientes com 2+ pedidos calculam o ciclo automaticamente pela média entre compras.
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
      <SectionHeading title="Configurações gerais" description="Configurações gerais do sistema" />

      <div className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor="company-name">Nome da Empresa</Label>
          <Input id="company-name" defaultValue="Torque CRM" />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="timezone">Fuso Horário</Label>
          <Input id="timezone" defaultValue="America/Sao_Paulo" disabled />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
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

        <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
          <div className="space-y-0.5">
            <Label>Animações</Label>
            <p className="text-sm text-muted-foreground">
              Ativar animações e transições
            </p>
          </div>
          <Switch defaultChecked />
        </div>
      </div>

      <div className="border-t border-border pt-6">
        <DefaultPipelineSettings />
      </div>

      <div className="border-t border-border pt-6">
        <ConfirmacaoOverdueSettings />
      </div>

      <div className="border-t border-border pt-6">
        <ReorderCycleSettings />
      </div>
    </div>
  );
}

export default function Configuracoes() {
  const { openNewTicket } = useSupportPanel();
  const supportAvailable = useSupportAvailable();
  const { orgType } = useOrganization();
  const { isAdmin } = useIdentity();
  const { tab: tabParam } = useParams<{ tab?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const isOutboundOrg = orgType === "outbound";
  const tabs = useMemo(
    () => visibleSettingsTabs({ isAdmin, isOutboundOrg }),
    [isAdmin, isOutboundOrg],
  );

  // A URL manda. `:tab` é a rota das três primárias; `?tab=` identifica as de
  // "Outros" e continua servindo os links antigos (onboarding, banner do chat).
  // Aba pedida mas invisível para este usuário (Marcos fora de outbound, Ajuda
  // sem admin) cai no padrão da rota em que ele está.
  const isOthersRoute = tabParam === SETTINGS_OTHERS_SLUG;
  const requested = resolveSettingsTab(tabParam) ?? resolveSettingsTab(searchParams.get("tab"));
  const fallbackTab = isOthersRoute
    ? (visibleOtherSettingsTabs({ isAdmin, isOutboundOrg })[0] ?? DEFAULT_SETTINGS_TAB)
    : DEFAULT_SETTINGS_TAB;
  const activeTab =
    requested && tabs.some((t) => t.value === requested.value) ? requested : fallbackTab;

  // Normaliza para o endereço canônico da aba ativa. Os demais parâmetros de
  // query sobrevivem de propósito: o retorno do OAuth do Google cai aqui com
  // `?google=connected&email=…`, e descartá-los engoliria o toast de conexão.
  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (isPrimarySettingsTab(activeTab)) nextParams.delete("tab");
    else nextParams.set("tab", activeTab.value);

    const basePath = isPrimarySettingsTab(activeTab)
      ? `${SETTINGS_BASE_PATH}/${activeTab.slug}`
      : SETTINGS_OTHERS_PATH;
    const query = nextParams.toString();
    const canonical = query ? `${basePath}?${query}` : basePath;

    if (`${location.pathname}${location.search}` !== canonical) {
      navigate(canonical, { replace: true });
    }
  }, [activeTab, location.pathname, location.search, navigate, searchParams]);

  return (
    // Trocar de aba navega: a aba É a rota. As pílulas saem do mesmo registro
    // que alimenta o Pitstop — dois inventários divergiriam. Leitura da ajuda
    // mora no painel de suporte (o "?" do Cmd+K); aqui fica só a autoria, e
    // `HelpAdminPanel` não se protege sozinho — quem gateava era o
    // `HelpCenter`, que saiu daqui.
    //
    // V5: o `<Tabs>` envolve o cabeçalho para a navegação da página morar
    // dentro do `PageHeader` como pílula escura (antes: círculos de 48px que
    // cresciam para 160px com gradiente). Mesmos `value`s, mesma navegação.
    <Tabs
      value={activeTab.value}
      onValueChange={(value) => {
        const next = tabs.find((t) => t.value === value);
        if (next) navigate(settingsTabPath(next));
      }}
      className="w-full space-y-5"
    >
      <PageHeader
        title="Configurações"
        subtitle="Gerencie as configurações do sistema"
        tabs={
          <TabsList variant="pill" aria-label="Seções de configurações">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                <tab.icon className="h-4 w-4" aria-hidden />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      />

      <div>
        <TabsContent value="tags" className="mt-0">
          <SettingsCard>
            <TagsSettings />
          </SettingsCard>
        </TabsContent>

        <TabsContent value="notifications" className="mt-0">
          <SettingsCard>
            <PreferenciasDeAviso />
          </SettingsCard>
        </TabsContent>

        <TabsContent value="whatsapp" className="mt-0">
          <Suspense fallback={<TabFallback label="WhatsApp" />}>
            <SettingsCard>
              <WhatsAppSettings />
            </SettingsCard>
          </Suspense>
        </TabsContent>

        <TabsContent value="integracoes" className="mt-0">
          <Suspense fallback={<TabFallback label="Integrações" />}>
            <IntegrationsCatalog />
          </Suspense>
        </TabsContent>

        <TabsContent value="webhooks" className="mt-0">
          <Suspense fallback={<TabFallback label="Webhooks" />}>
            <SettingsCard>
              <WebhookSettings />
            </SettingsCard>
          </Suspense>
        </TabsContent>

        <TabsContent value="api" className="mt-0">
          <Suspense fallback={<TabFallback label="documentação" />}>
            <ApiDocsSettings />
          </Suspense>
        </TabsContent>

        <TabsContent value="sla" className="mt-0">
          <Suspense fallback={<TabFallback label="SLA" />}>
            <SettingsCard>
              <SlaConfigPanel />
            </SettingsCard>
          </Suspense>
        </TabsContent>

        <TabsContent value="api-keys" className="mt-0">
          <Suspense fallback={<TabFallback label="API Keys" />}>
            <SettingsCard>
              <ApiKeysPanel />
            </SettingsCard>
          </Suspense>
        </TabsContent>

        <TabsContent value="sandbox" className="mt-0">
          <Suspense fallback={<TabFallback label="Sandbox" />}>
            <SettingsCard>
              <SandboxPanel />
            </SettingsCard>
          </Suspense>
        </TabsContent>

        <TabsContent value="checklists" className="mt-0">
          <Suspense fallback={<TabFallback label="Checklists" />}>
            <SettingsCard>
              <ChecklistTemplatesManager />
            </SettingsCard>
          </Suspense>
        </TabsContent>

        <TabsContent value="oraculo-profile" className="mt-0">
          <Suspense fallback={<TabFallback label="Perfil da operação" />}>
            <SettingsCard>
              <OraculoPerfilSettings />
            </SettingsCard>
          </Suspense>
        </TabsContent>

        {isAdmin && <TabsContent value="billing" className="mt-0">
          <Suspense fallback={<TabFallback label="assinatura e cobrança" />}>
            <BillingSettings onContactSupport={supportAvailable ? openNewTicket : undefined} />
          </Suspense>
        </TabsContent>}

        <TabsContent value="general" className="mt-0">
          <SettingsCard>
            <GeneralSettings />
          </SettingsCard>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="ajuda" className="mt-0">
            <Suspense fallback={<TabFallback label="Central de Ajuda" />}>
              <SettingsCard>
                <HelpAdminPanel />
              </SettingsCard>
            </Suspense>
          </TabsContent>
        )}

        {orgType === "outbound" && (
          <TabsContent value="marcos" className="mt-0">
            <Suspense fallback={<TabFallback label="Marcos" />}>
              <MilestonesConfig />
            </Suspense>
          </TabsContent>
        )}
      </div>

      {/* ⚠️ HERDADO: os três cartões abaixo são FIXOS no código — não medem
          banco, RLS nem latência. Ficam (decisão de produto pendente); só a
          forma mudou. Ver docs/ui-v5/validacao-telas.md. */}
      <div className="grid grid-cols-1 gap-4 pt-3 md:grid-cols-3">
        <StatusCard icon={Database} title="Banco de Dados" detail="Status: Conectado" badge="Online" />
        <StatusCard icon={Shield} title="Segurança" detail="RLS: Ativo" badge="Protegido" />
        <StatusCard icon={Globe} title="API" detail={<>Latência: {"<"}50ms</>} badge="Rápido" />
      </div>
    </Tabs>
  );
}

function StatusCard({
  icon: Icon,
  title,
  detail,
  badge,
}: {
  icon: ElementType;
  title: string;
  detail: ReactNode;
  badge: string;
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground/70">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold tracking-tight">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <Badge variant="success">{badge}</Badge>
    </Card>
  );
}
