# Processamento de Lead

## Objetivo
Processar um novo lead recebido de qualquer origem (webhook, importação, criação manual), validar dados, verificar duplicatas, criar registro no banco de dados e registrar histórico.

## Entradas
- name: string - Nome completo do lead (obrigatório)
- email: string? - Email do lead (opcional mas recomendado)
- phone: string? - Telefone do lead (opcional)
- company: string? - Nome da empresa (opcional)
- origin: string - Origem do lead (calendly, whatsapp, meta_ads, remarketing, base_clientes, parceiro, indicacao, quiz, site, organico, outro)
- segment: string? - Segmento do lead (opcional)
- faturamento: string? - Faturamento estimado (opcional)
- urgency: string? - Urgência (opcional)
- notes: string? - Notas adicionais (opcional)
- rating: number? - Rating do lead (0-10, opcional)
- sdr_id: string? - ID do SDR para atribuição (opcional)
- compromisso_date: string? - Data de compromisso/reunião (opcional, formato ISO)
- tenant_id: string - ID da organização (obrigatório)
- user_id: string - ID do usuário que está executando (obrigatório)

## Ferramentas
- `execution/typescript/business/process_lead.ts` - Script principal de processamento

## Saídas
- lead_id: string - ID do lead criado ou atualizado
- action: string - Ação realizada (created, updated, unified)
- deduplication_method: string? - Método de deduplicação usado (email, name_same_day)
- pipe: string? - Pipe onde o lead foi inserido (whatsapp, confirmacao)

## Edge Cases
- Lead duplicado por email: Unificar com lead existente, mesclar dados, preservar dados existentes quando novos são vazios
- Lead duplicado por nome no mesmo dia: Unificar com lead existente, mesclar dados
- Dados inválidos: Validar email, telefone, rating antes de processar
- Tenant sem subscription: Bloquear execução e retornar erro
- Compromisso_date preenchido: Criar lead diretamente no pipe_confirmacao com status "reuniao_marcada"
- Sem compromisso_date: Criar lead no pipe_whatsapp com status "novo"
- Lead já em pipe_propostas com status "compromisso_marcado": Manter em pipe_whatsapp mesmo com compromisso_date

## Aprendizados
(Atualizado automaticamente pelo sistema)
