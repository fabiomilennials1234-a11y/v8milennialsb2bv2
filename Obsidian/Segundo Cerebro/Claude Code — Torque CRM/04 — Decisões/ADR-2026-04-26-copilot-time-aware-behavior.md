# ADR 2026-04-26 — Copilot Time-Aware Behavior

**Status**: Accepted (deployed prod)
**Data**: 2026-04-26
**Autor**: Gabriel (CTO) + Claude Code

## Contexto

Copilot do Torque CRM tinha controle de horário simplista: `availability` JSONB com modo `always | scheduled`. Limitações:

1. Agente não sabia que horas/dia da semana era no momento da resposta — bloco prompt `# DISPONIBILIDADE` informava apenas a configuração estática (seg-sex 9-18h), nunca o instante atual
2. Apenas 2 estados — dentro ou fora — sem granularidade pra adaptar tom por janela (comercial vs madrugada vs fds)
3. Fora-do-horário tinha apenas resposta canned fixa (`out_of_hours_message`) — sem opção de LLM responder com instrução de tom diferente

Trabalho adjacente recente: D034 (fallback elimination), D032 (phone_ai_preferences). Feature complementa controle de copilot já maduro.

## Decisão

Adicionar **Time-Aware Behavior** em 6 ondas (F1-F6):

### Schema (extend, not duplicate)
Decidido **estender** a coluna `availability` JSONB com 2 colunas novas em vez de criar tabela paralela ou refatorar `availability`:

```sql
ALTER TABLE copilot_agents
  ADD COLUMN behavior_windows JSONB DEFAULT '[]',
  ADD COLUMN behavior_enforcement TEXT DEFAULT 'hard' CHECK IN ('hard','soft');
```

Razão: `availability` legacy continua intocado (timezone aproveitado), zero quebra em UI/hooks existentes, opt-in pra novas janelas.

### Modelo de janela
```
{ id, name, days: ('mon'|...|'sun')[], start: 'HH:MM', end: 'HH:MM', behavior: string }
```

- **First-match wins** (ordem do array = prioridade)
- **Wrap midnight** suportado (end ≤ start cobre overnight)
- **Cobertura 24/7 obrigatória** validada na UI (não no DB — DB aceita qualquer estado)
- **Limite de 6 janelas** por agente (decisão UX: simplicidade vs flexibilidade)

### Enforcement (toggle global do agente)
- **Hard** (default, retrocompat): janela com behavior vazio devolve canned `out_of_hours_message`, não chama LLM
- **Soft**: sempre chama LLM injetando contexto temporal — nunca bloqueia resposta

### Cobertura na sessão atual
- F1 migration + backfill ✅
- F2 resolver + prompt injection + checkOutOfHours refator ✅
- F3 UI com timeline 7×24 + validação cobertura ✅
- F4 hooks/types ✅
- F5 semantic via prompt ✅ (programmatic tool blocking adiado para F5b)
- F6 audit runtime_logs ✅

## Alternativas consideradas

### Alt 1: Coluna nova `business_timezone` + `business_hours` + `behavior_*` em `copilot_agents`
**Rejeitada** — duplica info que já existe em `availability` JSONB. Quebraria UI das 26 orgs ativas.

### Alt 2: Tabela paralela `copilot_agent_time_rules`
**Rejeitada** — overkill pra modelo simples (até 6 janelas por agente). Custo de join + RLS extra.

### Alt 3: 4 janelas fixas (commercial/after_hours/late_night/weekend)
**Rejeitada após discussão com user** — perde flexibilidade real (cliente quer nomear, sobrepor, customizar).

### Alt 4: Programmatic tool blocking imediato (F5)
**Adiada (F5b)** — `executeScheduleMeeting` + `executeTransferHuman` recebem só `payload`, não capabilities. Pra ficar time-aware precisa mudar assinatura de N tools + UI explicando bloqueio. Scope grande pra mesma sessão. Por enquanto, instrução textual no prompt já cobre ~80% dos casos.

## Impacto

### Retrocompat
100% preservada. Agentes legacy:
- `behavior_windows` vazio → resolver retorna null → bloco DISPONIBILIDADE clássico no prompt
- `behavior_enforcement` default `'hard'` + behavior vazio → mensagem canned mantida idêntica
- Backfill criou janela "Padrão" 7d/24h vazia → equivalente a `mode='always'` semanticamente

### Performance
- Resolver é O(N) onde N≤6 janelas por agente. Negligível.
- Audit `time_context` em runtime_logs: ~80 bytes extras por mensagem do agente. Aceitável.
- Sem nova chamada SQL (`behavior_windows` vem em `SELECT_AGENT = "*"` existente).

### Operacional
- 26 agentes em prod backfilled em 1 UPDATE
- Edge function `agent-message` redeployada
- Migration anti-pattern L002 (Studio sem versionar) resurgiu durante deploy — 8 migrations órfãs descobertas e sincronizadas via `migration repair`

## Riscos remanescentes

1. **F5b**: hoje agente pode prometer agendamento de reunião fora janela comercial via prompt mas sem enforcement programático. LLM pode falhar a regra.
2. **Truncagem prompt**: bloco `# CONTEXTO TEMPORAL` adiciona ~150 chars no prompt. `prompt-builder.ts` ainda skeleton, sem warning de overflow.
3. **DST**: resolver usa `Intl.DateTimeFormat` (timezone-aware nativo). Brasil aboliu DST em 2019, não testado em TZs com DST ativo.
4. **Validação 24/7 só no frontend**: DB aceita janelas com gaps. Inserts via API direta podem deixar agente "muto" em horários sem cobertura. Mitigação: backend default seguro com `enforcement=hard` + canned.

## Decisões correlatas
- D034 (Copilot fallback elimination, 2026-04-23) — esta feature herda padrão de telemetria por invocação
- ADR-2026-04-26-trilha-3 (refactor copilot) — Time-Aware é capa adicional sobre arquitetura modular já estabelecida

## Lições

**L004**: Anti-pattern L002 (RPCs/migrations não-versionadas via Studio) continua acontecendo. Time deveria configurar workflow gating no Supabase dashboard pra desabilitar SQL Editor de produção pra todos exceto admin Milennials.
