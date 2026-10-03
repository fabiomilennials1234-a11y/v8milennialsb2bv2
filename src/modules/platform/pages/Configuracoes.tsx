import { useState, useEffect, useMemo, lazy, Suspense, type ReactNode } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { usePipelineDisplayConfig } from "@/modules/pipelines";
import { NOME_DE_FABRICA } from "@/contracts/pipe";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { useThemeTransition } from "@/contexts/ThemeTransitionContext";
import { format } from "date-fns";
import {
  Tag,
  Plus,
  Edit2,
  Trash2,
  MoreHorizontal,
  Code,
  Copy,
  ArrowDownToLine,
  Globe,
  Repeat,
  CalendarClock,
  FlaskConical,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { IconChip, InkPanel, KpiTile } from "@/components/ui/bento";
import { cn } from "@/lib/utils";
import {
  AcaoDoCabecalho,
  CartaoDeAjustes,
  LinhaDeAjuste,
  SlotDeAcoesProvider,
} from "@/modules/platform/components/settings/settings-ui";
import { vidroNaTinta } from "@/modules/platform/components/settings/settings-classes";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
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
import { useOrganization, useOrgSwitcher } from "@/modules/identity";
import { InterfaceDaOrgSetting } from "@/modules/platform/ui-version/InterfaceDaOrgSetting";
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_BASE_PATH,
  canSeeSettingsTab,
  hostSettingsTab,
  resolveSettingsTab,
  settingsTabPath,
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
const OraculoPerfilSettings = lazy(() =>
  import("@/modules/copilot").then((m) => ({ default: m.OraculoPerfilSettings }))
);
// API Keys não tem aba própria: é o painel em tinta no topo de API & Webhooks
// (a documentação deixou de embuti-lo — era a mesma tela em dois lugares).
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

  const coresEmUso = new Set(tags.map((t) => (t.color || "#F5C518").toLowerCase())).size;

  return (
    <div className="space-y-4">
      {/* A ação primária sobe para o cabeçalho da página (mockup V5). */}
      {isAdmin && (
        <AcaoDoCabecalho>
          <Button onClick={() => handleOpenDialog()}>
            <Plus />
            Nova Tag
          </Button>
        </AcaoDoCabecalho>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <KpiTile
          label="Tags ativas"
          value={isLoading ? "—" : tags.length}
          loading={isLoading}
          icon={Tag}
          tone="gold"
          note={tags.length === 0 ? "Nenhuma tag cadastrada" : `${coresEmUso} ${coresEmUso === 1 ? "cor" : "cores"} em uso`}
        >
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1" aria-hidden>
              {tags.slice(0, 16).map((tag) => (
                // Cor da tag é dado do usuário — fica inline.
                <span key={tag.id} className="h-3.5 w-3.5 rounded-[4px]" style={{ backgroundColor: tag.color || "#F5C518" }} />
              ))}
            </div>
          )}
        </KpiTile>

        <Card>
          <CardContent className="p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <SectionHeading
                title={
                  <span className="flex items-center gap-2">
                    Tags de leads
                    {!isLoading && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-foreground/75">
                        {tags.length} {tags.length === 1 ? "tag" : "tags"}
                      </span>
                    )}
                  </span>
                }
                description="Crie e gerencie tags para organizar seus leads"
              />
            </div>

            {isLoading ? (
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="h-[58px] animate-pulse rounded-2xl bg-muted" />
                ))}
              </div>
            ) : tags.length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl border border-dashed border-border py-10 text-center">
                <IconChip icon={Tag} tone="gold" />
                <p className="mt-3 text-sm font-semibold">Nenhuma tag cadastrada</p>
                {isAdmin && (
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => handleOpenDialog()}>
                    <Plus />
                    Criar a primeira tag
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {tags.map((tag) => {
                  const cor = tag.color || "#F5C518";
                  return (
                    <motion.div
                      key={tag.id}
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-card py-2.5 pl-2.5 pr-1.5 transition-[border-color,box-shadow] hover:border-foreground/15 hover:shadow-relevo"
                    >
                      {/* Cor da tag é dado do usuário — fica inline. */}
                      <span
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px]"
                        style={{ backgroundColor: `color-mix(in srgb, ${cor} 16%, transparent)` }}
                      >
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: cor }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{tag.name}</p>
                        {tag.created_at && (
                          <p className="text-[11px] text-muted-foreground">
                            criada em {format(new Date(tag.created_at), "dd/MM/yyyy")}
                          </p>
                        )}
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
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
  // Sem o funil de reuniões, o título dizia "Funil Funil removido" (o prefixo
  // fixo somado ao fallback). Agora o título não depende do nome existir.
  const nomeConfirmacao = (() => {
    const c = displayConfigs?.find((x) => x.pipe_type === "confirmacao");
    return c ? c.display_name || NOME_DE_FABRICA.confirmacao : null;
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
    <LinhaDeAjuste
      rotulo={nomeConfirmacao ? `Atraso · ${nomeConfirmacao}` : "Atraso de reunião"}
      htmlFor="confirmacao-overdue-days"
      ajuda={
        <>
          Dias sem interação para considerar atrasado. Leads sem nenhuma atualização (status, data, notas) há esse
          número de dias aparecem como &quot;Atrasadas&quot; no funil. Itens em Remarcar com atividade recente não entram.
        </>
      }
    >
      <div className="relative">
        <Input
          id="confirmacao-overdue-days"
          type="number"
          min={1}
          max={365}
          value={localDays}
          onChange={(e) => setLocalDays(Number(e.target.value) || 5)}
          disabled={!isAdmin}
          className="w-[120px] pr-11 tabular-nums"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">dias</span>
      </div>
      {isAdmin && (
        <Button
          variant="outline"
          onClick={handleSave}
          disabled={isUpdating || localDays === settings.confirmacao_overdue_days}
        >
          {isUpdating ? "Salvando..." : saved ? "Salvo!" : "Salvar"}
        </Button>
      )}
    </LinhaDeAjuste>
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
    <LinhaDeAjuste
      rotulo="Funil de entrada"
      htmlFor="default-pipeline"
      ajuda={
        <>
          Leads de webhooks e integrações que não declaram destino caem na primeira etapa ativa deste funil. Sem funil
          padrão, o lead é criado apenas na lista de Leads, sem card.
        </>
      }
    >
      <Select
        value={loading ? undefined : current}
        onValueChange={handleChange}
        disabled={!isAdmin || isUpdating || loading}
      >
        <SelectTrigger id="default-pipeline" className="sm:w-[340px]">
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
    </LinhaDeAjuste>
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
    <LinhaDeAjuste
      rotulo="Dias entre recompras (padrão)"
      htmlFor="reorder-cycle-days"
      ajuda="Ciclo para clientes novos (com menos de 2 pedidos). Clientes com 2+ pedidos calculam o ciclo automaticamente pela média entre compras."
    >
      <div className="relative">
        <Input
          id="reorder-cycle-days"
          type="number"
          min={1}
          max={365}
          value={localDays}
          onChange={(e) => setLocalDays(Number(e.target.value) || 30)}
          disabled={!isAdmin}
          className="w-[120px] pr-11 tabular-nums"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">dias</span>
      </div>
      {isAdmin && (
        <Button
          variant="outline"
          onClick={handleSave}
          disabled={isUpdating || localDays === settings.default_reorder_cycle_days}
        >
          {isUpdating ? "Salvando..." : saved ? "Salvo!" : "Salvar"}
        </Button>
      )}
    </LinhaDeAjuste>
  );
}

/**
 * Geral (V5): seções em cartão com linhas (rótulo + ajuda à esquerda, o
 * controle à direita). Cada ajuste mantém o próprio "Salvar" — não existe
 * salvamento único da página.
 */
function GeneralSettings() {
  const { organizationId, timezone } = useOrganization();
  const { orgs } = useOrgSwitcher();
  const nomeDaOrg = orgs.find((o) => o.id === organizationId)?.name;

  return (
    <div className="space-y-4">
      <CartaoDeAjustes titulo="Interface" descricao="Como o Torque aparece para toda a organização">
        <InterfaceDaOrgSetting />
      </CartaoDeAjustes>

      <CartaoDeAjustes titulo="Empresa" descricao="Como a organização aparece para o time">
        {/* ⚠️ HERDADO: o nome não é salvo daqui (não há escrita ligada a este
            campo). O restyle só mostra o nome real em vez de um texto fixo. */}
        <LinhaDeAjuste rotulo="Nome da Empresa" htmlFor="company-name">
          <Input key={nomeDaOrg ?? "sem-nome"} id="company-name" defaultValue={nomeDaOrg ?? "Torque CRM"} className="sm:w-[340px]" />
        </LinhaDeAjuste>
        <LinhaDeAjuste
          rotulo="Fuso Horário"
          htmlFor="timezone"
          ajuda="Corta o dia da organização em agenda, relatórios e metas."
        >
          <Input id="timezone" value={timezone ?? "America/Sao_Paulo"} readOnly disabled className="sm:w-[340px]" />
        </LinhaDeAjuste>
      </CartaoDeAjustes>

      <CartaoDeAjustes titulo="Funis e entrada de leads" descricao="Para onde vai o lead que chega sem destino declarado">
        <DefaultPipelineSettings />
        <ConfirmacaoOverdueSettings />
      </CartaoDeAjustes>

      <CartaoDeAjustes titulo="Carteira de clientes" descricao="Clientes que compram de novo">
        <ReorderCycleSettings />
      </CartaoDeAjustes>
    </div>
  );
}

/** Aparência — vale só para você, neste navegador. */
function AparenciaSettings() {
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
    <CartaoDeAjustes titulo="Aparência" descricao="Vale só para você, neste navegador">
      <LinhaDeAjuste rotulo="Modo escuro" ajuda="Ativar tema escuro no sistema">
        <Switch
          checked={mounted ? !!isDark : false}
          onCheckedChange={handleDarkModeChange}
          aria-label="Modo escuro"
        />
      </LinhaDeAjuste>
      {/* ⚠️ HERDADO: a chave de animações não está ligada a nada. */}
      <LinhaDeAjuste rotulo="Animações" ajuda="Ativar animações e transições">
        <Switch defaultChecked aria-label="Animações" />
      </LinhaDeAjuste>
    </CartaoDeAjustes>
  );
}

/**
 * "Como está configurado" — o resumo fixo da aba Geral. Só lê o que a página
 * já carrega (organização, plano, funil padrão, fuso, recompra); nada novo é
 * buscado nem calculado.
 */
function ComoEstaConfigurado() {
  const { organizationId, timezone } = useOrganization();
  const { orgs } = useOrgSwitcher();
  const { planName } = useOrgFeatures();
  const { settings, isLoading } = useOrganizationSettings();
  const { data: funis = [] } = useFunisDaOrg();

  const nome = orgs.find((o) => o.id === organizationId)?.name;
  const plano = planName && planName !== "free" ? planName.toUpperCase() : null;
  const funil = settings.default_pipeline_id
    ? funis.find((f) => f.id === settings.default_pipeline_id)?.label ?? "—"
    : "Sem funil padrão";
  // Mesmo critério do seletor de organização: a sandbox nasce com "[Sandbox]" no nome.
  const ehSandbox = !!nome?.includes("[Sandbox]");
  const iniciais =
    (nome ?? "")
      .replace(/\[.*?\]/g, "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase() || "O";

  const linhas: { icone: LucideIcon; rotulo: string; valor: ReactNode }[] = [
    { icone: ArrowDownToLine, rotulo: "Leads novos entram em", valor: isLoading ? "—" : funil },
    { icone: Globe, rotulo: "Fuso horário", valor: timezone ?? "—" },
    { icone: Repeat, rotulo: "Recompra sugerida", valor: isLoading ? "—" : `a cada ${settings.default_reorder_cycle_days} dias` },
    { icone: CalendarClock, rotulo: "Atraso de reunião", valor: isLoading ? "—" : `${settings.confirmacao_overdue_days} dias sem interação` },
    { icone: FlaskConical, rotulo: "Organização sandbox", valor: ehSandbox ? "Sim" : "Não" },
  ];

  const copiarId = async () => {
    if (!organizationId) return;
    try {
      await navigator.clipboard.writeText(organizationId);
      toast.success("ID da organização copiado");
    } catch {
      toast.error("Não deu para copiar");
    }
  };

  return (
    <InkPanel aria-label="Como está configurado" className="xl:sticky xl:top-4">
      <div className="flex items-center gap-3 px-1.5 pb-3.5 pt-1">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary text-[15px] font-extrabold text-primary-foreground">
          {iniciais}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[17px] font-extrabold tracking-[-0.02em]">{nome ?? "Organização"}</p>
          {plano && <p className="text-[12px] text-tinta-muted">plano {plano}</p>}
        </div>
      </div>

      <div className={cn(vidroNaTinta, "flex items-center gap-3 py-3")}>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-tinta-muted">ID da organização</p>
          <p className="mt-0.5 break-all font-mono text-[11.5px] text-tinta-foreground">{organizationId ?? "—"}</p>
        </div>
        <button
          type="button"
          onClick={copiarId}
          disabled={!organizationId}
          aria-label="Copiar ID da organização"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[.08] text-tinta-foreground transition-colors hover:bg-white/[.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className={cn(vidroNaTinta, "mt-2.5")}>
        <p className="mb-2 text-[11px] font-bold text-tinta-muted">Como está configurado</p>
        <dl className="space-y-2.5">
          {linhas.map(({ icone: Icone, rotulo, valor }) => (
            <div key={rotulo} className="flex items-start gap-2.5 text-[12.5px]">
              <Icone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tinta-muted" aria-hidden />
              <dt className="min-w-0 flex-1 text-tinta-muted">{rotulo}</dt>
              <dd className="max-w-[55%] text-right font-bold text-tinta-foreground">{valor}</dd>
            </div>
          ))}
        </dl>
      </div>
    </InkPanel>
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

  const [slotDeAcoes, setSlotDeAcoes] = useState<HTMLElement | null>(null);

  const isOutboundOrg = orgType === "outbound";
  const visibilidade = useMemo(() => ({ isAdmin, isOutboundOrg }), [isAdmin, isOutboundOrg]);
  const tabs = useMemo(() => visibleSettingsTabs(visibilidade), [visibilidade]);

  // A URL manda. `:tab` é a rota da aba; `?tab=` serve os links antigos
  // (onboarding, banner do chat, "Outros"). V5: as quinze abas viraram sete —
  // aba antiga que virou SEÇÃO abre o grupo dela rolado até a seção, e
  // Checklists (que duplicava `/checklists`) desvia para lá.
  const requested = resolveSettingsTab(tabParam) ?? resolveSettingsTab(searchParams.get("tab"));
  const secaoPedida =
    searchParams.get("secao") ?? (requested?.group && canSeeSettingsTab(requested, visibilidade) ? requested.value : null);
  const host = requested ? hostSettingsTab(requested) : null;
  const activeTab = host && tabs.some((t) => t.value === host.value) ? host : DEFAULT_SETTINGS_TAB;

  // Normaliza para o endereço canônico. Os demais parâmetros de query
  // sobrevivem de propósito: o retorno do OAuth do Google cai aqui com
  // `?google=connected&email=…`, e descartá-los engoliria o toast de conexão.
  useEffect(() => {
    if (requested?.redirect) {
      navigate(requested.redirect, { replace: true });
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("tab");
    if (secaoPedida) nextParams.set("secao", secaoPedida);
    const basePath = `${SETTINGS_BASE_PATH}/${activeTab.slug}`;
    const query = nextParams.toString();
    const canonical = query ? `${basePath}?${query}` : basePath;
    if (`${location.pathname}${location.search}` !== canonical) {
      navigate(canonical, { replace: true });
    }
  }, [activeTab, requested, secaoPedida, location.pathname, location.search, navigate, searchParams]);

  // Leva o olho até a seção pedida (link antigo de aba que virou seção).
  useEffect(() => {
    if (!secaoPedida) return;
    // API Keys mora dentro da documentação da API (o painel embute as chaves).
    const alvo = secaoPedida === "api-keys" ? "api" : secaoPedida;
    const id = window.setTimeout(() => {
      document.getElementById(`secao-${alvo}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 150);
    return () => window.clearTimeout(id);
  }, [secaoPedida, activeTab.value]);

  const ver = (value: string) => {
    const tab = resolveSettingsTab(value);
    return !!tab && canSeeSettingsTab(tab, visibilidade);
  };

  return (
    // O cabeçalho publica um alvo; o painel da aba entrega para ele a ação
    // primária ("Nova Tag", "Nova Instância", "Nova chave") — o estado do
    // diálogo continua no painel. Só a aba ativa está montada.
    <SlotDeAcoesProvider value={slotDeAcoes}>
    {/* Trocar de aba navega: a aba É a rota. As pílulas saem do mesmo registro
        que alimenta o Pitstop — dois inventários divergiriam. */}
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
        subtitle={activeTab.subtitle ?? "Gerencie as configurações do sistema"}
        actions={
          <>
            {activeTab.value === "integracoes" && ver("api-webhooks") && (
              <Button variant="outline" onClick={() => navigate(`${SETTINGS_BASE_PATH}/api-webhooks`)}>
                <Code />
                API & Webhooks
              </Button>
            )}
            <div ref={setSlotDeAcoes} className="contents" />
          </>
        }
        tabs={
          <TabsList variant="pill" aria-label="Seções de configurações">
            {tabs.map((tab) => (
              // Só o rótulo: sete pílulas com ícone não cabem no centro da barra.
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      />

      <div>
        <TabsContent value="tags" className="mt-0">
          <TagsSettings />
        </TabsContent>

        <TabsContent value="notifications" className="mt-0">
          <PreferenciasDeAviso />
        </TabsContent>

        <TabsContent value="whatsapp" className="mt-0">
          <Suspense fallback={<TabFallback label="WhatsApp" />}>
            <WhatsAppSettings />
          </Suspense>
        </TabsContent>

        <TabsContent value="integracoes" className="mt-0">
          <Suspense fallback={<TabFallback label="Integrações" />}>
            <IntegrationsCatalog />
          </Suspense>
        </TabsContent>

        {isAdmin && <TabsContent value="billing" className="mt-0">
          <Suspense fallback={<TabFallback label="assinatura e cobrança" />}>
            <BillingSettings onContactSupport={supportAvailable ? openNewTicket : undefined} />
          </Suspense>
        </TabsContent>}

        {/* API & Webhooks: as chaves (tinta + ouro), os webhooks de saída em
            tabela e, embaixo, a documentação da API. */}
        <TabsContent value="api-webhooks" className="mt-0 space-y-5">
          <SecaoDeConfiguracao id="api" titulo="Chaves de API" oculto>
            <Suspense fallback={<TabFallback label="chaves de API" />}>
              <ApiKeysPanel />
            </Suspense>
          </SecaoDeConfiguracao>
          <SecaoDeConfiguracao id="webhooks" titulo="Webhooks de saída" oculto>
            <Suspense fallback={<TabFallback label="Webhooks" />}>
              <SettingsCard>
                <WebhookSettings />
              </SettingsCard>
            </Suspense>
          </SecaoDeConfiguracao>
          <SecaoDeConfiguracao id="documentacao" titulo="Documentação da API" oculto>
            <Suspense fallback={<TabFallback label="documentação" />}>
              <ApiDocsSettings />
            </Suspense>
          </SecaoDeConfiguracao>
        </TabsContent>

        {/* Geral: seções em cartão à esquerda e, fixo à direita, o resumo
            "Como está configurado". */}
        <TabsContent value="general" className="mt-0">
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="order-2 min-w-0 space-y-5 xl:order-1">
              <SecaoDeConfiguracao id="general" titulo="Organização" oculto>
                <GeneralSettings />
              </SecaoDeConfiguracao>
              <SecaoDeConfiguracao id="sla" titulo="SLA de atendimento" oculto>
                <Suspense fallback={<TabFallback label="SLA" />}>
                  <SlaConfigPanel />
                </Suspense>
              </SecaoDeConfiguracao>
              <SecaoDeConfiguracao id="sandbox" titulo="Sandbox" oculto>
                <Suspense fallback={<TabFallback label="Sandbox" />}>
                  <SandboxPanel />
                </Suspense>
              </SecaoDeConfiguracao>
              <SecaoDeConfiguracao id="oraculo-profile" titulo="Perfil da operação" oculto>
                <Suspense fallback={<TabFallback label="Perfil da operação" />}>
                  <SettingsCard>
                    <OraculoPerfilSettings />
                  </SettingsCard>
                </Suspense>
              </SecaoDeConfiguracao>
              <SecaoDeConfiguracao id="aparencia" titulo="Aparência" oculto>
                <AparenciaSettings />
              </SecaoDeConfiguracao>
              {ver("marcos") && (
                <SecaoDeConfiguracao id="marcos" titulo="Marcos">
                  <Suspense fallback={<TabFallback label="Marcos" />}>
                    <MilestonesConfig />
                  </Suspense>
                </SecaoDeConfiguracao>
              )}
              {ver("ajuda") && (
                <SecaoDeConfiguracao id="ajuda" titulo="Central de Ajuda" oculto>
                  <Suspense fallback={<TabFallback label="Central de Ajuda" />}>
                    <SettingsCard>
                      <HelpAdminPanel />
                    </SettingsCard>
                  </Suspense>
                </SecaoDeConfiguracao>
              )}
            </div>
            <div className="order-1 min-w-0 xl:order-2 xl:self-stretch">
              <ComoEstaConfigurado />
            </div>
          </div>
        </TabsContent>
      </div>
      {/* Os três cartões fixos "Banco de Dados / Segurança / API" saíram
          (decisão do CTO, 02/10): não mediam banco, RLS nem latência. */}
    </Tabs>
    </SlotDeAcoesProvider>
  );
}

/** Seção de uma aba-grupo: âncora para links antigos e título que separa. */
function SecaoDeConfiguracao({
  id,
  titulo,
  oculto = false,
  children,
}: {
  id: string;
  titulo: string;
  /** O conteúdo já traz título visível (cartão, painel em tinta): o da seção fica só para leitor de tela. */
  oculto?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={`secao-${id}`} aria-labelledby={`secao-${id}-titulo`} className={cn("scroll-mt-24", !oculto && "space-y-3")}>
      <h2
        id={`secao-${id}-titulo`}
        className={cn("px-1 text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground", oculto && "sr-only")}
      >
        {titulo}
      </h2>
      {children}
    </section>
  );
}
