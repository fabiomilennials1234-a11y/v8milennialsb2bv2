import { useState } from "react";
import { Zap, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";
import { JsonBlock } from "./JsonBlock";
import { ApiExplorer } from "./ApiExplorer";
import { generateCurl, generateJavaScript, generatePython } from "@/lib/api-docs/code-generators";
import type { OrgContext } from "@/lib/api-docs/code-generators";
import type { ApiEndpoint } from "@/lib/api-docs/types";

type Language = "curl" | "javascript" | "python";

interface ApiCodePanelProps {
  endpoint: ApiEndpoint;
  orgContext: OrgContext;
}

const LANGUAGES: { id: Language; label: string; lang: string }[] = [
  { id: "curl", label: "cURL", lang: "bash" },
  { id: "javascript", label: "JavaScript", lang: "javascript" },
  { id: "python", label: "Python", lang: "python" },
];

const generators: Record<Language, (ep: ApiEndpoint, org: OrgContext) => string> = {
  curl: generateCurl,
  javascript: generateJavaScript,
  python: generatePython,
};

export function ApiCodePanel({ endpoint, orgContext }: ApiCodePanelProps) {
  const [language, setLanguage] = useState<Language>("curl");
  const [explorerMode, setExplorerMode] = useState(false);

  const code = generators[language](endpoint, orgContext);
  const langConfig = LANGUAGES.find((l) => l.id === language)!;

  const hasOrgData = orgContext.organizationId && orgContext.organizationId !== "carregando...";

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-card border border-tinta-line bg-tinta text-tinta-foreground shadow-relevo-tinta">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-tinta-line px-4 py-3">
        <div className="flex items-center gap-0.5 rounded-full bg-tinta-2 p-1">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.id}
              onClick={() => {
                setLanguage(lang.id);
                setExplorerMode(false);
              }}
              className={cn(
                "rounded-full px-3 py-1.5 text-[12px] font-semibold transition-all",
                language === lang.id && !explorerMode
                  ? "bg-tinta-3 text-tinta-foreground shadow-sm"
                  : "text-tinta-muted hover:text-tinta-foreground",
              )}
            >
              {lang.label}
            </button>
          ))}
          <div className="mx-1 h-4 w-px bg-tinta-line" />
          <button
            onClick={() => setExplorerMode(true)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-all",
              explorerMode
                ? "bg-primary text-primary-foreground shadow-brilho-ouro"
                : "text-tinta-muted hover:text-tinta-foreground",
            )}
          >
            <Zap className="w-3 h-3" />
            Testar
          </button>
        </div>
      </div>

      {/* Org data banner */}
      {hasOrgData && !explorerMode && (
        <div className="flex items-center gap-2 border-b border-tinta-line bg-white/[.04] px-4 py-2">
          <Info className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="text-[11px] text-tinta-muted">
            Estes exemplos usam os dados da sua organização
          </span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {explorerMode ? (
          <ApiExplorer endpoint={endpoint} orgContext={orgContext} />
        ) : (
          <div className="p-4 space-y-4">
            <CodeBlock code={code} language={langConfig.lang} />
            <JsonBlock
              data={endpoint.responseExample}
              label="Response de exemplo"
              defaultCollapsed
            />
          </div>
        )}
      </div>
    </div>
  );
}
