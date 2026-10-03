import { useState, useCallback } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface JsonBlockProps {
  data: Record<string, unknown>;
  label?: string;
  defaultCollapsed?: boolean;
  className?: string;
}

export function JsonBlock({ data, label, defaultCollapsed = false, className }: JsonBlockProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [copied, setCopied] = useState(false);

  const json = JSON.stringify(data, null, 2);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [json]);

  return (
    <div className={cn("overflow-hidden rounded-xl border border-tinta-line", className)}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between bg-tinta-3 px-4 py-2 transition-colors hover:bg-tinta-3/80"
      >
        <div className="flex items-center gap-2">
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5 text-tinta-muted" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-tinta-muted" />
          )}
          <span className="text-[11px] font-mono text-tinta-muted uppercase tracking-wider">
            {label || "Response"}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleCopy();
          }}
          className="flex items-center gap-1.5 text-[11px] text-tinta-muted hover:text-tinta-foreground transition-colors"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      </button>
      {!collapsed && (
        <pre className="overflow-x-auto bg-tinta-2 p-4 text-[13px] leading-relaxed">
          <code className="whitespace-pre font-mono text-tinta-foreground/90">
            {colorizeJson(json)}
          </code>
        </pre>
      )}
    </div>
  );
}

// Cores de sintaxe: série categórica sobre superfície SEMPRE escura (tinta nos
// dois temas) — como série de gráfico, ficam literais de propósito.
function colorizeJson(json: string): React.ReactNode[] {
  return json.split("\n").map((line, i) => {
    const colored = line
      .replace(/"([^"]+)":/g, (_m, key) => `\x01"${key}"\x02:`)
      .replace(/: "([^"]*)"/g, (_m, val) => `: \x03"${val}"\x04`)
      .replace(/: (true|false)/g, (_m, val) => `: \x05${val}\x06`)
      .replace(/: (\d+)/g, (_m, val) => `: \x07${val}\x08`);

    const parts: React.ReactNode[] = [];
    let buffer = "";
    for (let j = 0; j < colored.length; j++) {
      const ch = colored[j];
      if (ch === "\x01") {
        if (buffer) parts.push(buffer);
        buffer = "";
      } else if (ch === "\x02") {
        parts.push(<span key={`${i}-k-${j}`} className="text-blue-300">{buffer}</span>);
        buffer = "";
      } else if (ch === "\x03") {
        if (buffer) parts.push(buffer);
        buffer = "";
      } else if (ch === "\x04") {
        parts.push(<span key={`${i}-s-${j}`} className="text-emerald-300">{buffer}</span>);
        buffer = "";
      } else if (ch === "\x05") {
        if (buffer) parts.push(buffer);
        buffer = "";
      } else if (ch === "\x06") {
        parts.push(<span key={`${i}-b-${j}`} className="text-amber-300">{buffer}</span>);
        buffer = "";
      } else if (ch === "\x07") {
        if (buffer) parts.push(buffer);
        buffer = "";
      } else if (ch === "\x08") {
        parts.push(<span key={`${i}-n-${j}`} className="text-purple-300">{buffer}</span>);
        buffer = "";
      } else {
        buffer += ch;
      }
    }
    if (buffer) parts.push(buffer);

    return (
      <span key={i}>
        {parts}
        {"\n"}
      </span>
    );
  });
}
