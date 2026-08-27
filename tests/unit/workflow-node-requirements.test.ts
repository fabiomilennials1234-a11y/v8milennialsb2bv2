import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  NODE_REQUIREMENTS,
  findNodeConfigIssues,
  isFilled,
} from "../../src/contracts/workflows/node-requirements";

/** Todo o código do executor, concatenado — onde as regras de verdade moram. */
function fonteDoExecutor(): string {
  const raiz = join(__dirname, "../../supabase/functions/_shared");
  const partes: string[] = [
    readFileSync(join(raiz, "workflow-action-handler.ts"), "utf8"),
    // A decisão do nó de mensagem (texto vs. template, e a janela de 24h) foi
    // extraída para cá: o handler é adaptador dela. Sem este arquivo a âncora
    // deixaria de ver os motivos que o executor realmente devolve.
    readFileSync(join(raiz, "decisao-de-envio.ts"), "utf8"),
  ];
  for (const pasta of ["action-handlers", "actions"]) {
    const dir = join(raiz, pasta);
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".ts") && !f.endsWith(".test.ts")) {
        partes.push(readFileSync(join(dir, f), "utf8"));
      }
    }
  }
  // Junta os literais que o executor quebra em várias linhas
  // (`"parte um " +\n  "parte dois"`). Sem isto a âncora dá VERMELHO FALSO para
  // toda mensagem longa: a string existe, mas não como uma sequência contígua
  // de bytes no arquivo. Une só o par aspas-mais-aspas — qualquer outra
  // concatenação (com variável, com template literal) continua invisível aqui,
  // e é isso que mantém a âncora exigindo a frase escrita por extenso.
  return partes.join("\n").replace(/"\s*\+\s*\n\s*"/g, "");
}

describe("regra não pode divergir do executor", () => {
  const fonte = fonteDoExecutor();

  it("toda mensagem de erro declarada existe no executor", () => {
    const orfas: string[] = [];
    for (const [actionType, regras] of Object.entries(NODE_REQUIREMENTS)) {
      for (const r of regras) {
        if (!fonte.includes(r.executorError)) {
          orfas.push(`${actionType}: "${r.executorError}"`);
        }
      }
    }
    // Se isto falhar: alguém mudou a guarda no executor e a regra daqui virou ficção.
    expect(orfas).toEqual([]);
  });

  it("toda chave declarada é lida pelo executor", () => {
    const orfas: string[] = [];
    for (const [actionType, regras] of Object.entries(NODE_REQUIREMENTS)) {
      for (const r of regras) {
        for (const chave of r.anyOf) {
          if (!fonte.includes(chave)) orfas.push(`${actionType}.${chave}`);
        }
      }
    }
    // Chave com nome errado = validador que nunca dispara. Verde por ausência.
    expect(orfas).toEqual([]);
  });

  it("controle positivo: erro inventado é detectado como órfão", () => {
    expect(fonte.includes("No unicorn configured")).toBe(false);
  });
});

const no = (actionType: string, extra: Record<string, unknown> = {}, id = "n1") => ({
  id,
  type: "action",
  data: { actionType, label: "Ação", ...extra },
});

