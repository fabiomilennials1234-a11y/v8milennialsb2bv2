import { useCallback } from "react";
import { useLocation } from "react-router-dom";
import { buildSupportContext, type SupportContext } from "@/core/observability/support-context";
import { getSessionId } from "@/core/trace/request-trace";
import { useAuth } from "@/modules/identity";
import { useOrganization } from "@/modules/identity";

/**
 * Captura o Support Context no instante em que o Chamado é aberto.
 *
 * Devolve uma função, não um valor: o snapshot descreve *o mundo quando
 * quebrou*, e um valor memoizado por render descreveria o mundo quando o
 * componente montou.
 */
export function useCaptureSupportContext(): () => SupportContext {
  const location = useLocation();
  const { organizationId, role } = useOrganization();
  const { user } = useAuth();

  return useCallback(
    () =>
      buildSupportContext({
        pathname: location.pathname,
        search: location.search,
        appVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev",
        userAgent: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        organizationId: organizationId ?? null,
        userId: user?.id ?? null,
        role: role ?? null,
        sessionId: getSessionId(),
      }),
    [location.pathname, location.search, organizationId, role, user?.id],
  );
}
