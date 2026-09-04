/**
 * Configuracao de acoes pos-captura para Lead Ads (Meta)
 * Permite configurar o que acontece quando um lead chega via formulario de anuncio:
 * - Selecionar formulario especifico da pagina
 * - Vincular a campanha
 * - Adicionar tags automaticas
 * - Enviar para pipe/estagio
 * - Notificar time
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useMetaConnectionStatus, MetaPage } from "@/modules/communication/hooks/useMetaConnection";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { usePipelineDisplayConfig } from "@/modules/pipelines";
import { destinosDeSistema } from "@/contracts/pipe";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Megaphone,
  Bell,
  Tag,
  Target,
  FileText,
  Kanban,
  Plus,
  X,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FieldMapping {
  meta_field: string;
  lead_field: string;
}

interface LeadgenConfig {
  id: string;
  meta_page_id: string;
  form_id: string | null;
  form_name: string | null;
  assign_to_campaign_id: string | null;
  assign_to_pipe: string | null;
  assign_to_stage: string | null;
  notify_team: boolean;
  auto_tag: string[];
  field_mappings: FieldMapping[];
  is_active: boolean;
}

interface MetaForm {
  id: string;
  name: string;
  status: string;
}

interface MetaFormField {
  key: string;
  label: string;
  type: string;
}

const LEAD_FIELD_OPTIONS = [
  { value: "name", label: "Nome" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Telefone" },
  { value: "company", label: "Empresa" },
  { value: "segment", label: "Segmento" },
  { value: "urgency", label: "Urgencia" },
  { value: "faturamento", label: "Faturamento" },
  { value: "notes", label: "Observacoes" },
  { value: "utm_campaign", label: "UTM Campaign" },
  { value: "utm_source", label: "UTM Source" },
  { value: "utm_medium", label: "UTM Medium" },
  { value: "utm_content", label: "UTM Content" },
  { value: "utm_term", label: "UTM Term" },
];


// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface PageFormsResult {
  forms: MetaForm[];
  tos_not_accepted?: boolean;
  tos_accept_url?: string;
}

/** Busca formularios de uma pagina via Edge Function */
function usePageForms(pageId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["meta_lead_forms", pageId],
    queryFn: async (): Promise<PageFormsResult> => {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;

      const res = await fetch(
        `${supabaseUrl}/functions/v1/list-lead-forms`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ pageId }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Erro ao buscar formularios" }));
        console.error("[usePageForms] Error response:", err);
        throw new Error(err.error || "Erro ao buscar formularios");
      }

      const data = await res.json();
      // Handle both old format (array) and new format (object with forms key)
      if (Array.isArray(data)) {
        return { forms: data };
      }
      return data as PageFormsResult;
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 min cache
    retry: 1,
  });
}

/** Busca campos de um formulario especifico via Edge Function */
function useFormFields(pageId: string, formId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["meta_form_fields", pageId, formId],
    queryFn: async (): Promise<MetaFormField[]> => {
      if (!formId) return [];
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;

      const res = await fetch(
        `${supabaseUrl}/functions/v1/list-lead-forms`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ pageId, formId }),
        }
      );

      if (!res.ok) return [];
      return res.json();
    },
    enabled: enabled && !!formId,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

