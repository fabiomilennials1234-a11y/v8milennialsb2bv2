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
      <div className="flex h-64 items-center justify-center rounded-card border border-card-border bg-card text-muted-foreground shadow-relevo">
        <p>Nenhum endpoint documentado ainda.</p>
      </div>
    );
  }

  return (
    // V5: a aba é renderizada sem cartão em Configurações — o cartão mora
    // aqui (antes, `-mx-6 -mt-6` compensava um padding que não existia).
    <div className="overflow-hidden rounded-card border border-card-border bg-card text-card-foreground shadow-relevo">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 pb-4 pt-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-muted text-foreground/70">
          <Book className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-bold tracking-tight">API & Chaves</h3>
          <p className="text-[13px] text-muted-foreground">
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
            <SelectTrigger className="h-9 w-[200px] rounded-full text-xs">
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
            aria-label={mobileNavOpen ? "Fechar lista de endpoints" : "Abrir lista de endpoints"}
            className="rounded-xl p-2 transition-colors hover:bg-muted xl:hidden"
          >
            {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* API Keys section — collapsible */}
      <Collapsible open={keysOpen} onOpenChange={setKeysOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between border-b border-border px-6 py-3 transition-colors hover:bg-muted/40">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Chaves de API</span>
            <span className="text-xs tabular-nums text-muted-foreground">({activeKeys.length} ativas)</span>
          </div>
          {keysOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-b border-border bg-muted/20 px-6 py-4">
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
          <div className="border-b border-border bg-card xl:hidden">
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
        <div className="shrink-0 p-3 xl:w-[420px] xl:pl-0">
          <ApiCodePanel endpoint={selectedEndpoint} orgContext={orgContext} />
        </div>
      </div>
    </div>
  );
}
