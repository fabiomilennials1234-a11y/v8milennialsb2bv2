import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import type { WhatsAppInstanceForUser } from "@/hooks/chat/types";

const LS_KEY_PREFIX = "preferred_whatsapp_instance:";

function lsKey(teamMemberId: string): string {
  return `${LS_KEY_PREFIX}${teamMemberId}`;
}

function readLocal(teamMemberId: string | null | undefined): string | null {
  if (!teamMemberId || typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(lsKey(teamMemberId)) || null;
  } catch {
    return null;
  }
}

function writeLocal(teamMemberId: string | null | undefined, instanceId: string | null): void {
  if (!teamMemberId || typeof localStorage === "undefined") return;
  try {
    if (instanceId) {
      localStorage.setItem(lsKey(teamMemberId), instanceId);
    } else {
      localStorage.removeItem(lsKey(teamMemberId));
    }
  } catch { /* silent */ }
}

const QUERY_KEY = "preferred_whatsapp_instance";

export function usePreferredInstance(allowedInstances: WhatsAppInstanceForUser[]) {
  const { data: teamMember } = useCurrentTeamMember();
  const tmId = teamMember?.id ?? null;
  const queryClient = useQueryClient();

  const localFallback = useMemo(() => readLocal(tmId), [tmId]);

  const { data: dbValue, isLoading } = useQuery({
    queryKey: [QUERY_KEY, tmId],
    queryFn: async () => {
      if (!tmId) return null;
      const { data, error } = await supabase
        .from("team_members")
        .select("preferred_whatsapp_instance_id")
        .eq("id", tmId)
        .single();
      if (error) throw error;
      const id = data?.preferred_whatsapp_instance_id ?? null;
      if (id) writeLocal(tmId, id);
      return id ?? null;
    },
    enabled: !!tmId,
    staleTime: 10 * 60_000,
  });

  const resolved = dbValue ?? localFallback;

  const isValid = useMemo(() => {
    if (!resolved) return false;
    return allowedInstances.some((i) => i.id === resolved);
  }, [resolved, allowedInstances]);

  const preferredInstanceId = isValid ? resolved : null;

  useEffect(() => {
    if (resolved && !isValid && !isLoading && tmId) {
      writeLocal(tmId, null);
      supabase
        .from("team_members")
        .update({ preferred_whatsapp_instance_id: null })
        .eq("id", tmId)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: [QUERY_KEY, tmId] });
        });
    }
  }, [resolved, isValid, isLoading, tmId, queryClient]);

  const { mutate: setPreferred } = useMutation({
    mutationFn: async (instanceId: string | null) => {
      if (!tmId) return;
      writeLocal(tmId, instanceId);
      const { error } = await supabase
        .from("team_members")
        .update({ preferred_whatsapp_instance_id: instanceId })
        .eq("id", tmId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY, tmId] });
    },
  });

  const setPreferredInstance = useCallback(
    (instanceId: string | null) => {
      setPreferred(instanceId);
    },
    [setPreferred],
  );

  return {
    preferredInstanceId,
    setPreferredInstance,
    isLoading: isLoading && !localFallback,
  };
}
