/**
 * O andar de baixo do alarme: quem vigia o ENVIO do alerta do infra-watchdog.
 *
 * Quando o watchdog detecta algo e o WhatsApp não sai, ele grava
 * `module='job_monitor', action='watchdog_alert', status='error'` em
 * `runtime_logs` e chama isso de "último recurso" — só que ninguém lia essa
 * prateleira. É a MESMA prateleira não-lida do incidente que criou o watchdog.
 *
 * O que estes testes seguram, nesta ordem de importância:
 *   1. falha plantada MORDE — e o alerta diz QUANTAS e DESDE QUANDO;
 *   2. sem falha, SILÊNCIO — sem "tudo ok" diário;
 *   3. a janela expira, então conserto devolve o silêncio sozinho;
 *   4. consulta quebrada NÃO vira silêncio ("não sei" ≠ "não há").
 */

import { describe, it, expect, vi } from "vitest";
import {
  assessWatchdogDelivery,
  WATCHDOG_DELIVERY_LOOKBACK_MINUTES,
} from "../../supabase/functions/cron-health-check/watchdog-delivery.ts";
import { runHealthCheck } from "../../supabase/functions/cron-health-check/health-check.ts";

const AGORA = new Date("2026-08-11T18:00:00.000Z");
const minutosAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000).toISOString();

const sondaSaudavel = {
  fetchTableSecret: vi.fn().mockResolvedValue("segredo"),
  envSecret: "segredo",
  probe: vi.fn().mockResolvedValue(200),
};

describe("watchdog-delivery — assessWatchdogDelivery", () => {
  it("MORDE com falha plantada, e diz quantas e desde quando", () => {
    const r = assessWatchdogDelivery(
      [
        { created_at: minutosAtras(10) },
        { created_at: minutosAtras(180) },
        { created_at: minutosAtras(90) },
      ],
      AGORA,
    );

    expect(r.failing).toBe(true);
    expect(r.count).toBe(3);
    // A mais ANTIGA das três, não a primeira da lista — a entrada vem fora de ordem
    // de propósito, porque `order by` na consulta é promessa, não garantia.
    expect(r.oldest_at).toBe(minutosAtras(180));
    expect(r.message).toContain("3");
    expect(r.message).toContain(minutosAtras(180));
  });

  it("uma falha só já conta — alerta perdido não tem 'pouco'", () => {
    const r = assessWatchdogDelivery([{ created_at: minutosAtras(5) }], AGORA);
    expect(r.failing).toBe(true);
    expect(r.count).toBe(1);
    expect(r.message).toMatch(/1 alerta do watchdog não saiu/);
  });

  it("SILÊNCIO quando não há falha — nenhum 'tudo ok'", () => {
    const r = assessWatchdogDelivery([], AGORA);
    expect(r.failing).toBe(false);
    expect(r.count).toBe(0);
    expect(r.oldest_at).toBeNull();
    expect(r.message).toBeNull();
  });

  it("falha fora da janela não alerta para sempre — consertado, o silêncio volta", () => {
    const r = assessWatchdogDelivery(
      [{ created_at: minutosAtras(WATCHDOG_DELIVERY_LOOKBACK_MINUTES + 1) }],
      AGORA,
    );
    expect(r.failing).toBe(false);
    expect(r.message).toBeNull();
  });

  it("descarta timestamp ilegível em vez de anunciar 'desde 1970'", () => {
    const r = assessWatchdogDelivery(
      [{ created_at: "não é data" }, { created_at: minutosAtras(20) }],
      AGORA,
    );
    expect(r.count).toBe(1);
    expect(r.oldest_at).toBe(minutosAtras(20));
  });
});

describe("cron-health-check — a falha de envio chega ao relatório", () => {
  it("reprova o health check mesmo com a sonda de CRON verde", async () => {
    const report = await runHealthCheck({
      ...sondaSaudavel,
      fetchWatchdogDeliveryFailures: vi.fn().mockResolvedValue([
        { created_at: minutosAtras(30) },
        { created_at: minutosAtras(12) },
      ]),
      now: AGORA,
    });

    // A sonda do segredo passou; quem derruba é o alerta perdido. Sem esta
    // asserção, o defeito voltaria a ficar invisível justamente quando o resto
    // do sistema está saudável — que é o caso comum.
    expect(report.edge_probe_status).toBe(200);
    expect(report.healthy).toBe(false);
    expect(report.watchdog_delivery?.count).toBe(2);
    expect(report.watchdog_delivery?.oldest_at).toBe(minutosAtras(30));
    expect(report.message).toContain("Healthy (HTTP 200)");
    expect(report.message).toContain("2 alertas do watchdog não saíram");
  });

  it("segue saudável e silencioso quando não há falha de envio", async () => {
    const report = await runHealthCheck({
      ...sondaSaudavel,
      fetchWatchdogDeliveryFailures: vi.fn().mockResolvedValue([]),
      now: AGORA,
    });

    expect(report.healthy).toBe(true);
    expect(report.watchdog_delivery?.failing).toBe(false);
    expect(report.message).toBe("Healthy (HTTP 200)");
  });

  it("consulta quebrada NÃO vira silêncio — 'não sei' ≠ 'não há'", async () => {
    const report = await runHealthCheck({
      ...sondaSaudavel,
      fetchWatchdogDeliveryFailures: vi.fn().mockRejectedValue(new Error("permission denied")),
      now: AGORA,
    });

    expect(report.healthy).toBe(false);
    expect(report.watchdog_delivery?.failing).toBe(true);
    expect(report.message).toMatch(/não deu para ler as falhas de envio/);

    // O discriminador. Sem ele, esta linha de runtime_logs seria idêntica à do
    // caso saudável (count 0) e ninguém separaria saúde de cegueira depois.
    expect(report.watchdog_delivery?.readable).toBe(false);
    expect(report.watchdog_delivery?.count).toBeNull();
  });

  it("caso saudável se declara LEGÍVEL com zero — o par do teste acima", async () => {
    const report = await runHealthCheck({
      ...sondaSaudavel,
      fetchWatchdogDeliveryFailures: vi.fn().mockResolvedValue([]),
      now: AGORA,
    });

    expect(report.watchdog_delivery?.readable).toBe(true);
    expect(report.watchdog_delivery?.count).toBe(0);
  });

  it("sem o leitor injetado, o relatório é o de antes (nada muda para quem já chama)", async () => {
    const report = await runHealthCheck(sondaSaudavel);

    expect(report.healthy).toBe(true);
    expect(report.watchdog_delivery).toBeUndefined();
    expect(report.message).toBe("Healthy (HTTP 200)");
  });

  it("alerta perdido aparece mesmo quando não há segredo de CRON nenhum", async () => {
    const report = await runHealthCheck({
      fetchTableSecret: vi.fn().mockResolvedValue(null),
      envSecret: "",
      probe: vi.fn(),
      fetchWatchdogDeliveryFailures: vi.fn().mockResolvedValue([{ created_at: minutosAtras(3) }]),
      now: AGORA,
    });

    // Uma sonda não pode calar a outra: sem esta, a falta do segredo esconderia
    // o alerta perdido atrás do return antecipado.
    expect(report.message).toContain("No CRON secret");
    expect(report.watchdog_delivery?.count).toBe(1);
  });
});
