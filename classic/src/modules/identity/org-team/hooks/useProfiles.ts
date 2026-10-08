import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Profile = Tables<"profiles">;

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("full_name");
      
      if (error) throw error;
      return data as Profile[];
    },
  });
}

export function useProfile(id: string) {
  return useQuery({
    queryKey: ["profiles", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", id)
        .single();
      
      if (error) throw error;
      return data as Profile;
    },
    enabled: !!id,
  });
}
