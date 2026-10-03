import { ApiCategory } from "./types";
import { restApiCategory } from "./rest-api-endpoints";

/**
 * O que a tela de documentação da API mostra em Configurações.
 *
 * Só a **API REST pública** (`/api/v1/*`) — a que tem contrato versionado em
 * `public/api/openapi.json`, guarda de paridade em `tests/unit/api-docs-paridade.test.ts`
 * e cobre Lead e Negócio como recursos de primeira classe (épico #1761).
 *
 * As oito entradas `/functions/v1/*` que viviam aqui saíram em 2026-08-24 por decisão
 * do CTO: eram endpoints internos e webhooks de integração exibidos ao cliente como se
 * fossem API pública, sem contrato, sem versão e sem guarda de paridade. Duas já têm
 * substituto nominal na API nova (`get-lead-timeline` → `GET /api/v1/leads/{id}/timeline`,
 * `check-api-health` → `GET /api/v1/ping`).
 *
 * As funções continuam **no ar** — isto muda o que é documentado, não o que responde.
 * Uso medido em prod em 2026-08-24, nas duas tabelas de log que existem:
 *   • `lead-webhook`    — 2.446 ingestões em 30 dias, a última no dia da medição
 *                         (`runtime_logs`, module `lead`, action `webhook_ingest`)
 *   • `partner-webhook` — 2.197 chamadas no histórico, a última em 2026-08-04
 *                         (`api_key_usage_log`)
 *   • as outras seis    — nenhuma linha em `runtime_logs` nem em `api_key_usage_log`.
 *                         Ausência de registro, não prova de zero uso: nada garante que
 *                         elas escrevam nessas tabelas.
 *
 * O contrato do `lead-webhook` vive no `CLAUDE.md` da raiz, seção "Webhook lead-webhook" —
 * é ali que o suporte deve buscá-lo. O histórico das entradas removidas está no git.
 *
 * Somar categoria aqui sem contrato em `openapi.json` recria exatamente o problema.
 */
export const apiCategories: ApiCategory[] = [restApiCategory];
