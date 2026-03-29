import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  AlertTriangle,
  Target,
  TrendingUp,
  Lightbulb,
  ChevronRight,
  Loader2,
  User,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useTVDashboardData } from "@/hooks/useTVDashboardData";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { useIndividualGoals } from "@/hooks/useGoals";

// ── Types ──────────────────────────────────────────────────

interface VendorAction {
  name: string;
  action: string;
  reason: string;
}

interface TVAnalysis {
  diagnostico: string;
  causa: string;
  acao_prioritaria: string;
  acao_secundaria: string;
  oportunidade: string | null;
  alerta: string | null;
  vendor_actions: VendorAction[];
}

// ── Component ──────────────────────────────────────────────

export function AICoachSection() {
  const [analysis, setAnalysis] = useState<TVAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeVendorIdx, setActiveVendorIdx] = useState(0);

  const { organizationId } = useOrganization();
  const { data: tvData } = useTVDashboardData();
  const { data: teamMembers } = useTeamMembers();

  const now = new Date();
  const { data: individualGoals } = useIndividualGoals(now.getMonth() + 1, now.getFullYear());

  // Build team members with goals for context (memoized to prevent re-render loops)
  const membersWithGoals = useMemo(() => (teamMembers || [])
    .filter((m) => m.is_active)
    .map((m) => {
      const isSales = m.metric_type === "sales";
      const goals = isSales
        ? individualGoals?.closerGoals
        : individualGoals?.meetingsGoals;
      const memberGoal = (goals || []).find((g: any) => g.id === m.id);
      return {
        name: m.name,
        metric_type: m.metric_type || "sales",
        current: memberGoal?.current || 0,
        goal: memberGoal?.goal || 0,
        percentage: memberGoal?.percentage || 0,
      };
    }), [teamMembers, individualGoals]);

  const fetchAnalysis = useCallback(async () => {
    if (!organizationId) return;
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "oraculo-comercial",
        {
          body: {
            mode: "tv_analysis",
            organization_id: organizationId,
            tv_data: {
              metaVendasMes: tvData?.metaVendasMes || 0,
              vendasRealizadas: tvData?.vendasRealizadas || 0,
              ondeDeveriamEstar: tvData?.ondeDeveriamEstar || 0,
              propostasQuentes: tvData?.propostasQuentes || [],
            },
            team_members: membersWithGoals,
          },
        }
      );

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);

      setAnalysis(data as TVAnalysis);
    } catch (e: any) {
      console.error("[AICoach] TV analysis error:", e);
      setError(e.message || "Erro ao gerar análise");
      setAnalysis(null);
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, tvData, membersWithGoals]);

  // Stable ref for fetch to avoid interval recreation
  const fetchRef = useRef(fetchAnalysis);
  fetchRef.current = fetchAnalysis;

  // Auto-fetch on mount and every 5 minutes
  useEffect(() => {
    if (!organizationId || !tvData) return;
    fetchRef.current();
    const interval = setInterval(() => fetchRef.current(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [organizationId, tvData]);

  // Auto-rotate vendor actions
  const vendorCount = analysis?.vendor_actions?.length ?? 0;
  useEffect(() => {
    if (vendorCount === 0) return;
    const interval = setInterval(() => {
      setActiveVendorIdx((prev) => (prev + 1) % vendorCount);
    }, 8000);
    return () => clearInterval(interval);
  }, [vendorCount]);

  // Loading state
  if (isLoading && !analysis) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
        <p className="text-xs text-white/40">Analisando operação...</p>
      </div>
    );
  }

  // Error state
  if (error && !analysis) {
    return (
      <div className="flex flex-col items-center justify-center py-6 gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-400" />
        <p className="text-xs text-white/40 text-center">{error}</p>
        <button
          onClick={fetchAnalysis}
          className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!analysis) return null;

  const vendors = analysis.vendor_actions || [];
  const currentVendor = vendors[activeVendorIdx];

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* ── Macro Insight: Diagnóstico Principal ── */}
      <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Target className="w-4 h-4 text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wider mb-1">
              Diagnóstico
            </p>
            <p className="text-sm text-white/90 leading-snug">
              {analysis.diagnostico}
            </p>
            {analysis.causa && (
              <p className="text-xs text-white/50 mt-1 leading-snug">
                {analysis.causa}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Ação Prioritária ── */}
      <div className="rounded-lg bg-emerald-500/[0.06] border border-emerald-500/20 p-3">
        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-1">
              Ação Prioritária
            </p>
            <p className="text-sm text-white/90 leading-snug">
              {analysis.acao_prioritaria}
            </p>
            {analysis.acao_secundaria && (
              <p className="text-xs text-white/50 mt-1">
                Também: {analysis.acao_secundaria}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Oportunidade ou Alerta ── */}
      {analysis.oportunidade && (
        <div className="rounded-lg bg-yellow-500/[0.06] border border-yellow-500/20 p-2.5">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-yellow-400 flex-shrink-0" />
            <p className="text-xs text-white/80 leading-snug">
              <span className="font-bold text-yellow-400">Oportunidade: </span>
              {analysis.oportunidade}
            </p>
          </div>
        </div>
      )}

      {analysis.alerta && (
        <div className="rounded-lg bg-red-500/[0.06] border border-red-500/20 p-2.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-xs text-white/80 leading-snug">
              <span className="font-bold text-red-400">Alerta: </span>
              {analysis.alerta}
            </p>
          </div>
        </div>
      )}

      {/* ── Vendor Actions (auto-rotate) ── */}
      {vendors.length > 0 && (
        <div className="flex-1 min-h-0">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-wider">
              Foco por Vendedor
            </p>
            {vendors.length > 1 && (
              <div className="flex gap-1">
                {vendors.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveVendorIdx(i)}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${
                      i === activeVendorIdx ? "bg-purple-400 w-3" : "bg-white/20"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {currentVendor && (
              <motion.div
                key={activeVendorIdx}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3"
              >
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-purple-500/15 flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-purple-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white">
                      {currentVendor.name}
                    </p>
                    <p className="text-xs text-white/70 mt-0.5 leading-snug">
                      {currentVendor.action}
                    </p>
                    <p className="text-[10px] text-white/40 mt-1">
                      {currentVendor.reason}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/20 flex-shrink-0 mt-1" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── Refresh indicator ── */}
      {isLoading && analysis && (
        <div className="flex items-center justify-center gap-1.5 py-1">
          <Loader2 className="w-3 h-3 animate-spin text-purple-400/50" />
          <span className="text-[9px] text-white/30">Atualizando...</span>
        </div>
      )}
    </div>
  );
}
