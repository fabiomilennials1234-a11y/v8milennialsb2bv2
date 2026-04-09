import { useState, useMemo } from "react";
import { Book, Menu, X } from "lucide-react";
import { useOrganization } from "@/hooks/useOrganization";
import { apiCategories } from "@/lib/api-docs/endpoints";
import { ApiDocsSidebar } from "./ApiDocsSidebar";
import { ApiDocsContent } from "./ApiDocsContent";
import { ApiCodePanel } from "./ApiCodePanel";
import type { OrgContext } from "@/lib/api-docs/code-generators";

export function ApiDocsSettings() {
  const { organizationId } = useOrganization();
  const baseUrl = (import.meta.env.VITE_SUPABASE_URL as string || "").replace(/\/$/, "");

  const allEndpoints = useMemo(
    () => apiCategories.flatMap((c) => c.endpoints),
    [],
  );

  const [selectedEndpointId, setSelectedEndpointId] = useState(
    allEndpoints[0]?.id || "",
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const selectedEndpoint = allEndpoints.find((e) => e.id === selectedEndpointId) || allEndpoints[0];

  const orgContext: OrgContext = useMemo(
    () => ({
      baseUrl,
      organizationId: organizationId || "carregando...",
      apiKey: undefined,
    }),
    [baseUrl, organizationId],
  );

  if (!selectedEndpoint) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>Nenhum endpoint documentado ainda.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 -mx-6 -mt-6">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 pt-6 pb-4 border-b border-border">
        <Book className="w-5 h-5 text-primary" />
        <div>
          <h3 className="text-lg font-semibold">Documentacao da API</h3>
          <p className="text-sm text-muted-foreground">
            Endpoints disponiveis para integracao com sistemas externos
          </p>
        </div>
        {/* Mobile nav toggle */}
        <button
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
          className="ml-auto xl:hidden p-2 rounded-md hover:bg-muted/50 transition-colors"
        >
          {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Three-panel layout */}
      <div className="flex flex-col xl:flex-row min-h-[600px]">
        {/* Sidebar - desktop */}
        <div className="hidden xl:block w-[240px] shrink-0 border-r border-border">
          <ApiDocsSidebar
            categories={apiCategories}
            selectedEndpointId={selectedEndpointId}
            onSelect={(id) => setSelectedEndpointId(id)}
          />
        </div>

        {/* Sidebar - mobile overlay */}
        {mobileNavOpen && (
          <div className="xl:hidden border-b border-border bg-background">
            <ApiDocsSidebar
              categories={apiCategories}
              selectedEndpointId={selectedEndpointId}
              onSelect={(id) => {
                setSelectedEndpointId(id);
                setMobileNavOpen(false);
              }}
            />
          </div>
        )}

        {/* Content panel */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <ApiDocsContent endpoint={selectedEndpoint} baseUrl={baseUrl} />
        </div>

        {/* Code panel */}
        <div className="xl:w-[420px] shrink-0">
          <ApiCodePanel endpoint={selectedEndpoint} orgContext={orgContext} />
        </div>
      </div>
    </div>
  );
}
