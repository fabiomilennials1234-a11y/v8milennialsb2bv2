# Reconstrução UAZAPI — estado verificável

Atualizado em 2026-09-11. PR draft: https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/pull/2099.

## Ambientes e autorização

- Git `codex/uazapi-rebuild`, base `23cbd6796004113c24684dd394a7e2b2db5114c6` da main.
- Supabase QA `uazapi-rebuild`, ref `qtkohfnephshaxgtzksz`, pai produção `jsjsmuncfkbsbzqzqhfq`.
- CTO confirmou custo US$ 0,01344/h e permanência durante reconstrução. Persistent=true. Exceção explícita ao cleanup por rodada; encerrar cobrança ao finalizar reconstrução.
- TorqueCRM QA e TorqueSDR mantêm identidade da organização/instância autorizadas. Credencial de instância somente no backend; token administrativo não foi necessário nem persistido.
- Destinatário controlado fornecido pelo CTO com autorização para texto/mídia/ações. Identificadores pessoais omitidos dos artefatos.
- Nenhuma alteração de código/schema em produção; webhook remoto da TorqueSDR não foi alterado. Envios de teste saíram da instância real, conforme autorizado.

## Retificação da auditoria inicial

Auditoria inicial usou checkout antigo, não a main atual. PIX, markread, sender, disconnect/delete e proxy regional já tinham correções. Foram preservadas. Inventário antigo não representa produção.

## Implementação

- Criação e conexão separadas, campos documentados, validação de identidade/token antes de persistir credenciais.
- Texto/mídia/menu/PIX compartilham normalização: Pending → queued, messageTimestamp em ms → segundos, identidade/timestamp inválidos falham explicitamente. Aceitação não significa entrega.
- Mídia usa text/docName, download base64Data; menus preservam footerText/listButton/selectableCount. Reação usa text; pin usa pin=true; edição/exclusão usam id documentado.
- Localização, contato, bloqueio/listagem e solicitação de recuperação de histórico implementados no provider. Contatos múltiplos/email múltiplo rejeitados explicitamente na UAZAPI, sem truncamento silencioso.
- Histórico pagina hasMore/nextOffset; chats percorrem totalRecords e excluem JIDs de grupo inconsistentes. Falta de progresso falha explicitamente.
- Hibernação preservada como estado do fornecedor; persistência usa disconnected, sem apagar credenciais. Estados desconhecidos ignorados na atualização da conexão.
- Sender traduz sending → running e completed → completed; estado desconhecido não vira falha terminal silenciosa.
- Monitor usa filtros documentados e conta janela completa localmente. Paginação truncada ou inconsistente retorna desconhecido, impedindo rebind por falsa divergência.
- Webhook aceita chat como objeto, mantém JID de grupo e extrai referência da reação em content.key.ID. Reação atualiza mensagem original, sem disparar nova automação; replay idempotente e compare-and-swap evitam duplicação/perda concorrente.
- Consulta canônica do chat carrega reactions/edited/pinned_at/deleted_at; reação real apareceu após reload. Composer e fallback persistem queued como pending, sem antecipar receipt.
- Ações novas passam pela autorização de conversa; credencial admin deixa de ser exigida para operações com token de instância existente.
- Inventário completo das 139 operações em `docs/integrations/uazapi-capabilities.md`. Há 32 referências literais no backend e 23 operações sondadas. Isso NÃO equivale a 139 recursos de produto implementados.

## Banco isolado

Snapshot somente de schema atual de public/private/backup, obtido por login temporário read-only. Nenhuma tabela de clientes copiada. 334 tabelas públicas, 979 políticas e 1.053 funções públicas, mesmos totais da origem. Metadados de 4.218 colunas coincidem em nome/tipo/nullability/default; lacunas físicas de ordinal de colunas removidas foram excluídas da comparação.

Oito funções continham hostname fixo de produção: substituído pelo hostname QA. Zero referências restantes a esse hostname nas funções inspecionadas; zero crons ativos. Seed mínimo: plano, org QA, instância/credencial, segunda org para teste negativo e usuários Auth sintéticos. Credenciais não acessíveis por anon/authenticated; RPC de credencial também nega authenticated.

Replay automático continua sinalizado MIGRATIONS_FAILED pelo problema preexistente de bootstrap. Restauração manual não equivale a replay completo das migrations e não autoriza merge de banco para produção. Seis blocos DEFAULT ACL de donos da plataforma foram omitidos por permissão; grants explícitos dos objetos existentes foram restaurados. Não replicar grants globais permissivos em novos objetos.

## Homologação real

Evidência sem tokens/conteúdo pessoal: `live-verification-2026-09-11.json` e fixtures estruturais em `tests/fixtures/uazapi/`.

- Texto, imagem, documento e menu aceitos; imagem/documento/menu confirmados Delivered. Downloads de imagem/documento decodificados.
- Áudio, voz PTT, vídeo e figurinha aceitos como queued; consulta posterior confirmou Sent, sem erro.
- Localização e contato aceitos. Localização (0,0) retornou 400 apesar do contrato; coordenadas públicas válidas passaram.
- Edição, reação, pin, unpin, markread e exclusão de mensagem própria de teste aceitos. Markread de mensagem própria não prova receipt visual de uma mensagem recebida.
- Sender: criação, listagem, pausa, retomada (running) e exclusão verificados. Nenhuma pasta agendada de teste deixada ativa.
- Recuperação history reconhecida pelo fornecedor e pelo proxy. Modo exact retornou 404 para mensagem escolhida; não afirmar suporte homologado nem conclusão assíncrona da recuperação.
- Deploy QA de whatsapp-api-proxy, whatsapp-webhook, whatsapp-health-monitor e get-member-permissions.
- JWT real: ausência de sessão 401; outra org 403; admin QA 200. Envio pelo proxy 200/queued. Recuperação inválida 400; recuperação cross-org 403; contato múltiplo e coordenadas inválidas 400.
- SSE capturou envelope real de reação do teste; replay no webhook QA: texto e reação repetidos persistiram uma mensagem e uma reação, DLQ vazia. Segredo incorreto 404. Isso não é reconfiguração nem prova de entrega de webhook remoto diretamente em QA.
- App local em http://127.0.0.1:8099/chat-whatsapp aponta somente para QA, login sintético, caixa TorqueSDR, mensagem e reação de teste renderizaram. Verificação de navegação não equivale a homologação integral de todos os fluxos de interface.

## Verificações de código

224 testes direcionados passaram em 15 arquivos. Deno check passou nos três handlers alterados; corrigidas assinaturas de client genérico que produziam never no webhook. Build passou. Lint ratchet e TypeScript frontend ratchet: zero problemas introduzidos. Suite global comparada anteriormente com main limpa: zero falhas novas; detalhes em `test-comparison.json`. Baselines não ampliados.

## Limites para promover o PR

- PIX: contrato testado; sem envio real de cobrança. Lifecycle disconnect/delete não foi exercitado na TorqueSDR ativa.
- Recuperação exact (404) precisa esclarecimento do fornecedor; history é assíncrono, ainda sem controle dedicado na interface ou ingestão específica de eventos history.
- Certificar recebimento remoto/receipts, reconexão e consumidores indiretos do adapter em ambiente dedicado antes do rollout. Os quatro deploys QA não atualizam automaticamente outras Edge Functions que embutem o adapter.
- As demais capacidades do inventário (grupos, etiquetas, perfil, catálogos, chatbot/integrações administrativas etc.) são lacunas de produto separadas, não escondidas atrás de um proxy genérico.
- PR permanece draft; nenhum merge/deploy em produção autorizado por esta etapa.
