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
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 rounded-lg xl:rounded-l-none overflow-hidden border border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
        <div className="flex items-center gap-1 bg-zinc-800/50 rounded-md p-0.5">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.id}
              onClick={() => {
                setLanguage(lang.id);
                setExplorerMode(false);
              }}
              className={cn(
                "px-3 py-1.5 text-[12px] font-medium rounded transition-all",
                language === lang.id && !explorerMode
                  ? "bg-zinc-700 text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              {lang.label}
            </button>
          ))}
          <div className="w-px h-4 bg-zinc-700 mx-1" />
          <button
            onClick={() => setExplorerMode(true)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded transition-all",
              explorerMode
                ? "bg-blue-600 text-white shadow-sm"
                : "text-zinc-500 hover:text-zinc-300",
            )}
          >
            <Zap className="w-3 h-3" />
            Testar
          </button>
        </div>
      </div>

      {/* Org data banner */}
      {hasOrgData && !explorerMode && (
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 border-b border-blue-500/20">
          <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="text-[11px] text-blue-300">
            Estes exemplos usam os dados da sua organizacao
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
