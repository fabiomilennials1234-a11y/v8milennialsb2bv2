/**
 * Configuracao de acoes pos-captura para Lead Ads (Meta)
 * Permite configurar o que acontece quando um lead chega via formulario de anuncio
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useMetaConnectionStatus } from "@/hooks/useMetaConnection";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Megaphone, Bell, Tag, Target } from "lucide-react";
import { toast } from "sonner";

interface LeadgenConfig {
  id: string;
  meta_page_id: string;
  form_id: string | null;
  form_name: string | null;
  assign_to_campaign_id: string | null;
  notify_team: boolean;
  auto_tag: string[];
  is_active: boolean;
}

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

  // Buscar campanhas para o select
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
      return data;
    },
    enabled: !!orgId,
  });

  // Upsert config
  const upsertConfig = useMutation({
    mutationFn: async (config: Partial<LeadgenConfig> & { meta_page_id: string }) => {
      if (!orgId) throw new Error("Org nao encontrada");

      const { error } = await (supabase as any)
        .from("meta_leadgen_configs")
        .upsert(
          {
            ...config,
            organization_id: orgId,
          },
          { onConflict: "id" }
        );

      if (error) throw error;
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
          Configure o que acontece automaticamente quando um lead chega de um formulario de anuncio.
        </p>
      </div>

      {pages.map((page) => {
        const pageConfig = configs.find((c) => c.meta_page_id === page.id) || {
          id: "",
          meta_page_id: page.id,
          form_id: null,
          form_name: null,
          assign_to_campaign_id: null,
          notify_team: false,
          auto_tag: [],
          is_active: true,
        };

        return (
          <div key={page.id} className="border rounded-lg p-4 space-y-4">
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
                checked={pageConfig.is_active}
                onCheckedChange={(checked) =>
                  upsertConfig.mutate({
                    ...pageConfig,
                    is_active: checked,
                  })
                }
              />
            </div>

            {pageConfig.is_active && (
              <div className="space-y-3 pl-2 border-l-2 border-primary/20">
                {/* Vincular a campanha */}
                <div className="flex items-center gap-3">
                  <Target className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1">
                    <Label className="text-xs">Vincular a campanha</Label>
                    <Select
                      value={pageConfig.assign_to_campaign_id || "none"}
                      onValueChange={(val) =>
                        upsertConfig.mutate({
                          ...pageConfig,
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

                {/* Notificar time */}
                <div className="flex items-center gap-3">
                  <Bell className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 flex items-center justify-between">
                    <Label className="text-xs">Notificar time</Label>
                    <Switch
                      checked={pageConfig.notify_team}
                      onCheckedChange={(checked) =>
                        upsertConfig.mutate({
                          ...pageConfig,
                          notify_team: checked,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
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
