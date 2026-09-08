import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isVirtualTeamMember, useOrganization } from "@/modules/identity";
import type { Json } from "@/integrations/supabase/types";
import type { StudioWindow } from "@/modules/analytics/lib/metrics-studio-window";

interface PendingLayout {
  organizationId: string;
  panelId: string;
  editorId: string | null;
  layout: StudioWindow[];
}
export interface PanelPersistence {
  organizationId: string | null;
  layout: StudioWindow[] | null;
  isLoading: boolean;
  error: Error | null;
  save: (windows: StudioWindow[]) => void;
  isSaving: boolean;
  saveError: string | null;
  retrySave: () => void;
  discardPanel: (id: string) => void;
  refetch: () => void;
}
const key = (org: string, panel: string) => ["metrics-studio-panel", org, panel];
const message = (error: unknown) => error instanceof Error ? error.message : "Não foi possível salvar o painel";

/** Fila por org+aba: mudar de aba nunca troca o destino nem descarta outra edição. */
export function useMetricsStudioPanel(panelId: string | null): PanelPersistence {
  const { organizationId, teamMemberId, isReady } = useOrganization();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef(new Map<string, PendingLayout>());
  const failed = useRef(new Map<string, PendingLayout>());
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ativa = isReady && !!organizationId;
  const editorId = isVirtualTeamMember(teamMemberId) ? null : teamMemberId ?? null;

  const query = useQuery({
    queryKey: key(organizationId ?? "", panelId ?? ""),
    queryFn: async (): Promise<StudioWindow[]> => {
      const { data, error } = await supabase.from("metrics_studio_panels")
        .select("layout").eq("id", panelId!).eq("organization_id", organizationId!).single();
      if (error) throw new Error(`Carregar painel: ${error.message}`);
      if (!Array.isArray(data.layout)) throw new Error("O layout salvo não é válido");
      return data.layout as unknown as StudioWindow[];
    },
    enabled: ativa && !!panelId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const flush = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      while (pending.current.size) {
        const [id, target] = pending.current.entries().next().value!;
        pending.current.delete(id);
        try {
          // UPDATE, nunca upsert: um debounce não pode ressuscitar uma aba excluída.
          const { error } = await supabase.from("metrics_studio_panels")
            .update({ team_member_id: target.editorId, layout: target.layout as unknown as Json })
            .eq("id", target.panelId).eq("organization_id", target.organizationId)
            .select("id").single();
          if (error) throw new Error(error.message);
          failed.current.delete(id);
        } catch (error) {
          failed.current.set(id, target);
          setSaveError(message(error));
        }
      }
    } finally {
      inFlight.current = false;
      setIsSaving(false);
      if (!failed.current.size) setSaveError(null);
    }
  }, []);

  const schedule = useCallback(() => {
    setIsSaving(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void flush(); }, 800);
  }, [flush]);

  const save = useCallback((layout: StudioWindow[]) => {
    if (!ativa || !organizationId || !panelId) return;
    const id = JSON.stringify([organizationId, panelId]);
    pending.current.set(id, { organizationId, panelId, editorId, layout });
    failed.current.delete(id);
    queryClient.setQueryData(key(organizationId, panelId), layout);
    schedule();
  }, [ativa, organizationId, panelId, editorId, queryClient, schedule]);

  const retrySave = useCallback(() => {
    for (const [id, target] of failed.current) {
      if (!pending.current.has(id)) pending.current.set(id, target);
    }
    if (pending.current.size) schedule();
  }, [schedule]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current.size || inFlight.current || failed.current.size) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      if (timer.current) clearTimeout(timer.current);
      void flush();
    };
  }, [flush]);

  return {
    organizationId: ativa ? organizationId : null,
    layout: ativa ? query.data ?? null : [],
    isLoading: ativa && !!panelId && query.isLoading,
    error: query.error,
    save, isSaving, saveError, retrySave,
    discardPanel: (id: string) => {
      const target = JSON.stringify([organizationId, id]);
      pending.current.delete(target);
      failed.current.delete(target);
      if (!failed.current.size) setSaveError(null);
    },
    refetch: () => { void query.refetch(); },
  };
}
