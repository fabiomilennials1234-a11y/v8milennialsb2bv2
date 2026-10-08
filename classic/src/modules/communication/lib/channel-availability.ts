/**
 * Disponibilidade dos canais de comunicação na UI.
 *
 * O CRM tem o **andaime** de e-mail e SMS pronto desde 08/05/2026 (commit
 * `8dd7d94c`, "waves 0-7 — world-class CRM foundation"): hooks, composer,
 * thread view, dialog de SMS, writer com IA, e as 7 tabelas
 * (`emails`, `email_accounts`, `email_templates`, `ai_email_drafts`,
 * `sms_messages`, `sms_templates`, `sms_provider_config`).
 *
 * O que NÃO existe é o backend. As edge functions que essa UI invoca —
 * `send-email`, `send-sms` e `generate-ai-email-draft` — **nunca foram
 * construídas**: não aparecem em nenhum commit da história, não estão no
 * `config.toml` e não estão entre as funções deployadas no PROD
 * (conferido em 06/08/2026 contra as 150 vivas via Management API).
 *
 * Resultado: os botões de "Email", "Email com IA" e "Enviar SMS" na ficha do
 * lead estavam expostos ao cliente desde maio e **todo clique dava erro**.
 *
 * Estas flags escondem esses pontos de entrada sem apagar o andaime. Apagar
 * seria reverter roadmap, não limpar resíduo: o `docs/MASTER-ROADMAP-WORLD-CLASS.md`
 * descreve os dois canais na **Wave 2** — 2.1 (Email Sync Gmail/Outlook),
 * 2.2 (Unified Inbox) e 2.4 (SMS Integration) — e a Wave 2 depende
 * explicitamente da Wave 1.1 (modelo Contact/Company/Deal), que é o épico
 * SCRUM-43 e ainda não está em produção. O código já foi escrito para esse
 * modelo: `useEmails` aceita `contactId` e `AiEmailWriter` aceita `dealId`.
 *
 * Que o roadmap está vivo, e não abandonado, mostra a própria Wave 2.3
 * (Call Logging + VoIP): virou o TorqueCalls, deployado em 08/2026, e o
 * `LogCallModal` fica no mesmo menu de onde estas flags escondem o e-mail.
 *
 * **Para religar:** construa a edge function do canal, registre no
 * `config.toml`, deploye, e vire a flag correspondente para `true`.
 *
 * Tipadas como `boolean` (e não pelo literal `false`) de propósito: com o tipo
 * literal, o TypeScript trataria os ramos como inalcançáveis e o próximo a
 * mexer aqui levaria erro de "condição sempre falsa" ao virar a flag.
 */

/** Wave 2.1 — Email Sync. Falta a edge function `send-email` (e `generate-ai-email-draft`). */
export const EMAIL_CHANNEL_AVAILABLE: boolean = false;

/** Wave 2.4 — SMS Integration. Falta a edge function `send-sms`. */
export const SMS_CHANNEL_AVAILABLE: boolean = false;
