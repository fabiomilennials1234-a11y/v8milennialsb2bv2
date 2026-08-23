// @vitest-environment node
/**
 * O ESCAPE PRECISA RECONHECER O QUE O GOVERNOR REALMENTE EMITE — issue #1689.
 *
 * ─── A DIVERGÊNCIA QUE ESTE ARQUIVO IMPEDE ──────────────────────────────────
 *
 * A decisão de janela é do send-governor e o contrato dele não muda: ele avalia
 * e devolve bloqueio com um motivo. Quem lê esse motivo e escolhe o fallback é
 * o nó, em `decisao-de-envio.ts`. São dois módulos e uma string entre eles — e
 * uma string entre dois módulos é exatamente o tipo de acordo que se quebra sem
 * nada ficar vermelho.
 *
 * ⚠️ E A QUEBRA SERIA INVISÍVEL. Se o motivo for renomeado no governor, o
 * classificador para de reconhecê-lo, o nó deixa de escapar e passa a falhar
 * com o erro cru do transporte. Ninguém vê: o nó já podia falhar antes, o
 * workflow já parava antes, e a única diferença é o template que deixou de sair.
 *
 * ─── COMO ELE PRENDE ────────────────────────────────────────────────────────
 *
 * Roda o `evaluateSend` REAL — não uma cópia da regra — com uma janela fechada
 * num canal oficial, serializa o veredito no MESMO formato que
 * `whatsapp-dispatch` usa para devolvê-lo (`governor_<ação>:<motivo>`), e exige
 * que o classificador do nó o leia como janela fechada. Renomear o motivo,
 * mudar a ação de `block` para outra coisa, ou trocar o formato da string
 * derruba este arquivo.
 *
 * Prior art do padrão no repositório: `template-send-twin`,
 * `instance-routing-twin`, `notificame-template-buttons-twin`,
 * `blast-planning-twin`, `stage-role-classifier-twin`.
 */
import { describe, expect, it } from "vitest";

import { evaluateSend } from "../../supabase/functions/_shared/send-governor/core.ts";
import type {
  GovernorContext,
  GovernorState,
} from "../../supabase/functions/_shared/send-governor/types.ts";
import {
  decidirEnvioDoNoDeTexto,
  janelaPeloErroDoTransporte,
} from "../../supabase/functions/_shared/decisao-de-envio.ts";

const AGORA = "2026-08-20T12:00:00.000Z";
/** Última entrada do contato há 30 horas — fora da janela de 24h. */
const HA_30_HORAS = "2026-08-19T06:00:00.000Z";

const ctx: GovernorContext = {
  orgId: "org-1",
  instanceId: "inst-oficial",
  category: "automation",
  recipientPhone: "5511999999999",
};

function estado(over: Partial<GovernorState> = {}): GovernorState {
  return {
    mode: "enforce",
    warmupEnabled: false,
    coldGateEnabled: false,
    usedToday: 0,
    instanceCap: 80,
    instanceAgeDays: 30,
    reputation: "healthy",
    quarantineUntil: null,
    isColdContact: false,
    nowIso: AGORA,
    // O canal oficial é o único provider com janela governada aqui.
    instanceProvider: "notificame",
    lastInboundIso: HA_30_HORAS,
    windowResolved: true,
    windowSource: "channel_messages",
    ...over,
  };
}

/**
 * Como `whatsapp-dispatch` devolve um bloqueio do governor aos chamadores.
 * Cópia literal do formato usado nos sete remetentes daquele arquivo — é ESTA
 * string que o nó de texto recebe e é sobre ela que o classificador decide.
 */
const comoOTransporteDevolve = (acao: string, motivo: string) =>
  `governor_${acao}:${motivo}`;

describe("o motivo que o governor emite é o que o nó procura", () => {
  it("janela fechada no canal oficial vira escape para template", () => {
    const veredito = evaluateSend(ctx, estado());

    // O contrato do governor, inalterado: bloqueio com motivo de janela.
    expect(veredito.action).toBe("block");
    expect(veredito.reason).toBe("outside_24h_window");

    const erro = comoOTransporteDevolve(veredito.action, veredito.reason);
    expect(janelaPeloErroDoTransporte(erro)).toBe("fechada");

    const decisao = decidirEnvioDoNoDeTexto({
      janela: janelaPeloErroDoTransporte(erro),
      escape: { name: "retomada", language: "pt_BR" },
    });
    expect(decisao.acao).toBe("template");
  });

  it("janela ABERTA no canal oficial não produz bloqueio nenhum para o nó ler", () => {
    const veredito = evaluateSend(
      ctx,
      estado({ lastInboundIso: "2026-08-20T09:00:00.000Z" }),
    );
    expect(veredito.action).toBe("allow");
  });

  it("chip: o governor não emite motivo de janela, então o nó nunca escapa", () => {
    // Mesmo cenário temporal, provider sem janela. É AQUI que o "chip idêntico
    // ao de hoje" se sustenta: não há decisão nova no nó, há ausência de motivo.
    const veredito = evaluateSend(ctx, estado({ instanceProvider: "uazapi" }));
    expect(veredito.reason).not.toBe("outside_24h_window");
    expect(veredito.action).toBe("allow");
  });

  it("outro bloqueio do governor NÃO é lido como janela", () => {
    const veredito = evaluateSend(
      ctx,
      estado({ reputation: "quarantined", quarantineUntil: null }),
    );
    expect(veredito.reason).toBe("quarantined");

    const erro = comoOTransporteDevolve(veredito.action, veredito.reason);
    expect(janelaPeloErroDoTransporte(erro)).toBe("aberta_ou_sem_janela");
  });

  it("em observação o governor deixa passar, e o nó nunca chega a decidir", () => {
    // O modo é por organização e entra em `shadow` primeiro. Nesse modo não há
    // bloqueio para o nó ler — o texto sai como hoje e a Meta é quem recusa.
    const veredito = evaluateSend(ctx, estado({ mode: "shadow" }));
    expect(veredito.action).toBe("allow");
    expect(veredito.wouldBe).toBe("block");
    expect(veredito.shadowed).toBe(true);
  });
});
