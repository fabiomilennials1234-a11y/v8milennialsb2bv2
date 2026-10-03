import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Retorna um Map<team_member_id, avatar_url> para exibir fotos de perfil.
 * Faz join de team_members.user_id → profiles.avatar_url.
 */
export function useAvatarMap() {
  const { data: avatarMap = new Map<string, string>() } = useQuery({
    queryKey: ["avatar-map"],
    queryFn: async () => {
      // Buscar team_members com user_id
      const { data: members, error: membersError } = await supabase
        .from("team_members")
        .select("id, user_id");

      if (membersError) throw membersError;

      // Buscar profiles com avatar_url
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, avatar_url")
        .not("avatar_url", "is", null);

      if (profilesError) throw profilesError;

      // Mapear profile.id (= user_id) → avatar_url
      const profileMap = new Map<string, string>();
      for (const profile of profiles || []) {
        if (profile.avatar_url) {
          profileMap.set(profile.id, profile.avatar_url);
        }
      }

      // Mapear team_member.id → avatar_url (via user_id)
      const map = new Map<string, string>();
      for (const member of members || []) {
        if (member.user_id) {
          const url = profileMap.get(member.user_id);
          if (url) {
            map.set(member.id, url);
          }
        }
      }
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });

  return avatarMap;
}
