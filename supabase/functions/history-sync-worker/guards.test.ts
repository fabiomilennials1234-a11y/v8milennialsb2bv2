import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  GUARD_DEFAULTS,
  insideFullWindow,
  parseGuardConfig,
  reachedChatCap,
  reachedGlobalCap,
} from "./guards.ts";

// ---------------------------------------------------------------------------
// Teto por conversa — a regressão do incidente de 2026-08-06
// ---------------------------------------------------------------------------

Deno.test("REGRESSÃO: escopo 'default' tem teto por conversa", () => {
  // No caminho multi-conversa (`processMultiChat`) — o que roda em `default`,
  // `full` e `incremental`, e o que estava em curso no incidente — NÃO existia
  // teto por conversa nenhum: cada chat era percorrido até o provedor dizer que
  // acabou. Foi assim que uma única conversa chegou a offset 2300 com o teto
  // declarado em 500. Esta asserção é a que trava o retorno daquele estado.
  assertEquals(reachedChatCap("default", 500, 500), true);
  assertEquals(reachedChatCap("default", 501, 500), true);
  assertEquals(reachedChatCap("incremental", 500, 500), true);
  // Antes do limite, segue aberta.
  assertEquals(reachedChatCap("default", 499, 500), false);
});

Deno.test("'full' é a única exceção ao teto por conversa, e é deliberada", () => {
  // `full` significa "quero o histórico inteiro desta conversa" — limitar por
  // conversa contradiria o pedido. O que segura um job `full` é o teto global.
  // Se esta asserção começar a falhar, alguém mudou a semântica de `full` e
  // precisa mexer também no teto global.
  assertEquals(reachedChatCap("full", 2300, 500), false);
  assertEquals(reachedGlobalCap(50_000, 500, 100), true);
});

Deno.test("teto por conversa: valor inválido não encerra a conversa", () => {
  // Teto zerado ou ausente não pode significar "conversa já terminou" — isso
  // truncaria toda importação em silêncio.
  assertEquals(reachedChatCap("default", 100, 0), false);
  assertEquals(reachedChatCap("default", 100, NaN), false);
});

Deno.test("teto global vale inclusive para 'full'", () => {
  assertEquals(reachedGlobalCap(49_999, 500, 100), false);
  assertEquals(reachedGlobalCap(50_000, 500, 100), true);
  assertEquals(reachedGlobalCap(1, 0, 0), false); // cap inválido não trava o job
});

// ---------------------------------------------------------------------------
// Janela noturna
// ---------------------------------------------------------------------------

const at = (hourUtc: number) => new Date(Date.UTC(2026, 7, 6, hourUtc, 30, 0));

Deno.test("janela padrão 03–09 UTC cobre a madrugada de Brasília", () => {
  const cfg = GUARD_DEFAULTS;
  assertEquals(insideFullWindow(cfg, at(3)), true);   // 00h BRT
  assertEquals(insideFullWindow(cfg, at(6)), true);   // 03h BRT
  assertEquals(insideFullWindow(cfg, at(8)), true);   // 05h BRT
  assertEquals(insideFullWindow(cfg, at(9)), false);  // 06h BRT — fim exclusivo
  assertEquals(insideFullWindow(cfg, at(2)), false);
  assertEquals(insideFullWindow(cfg, at(20)), false); // 17h BRT, horário comercial
});

Deno.test("o horário do incidente cai FORA da janela", () => {
  // O colapso foi por volta das 20:45 UTC de 2026-08-06. Com a janela em vigor,
  // aquele job `full` nem teria sido coletado.
  assertEquals(insideFullWindow(GUARD_DEFAULTS, at(20)), false);
});

Deno.test("janela que cruza a meia-noite UTC é interpretada corretamente", () => {
  const cfg = { ...GUARD_DEFAULTS, fullWindowStart: 22, fullWindowEnd: 4 };
  assertEquals(insideFullWindow(cfg, at(22)), true);
  assertEquals(insideFullWindow(cfg, at(23)), true);
  assertEquals(insideFullWindow(cfg, at(0)), true);
  assertEquals(insideFullWindow(cfg, at(3)), true);
  assertEquals(insideFullWindow(cfg, at(4)), false);
  assertEquals(insideFullWindow(cfg, at(12)), false);
});

// ---------------------------------------------------------------------------
// Leitura da configuração
// ---------------------------------------------------------------------------

Deno.test("configuração ausente cai nos defaults conservadores", () => {
  assertEquals(parseGuardConfig(null), GUARD_DEFAULTS);
  assertEquals(parseGuardConfig([]), GUARD_DEFAULTS);
});

Deno.test("configuração é lida de cron_config", () => {
  const cfg = parseGuardConfig([
    { key: "history_sync_max_pressure_pct", value: "45" },
    { key: "history_sync_max_rows_per_min", value: "150" },
  ]);
  assertEquals(cfg.maxPressurePct, 45);
  assertEquals(cfg.maxRowsPerMin, 150);
  // As não informadas seguem no default.
  assertEquals(cfg.fullWindowStart, GUARD_DEFAULTS.fullWindowStart);
});

Deno.test("valor corrompido não desliga o freio", () => {
  // `cron_config` é texto livre e editado à mão durante incidente. Um valor
  // inválido tem que cair no default, nunca virar NaN — comparação com NaN é
  // sempre falsa, e o freio deixaria de existir sem nenhum sinal.
  const cfg = parseGuardConfig([
    { key: "history_sync_max_pressure_pct", value: "sessenta" },
    { key: "history_sync_max_rows_per_min", value: "" },
    { key: "history_sync_full_window_start", value: null },
  ]);
  assertEquals(cfg.maxPressurePct, GUARD_DEFAULTS.maxPressurePct);
  assertEquals(cfg.maxRowsPerMin, GUARD_DEFAULTS.maxRowsPerMin);
  assertEquals(cfg.fullWindowStart, GUARD_DEFAULTS.fullWindowStart);
});

Deno.test("zero explícito é respeitado, não confundido com ausência", () => {
  // Zero é um pedido legítimo: "não deixe nenhuma escrita passar". Só não pode
  // ser confundido com campo vazio.
  const cfg = parseGuardConfig([{ key: "history_sync_max_rows_per_min", value: "0" }]);
  assertEquals(cfg.maxRowsPerMin, 0);
});
