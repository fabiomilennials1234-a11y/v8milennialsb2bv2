import { useQuery } from "@tanstack/react-query";
import { useCurrentTeamMember } from "@/modules/identity";
import { contactAvatarLoader } from "@/modules/communication/lib/contactAvatarLoader";

/** A URL assinada vale 60 min; a foto é revalidada antes de vencer. */
const COM_FOTO_MS = 50 * 60 * 1000;
/** "Sem foto" volta a perguntar mais cedo: o cron pode ter acabado de baixar. */
const SEM_FOTO_MS = 10 * 60 * 1000;

/**
 * URL assinada da foto de perfil do contato WhatsApp (Uazapi), ou `null`.
 *
 * Cada linha pede a sua; o `contactAvatarLoader` junta os pedidos do mesmo
 * frame em 1 RPC + 1 assinatura. `enabled: false` (grupo, canal social) não
 * consulta nada. `null` = mostra o gradiente com a inicial, como sempre.
 */
export function useContactAvatarUrl(
  phone: string | null | undefined,
  { enabled = true }: { enabled?: boolean } = {},
): string | null {
  const { data: member } = useCurrentTeamMember();
  const organizationId = member?.organization_id ?? null;
  const { data } = useQuery({
    queryKey: ["contact-avatar", organizationId, phone ?? null],
    queryFn: () => contactAvatarLoader.load(organizationId as string, phone as string),
    enabled: enabled && !!organizationId && !!phone,
    staleTime: (query) => (query.state.data ? COM_FOTO_MS : SEM_FOTO_MS),
    gcTime: 60 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return data ?? null;
}
