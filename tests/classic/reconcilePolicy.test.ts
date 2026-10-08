/**
 * Contrato da política de reconciliação do chat (incidente OOM 2026-10-05).
 *
 * O que este arquivo trava:
 *   - pisos literais no caminho saudável: thread ≥ 120 s, lista ≥ 300 s, em
 *     QUALQUER semente — o jitter só soma, nunca subtrai;
 *   - teto do jitter: +25%;
 *   - em fallback o intervalo só cresce com o tempo (nunca acelera sob carga);
 *   - nada, em estado nenhum, abaixo de 10 s;
 *   - mesma entrada + mesma semente → mesmo número (TanStack reinicia o timer
 *     quando o valor muda; um número diferente a cada render faria o poll
 *     nunca disparar).
 */
import { describe, it, expect } from "vitest";
import {
  intervaloDeReconciliacao,
  misturarSemente,
  JITTER_MAX_FRACAO,
  PISO_ABSOLUTO_MS,
  PISO_SAUDAVEL_MS,
  PISO_FALLBACK_MS,
  TETO_FALLBACK_MS,
  type PerfilDeReconciliacao,
} from "@/modules/communication/hooks/chat/reconcilePolicy";

const PERFIS: PerfilDeReconciliacao[] = ["thread", "lista"];
const AGORA = 1_780_000_000_000;

/** Sementes variadas, incluindo os extremos do uint32. */
const SEMENTES = [
  0,
  1,
  2 ** 32 - 1,
  2 ** 31,
  ...Array.from({ length: 500 }, (_, i) => misturarSemente(i * 7919, AGORA + i * 1_000)),
];

describe("intervaloDeReconciliacao — saudável", () => {
  it("pisos literais: thread ≥ 120 000 e lista ≥ 300 000 em toda semente", () => {
    expect(PISO_SAUDAVEL_MS.thread).toBe(120_000);
    expect(PISO_SAUDAVEL_MS.lista).toBe(300_000);
    for (const perfil of PERFIS) {
      for (const semente of SEMENTES) {
        const v = intervaloDeReconciliacao({
          perfil,
          saudavel: true,
          emFallbackDesdeMs: null,
          agoraMs: AGORA,
          semente,
        });
        expect(v).toBeGreaterThanOrEqual(PISO_SAUDAVEL_MS[perfil]);
        expect(v).toBeLessThanOrEqual(PISO_SAUDAVEL_MS[perfil] * (1 + JITTER_MAX_FRACAO));
      }
    }
  });

  it("o jitter de fato espalha (não é constante entre sementes)", () => {
    const valores = new Set(
      SEMENTES.map((semente) =>
        intervaloDeReconciliacao({
          perfil: "thread",
          saudavel: true,
          emFallbackDesdeMs: null,
          agoraMs: AGORA,
          semente,
        }),
      ),
    );
    expect(valores.size).toBeGreaterThan(100);
  });

  it("saudável ignora emFallbackDesdeMs residual", () => {
    const a = intervaloDeReconciliacao({
      perfil: "lista",
      saudavel: true,
      emFallbackDesdeMs: AGORA - 5_000,
      agoraMs: AGORA,
      semente: 42,
    });
    expect(a).toBeGreaterThanOrEqual(300_000);
  });

  it("não saudável ainda dentro da carência (sem fallback) usa o intervalo saudável", () => {
    const v = intervaloDeReconciliacao({
      perfil: "thread",
      saudavel: false,
      emFallbackDesdeMs: null,
      agoraMs: AGORA,
      semente: 42,
    });
    expect(v).toBeGreaterThanOrEqual(120_000);
  });
});

