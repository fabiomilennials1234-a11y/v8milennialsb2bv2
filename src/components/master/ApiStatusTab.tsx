/**
 * ApiStatusTab — Health check de todas as APIs do sistema
 *
 * Grid de cards com status em tempo real.
 * Auto-refresh a cada 60s + botão manual.
 */

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Loader2,
  Zap,
  Brain,
  Sparkles,
  MessageSquare,
  CreditCard,
  Bug,
  Share2,
  Bot,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

// ─── Types ──────────────────────────────────────────────

interface ApiHealthResult {
  service: string;
  status: "connected" | "error" | "not_configured";
  latency_ms: number;
  error?: string;
  checked_at: string;
}

interface HealthCheckResponse {
  results: ApiHealthResult[];
  checked_at: string;
}

// ─── Service icons & metadata ───────────────────────────

const SERVICE_META: Record<string, { icon: React.ReactNode; description: string; category: string }> = {
  "Evolution API": {
    icon: <MessageSquare className="w-5 h-5" />,
    description: "WhatsApp messaging gateway",
    category: "Messaging",
  },
  "OpenRouter": {
    icon: <Brain className="w-5 h-5" />,
    description: "Multi-model LLM proxy (Gemini, Claude, etc.)",
    category: "AI",
  },
  "Gemini": {
    icon: <Sparkles className="w-5 h-5" />,
    description: "Embeddings multimodais + LLM",
    category: "AI",
  },
  "OpenAI": {
    icon: <Bot className="w-5 h-5" />,
    description: "Vision + text extraction (fallback)",
    category: "AI",
  },
  "Asaas": {
    icon: <CreditCard className="w-5 h-5" />,
    description: "Pagamentos (PIX, boleto, cartao)",
    category: "Billing",
  },
  "Sentry": {
    icon: <Bug className="w-5 h-5" />,
    description: "Error tracking + performance",
    category: "Monitoring",
  },
  "Meta (Facebook)": {
    icon: <Share2 className="w-5 h-5" />,
    description: "Lead Ads + Messenger + Instagram",
    category: "Marketing",
  },
};

// ─── Status badge ───────────────────────────────────────

function StatusBadge({ status }: { status: ApiHealthResult["status"] }) {
  if (status === "connected") {
    return (
      <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 gap-1">
        <CheckCircle2 className="w-3 h-3" />
        Conectado
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 gap-1">
        <XCircle className="w-3 h-3" />
        Erro
      </Badge>
    );
  }
  return (
    <Badge className="bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-500/20 gap-1">
      <MinusCircle className="w-3 h-3" />
      Nao Configurado
    </Badge>
  );
}

// ─── API Card ───────────────────────────────────────────

function ApiCard({ result }: { result: ApiHealthResult }) {
  const meta = SERVICE_META[result.service] || {
    icon: <Zap className="w-5 h-5" />,
    description: "",
    category: "Other",
  };

  const statusColor = result.status === "connected"
    ? "border-emerald-500/20"
    : result.status === "error"
    ? "border-red-500/20"
    : "border-zinc-500/10";

  return (
    <Card className={`transition-colors ${statusColor}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${
              result.status === "connected" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
              result.status === "error" ? "bg-red-500/10 text-red-600 dark:text-red-400" :
              "bg-zinc-500/10 text-zinc-500"
            }`}>
              {meta.icon}
            </div>
            <div>
              <p className="text-sm font-semibold">{result.service}</p>
              <p className="text-[11px] text-muted-foreground">{meta.description}</p>
            </div>
          </div>
          <StatusBadge status={result.status} />
        </div>

        {/* Details */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {result.latency_ms > 0 && (
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              {result.latency_ms}ms
            </span>
          )}
          <span className="text-[11px]">
            {formatDistanceToNow(new Date(result.checked_at), { addSuffix: true, locale: ptBR })}
          </span>
        </div>

        {/* Error message */}
        {result.error && (
          <div className="text-xs text-red-500 dark:text-red-400 bg-red-500/5 rounded-md px-2.5 py-1.5 font-mono break-all">
            {result.error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Loading skeleton ───────────────────────────────────

function ApiCardSkeleton() {
  return (
    <Card className="animate-pulse">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-muted" />
            <div className="space-y-1.5">
              <div className="h-4 w-24 rounded bg-muted" />
              <div className="h-3 w-40 rounded bg-muted" />
            </div>
          </div>
          <div className="h-5 w-20 rounded-full bg-muted" />
        </div>
        <div className="h-3 w-16 rounded bg-muted" />
      </CardContent>
    </Card>
  );
}

// ─── Main Component ─────────────────────────────────────

export function ApiStatusTab() {
  const [results, setResults] = useState<ApiHealthResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastCheck, setLastCheck] = useState<string | null>(null);

  const runHealthCheck = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("check-api-health");
      if (error) throw error;
      const response = data as HealthCheckResponse;
      setResults(response.results);
      setLastCheck(response.checked_at);
    } catch (e) {
      console.error("Health check failed:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load + auto-refresh every 60s
  useEffect(() => {
    runHealthCheck();
    const interval = setInterval(runHealthCheck, 60000);
    return () => clearInterval(interval);
  }, [runHealthCheck]);

  // Stats
  const connected = results.filter((r) => r.status === "connected").length;
  const errors = results.filter((r) => r.status === "error").length;
  const notConfigured = results.filter((r) => r.status === "not_configured").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {results.length > 0 && (
            <>
              <Badge variant="outline" className="gap-1 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                <CheckCircle2 className="w-3 h-3" />
                {connected} conectadas
              </Badge>
              {errors > 0 && (
                <Badge variant="outline" className="gap-1 text-red-600 dark:text-red-400 border-red-500/30">
                  <XCircle className="w-3 h-3" />
                  {errors} com erro
                </Badge>
              )}
              {notConfigured > 0 && (
                <Badge variant="outline" className="gap-1 text-zinc-500 border-zinc-500/30">
                  <MinusCircle className="w-3 h-3" />
                  {notConfigured} nao configuradas
                </Badge>
              )}
            </>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={runHealthCheck}
          disabled={isLoading}
          className="gap-2"
        >
          {isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          Verificar Agora
        </Button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {isLoading && results.length === 0
          ? Array.from({ length: 7 }).map((_, i) => <ApiCardSkeleton key={i} />)
          : results.map((result) => <ApiCard key={result.service} result={result} />)
        }
      </div>

      {/* Footer */}
      {lastCheck && (
        <p className="text-xs text-muted-foreground text-center">
          Auto-refresh a cada 60s
        </p>
      )}
    </div>
  );
}
