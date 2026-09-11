# Otimização do chat — avaliação em 2026-09-11

Integração melhorou em correção de contratos e resiliência. Ainda não homologada para escala de CRM: não houve ensaio representativo de concorrência, volume de produção ou p95.

## Evidência observada

- Chromium no QA, conversa com 214 mensagens: duas respostas HTTP 200 de 199.006 bytes de JSON decodificado, durante abertura e observação por 23 segundos. Não é medição de bytes comprimidos na rede.
- Nenhuma chamada do navegador ao domínio UAZAPI nesse período. Leitura do chat vem do Supabase.
- Virtualização ativa; 11 itens de timeline montados na amostra.
- `fetchConversationMessages` busca até 1.000 mensagens com projeção explícita e ordem decrescente, depois reverte. Não existe navegação para mensagens além dessa janela.
- Realtime aplica patches incrementais. Backstop consulta novamente a janela a cada 20 segundos; fallback desconectado usa 10 segundos. Remover esse mecanismo sem substituição faria reaparecer perdas silenciosas de eventos já documentadas.
- Histórico usa batches, orçamento de execução e checkpoints. Retomada agora preserva checkpoint, sem novo job; página cheia da UAZAPI é seguida mesmo quando hasMore=false contradiz a existência de próxima página.
- Storage recuperou vídeo/figurinha e playback foi validado. Transcrição do provider retornou texto; integração completa dessa saída no CRM não foi validada.

## Prioridades antes de chamar o chat de otimizado

1. Corrigir reentrada: teste real criou nova execução com reinscrição desativada. É defeito funcional confirmado, não uma hipótese de performance.
2. Paginar mensagens por cursor estável e oferecer “carregar anteriores”, preservando ligações e mensagens otimistas.
3. Reconciliar alterações com consulta menor, mantendo garantia de recuperação quando Realtime perde eventos. Não simplesmente desligar polling.
4. Medir planos de consulta, CPU, I/O, tráfego e latência com volume e concorrência representativos. Só então ajustar índices: existem vários índices parcialmente sobrepostos, cada novo índice também encarece escrita/webhook.
5. Completar transcrição no CRM, lifecycle dedicado, replay de migrations e CI antes de rollout.

Arquivos principais: `whatsappMessagesQuery.ts`, `useWhatsAppMessages.ts`, `useRealtimeFallback.ts`, `MessageList.tsx`, `history-sync-worker/index.ts`. Evidência numérica: `live-verification-round7-2026-09-11.json`.