describe("intervaloDeReconciliacao — fallback", () => {
  const amostrasDeTempo = Array.from({ length: 121 }, (_, i) => i * 5_000); // 0..10 min

  it("degraus: thread 30 s → 60 s → 120 s; lista 60 s → 120 s → 300 s", () => {
    expect(PISO_FALLBACK_MS).toEqual({ thread: 30_000, lista: 60_000 });
    expect(TETO_FALLBACK_MS).toEqual({ thread: 120_000, lista: 300_000 });
    const base = (perfil: PerfilDeReconciliacao, decorrido: number) =>
      intervaloDeReconciliacao({
        perfil,
        saudavel: false,
        emFallbackDesdeMs: AGORA - decorrido,
        agoraMs: AGORA,
        semente: 0, // semente 0 ainda pode gerar jitter; testamos faixa
      });
    const naFaixa = (v: number, alvo: number) => {
      expect(v).toBeGreaterThanOrEqual(alvo);
      expect(v).toBeLessThanOrEqual(alvo * (1 + JITTER_MAX_FRACAO));
    };
    naFaixa(base("thread", 0), 30_000);
    naFaixa(base("thread", 59_999), 30_000);
    naFaixa(base("thread", 60_000), 60_000);
    naFaixa(base("thread", 179_999), 60_000);
    naFaixa(base("thread", 180_000), 120_000);
    naFaixa(base("thread", 3_600_000), 120_000);
    naFaixa(base("lista", 0), 60_000);
    naFaixa(base("lista", 60_000), 120_000);
    naFaixa(base("lista", 180_000), 300_000);
    naFaixa(base("lista", 3_600_000), 300_000);
  });

  it("monotônico não-decrescente no tempo, com teto e piso, em toda semente", () => {
    for (const perfil of PERFIS) {
      for (const semente of SEMENTES.slice(0, 80)) {
        let anterior = 0;
        for (const decorrido of amostrasDeTempo) {
          const v = intervaloDeReconciliacao({
            perfil,
            saudavel: false,
            emFallbackDesdeMs: AGORA - decorrido,
            agoraMs: AGORA,
            semente,
          });
          expect(v).toBeGreaterThanOrEqual(anterior);
          expect(v).toBeGreaterThanOrEqual(PISO_FALLBACK_MS[perfil]);
          expect(v).toBeLessThanOrEqual(TETO_FALLBACK_MS[perfil] * (1 + JITTER_MAX_FRACAO));
          anterior = v;
        }
      }
    }
  });

  it("relógio que voltou (desde > agora) não gera intervalo abaixo do piso", () => {
    const v = intervaloDeReconciliacao({
      perfil: "thread",
      saudavel: false,
      emFallbackDesdeMs: AGORA + 60_000,
      agoraMs: AGORA,
      semente: 7,
    });
    expect(v).toBeGreaterThanOrEqual(PISO_FALLBACK_MS.thread);
  });
});

describe("intervaloDeReconciliacao — invariantes globais", () => {
  it("nunca abaixo de 10 s, em estado nenhum", () => {
    expect(PISO_ABSOLUTO_MS).toBe(10_000);
    for (const perfil of PERFIS) {
      for (const saudavel of [true, false]) {
        for (const desde of [null, AGORA, AGORA - 1, AGORA - 10 ** 9, AGORA + 10 ** 9]) {
          for (const semente of SEMENTES.slice(0, 40)) {
            const v = intervaloDeReconciliacao({
              perfil,
              saudavel,
              emFallbackDesdeMs: desde,
              agoraMs: AGORA,
              semente,
            });
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(PISO_ABSOLUTO_MS);
          }
        }
      }
    }
  });

  it("estável por semente: mesma entrada → mesmo valor", () => {
    for (const semente of SEMENTES.slice(0, 50)) {
      const entrada = {
        perfil: "lista" as const,
        saudavel: false,
        emFallbackDesdeMs: AGORA - 90_000,
        agoraMs: AGORA,
        semente,
      };
      expect(intervaloDeReconciliacao(entrada)).toBe(intervaloDeReconciliacao(entrada));
    }
  });

  it("estável dentro do mesmo degrau: o tempo andando não muda o valor", () => {
    // TanStack recalcula o intervalo a cada render; valor diferente reinicia o
    // timer. Dentro de um degrau o número precisa ser idêntico.
    const em = (decorrido: number) =>
      intervaloDeReconciliacao({
        perfil: "thread",
        saudavel: false,
        emFallbackDesdeMs: AGORA,
        agoraMs: AGORA + decorrido,
        semente: 123,
      });
    expect(em(1_000)).toBe(em(59_000));
    expect(em(61_000)).toBe(em(170_000));
  });

  it("devolve inteiro em ms", () => {
    const v = intervaloDeReconciliacao({
      perfil: "thread",
      saudavel: true,
      emFallbackDesdeMs: null,
      agoraMs: AGORA,
      semente: 999,
    });
    expect(Number.isInteger(v)).toBe(true);
  });
});

describe("misturarSemente", () => {
  it("é determinística e devolve uint32", () => {
    const a = misturarSemente(12345, AGORA);
    expect(a).toBe(misturarSemente(12345, AGORA));
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 ** 32);
  });

  it("muda quando dataUpdatedAt muda (cada fetch sorteia de novo)", () => {
    expect(misturarSemente(12345, AGORA)).not.toBe(misturarSemente(12345, AGORA + 1));
  });

  it("abas diferentes (semente fixa diferente) não sincronizam", () => {
    expect(misturarSemente(1, AGORA)).not.toBe(misturarSemente(2, AGORA));
  });
});
