# UAZAPI — cobertura completa da integração

Atualização: 2026-09-11. Código avaliado: `6602b48fc`. Branch `codex/uazapi-rebuild`; [PR draft #2099](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/pull/2099). Ambiente Supabase QA persistente; sem promoção de código/schema para produção.

Fonte: [OpenAPI oficial uazapiGO 2.1.1](https://docs.uazapi.com/openapi-bundled.json), obtido novamente nesta rodada. Inventário inclui **todas as 139 operações HTTP**, com correspondência exata de método e caminho. Não equivale a cobrir cada combinação opcional do schema.

**33 operações possuem integração no backend; 1 é usada somente como ferramenta QA (SSE); 105 não estão integradas.** Ter método no backend não garante botão no chat, todos os parâmetros nem homologação ponta a ponta.

O inventário inicial contava referências literais e deixou escapar `/proxy-managed/cities`, cuja URL é dinâmica. PIX, sender e lifecycle já existiam antes da reconstrução; esta sessão corrigiu contratos e consumidores. Não atribuímos a criação de todos esses recursos à sessão.

Atualização R11: compositor de lista/PIX agora preserva pending, ID real, timestamp e metadata antes do webhook; lista repassa rótulo/descrição. Envios reais pelo navegador confirmados Delivered no fornecedor. [Evidência R11](../../.specs/uazapi-rebuild/live-verification-round11-2026-09-11.json). Sem novos endpoints nessa rodada. Atualização R12: localização e contato agora estão no compositor TorqueSDR; cartões, reload, mapa e copiar telefone validados. Ambos confirmados Delivered pelo fornecedor. JSON/CSV atualizados; variações recebidas continuam pendentes.

Atualização R13: bloqueio/desbloqueio validado pela API, estado inicial restaurado; presença validada no navegador com duração configurada de10s. Áudio recebido/reprodução e markread agora exercitados; transcrição recebida falhou porque UAZAPI retornou cache sem texto. UI de bloqueio continua pendente. [Evidência R13](../../.specs/uazapi-rebuild/live-verification-round13-2026-09-11.json).

## O que foi construído/corrigido nesta sessão

| Área | Entrega | Evidência / limite |
|---|---|---|
| Adapter e payloads | Campos de texto/mídia/menu/PIX; timestamps; estados queued/sent; erros e respostas reais | Contratos e chamadas reais; aceitação não confundida com entrega |
| Segurança | Autorização por org/conversa; credenciais somente backend; testes positivos/negativos | Sem sessão401, outra org403; políticas QA verificadas |
| Entrada e receipts | Envelope UAZAPI, reação idempotente, receipt em lote e corrida com eco | SSE real → relé filtrado → webhook QA → banco → chat; não é webhook remoto direto em QA |
| Chat | Recebidas/enviadas, seleções de lista, opções de menu, mídia, reação, PIX copiável e transcrição | Navegador real; texto/lista, imagem, documento, figurinha, áudio/PTT e vídeo; não cobre todas as variantes |
| Transcrição | Ação autenticada, cache persistente e lease120s | HTTP200, reload, cache, outsider403 e duas chamadas concorrentes200/409; só áudios enviados |
| PIX | Card com recebedor/chave, copiar, metadata mínima para node/gateway | PIX real Read; clipboard conferido; nenhum pagamento efetuado |
| Disparos | Unidades de atraso, caption, estados, pausa/retomada e contadores | Quick Blast1 destinatário e lote controlado2; guardas Mass Send; sem lote massivo |
| Workflows/nodes | Texto/lista/PIX, escopo, retries seguros, publicação versionada, espera e timeout | Grafo4 passos; publicação versão1; cron real; resposta e timeout; 429 repetível e503ambíguo terminal |
| Reentrada | Guarda atômica por org/workflow/lead; ativo, cooldown e limite total | 8 tentativas concorrentes para1 vaga →1 aceita; banco e execução real |
| Histórico | Solicitação, progresso, CAS para retomar mesmo job/cursor; paginação defensiva | Retomada100→215; fornecedor retornou hasMore=false prematuro; recuperação upstream ausente ainda não provada |
| Escala do chat | Página100, cursor timestamp+UUID, virtualização estável, scroll preservado, manifesto xmin/fingerprint | 1.314 mensagens em14 páginas, sem duplicação; fixtures de carga removidas |

### Desempenho medido — QA, não certificação de produção

- Poll sem alterações: payload JSON decodificado caiu de199.006 para88 bytes. Primeiro manifesto6.985 bytes + corpo97.476 bytes.
- Com1.314 mensagens carregadas, amostra final18 bolhas montadas no DOM; paginação não depende de carregar todo histórico de uma vez.
- Sondagem30 requisições, concorrência10: p50145ms/p95189ms, zero erros. Amostra pequena; faltam tenants simultâneos e carga sustentada representativa.
- Poll de recuperação continua20s/10s no fallback para eventos perdidos. Histórico de chamadas mantém teto independente1.000.

## Pendências priorizadas

1. **P1 — infraestrutura/CI:** bootstrap automático Supabase segue MIGRATIONS_FAILED; QA foi restaurado por schema. Replay integral das migrations ainda não executado; Docker ausente no host. Seis DEFAULT ACL de donos da plataforma não foram replicados. Não promover banco nessas condições.
2. **P1 — homologação:** recebimento direto do webhook em ambiente isolado; transcrição de áudio recebido real; markread/edição/exclusão recebidos e variantes de menus; recuperação de mensagem realmente ausente no fornecedor. Doze candidatos de histórico estavam todos presentes: não simulamos uma prova inexistente.
3. **P1 — escala:** benchmark sustentado, campanhas concorrentes, perdas de rede/Realtime e volumes por tenant; validar impacto no banco e p95/p99. Pequeno ensaio QA não prova escala de CRM em produção.
4. **P1 — lifecycle, por último:** desconexão/reconexão completa/exclusão conforme escopo operacional final, usando TorqueSDR. A pedido do usuário, nenhuma nova ação de lifecycle agora.
5. **P2 — produto:** bloqueio/desbloqueio com UX e autorização; presença; erros de webhook; etiquetas, arquivar/silenciar/fixar conversa, perfil/privacidade e respostas rápidas após definir fonte de verdade CRM versus WhatsApp.
6. **P3 — expansão deliberada:** grupos/comunidades, canais/newsletters, catálogo/business, chamadas UAZAPI e Chatwoot. Não habilitar apenas por existir endpoint: exigem modelo de dados, permissões e necessidade de produto.

**Estado operacional:** Leo Meireles foi desconectada durante teste anteriormente autorizado; QR gerado, reconexão não confirmada, nenhuma exclusão. Usuário depois adiou lifecycle para TorqueSDR. TorqueSDR não foi desconectada nesta rodada. Testes usaram instâncias reais autorizadas, embora código/schema permaneçam em QA.

## Webhooks e recursos que não são endpoints separados

| Evento oficial | Tratamento atual | Lacuna |
|---|---|---|
| messages | Handler, persistência, mídia, seleção e reação | Ampliar variantes de conteúdo |
| messages_update | Handler de receipts; IDs em lote | Falhas prolongadas e novas variantes |
| connection | Handler de estado | Pareamento completo na última etapa |
| history | Sem handler dedicado | Poll de histórico não equivale a consumir esse evento |
| newsletter_messages, call, contacts, presence, groups, labels, chats, chat_labels, blocks, sender | Sem case dedicado no dispatcher atual; registra evento não tratado | Integração específica conforme prioridade; polling de sender é caminho separado |

`payment`/`payment_response` têm cases legados, mas não aparecem como eventos oficiais nesse enum. Não certificam recebimento de dinheiro. Configurações embutidas no schema (por exemplo automação/chatbot) também não estão homologadas como produto. Copilot interno, tags CRM e chamadas de outro provedor não contam como uso dessas capacidades UAZAPI.

## Verificações e evidências

- Última rodada de código:997 testes/73 arquivos; Deno compartilhado e build passaram; TypeScript/lint sem novos problemas; zero colisões de migration.
- CI no commit avaliado: somente Supabase Preview `skipped`; não há CI verde do commit atual. Erro nullable do run antigo foi corrigido e checado localmente. Guard master-ghost tem falhas preexistentes, sem delta; baseline não ampliado.
- Problemas QA fora deste escopo observados: master_users406, convite401, upsell404. Não declaramos aplicação inteira homologada.
- Evidências versionadas: [rodada inicial](../../.specs/uazapi-rebuild/live-verification-2026-09-11.json), [R2](../../.specs/uazapi-rebuild/live-verification-round2-2026-09-11.json), [R4](../../.specs/uazapi-rebuild/live-verification-round4-2026-09-11.json), [R5](../../.specs/uazapi-rebuild/live-verification-round5-2026-09-11.json), [R6](../../.specs/uazapi-rebuild/live-verification-round6-2026-09-11.json), [R7](../../.specs/uazapi-rebuild/live-verification-round7-2026-09-11.json), [R8](../../.specs/uazapi-rebuild/live-verification-round8-2026-09-11.json), [R9](../../.specs/uazapi-rebuild/live-verification-round9-2026-09-11.json), [R10](../../.specs/uazapi-rebuild/live-verification-round10-2026-09-11.json).
- [CSV filtrável](../../.specs/uazapi-rebuild/COBERTURA-UAZAPI.csv) e [JSON completo](../../.specs/uazapi-rebuild/capabilities-current.json). `capabilities.json` antigo permanece como fotografia histórica, não status atual.

## Matriz integral — 139 operações

Cada linha separa existência de integração, mudança da sessão, evidência e trabalho restante. “Não integrado” foi apurado no inventário e referências de runtime; não significa falta de permissão no plano contratado. Campos opcionais não exercitados continuam sem homologação.

### Admininstração

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `POST /instance/create` — Criar Instancia | **Backend integrado (escopo parcial)**. Existente; contrato de criação e validação de identidade corrigidos. | Sem criação real homologada nesta sessão. | Criação completa + credenciais + UI, na etapa de lifecycle. P1 — concluir homologação CRM. |
| `GET /instance/all` — Listar todas as instâncias | **Backend integrado (escopo parcial)**. Existente; monitor preservado. | Usado na identificação operacional; sem homologação administrativa completa. | Paginação/permissões administrativas em cenários adicionais. P1 — concluir homologação CRM. |
| `POST /instance/updateAdminFields` — Atualizar campos administrativos | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `GET /globalwebhook` — Ver Webhook Global | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — administração restrita. |
| `POST /globalwebhook` — Configurar Webhook Global | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — administração restrita. |
| `GET /globalwebhook/errors` — Ver últimos erros do webhook global | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — administração restrita. |
| `POST /admin/restart` — Reiniciar a aplicação | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — administração restrita. |
| `POST /admin/token/rotate` — Rotacionar admin token | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — administração restrita. |

### Instancia

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `POST /instance/connect` — Conectar instância ao WhatsApp | **Backend integrado (escopo parcial)**. Existente; criação separada da conexão, proxy regional preservado. | Leo: chamada aceita, QR gerado; pareamento NÃO confirmado. | Reconexão completa por último na TorqueSDR. P1 — concluir homologação CRM. |
| `POST /instance/disconnect` — Desconectar instância | **Backend integrado (escopo parcial)**. Existente, preservado. | Leo: desconexão real confirmada. | Fluxo completo na TorqueSDR adiado pelo usuário. P1 — concluir homologação CRM. |
| `POST /instance/reset` — Reiniciar runtime da instância | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — administração restrita. |
| `GET /instance/status` — Verificar status da instância | **Backend integrado (escopo parcial)**. Normalização de estados desconhecidos/hibernação corrigida. | Consulta real; distingue connected/disconnected. | Cobrir transições durante reconexão final. P1 — concluir homologação CRM. |
| `GET /instance/wa_messages_limits` — Consultar limites atuais de novas conversas no WhatsApp | **Backend integrado (escopo parcial)**. Quota desconhecida preservada como null; bloqueio explícito respeitado. | Sondagem real + testes de contratos nullable. | Limites reais sob volume representativo. P1 — concluir homologação CRM. |
| `POST /instance/updateInstanceName` — Atualizar nome da instância | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `DELETE /instance` — Deletar instância | **Backend integrado (escopo parcial)**. Existente; preservado. | Não executado. | Destrutivo: última etapa, escopo operacional a resolver sem perder instância útil. P1 — concluir homologação CRM. |
| `GET /instance/privacy` — Buscar configurações de privacidade | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /instance/privacy` — Alterar configurações de privacidade | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /instance/presence` — Atualizar status de presença da instância | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |

### CRM

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `POST /instance/updateFieldsMap` — Atualizar campos personalizados de leads | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /chat/editLead` — Edita informações de lead | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |

### Proxy

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `GET /instance/proxy` — Obter configuração de proxy da instância | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /instance/proxy` — Configurar ou alterar o proxy | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `GET /proxy-managed/cities` — Proxy Interno - Listar cidades disponíveis | **Backend integrado (escopo parcial)**. Existente; rota dinâmica não aparecia no inventário literal. | HTTP200 nesta rodada, consulta somente leitura; ver evidência R10. | Seleção regional durante nova conexão ainda não homologada. P1 — concluir homologação CRM. |

### Perfil

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `POST /profile/name` — Altera o nome do perfil do WhatsApp | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /profile/image` — Altera a imagem do perfil do WhatsApp | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |

### Enviar Mensagem

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `POST /send/text` — Enviar mensagem de texto | **Backend integrado (escopo parcial)**. Normalização, tracking, queued, eco/receipt, retries e consumidores corrigidos. | Envio real pelo chat, node, gateway; entrega/leitura entre dois números. | Carga representativa e falhas prolongadas. P1 — concluir homologação CRM. |
| `POST /send/media` — Enviar mídia (imagem, vídeo, áudio ou documento) | **Backend integrado (escopo parcial)**. Campos text/docName, download e armazenamento corrigidos. | Imagem, documento, áudio, PTT, vídeo, figurinha; mídia renderizada e áudio/vídeo reproduzidos. | Variações de tamanho/formato, expiração e redes lentas. P1 — concluir homologação CRM. |
| `POST /send/contact` — Enviar cartão de contato (vCard) | **Backend integrado (escopo parcial)**. Provider/proxy + compositor TorqueSDR; cartão legível, copiar telefone e validações de telefone/e-mail. | R12: envio pelo navegador HTTP200/queued, pending local com ID real, reload/clipboard conferidos; fornecedor Delivered/ContactMessage. | Variações recebidas pelo webhook e múltiplos telefones além do formulário de um número. |
| `POST /send/location` — Enviar localização geográfica | **Backend integrado (escopo parcial)**. Provider/proxy + compositor TorqueSDR; coordenadas validadas e cartão com link seguro para mapa. | R12: envio pelo navegador HTTP200/queued, pending local com ID real, reload e link conferidos; fornecedor Delivered/LocationMessage. | Variações recebidas pelo webhook e divergência do fornecedor em (0,0). |
| `POST /message/presence` — Enviar atualização de presença | **Backend integrado (escopo parcial)**. Mapping composing/paused preservado; delay10s e renovação8s no compositor; parada3s/blur/troca/perda de permissão; serialização e validação de estado. | R13: três chamadas de presença no navegador HTTP200; estado inválido400; outra org403; testes de timers/concorrência/permissões. | Observar indicador e expiração no telefone remoto; presença recebida e recording não homologados. |
| `POST /send/status` — Enviar status (stories) | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /send/menu` — Enviar menu interativo (botões, carrosel, lista ou enquete) | **Backend integrado (escopo parcial)**. Campos documentados + opções/seleção no chat; nodes e gateway preservam metadata. | Lista real enviada/lida; seleção recebida; fluxo wait_response/timeout. | Demais variantes de botões/enquete e limites não homologados integralmente. P1 — concluir homologação CRM. |
| `POST /send/carousel` — Enviar carrossel de mídia com botões | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /send/location-button` — Solicitar localização do usuário | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /send/request-payment` — Solicitar pagamento | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /send/pix-button` — Enviar botão PIX | **Backend integrado (escopo parcial)**. Endpoint já existia; payload preservado; novo card PIX e copiar chave no chat. | Envio real Read; copiar chave conferido no navegador; nenhum pagamento. | Entrada PIX recebida/variações; não é confirmação financeira. P1 — concluir homologação CRM. |

### Mensagem Async

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `GET /message/async` — Consultar fila async de envio direto | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `DELETE /message/async` — Limpar fila async de envio direto | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /instance/updateDelaySettings` — Configurar delay entre mensagens async | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |

### Ações na mensagem e Buscar

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `POST /message/download` — Baixar arquivo de uma mensagem | **Backend integrado (escopo parcial)**. base64Data + persistência de mídia; transcrição autenticada com cache/lease. | Downloads reais; transcrição HTTP200 persistida após reload; outsider403; concorrência200/409. R13: áudio recebido real reproduzido; transcribe=true devolveu HTTP200/cached com URL e MIME, sem texto; falha502 explícita no CRM, sem persistir transcrição vazia. | Resolver ausência de transcrição em resposta cached da UAZAPI para áudio recebido; nova homologação positiva após resolução. Não trocar provedor silenciosamente. |
| `POST /message/find` — Buscar mensagens em um chat | **Backend integrado (escopo parcial)**. Paginação/cursor e respostas reais corrigidos; base da recuperação. | Worker retomou100→215; 12 IDs antigos encontrados no fornecedor. | Recuperação de mensagem realmente ausente no fornecedor ainda sem prova. P1 — concluir homologação CRM. |
| `POST /message/history-sync` — Solicitar histórico sob demanda de um chat | **Backend integrado (escopo parcial)**. Provider/proxy + ação de histórico com progresso/retomada. | history/exact aceitos; exact também teve404 em caso inicial; job de histórico completou. | Aceitação não prova recuperação upstream; evento history sem handler dedicado. P1 — concluir homologação CRM. |
| `POST /message/markread` — Marcar mensagens como lidas | **Backend integrado (escopo parcial)**. Contrato existente preservado e testado. | Ação sobre mensagem própria aceita; receipts de conversa real observados separadamente. R13: chamada sobre áudio recebido real HTTP200, outra organização403. | Conferência visual dos recibos no aparelho remoto; API de entrada real já exercitada. |
| `POST /message/react` — Enviar reação a uma mensagem | **Backend integrado (escopo parcial)**. Campo text, referência da reação, replay/CAS e UI corrigidos. | Reação real, replay sem duplicar, persistência no chat após reload. | Variações concorrentes/múltiplos participantes. P1 — concluir homologação CRM. |
| `POST /message/delete` — Apagar Mensagem Para Todos | **Backend integrado (escopo parcial)**. ID e projeção deleted_at. | Exclusão de mensagem própria de teste aceita. | Revogação recebida e consistência visual em ambos os clientes. P1 — concluir homologação CRM. |
| `POST /message/edit` — Edita uma mensagem enviada | **Backend integrado (escopo parcial)**. ID/campos e projeção de mensagem editada corrigidos. | Edição de mensagem própria aceita. | Homologação visual completa de edição recebida. P1 — concluir homologação CRM. |
| `POST /message/pin` — Fixa ou desafixa uma mensagem | **Backend integrado (escopo parcial)**. Campo pin e projeção pinned_at. | Pin/unpin de teste aceitos. | Sincronização visual nos dois clientes. P1 — concluir homologação CRM. |

### Grupos e Comunidades

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `POST /group/create` — Criar um novo grupo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /group/info` — Obter informações detalhadas de um grupo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /group/inviteInfo` — Obter informações de um grupo pelo código de convite | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /group/join` — Entrar em um grupo usando código de convite | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /group/leave` — Sair de um grupo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `GET /group/list` — Listar todos os grupos | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /group/list` — Listar todos os grupos com filtros e paginacao | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /group/resetInviteCode` — Resetar código de convite do grupo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /group/updateAnnounce` — Configurar permissões de envio de mensagens no grupo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /group/updateJoinApproval` — Configurar aprovação para entrada no grupo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /group/updateMemberAddMode` — Configurar quem pode adicionar novos membros ao grupo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /group/updateDescription` — Atualizar descrição do grupo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /group/ephemeral` — Configurar mensagens temporárias em grupo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /group/updateImage` — Atualizar imagem do grupo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /group/updateLocked` — Configurar permissão de edição do grupo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /group/updateName` — Atualizar nome do grupo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /group/updateParticipants` — Gerenciar participantes do grupo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /community/create` — Criar uma comunidade | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /community/editgroups` — Gerenciar grupos em uma comunidade | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |

### Newsletters e Canais

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `POST /newsletter/create` — Criar canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `GET /newsletter/list` — Listar canais inscritos | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/info` — Buscar informações de um canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/link` — Buscar canal por link-chave de convite | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/subscribe` — Assinar live updates temporários de um canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/messages` — Buscar mensagens de um canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/messages/edit` — Editar mensagem recente de um canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/messages/delete` — Deletar mensagem recente de um canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/updates` — Buscar updates de mensagens de um canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/viewed` — Marcar posts do canal como visualizados | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/reaction` — Reagir a um post do canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/follow` — Seguir canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/unfollow` — Deixar de seguir canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/mute` — Silenciar canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/unmute` — Remover mute do canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/delete` — Deletar canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/picture` — Atualizar foto do canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/name` — Atualizar nome do canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/description` — Atualizar descrição do canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/settings` — Atualizar configurações do canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/search` — Pesquisar canais públicos | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/admin/invite` — Convidar admin do canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/admin/accept` — Aceitar convite de admin do canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/admin/remove` — Remover admin do canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/admin/revoke` — Revogar convite de admin do canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /newsletter/owner/transfer` — Transferir dono do canal | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |

### Webhooks e SSE

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `GET /webhook` — Ver Webhook da Instância | **Backend integrado (escopo parcial)**. Inspeção/monitor existentes; comparação sem falso rebind por truncamento. | Configuração consultada e backup operacional realizado. | Teste de entrega direta do provider ao QA. P1 — concluir homologação CRM. |
| `POST /webhook` — Configurar Webhook da Instância | **Backend integrado (escopo parcial)**. Configuração existente; monitor/filtros e detecção de divergência corrigidos. | Sem reconfiguração do webhook remoto TorqueSDR. | Entrega direta QA; relé SSE não substitui esse teste. P1 — concluir homologação CRM. |
| `GET /webhook/errors` — Ver últimos erros do webhook local | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `GET /sse` — Server-Sent Events (SSE) | **Ferramenta QA apenas**. Ferramenta de homologação temporária; sem consumo permanente pelo produto. | Eventos reais filtrados dos números autorizados e replay no webhook QA. | Não planejar SSE temporário como infraestrutura de produção. P3 — fora do núcleo CRM. |

### Mensagem em massa

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `POST /sender/simple` — Criar nova campanha (Simples) | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /sender/advanced` — Criar envio em massa avançado | **Backend integrado (escopo parcial)**. Disparos existentes corrigidos: ms→s, caption/text, info, tracking/estados. | Quick Blast real de1 destinatário; lote controlado2; nodes e guardas de Mass Send. | Mass Send representativo acima do limiar sem ampliar destinatários sem autorização. P1 — concluir homologação CRM. |
| `POST /sender/edit` — Controlar campanha de envio em massa | **Backend integrado (escopo parcial)**. Normalização pausa/retomada/estado e tratamento transitório. | Pausa, retomada e remoção de pasta de teste. | Concorrência e interrupção prolongada. P1 — concluir homologação CRM. |
| `POST /sender/cleardone` — Limpar mensagens enviadas | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `DELETE /sender/clearall` — Limpar toda fila de mensagens | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `GET /sender/listfolders` — Listar campanhas de envio | **Backend integrado (escopo parcial)**. Normalização de estados; desconhecido não vira falha. | Listagem real e polling controlado. | Muitas campanhas concorrentes. P1 — concluir homologação CRM. |
| `POST /sender/listmessages` — Listar mensagens de uma campanha | **Backend integrado (escopo parcial)**. Paginação e escopo por organização preservados/corrigidos. | Consulta real dos envios e atualização dos contadores. | Volume representativo e reconciliação prolongada. P1 — concluir homologação CRM. |

### Bloqueios

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `POST /chat/block` — Bloqueia ou desbloqueia contato do WhatsApp | **Backend integrado (escopo parcial)**. Adicionado provider/proxy. | R13: block200 → presença na blocklist → unblock200 → ausência confirmada; estado inicial restaurado. Outra org403. | Interface de bloqueio/desbloqueio no chat TorqueSDR. |
| `GET /chat/blocklist` — Lista contatos bloqueados | **Backend integrado (escopo parcial)**. Adicionado provider/proxy. | R13: consulta antes/depois do bloqueio/desbloqueio real confirma transições. | Lista e gestão de bloqueados na interface. |

### Etiquetas

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `POST /chat/labels` — Gerencia labels de um chat | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /label/edit` — Criar, editar ou deletar etiqueta | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `GET /labels` — Buscar todas as etiquetas | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /labels/refresh` — Iniciar recarga de etiquetas do WhatsApp | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |

### Chats

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `POST /chat/delete` — Deleta chat | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /chat/archive` — Arquivar/desarquivar chat | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /chat/ephemeral` — Configurar mensagens temporárias em chat privado | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /chat/read` — Marcar chat como lido/não lido | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /chat/mute` — Silenciar chat | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /chat/pin` — Fixar/desafixar chat | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /chat/find` — Busca chats com filtros | **Backend integrado (escopo parcial)**. Paginação por totalRecords; filtro de grupos/JIDs corrigido. | Consultas reais usadas no histórico. | Muitas conversas e todas as variantes do fornecedor. P1 — concluir homologação CRM. |
| `POST /chat/notes` — Consultar notas internas do chat | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /chat/notes/refresh` — Recarregar notas internas do chat no WhatsApp | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /chat/notes/edit` — Editar notas internas do chat | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |

### Contatos

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `GET /contacts` — Retorna lista de contatos do WhatsApp | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /contacts/list` — Listar todos os contatos com paginacao | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /contact/add` — Adiciona um contato à agenda | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /contact/remove` — Remove um contato da agenda | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /chat/details` — Obter Detalhes Completos | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `POST /chat/check` — Verificar Números no WhatsApp | **Backend integrado (escopo parcial)**. Verificação de número existente mantida. | Consulta real dos destinatários controlados. | Casos de número inválido/migração/LID adicionais. P1 — concluir homologação CRM. |

### Respostas Rápidas

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `POST /quickreply/edit` — Criar, atualizar ou excluir resposta rápida | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |
| `GET /quickreply/showall` — Listar todas as respostas rápidas | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P2 — avaliar para CRM. |

### Chamadas

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `POST /call/make` — Iniciar chamada de voz | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /call/reject` — Rejeitar chamada recebida | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |

### Integração Chatwoot

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `GET /chatwoot/config` — Obter configuração do Chatwoot | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `PUT /chatwoot/config` — Atualizar configuração do Chatwoot | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |

### Business

| Operação / finalidade | Implementação e sessão | Validação | Falta / prioridade |
|---|---|---|---|
| `POST /business/get/profile` — Obter o perfil comercial | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `GET /business/get/categories` — Obter as categorias de negócios | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /business/update/profile` — Atualizar o perfil comercial | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /business/catalog/list` — Listar os produtos do catálogo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /business/catalog/info` — Obter informações de um produto do catálogo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /business/catalog/delete` — Deletar um produto do catálogo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /business/catalog/show` — Mostrar um produto do catálogo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
| `POST /business/catalog/hide` — Ocultar um produto do catálogo | **Não integrado**. Não implementado na integração UAZAPI do produto; recurso equivalente interno não conta como integração. | Sem validação real registrada nesta sessão. | Implementar contrato, autorização, persistência, UX quando aplicável e testes antes de habilitar. P3 — fora do núcleo CRM. |
