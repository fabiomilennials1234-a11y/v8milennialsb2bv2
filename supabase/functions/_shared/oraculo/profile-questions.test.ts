import { assertEquals, assertMatch } from "jsr:@std/assert@^1.0.0";
import { buildProfileQuestions } from "./profile-questions.ts";

Deno.test("perfil — transforma medições consultadas em no máximo três perguntas contextuais", () => {
  const questions = buildProfileQuestions({
    evidence: [
      {
        name: "metricas",
        result: {
          escopo: "pessoa",
          periodo_dias: 30,
          leads_criados: 80,
          vendas: 12,
          receita: 40800,
          ticket_medio: 3400,
          conversao_lead_venda: 0.15,
          reunioes_marcadas: 22,
        },
      },
      {
        name: "funil",
        result: {
          periodo_dias: 30,
          total_aberto: 31,
          etapas: [
            { pipeline: "Comercial", etapa: "Qualificação", negocios: 8 },
            { pipeline: "Comercial", etapa: "Proposta", negocios: 17 },
          ],
        },
      },
    ],
    askedKeys: [],
    room: 3,
    id: (() => {
      let n = 0;
      return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    })(),
  });

  assertEquals(questions.length, 3);
  assertEquals(questions.map((q) => q.question_key), [
    "sales_outside_crm",
    "meeting_definition",
    "seasonality",
  ]);
  assertMatch(questions[0].prompt, /12 vendas.*R\$ 40\.800.*R\$ 3\.400/i);
  assertMatch(questions[1].prompt, /22 reuniões/i);
  assertMatch(questions[2].prompt, /80 leads.*12 vendas.*15%/i);
  assertEquals(questions[0].measured_context.source, "metricas");
});

Deno.test("perfil — não repete tema já perguntado e usa gargalo medido do funil", () => {
  const questions = buildProfileQuestions({
    evidence: [{
      name: "funil",
      result: {
        periodo_dias: 14,
        total_aberto: 20,
        etapas: [
          { pipeline: "Comercial", etapa: "Entrada", negocios: 4 },
          { pipeline: "Comercial", etapa: "Negociação", negocios: 12 },
        ],
      },
    }],
    askedKeys: ["sales_outside_crm"],
    room: 5,
    id: () => "00000000-0000-4000-8000-000000000001",
  });

  assertEquals(questions.length, 1);
  assertEquals(questions[0].question_key, "perceived_bottleneck");
  assertMatch(questions[0].prompt, /12 de 20 negócios.*Negociação/i);
});

Deno.test("perfil — sem medição válida não inventa entrevista nem bloqueia o turno", () => {
  assertEquals(
    buildProfileQuestions({
      evidence: [
        { name: "metricas", result: { error: "consulta_falhou" } },
        { name: "desconhecida", result: { vendas: 99 } },
      ],
      askedKeys: [],
      room: 3,
    }),
    [],
  );
  assertEquals(buildProfileQuestions({ evidence: [], askedKeys: [], room: 0 }), []);
});
