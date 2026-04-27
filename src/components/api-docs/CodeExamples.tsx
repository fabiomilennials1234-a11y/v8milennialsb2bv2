import { useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";
import type { ApiEndpoint } from "@/lib/api-docs/types";
import { generateCurl, generateJavaScript, generatePython } from "@/lib/api-docs/code-generators";

interface CodeExamplesProps {
  endpoint: ApiEndpoint;
  baseUrl: string;
}

export function CodeExamples({ endpoint, baseUrl }: CodeExamplesProps) {
  const examples = {
    curl: generateCurl(endpoint, baseUrl),
    javascript: generateJavaScript(endpoint, baseUrl),
    python: generatePython(endpoint, baseUrl),
  };

  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground mb-3">Exemplos de Código</h4>
      <Tabs defaultValue="curl" className="w-full">
        <TabsList className="bg-muted/50 border border-border">
          <TabsTrigger value="curl" className="text-xs">cURL</TabsTrigger>
          <TabsTrigger value="javascript" className="text-xs">JavaScript</TabsTrigger>
          <TabsTrigger value="python" className="text-xs">Python</TabsTrigger>
        </TabsList>
        <TabsContent value="curl">
          <CodeBlock code={examples.curl} language="bash" />
        </TabsContent>
        <TabsContent value="javascript">
          <CodeBlock code={examples.javascript} language="javascript" />
        </TabsContent>
        <TabsContent value="python">
          <CodeBlock code={examples.python} language="python" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className="relative group rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between bg-muted/70 px-4 py-2 border-b border-border">
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          {language}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 mr-1" />
              Copiado
            </>
          ) : (
            <>
              <Copy className="h-3 w-3 mr-1" />
              Copiar
            </>
          )}
        </Button>
      </div>
      <pre className="p-4 overflow-x-auto bg-[hsl(var(--muted)/0.3)]">
        <code className="text-xs font-mono text-foreground/90 leading-relaxed whitespace-pre">
          {code}
        </code>
      </pre>
    </div>
  );
}
