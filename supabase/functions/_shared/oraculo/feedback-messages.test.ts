import { assertStringIncludes } from "jsr:@std/assert@^1.0.0";
import { buildHallucinationAlert, buildWeeklyFeedbackDigest } from "./feedback-messages.ts";

Deno.test("feedback mensagem — invenção traz organização, comentário e caso reabrível", () => {
  const text = buildHallucinationAlert({
    feedbackId: "feedback-1",
    organizationName: "Fábrica Horizonte",
    comment: "Inventou R$ 80 mil.",
  });
  assertStringIncludes(text, "Possível invenção");
  assertStringIncludes(text, "Fábrica Horizonte");
  assertStringIncludes(text, "Inventou R$ 80 mil.");
  assertStringIncludes(text, "/master/oraculo-feedback?caso=feedback-1");
});

Deno.test("feedback mensagem — resumo semanal existe mesmo com zero atividade", () => {
  const text = buildWeeklyFeedbackDigest({
    periodStart: "2026-08-25",
    periodEnd: "2026-08-31",
    conversations: 0,
    positive: 0,
    negative: 0,
    invented: 0,
  });
  assertStringIncludes(text, "25/08 a 31/08");
  assertStringIncludes(text, "0 conversas");
  assertStringIncludes(text, "0 negativas");
  assertStringIncludes(text, "nenhuma por invenção");
});
