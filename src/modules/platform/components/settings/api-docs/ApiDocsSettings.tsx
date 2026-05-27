import { useState, useMemo } from "react";
import { Book, Menu, X, Key, ChevronDown, ChevronUp } from "lucide-react";
import { useOrganization } from "@/modules/identity";
import { useApiKeys } from "@/modules/platform/hooks/useApiKeys";
import { apiCategories } from "@/lib/api-docs/endpoints";
import { ApiDocsSidebar } from "./ApiDocsSidebar";
import { ApiDocsContent } from "./ApiDocsContent";
import { ApiCodePanel } from "./ApiCodePanel";
import { ApiKeysPanel } from "@/modules/platform/components/settings/ApiKeysPanel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { OrgContext } from "@/lib/api-docs/code-generators";

export function ApiDocsSettings() {
  const { organizationId } = useOrganization();
  const baseUrl = (import.meta.env.VITE_SUPABASE_URL as string || "").replace(/\/$/, "");
  const { data: keys = [] } = useApiKeys();
  const activeKeys = keys.filter((k) => k.is_active);

  const allEndpoints = useMemo(
    () => apiCategories.flatMap((c) => c.endpoints),
    [],
  );

  const [selectedEndpointId, setSelectedEndpointId] = useState(
    allEndpoints[0]?.id || "",
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedKeyPrefix, setSelectedKeyPrefix] = useState<string>("");
  const [keysOpen, setKeysOpen] = useState(true);

  const selectedEndpoint = allEndpoints.find((e) => e.id === selectedEndpointId) || allEndpoints[0];

  const selectedKeyDisplay = selectedKeyPrefix
    ? `${selectedKeyPrefix}...`
    : undefined;

  const orgContext: OrgContext = useMemo(
    () => ({
      baseUrl,
      organizationId: organizationId || "carregando...",
      apiKey: selectedKeyDisplay,
    }),
    [baseUrl, organizationId, selectedKeyDisplay],
  );

  if (!selectedEndpoint) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>Nenhum endpoint documentado ainda.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0 -mx-6 -mt-6">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 pt-6 pb-4 border-b border-border">
        <Book className="w-5 h-5 text-primary" />
        <div>
          <h3 className="text-lg font-semibold">API & Chaves</h3>
          <p className="text-sm text-muted-foreground">
            Gerencie chaves e consulte a documentação dos endpoints
          </p>
        </div>
        {/* API Key selector for code examples */}
        <div className="ml-auto flex items-center gap-2">
          <Key className="w-4 h-4 text-muted-foreground hidden sm:block" />
          <Select
            value={selectedKeyPrefix}
            onValueChange={setSelectedKeyPrefix}
            disabled={activeKeys.length === 0}
          >
            <SelectTrigger className="w-[200px] h-8 text-xs">
              <SelectValue placeholder={activeKeys.length === 0 ? "Nenhuma key ativa" : "Selecionar API Key"} />
            </SelectTrigger>
            <SelectContent>
              {activeKeys.map((k) => (
                <SelectItem key={k.id} value={k.key_prefix} className="text-xs">
                  <span className="font-mono">{k.key_prefix}...</span>
                  <span className="text-muted-foreground ml-2">({k.name})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Mobile nav toggle */}
          <button
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            className="xl:hidden p-2 rounded-md hover:bg-muted/50 transition-colors"
          >
            {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* API Keys section — collapsible */}
      <Collapsible open={keysOpen} onOpenChange={setKeysOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full px-6 py-3 border-b border-border hover:bg-muted/30 transition-colors">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Chaves de API</span>
            <span className="text-xs text-muted-foreground">({activeKeys.length} ativas)</span>
          </div>
          {keysOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-6 py-4 border-b border-border bg-muted/5">
            <ApiKeysPanel />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Three-panel docs layout */}
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