describe("detecção de nó incompleto", () => {
  it("add_tag sem tag é apontado", () => {
    const r = findNodeConfigIssues([no("add_tag")]);
    expect(r).toHaveLength(1);
    expect(r[0].missing).toBe("tag");
    expect(r[0].nodeId).toBe("n1");
  });

  it("add_tag com tagId OU tagName passa", () => {
    expect(findNodeConfigIssues([no("add_tag", { tagId: "abc" })])).toHaveLength(0);
    expect(findNodeConfigIssues([no("add_tag", { tagName: "Ouro" })])).toHaveLength(0);
  });

  it("string em branco não conta como preenchido", () => {
    expect(findNodeConfigIssues([no("add_tag", { tagName: "   " })])).toHaveLength(1);
    expect(isFilled("")).toBe(false);
    expect(isFilled([])).toBe(false);
    expect(isFilled(0)).toBe(true);
  });

  it("move_stage sem etapa é apontado — o caso da Nutrição [D7]", () => {
    expect(findNodeConfigIssues([no("move_stage")])[0].missing).toBe("etapa de destino");
  });

  it("notify_team_member usa notifyMemberId, não memberId", () => {
    // Controle: a chave errada NÃO satisfaz a regra.
    expect(findNodeConfigIssues([no("notify_team_member", { memberId: "x" })])).toHaveLength(1);
    expect(findNodeConfigIssues([no("notify_team_member", { notifyMemberId: "x" })])).toHaveLength(0);
  });

  it("rodízio não exige responsável — falso positivo bloquearia workflow válido", () => {
    expect(findNodeConfigIssues([no("assign_responsible", { assignMode: "round_robin" })])).toHaveLength(0);
    // Controle positivo: no modo específico, exige.
    expect(findNodeConfigIssues([no("assign_responsible", { assignMode: "specific" })])).toHaveLength(1);
    expect(findNodeConfigIssues([no("assign_responsible")])).toHaveLength(1); // default é specific
  });

  it("nó consolidado exige só a mídia do tipo escolhido", () => {
    expect(findNodeConfigIssues([no("send_whatsapp_message", { messageType: "imagem" })])[0].missing).toBe("imagem");
    // texto não exige URL nenhuma
    expect(findNodeConfigIssues([no("send_whatsapp_message", { messageType: "texto" })])).toHaveLength(0);
    // áudio preenchido não é cobrado por imagem
    expect(findNodeConfigIssues([no("send_whatsapp_message", { messageType: "audio", audioUrl: "u" })])).toHaveLength(0);
  });

  it("send_campaign_message cobra campanha E template", () => {
    expect(findNodeConfigIssues([no("send_campaign_message")])).toHaveLength(2);
    expect(findNodeConfigIssues([no("send_campaign_message", { campaignId: "c" })])).toHaveLength(1);
  });

  it("actionType sem regra passa — gate não trava feature nova", () => {
    expect(findNodeConfigIssues([no("acao_que_ainda_nao_existe")])).toHaveLength(0);
  });

  it("nó sem actionType (trigger, delay, condition) é ignorado", () => {
    expect(findNodeConfigIssues([{ id: "t", type: "trigger", data: { label: "Trigger" } }])).toHaveLength(0);
  });

  it("aponta todos os nós ruins, não só o primeiro", () => {
    const r = findNodeConfigIssues([no("add_tag", {}, "a"), no("move_stage", {}, "b")]);
    expect(r.map((i) => i.nodeId).sort()).toEqual(["a", "b"]);
  });
});

import { findStageIssues, PIPES_COM_ETAPA_VALIDADA } from "../../src/contracts/workflows/node-requirements";

describe("etapa que apodreceu", () => {
  const etapas = { whatsapp: ["novo", "abordado", "respondeu"], propostas: ["enviada"] };
  const moveStage = (extra: Record<string, unknown>) => ({
    id: "m1", type: "action", data: { actionType: "move_stage", label: "Mover", ...extra },
  });

  it("aponta etapa que não existe mais", () => {
    const r = findStageIssues([moveStage({ targetStage: "nutricao" })], etapas);
    expect(r).toHaveLength(1);
    expect(r[0].missing).toContain("nutricao");
  });

  it("etapa válida passa, e a comparação ignora caixa e espaço", () => {
    expect(findStageIssues([moveStage({ targetStage: "abordado" })], etapas)).toHaveLength(0);
    expect(findStageIssues([moveStage({ targetStage: "  ABORDADO " })], etapas)).toHaveLength(0);
  });

  it("funil sem etapas cadastradas não acusa — espelha o executor", () => {
    expect(findStageIssues([moveStage({ targetStage: "qualquer" })], {})).toHaveLength(0);
    expect(findStageIssues([moveStage({ targetStage: "qualquer" })], { whatsapp: [] })).toHaveLength(0);
  });

  it("funil que o executor não valida também não é cobrado aqui", () => {
    const r = findStageIssues([moveStage({ targetStage: "seja_o_que_for", pipeType: "campanha" })], etapas);
    expect(r).toHaveLength(0);
    expect(PIPES_COM_ETAPA_VALIDADA).not.toContain("campanha");
  });

  it("campo vazio é da outra regra, não desta", () => {
    expect(findStageIssues([moveStage({ targetStage: "" })], etapas)).toHaveLength(0);
    expect(findNodeConfigIssues([moveStage({ targetStage: "" })])).toHaveLength(1);
  });

  it("respeita o funil declarado no nó", () => {
    // 'enviada' vale em propostas, não em whatsapp
    expect(findStageIssues([moveStage({ targetStage: "enviada", pipeType: "propostas" })], etapas)).toHaveLength(0);
    expect(findStageIssues([moveStage({ targetStage: "enviada" })], etapas)).toHaveLength(1);
  });
});
