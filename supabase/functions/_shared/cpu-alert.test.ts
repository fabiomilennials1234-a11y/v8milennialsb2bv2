import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCpuAlertText,
  CPU_MAX_GAP_MS,
  type CpuState,
  parseCpuCounters,
  parseCpuState,
  parseMemoryPct,
  stepCpu,
} from "./cpu-alert.ts";

const prom = (cpu0: Record<string, number>, cpu1: Record<string, number>, extra = "") =>
  [
    "# HELP node_cpu_seconds_total Seconds the CPUs spent in each mode.",
    "# TYPE node_cpu_seconds_total counter",
    ...Object.entries(cpu0).map(([m, v]) => `node_cpu_seconds_total{cpu="0",mode="${m}",service_type="db"} ${v}`),
    ...Object.entries(cpu1).map(([m, v]) => `node_cpu_seconds_total{cpu="1",mode="${m}",service_type="db"} ${v}`),
    extra,
  ].join("\n");

Deno.test("soma os núcleos; ocioso é idle + iowait; steal conta como ocupado", () => {
  const c = parseCpuCounters(prom(
    { idle: 100, iowait: 10, user: 50, steal: 40 },
    { idle: 200, iowait: 0, system: 30, steal: 20 },
  ));
  assertEquals(c, { total: 450, idle: 310 });
});

Deno.test("com mais de um serviço, conta só o banco", () => {
  const texto = prom({ idle: 10, user: 10 }, { idle: 10, user: 10 },
    'node_cpu_seconds_total{cpu="0",mode="user",service_type="pooler"} 9999');
  assertEquals(parseCpuCounters(texto), { total: 40, idle: 20 });
});

Deno.test("sem a métrica, devolve null em vez de inventar zero", () => {
  assertEquals(parseCpuCounters("up 1\nnode_load1 0.5"), null);
});

Deno.test("RAM em uso sai de MemTotal e MemAvailable", () => {
  const texto = 'node_memory_MemTotal_bytes{service_type="db"} 2000\nnode_memory_MemAvailable_bytes{service_type="db"} 180';
  assertEquals(parseMemoryPct(texto), 91);
  assertEquals(parseMemoryPct("nada"), null);
});

Deno.test("primeira leitura só vira ponto de partida", () => {
  const s = stepCpu(null, { total: 100, idle: 50 }, 1_000, 85, 5);
  assertEquals(s.pct, null);
  assertEquals(s.alert, false);
  assertEquals(s.state.streak, 0);
});

// 2 núcleos, 120 s entre leituras = 240 s de CPU no intervalo.
const INTERVALO = 120_000;
function leitura(prev: CpuState, ocupadoPct: number): CpuStep {
  const dTotal = 240;
  return stepCpu(prev, {
    total: prev.total + dTotal,
    idle: prev.idle + dTotal * (1 - ocupadoPct / 100),
  }, prev.t + INTERVALO, 85, 5);
}
type CpuStep = ReturnType<typeof stepCpu>;

Deno.test("o incidente de 01/10: 98% seguido avisa na 5ª leitura (10 min), não antes", () => {
  let s = stepCpu(null, { total: 0, idle: 0 }, 0, 85, 5);
  const alertas: boolean[] = [];
  for (let i = 0; i < 6; i++) {
    s = leitura(s.state, 98);
    alertas.push(s.alert);
  }
  assertEquals(s.pct, 98);
  assertEquals(alertas, [false, false, false, false, true, true]);
});

Deno.test("pico curto zera a sequência e não avisa", () => {
  let s = stepCpu(null, { total: 0, idle: 0 }, 0, 85, 5);
  for (const pct of [95, 95, 95, 95, 40, 95, 95]) s = leitura(s.state, pct);
  assertEquals(s.state.streak, 2);
  assertEquals(s.alert, false);
});

Deno.test("contador que andou para trás (reboot) recomeça sem avisar", () => {
  const prev: CpuState = { t: 0, total: 10_000, idle: 100, streak: 4, pct: 99 };
  const s = stepCpu(prev, { total: 50, idle: 10 }, INTERVALO, 85, 5);
  assertEquals(s.state.streak, 0);
  assertEquals(s.alert, false);
});

Deno.test("leitura velha demais não forma média", () => {
  const prev: CpuState = { t: 0, total: 0, idle: 0, streak: 4, pct: 99 };
  const s = stepCpu(prev, { total: 240, idle: 0 }, CPU_MAX_GAP_MS + 1, 85, 5);
  assertEquals(s.pct, null);
  assertEquals(s.state.streak, 0);
});

Deno.test("estado do cron_config: lido de volta, e lixo vira null", () => {
  const st: CpuState = { t: 1, total: 2, idle: 1, streak: 3, pct: 90 };
  assertEquals(parseCpuState(JSON.stringify(st)), st);
  assertEquals(parseCpuState("2026-10-01T13:40:01.785Z"), null);
  assertEquals(parseCpuState('{"t":1}'), null);
  assertEquals(parseCpuState(null), null);
});

Deno.test("o aviso diz quanto, há quanto tempo e o que rodar", () => {
  const texto = buildCpuAlertText({ pct: 98, minutes: 10, thresholdPct: 85, memPct: 91 });
  assertStringIncludes(texto, "98%");
  assertStringIncludes(texto, "10 min");
  assertStringIncludes(texto, "RAM 91%");
  assertStringIncludes(texto, "pg_terminate_backend");
});