/** Editor de mapeamento de campos: formulario Meta → campo do lead */
function FieldMappingEditor({
  pageId,
  formId,
  mappings,
  onChange,
}: {
  pageId: string;
  formId: string | null;
  mappings: FieldMapping[];
  onChange: (mappings: FieldMapping[]) => void;
}) {
  const { data: formFields = [], isLoading } = useFormFields(pageId, formId, true);

  if (!formId) {
    return (
      <p className="text-xs text-muted-foreground">
        Selecione um formulario para configurar mapeamento de campos.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        Carregando campos...
      </div>
    );
  }

  if (formFields.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nenhum campo encontrado neste formulario.
      </p>
    );
  }

  const addMapping = () => {
    onChange([...mappings, { meta_field: "", lead_field: "" }]);
  };

  const updateMapping = (index: number, field: Partial<FieldMapping>) => {
    const updated = [...mappings];
    updated[index] = { ...updated[index], ...field };
    onChange(updated);
  };

  const removeMapping = (index: number) => {
    onChange(mappings.filter((_, i) => i !== index));
  };

  // Campos do lead ja usados
  const usedLeadFields = new Set(mappings.map((m) => m.lead_field).filter(Boolean));

  return (
    <div className="space-y-2">
      {mappings.map((mapping, index) => (
        <div key={index} className="flex items-center gap-2">
          {/* Campo do Meta */}
          <Select
            value={mapping.meta_field || "select"}
            onValueChange={(val) =>
              updateMapping(index, { meta_field: val === "select" ? "" : val })
            }
          >
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue placeholder="Campo do formulario" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="select" disabled>Campo do formulario</SelectItem>
              {formFields.map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label || f.key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-xs text-muted-foreground shrink-0">→</span>

          {/* Campo do Lead */}
          <Select
            value={mapping.lead_field || "select"}
            onValueChange={(val) =>
              updateMapping(index, { lead_field: val === "select" ? "" : val })
            }
          >
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue placeholder="Campo do lead" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="select" disabled>Campo do lead</SelectItem>
              {LEAD_FIELD_OPTIONS.filter(
                (o) => !usedLeadFields.has(o.value) || o.value === mapping.lead_field
              ).map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 shrink-0"
            onClick={() => removeMapping(index)}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs gap-1"
        onClick={addMapping}
      >
        <Plus className="w-3 h-3" />
        Adicionar mapeamento
      </Button>
    </div>
  );
}

/** Componente de tags com input para adicionar */
function TagInput({
  tags,
  availableTags,
  onChange,
}: {
  tags: string[];
  availableTags: Array<{ id: string; name: string; color: string }>;
  onChange: (tags: string[]) => void;
}) {
  const [inputValue, setInputValue] = useState("");

  const addTag = (tagName: string) => {
    const trimmed = tagName.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInputValue("");
  };

  const removeTag = (tagName: string) => {
    onChange(tags.filter((t) => t !== tagName));
  };

  const filteredSuggestions = availableTags.filter(
    (t) =>
      !tags.includes(t.name) &&
      t.name.toLowerCase().includes(inputValue.toLowerCase())
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => {
          const tagData = availableTags.find((t) => t.name === tag);
          return (
            <Badge
              key={tag}
              variant="secondary"
              className="gap-1 text-xs"
              style={tagData ? { backgroundColor: tagData.color + "30", borderColor: tagData.color } : {}}
            >
              {tag}
              <X
                className="w-3 h-3 cursor-pointer hover:text-destructive"
                onClick={() => removeTag(tag)}
              />
            </Badge>
          );
        })}
      </div>
      <div className="relative">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag(inputValue);
            }
          }}
          placeholder="Digite uma tag e pressione Enter"
          className="h-8 text-xs"
        />
        {inputValue && filteredSuggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full bg-popover border rounded-md shadow-md max-h-32 overflow-y-auto">
            {filteredSuggestions.slice(0, 5).map((t) => (
              <button
                key={t.id}
                type="button"
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2"
                onClick={() => addTag(t.name)}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: t.color }}
                />
                {t.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Card de configuracao de uma pagina */
function PageLeadgenCard({
  page,
  config,
  campaigns,
  tags: availableTags,
  pipeStages,
  onSave,
  isSaving,
}: {
  page: MetaPage;
  config: LeadgenConfig;
  campaigns: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string; color: string }>;
  pipeStages: Record<string, Array<{ stage_key: string; name: string }>>;
  onSave: (config: Partial<LeadgenConfig> & { meta_page_id: string }) => void;
  isSaving: boolean;
}) {
  const {
    data: formsResult,
    isLoading: formsLoading,
    refetch: refetchForms,
    error: formsError,
  } = usePageForms(page.id, config.is_active);

  const forms = formsResult?.forms ?? [];
  const tosNotAccepted = formsResult?.tos_not_accepted === true;
  const tosAcceptUrl = formsResult?.tos_accept_url;

  const selectedPipeStages = config.assign_to_pipe
    ? pipeStages[config.assign_to_pipe] || []
    : [];

  // Funis de sistema REAIS da org, com o nome que ELA usa (SCRUM-641) — o trio
  // cravado oferecia funil que a org podia nem ter, com nome de catálogo.
  const { data: displayConfigs } = usePipelineDisplayConfig();
  const pipeOptions = destinosDeSistema(displayConfigs).map((d) => ({
    value: d.pipeType,
    label: d.label,
  }));

  return (
    <div className="border rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-sm">{page.page_name}</span>
          {page.instagram_username && (
            <Badge variant="outline" className="ml-2 text-xs">
              @{page.instagram_username}
            </Badge>
          )}
        </div>
        <Switch
          checked={config.is_active}
          onCheckedChange={(checked) =>
            onSave({ ...config, is_active: checked })
          }
        />
      </div>

      {config.is_active && (
        <div className="space-y-4 pl-2 border-l-2 border-primary/20">
          {/* Formulario */}
          <div className="flex items-start gap-3">
            <FileText className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Formulario</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs gap-1"
                  onClick={() => refetchForms()}
                  disabled={formsLoading}
                >
                  <RefreshCw className={`w-3 h-3 ${formsLoading ? "animate-spin" : ""}`} />
                  Atualizar
                </Button>
              </div>
              {formsError ? (
                <p className="text-xs text-destructive mt-1">
                  Erro ao carregar formularios: {(formsError as Error)?.message || "Desconhecido"}. Clique em Atualizar.
                </p>
              ) : tosNotAccepted ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mt-1">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-amber-800 text-xs">
                        Termos do Lead Ads nao aceitos
                      </p>
                      <p className="text-amber-700 text-xs mt-1">
                        O administrador desta pagina precisa aceitar os Termos de
                        Servico do Lead Ads do Facebook para que os formularios
                        aparecam aqui.
                      </p>
                      {tosAcceptUrl && (
                        <a
                          href={tosAcceptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-amber-800 underline"
                        >
                          Aceitar os Termos agora
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      <p className="text-amber-600 text-xs mt-1.5">
                        Apos aceitar, clique em "Atualizar" para carregar os formularios.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <Select
                  value={config.form_id || "all"}
                  onValueChange={(val) =>
                    onSave({
                      ...config,
                      form_id: val === "all" ? null : val,
                      form_name:
                        val === "all"
                          ? null
                          : forms.find((f) => f.id === val)?.name || null,
                    })
                  }
                >
                  <SelectTrigger className="h-8 text-xs mt-1">
                    <SelectValue
                      placeholder={
                        formsLoading
                          ? "Carregando..."
                          : "Todos os formularios"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os formularios</SelectItem>
                    {forms.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                        {f.status !== "ACTIVE" && (
                          <span className="ml-1 text-muted-foreground">
                            ({f.status})
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {!formsLoading && forms.length === 0 && !formsError && !tosNotAccepted && (
                <p className="text-xs text-muted-foreground mt-1">
                  Nenhum formulario encontrado nesta pagina.
                </p>
              )}
            </div>
          </div>

          {/* Mapeamento de campos */}
          {config.form_id && (
            <div className="flex items-start gap-3">
              <Kanban className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
              <div className="flex-1">
                <Label className="text-xs mb-2 block">Mapeamento de campos</Label>
                <FieldMappingEditor
                  pageId={page.id}
                  formId={config.form_id}
                  mappings={config.field_mappings || []}
                  onChange={(newMappings) =>
                    onSave({ ...config, field_mappings: newMappings })
                  }
                />
              </div>
            </div>
          )}

          {/* Vincular a campanha */}
          <div className="flex items-center gap-3">
            <Target className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="flex-1">
              <Label className="text-xs">Vincular a campanha</Label>
              <Select
                value={config.assign_to_campaign_id || "none"}
                onValueChange={(val) =>
                  onSave({
                    ...config,
                    assign_to_campaign_id: val === "none" ? null : val,
                  })
                }
              >
                <SelectTrigger className="h-8 text-xs mt-1">
                  <SelectValue placeholder="Nenhuma" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Enviar para Pipe */}
          <div className="flex items-center gap-3">
            <Kanban className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="flex-1 space-y-2">
              <Label className="text-xs">Enviar para pipe</Label>
              <Select
                value={config.assign_to_pipe || "none"}
                onValueChange={(val) =>
                  onSave({
                    ...config,
                    assign_to_pipe: val === "none" ? null : val,
                    assign_to_stage: null,
                  })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Nenhum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {pipeOptions.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {config.assign_to_pipe && selectedPipeStages.length > 0 && (
                <Select
                  value={config.assign_to_stage || "default"}
                  onValueChange={(val) =>
                    onSave({
                      ...config,
                      assign_to_stage: val === "default" ? null : val,
                    })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Estagio inicial" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Estagio padrao</SelectItem>
                    {selectedPipeStages.map((s) => (
                      <SelectItem key={s.stage_key} value={s.stage_key}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Tags automaticas */}
          <div className="flex items-start gap-3">
            <Tag className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
            <div className="flex-1">
              <Label className="text-xs mb-2 block">Tags automaticas</Label>
              <TagInput
                tags={config.auto_tag || []}
                availableTags={availableTags}
                onChange={(newTags) =>
                  onSave({ ...config, auto_tag: newTags })
                }
              />
            </div>
          </div>

          {/* Notificar time */}
          <div className="flex items-center gap-3">
            <Bell className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="flex-1 flex items-center justify-between">
              <Label className="text-xs">Notificar time</Label>
              <Switch
                checked={config.notify_team}
                onCheckedChange={(checked) =>
                  onSave({ ...config, notify_team: checked })
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MetaLeadgenConfig() {
  const { organizationId: orgId } = useOrganization();
  const { isConnected, pages } = useMetaConnectionStatus();
  const queryClient = useQueryClient();

  // Buscar configs existentes
  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["meta_leadgen_configs", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await (supabase as any)
        .from("meta_leadgen_configs")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as LeadgenConfig[];
    },
    enabled: !!orgId && isConnected,
  });

  // Buscar campanhas
  const { data: campaigns = [] } = useQuery({
    queryKey: ["campanhas_for_leadgen", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("campanhas")
        .select("id, name")
        .eq("organization_id", orgId)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data as Array<{ id: string; name: string }>;
    },
    enabled: !!orgId,
  });

  // Buscar tags da org
  const { data: availableTags = [] } = useQuery({
    queryKey: ["tags_for_leadgen", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("tags")
        .select("id, name, color")
        .eq("organization_id", orgId)
        .order("name");
      if (error) throw error;
      return data as Array<{ id: string; name: string; color: string }>;
    },
    enabled: !!orgId,
  });

  // Buscar estagios dos pipes
  const { data: pipeStages = {} } = useQuery({
    queryKey: ["pipeline_stages_for_leadgen", orgId],
    queryFn: async () => {
      if (!orgId) return {};
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("pipeline_type, stage_key, name, position")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("position");
      if (error) throw error;

      const grouped: Record<string, Array<{ stage_key: string; name: string }>> = {};
      for (const stage of data || []) {
        // `pipeline_type` é anulável desde que a etapa ganhou FK ao funil
        // (SCRUM-616): etapa de funil custom não tem tipo de sistema e não
        // pertence a nenhum grupo desta tela.
        if (!stage.pipeline_type) continue;
        if (!grouped[stage.pipeline_type]) grouped[stage.pipeline_type] = [];
        grouped[stage.pipeline_type].push({
          stage_key: stage.stage_key,
          name: stage.name,
        });
      }
      return grouped;
    },
    enabled: !!orgId,
  });

  // Upsert config
  const upsertConfig = useMutation({
    mutationFn: async (config: Partial<LeadgenConfig> & { meta_page_id: string }) => {
      if (!orgId) throw new Error("Org nao encontrada");

      // Se tem id existente, faz update; senao, faz insert
      const { id, ...rest } = config;
      const payload = { ...rest, organization_id: orgId };

      if (id) {
        const { error } = await (supabase as any)
          .from("meta_leadgen_configs")
          .update(payload)
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("meta_leadgen_configs")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meta_leadgen_configs"] });
      toast.success("Configuracao salva!");
    },
    onError: () => toast.error("Erro ao salvar configuracao"),
  });

  if (!isConnected) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        Conecte sua conta Meta primeiro para configurar Lead Ads.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-primary" />
          Lead Ads — Acoes Pos-Captura
        </h4>
        <p className="text-xs text-muted-foreground mt-1">
          Configure o que acontece automaticamente quando um lead chega de um
          formulario de anuncio. Selecione o formulario, tags, campanha e pipe.
        </p>
      </div>

      {pages.map((page) => {
        const pageConfig = configs.find((c) => c.meta_page_id === page.id) || {
          id: "",
          meta_page_id: page.id,
          form_id: null,
          form_name: null,
          assign_to_campaign_id: null,
          assign_to_pipe: null,
          assign_to_stage: null,
          notify_team: false,
          auto_tag: [],
          field_mappings: [],
          is_active: true,
        };

        return (
          <PageLeadgenCard
            key={page.id}
            page={page}
            config={pageConfig}
            campaigns={campaigns}
            tags={availableTags}
            pipeStages={pipeStages}
            onSave={(c) => upsertConfig.mutate(c)}
            isSaving={upsertConfig.isPending}
          />
        );
      })}

      {pages.length === 0 && (
        <div className="text-center py-4 text-sm text-muted-foreground border border-dashed rounded-lg">
          Nenhuma pagina conectada com Lead Ads.
        </div>
      )}
    </div>
  );
}
