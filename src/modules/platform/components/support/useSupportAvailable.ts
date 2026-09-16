import { useAuth, useGestor } from "@/modules/identity";

/** Suporte não faz parte da experiência do gestor, inclusive dentro das orgs. */
export function useSupportAvailable() {
  const { user } = useAuth();
  const { isGestor, isLoading, error } = useGestor();
  return !!user && !isLoading && !error && !isGestor;
}
