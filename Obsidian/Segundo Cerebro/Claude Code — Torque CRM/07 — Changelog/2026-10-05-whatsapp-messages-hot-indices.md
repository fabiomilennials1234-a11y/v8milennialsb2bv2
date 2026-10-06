# 2026-10-05 — whatsapp_messages: HOT e índices (Parte 1, não aplicada)

## Mudanças
- **WhatsApp / banco**: três migrations escritas e ainda não aplicadas. C1 põe `fillfactor=85, toast_tuple_target=1024` em `whatsapp_messages`. A1 dropa `idx_whatsapp_messages_org` e A2 dropa `idx_whatsapp_conversations_instance`, as duas com `DROP INDEX CONCURRENTLY`. Cada uma tem rollback em `supabase/migrations/rollback/`.
- **Perf**: script de snapshot diário e protocolo de 7 dias para decidir os índices candidatos (~1,2 GB).

## Arquivos tocados
- `src/modules/communication/hooks/chat/useWhatsAppRealtime.ts`: o UPDATE agora funde a linha em vez de substituí-la (`shared/realtimeUpdate.ts`). Um `raw_payload` em toast inalterado chega ausente e não apaga mais o display da bolha.
- `supabase/migrations/20271107140003_whatsapp_messages_fillfactor_toast_target.sql` (+ rollback)
- `supabase/migrations/20271107140004_drop_idx_whatsapp_messages_org.sql` (+ rollback)
- `supabase/migrations/20271107140005_drop_idx_whatsapp_conversations_instance.sql` (+ rollback)
- `tests/integration/whatsapp-messages-hot.test.mjs`: prova em PGlite
- `scripts/perf/whatsapp-messages-index-snapshot.sql`: Q1 a Q4, saída em JSON
- `.specs/perf/whatsapp-messages-indexes/README.md`: protocolo, achados e leitores de `raw_payload`

## Decisões
- As versões são provisórias e serão renumeradas contra o ledger na hora de aplicar. A aplicação é por psql autocommit no pooler session, com `lock_timeout` de 3 s.
- `ALTER TABLE … SET (fillfactor/toast)` pega o lock SHARE UPDATE EXCLUSIVE, segundo a doc do PG17 de ALTER TABLE.

## Achados
- O gatilho do TOAST é fixo em ~2 kB, e `toast_tuple_target` só muda o alvo. Ele move para o toast as ~14% de tuplas que hoje ficam comprimidas inline. As 82% entre 1 e 2 kB não mudam.
- Montamos um fluxo calibrado na distribuição de prod; sem C1 ele reproduz os 25–29% de UPDATEs fora da página que prod mostra. Com 90 cai para 12%, e com 85 cai para 3%, com heap menor. **Decisão do CTO: 85.**

## Follow-ups
- `search_tsv`: a coluna é STORED e não tem índice.
