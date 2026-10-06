/**
 * Monitoramento — junta as fontes de erro que já existem numa fila só.
 *
 * Fontes (todas com policy de leitura para master):
 *   system_alerts          alertas abertos dos últimos 7 dias (automação, padrões de dead-letter)
 *   whatsapp_health_checks checagens ruins das últimas 24 h (o monitor roda a cada 5 min)
 *   runtime_logs           erros da aplicação das últimas 24 h
 *
 * O Sentry entra quando existir a edge function que lê a API dele por org
 * (ADR-0038) — hoje nenhuma tela lê o Sentry, e a fila não finge que lê.
 *
 * Cada fonte tem teto de linhas; quando bate no teto a tela avisa, em vez de
 * mostrar uma contagem truncada como se fosse a real.
 */

import { useQuery } from "@tanstack/react-query";
import { subDays, subHours } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useMasterAuth } from "./useMasterAuth";
import {
  buildIncidents,
  normalizeSignature,
  type IncidentEvent,
  type IncidentOrigin,
  type IncidentSeverity,
} from "../lib/incidents";

const ROW_CAP = 1000;

const HEALTH_LABELS: Record<string, string> = {
  critical: "Chip em estado crítico",
  error: "Chip com erro",
  probe_failed: "Chip não responde à sonda",
};

const ALERT_SEVERITY: Record<string, IncidentSeverity | null> = {
  critical: "critico",
  error: "erro",
  warning: "aviso",
  info: null,
};

function alertOrigin(category: string, sourceType: string | null): IncidentOrigin {
  const s = `${category} ${sourceType ?? ""}`.toLowerCase();
  if (s.includes("whatsapp") || s.includes("uazapi")) return "whatsapp";
  if (s.includes("meta")) return "meta";
  return "automacao";
}

export function useIncidentFeed() {
  const { isMaster } = useMasterAuth();

  return useQuery({
    queryKey: ["master-incident-feed"],
    queryFn: async () => {
      const desde24h = subHours(new Date(), 24).toISOString();
      const desde7d = subDays(new Date(), 7).toISOString();

      const [orgs, alerts, health, logs] = await Promise.all([
        supabase.from("organizations").select("id, name"),
        supabase
          .from("system_alerts")
          .select("organization_id, severity, category, source_type, title, message, created_at")
          .is("resolved_at", null)
          .gte("created_at", desde7d)
          .order("created_at", { ascending: false })
          .limit(ROW_CAP),
        supabase
          .from("whatsapp_health_checks")
          .select("organization_id, instance_id, status, notes, checked_at")
          .in("status", ["critical", "error", "probe_failed"])
          .gte("checked_at", desde24h)
          .order("checked_at", { ascending: false })
          .limit(ROW_CAP),
        supabase
          .from("runtime_logs")
          .select("organization_id, module, action, error_message, created_at")
          .eq("status", "error")
          .gte("created_at", desde24h)
          .order("created_at", { ascending: false })
          .limit(ROW_CAP),
      ]);
      for (const r of [orgs, alerts, health, logs]) if (r.error) throw r.error;

      const nome = new Map((orgs.data ?? []).map((o) => [o.id, o.name]));
      const orgName = (id: string | null) => (id ? (nome.get(id) ?? null) : null);
      const events: IncidentEvent[] = [];

      for (const a of alerts.data ?? []) {
        const severity = ALERT_SEVERITY[a.severity];
        if (!severity) continue;
        events.push({
          origin: alertOrigin(a.category, a.source_type),
          severity,
          organizationId: a.organization_id,
          organizationName: orgName(a.organization_id),
          signature: `alert:${a.category}:${normalizeSignature(a.title)}`,
          title: a.title,
          detail: a.message,
          at: a.created_at,
        });
      }

      for (const h of health.data ?? []) {
        events.push({
          origin: "whatsapp",
          severity: h.status === "critical" ? "critico" : "erro",
          organizationId: h.organization_id,
          organizationName: orgName(h.organization_id),
          signature: `health:${h.status}`,
          title: HEALTH_LABELS[h.status] ?? `Chip: ${h.status}`,
          detail: h.notes,
          at: h.checked_at,
        });
      }

      for (const l of logs.data ?? []) {
        events.push({
          origin: "aplicacao",
          severity: "erro",
          organizationId: l.organization_id,
          organizationName: orgName(l.organization_id),
          signature: `log:${l.module}:${l.action}:${normalizeSignature(l.error_message ?? "")}`,
          title: `${l.module} · ${l.action}`,
          detail: l.error_message,
          at: l.created_at,
        });
      }

      return {
        incidents: buildIncidents(events),
        truncated: [alerts, health, logs].some((r) => (r.data?.length ?? 0) >= ROW_CAP),
      };
    },
    enabled: isMaster,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}
