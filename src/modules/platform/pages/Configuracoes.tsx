import {
  useState,
  useEffect,
  useMemo,
  lazy,
  Suspense,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { usePipelineDisplayConfig } from "@/modules/pipelines";
import { NOME_DE_FABRICA } from "@/contracts/pipe";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { useThemeTransition } from "@/contexts/ThemeTransitionContext";
import {
  Settings,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { usePipelines } from "@/modules/pipelines";
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
      <div>
        <h3 className="text-lg font-medium">Funil {nomeConfirmacao}</h3>
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

/**
 * Funil padrão da org (SCRUM-624, ADR-0034 D4) — o fallback único das portas de
 * entrada sem destino declarado (ex.: lead-webhook sem `place_in_pipe`).
 * "Sem funil padrão" é estado válido: o lead entra na lista de Leads sem card.
 * A deleção do funil apontado é recusada pelo banco (trigger) até o admin
 * escolher um substituto aqui.
 */
function DefaultPipelineSettings() {
  const { settings, isAdmin, updateSettings, isUpdating, isLoading: settingsLoading } = useOrganizationSettings();
  const { data: pipelines = [], isLoading: pipelinesLoading } = usePipelines();

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
      <div>
        <h3 className="text-lg font-medium">Funil padrão</h3>
        <p className="text-sm text-muted-foreground">
          Onde entra um lead que chega por integração sem funil de destino declarado
        </p>
      </div>
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
                {p.name}
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
      <div>
        <h3 className="text-lg font-medium">Carteira de Clientes</h3>
        <p className="text-sm text-muted-foreground">
          Ciclo padrão de recompra para clientes novos (com menos de 2 pedidos)
        </p>
      </div>
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
        <DefaultPipelineSettings />
      </div>

      <div className="pt-6 border-t border-border">
        <ConfirmacaoOverdueSettings />
      </div>

      <div className="pt-6 border-t border-border">
        <ReorderCycleSettings />
      </div>
    </div>
  );
}

// Gradiente dourado das pílulas (mesma paleta dos botões de seção do Copilot Playground).
const PILL_GRADIENT = {
  "--gradient-from": "hsl(47 100% 58%)",
  "--gradient-to": "hsl(40 96% 45%)",
} as CSSProperties;

/**
 * PillTab — trigger de aba no estilo "pílula gradiente hover-expand" (portado do
 * PromptEditor do Copilot Playground). Círculo de ícone (48px) que expande para
 * 160px revelando preenchimento gradiente + glow + label uppercase.
 *
 * Comportamento pedido: no hover a pílula cresce NO FLUXO, empurrando as vizinhas
 * PARA O LADO (permitido) — mas nunca quebra linha nem mexe a página. Isso é
 * garantido no container (`TabsList`): `flex-nowrap` trava tudo numa linha só (não
 * desce) e `overflow-x:clip` corta qualquer transbordo horizontal sem criar
 * scrollbar (não empurra a tela) — e, ao contrário de `hidden`, o `clip` deixa o
 * glow vertical aparecer. Estados lidos via `data-state` do Radix.
 */
function PillTab({ value, label, icon }: { value: string; label: string; icon: ReactNode }) {
  return (
    <TabsTrigger
      value={value}
      title={label}
      style={PILL_GRADIENT}
      className="group relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card p-0 shadow-sm transition-all duration-500 hover:w-[160px] hover:border-transparent hover:shadow-none data-[state=active]:w-[160px] data-[state=active]:border-transparent data-[state=active]:shadow-none after:hidden"
    >
      {/* Gradient fill */}
      <span className="absolute inset-0 rounded-full bg-[linear-gradient(45deg,var(--gradient-from),var(--gradient-to))] opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-data-[state=active]:opacity-100" />
      {/* Blur glow */}
      <span className="absolute top-2 inset-x-0 h-full rounded-full bg-[linear-gradient(45deg,var(--gradient-from),var(--gradient-to))] blur-[15px] -z-10 opacity-0 transition-opacity duration-500 group-hover:opacity-40 group-data-[state=active]:opacity-40" />
      {/* Icon */}
      <span className="relative z-10 text-muted-foreground transition-transform duration-500 [&_svg]:w-5 [&_svg]:h-5 scale-100 group-hover:scale-0 group-data-[state=active]:scale-0">
        {icon}
      </span>
      {/* Label */}
      <span className="absolute inset-0 z-10 flex items-center justify-center px-3 text-center text-primary-foreground uppercase tracking-wide text-[11px] font-semibold whitespace-nowrap transition-transform duration-500 scale-0 group-hover:scale-100 group-hover:delay-150 group-data-[state=active]:scale-100 group-data-[state=active]:delay-150">
        {label}
      </span>
    </TabsTrigger>
  );
}

export default function Configuracoes() {
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

      {/* Trocar de aba navega: a aba É a rota. As pílulas saem do mesmo
          registro que alimenta o Pitstop — dois inventários divergiriam.
          Leitura da ajuda mora no painel de suporte (o "?" do Cmd+K); aqui fica
          só a autoria, e `HelpAdminPanel` não se protege sozinho — quem gateava
          era o `HelpCenter`, que saiu daqui. */}
      <Tabs
        value={activeTab.value}
        onValueChange={(value) => {
          const next = tabs.find((t) => t.value === value);
          if (next) navigate(settingsTabPath(next));
        }}
        className="w-full"
      >
        <TabsList className="flex flex-nowrap items-center gap-3 h-auto border-b-0 bg-transparent p-0 py-2 w-full max-w-5xl [overflow-x:clip]">
          {tabs.map((tab) => (
            <PillTab
              key={tab.value}
              value={tab.value}
              label={tab.label}
              icon={<tab.icon className="w-4 h-4" />}
            />
          ))}
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
                <PreferenciasDeAviso />
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

          {isAdmin && (
            <TabsContent value="ajuda">
              <Suspense fallback={<TabFallback label="Central de Ajuda" />}>
                <Card className="glass-card">
                  <CardContent className="pt-6">
                    <HelpAdminPanel />
                  </CardContent>
                </Card>
              </Suspense>
            </TabsContent>
          )}

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
