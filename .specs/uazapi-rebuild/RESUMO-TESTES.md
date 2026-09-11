# UAZAPI — resumo consolidado dos testes

Atualizado em 11/09/2026. Branch `codex/uazapi-rebuild`, PR #2099 em draft. QA Supabase persistente; instância real TorqueSDR, apenas destinatários autorizados. Sem deploy de código/schema em produção e sem alteração do webhook remoto.

## Cobertura comprovada

| Área | Testes | Evidência / resultado |
| --- | --- | --- |
| Documentação | Inventário de 139 operações, campos, respostas e paginação | OpenAPI 2.1.1; inventário completo não equivale a 139 funcionalidades homologadas |
| Texto e menus | Envios reais via provider, node e compositor | Aceitos; entrega e leitura confirmadas entre dois números |
| Imagem e documento | Enviar, consultar, baixar e persistir | Imagem/documento entregues; downloads decodificados; imagem enviada e recebida carregadas no chat |
| Áudio e voz | Áudio comum e PTT | Aceitos e posteriormente Sent; reprodução/transcrição completa não homologadas nesta rodada |
| Vídeo | Envio e consulta | Aceito e posteriormente Sent; reprodução completa no front não homologada |
| Figurinha | Envio, download, Storage e renderização | Enviada; download WebP 200; imagem carregada no navegador após configurar bucket media no QA |
| Localização e contato | Envio e validação de parâmetros | Chamadas aceitas; coordenadas inválidas/contatos múltiplos recusados. (0,0) falhou no fornecedor; coordenadas válidas passaram |
| Ações de mensagem | Editar, reagir, fixar/desfixar, marcar leitura, apagar mensagem própria | Chamadas aceitas; reação persistida e visível. Markread inicial usou mensagem própria, não prova leitura pelo cliente |
| Sender | Criar, listar, pausar, retomar, consultar e excluir campanha | Estados conferidos; pastas de teste removidas. Intervalo exato entre entregas não medido |
| Quick Blast | Preview, criação, polling, conclusão e isolamento | Uma mensagem enviada, zero falhas; cleanup removeu pasta e marcou job cancelled após conclusão |
| Mass Send | Sessão, organização e limiar | 401 sem sessão; 403 entre organizações; 400 abaixo do limiar. Não foi disparado lote de 50 destinatários |
| Nodes | Texto/lista reais, demais handlers em testes automatizados | Tracking, rótulo de lista, destinatário e template por organização, persistência sem regredir recibos |
| Grafo de workflow | Motor real: trigger → texto → lista → end | Banco/provider reais em QA; execução completed, quatro passos registrados. Worker de cron/publicação pelo editor ainda não homologados |
| Respostas recebidas | Seleções reais por segundo aparelho | fromMe=false, tipo list_response, conteúdo Validar/Concluir, status received |
| Webhook e replay | Envelope real, repetição de texto/reação, segredo inválido | Sem duplicação nos casos testados; segredo incorreto 404; DLQ vazia na verificação registrada |
| Chat | Compositor, respostas, recibos, reações, imagens, figurinha e lista lateral | Entrada à esquerda; seleção identificada; títulos legíveis; entrega/leitura; overflow lateral corrigido |
| Histórico consultável | Paginação, cursores, filtro de grupos e progresso de páginas | Contratos automatizados e consultas reais; guardas contra truncamento/inconsistência |
| Recuperação de histórico | history e exact | history reconhecido. exact: 404 no primeiro caso; 200/success no segundo chat com ambos os IDs. Recuperação de mensagem ausente e conclusão assíncrona ainda não comprovadas |
| Segurança | JWT, org, segredo, credenciais e RPC | Bloqueios positivos/negativos confirmados; credenciais fora do frontend/Git |
| Ambiente | Schema, isolamento, URLs internas e cron | Schema QA comparado com origem; sem dados comerciais copiados; referências fixas redirecionadas; zero cron ativo |
| Qualidade | Suíte direcionada ampliada | 645 testes em 50 arquivos. Deno, build e ratchets frontend aprovados nas mudanças correspondentes; baselines não ampliados |

## Falhas encontradas e tratadas

- Campos de mídia, reação, menus, pin e identidade normalizados conforme contrato.
- Delay de sender convertido de ms do CRM para segundos do fornecedor.
- Agendamento inválido rejeitado antes de produzir disparo imediato.
- Erro temporário de polling não terminaliza campanha.
- Aceitação Pending permanece pendente; eco/recibos avançam sem regredir entrega/leitura.
- Persistência do node não sobrescreve conteúdo nem recibos anteriores.
- Lead/template de outra organização não são usados no envio.
- Seleção de lista mostra título em vez de ID técnico; tipos canônicos e legados renderizam.
- Preview longo não alarga a lista de conversas (280px de viewport; scrollWidth passou de 670px para 280px).
- QA estava sem bucket media: configuração reproduzida, arquivo WebP persistido e figurinha renderizada.
- Helper de persistência aceita base64Data da UAZAPI e base64 legado; atualização de URL filtra organização.

## Pendências reais

- Worker de fila/cron, publicação pelo editor e variantes avançadas do grafo (espera de resposta, reentrada e retries em ambiente real).
- Card completo das opções do menu enviado; recuperação de histórico com progresso/retomada na interface.
- Provar recuperação de mensagem ausente e término do sync assíncrono, além do acknowledgement.
- Reprodução/transcrição ponta a ponta de áudio e vídeo; PIX real.
- Reconectar/desconectar/excluir somente em instância dedicada; não exercitado na TorqueSDR ativa.
- Homologar todos os consumidores que embutem o adapter antes do rollout.
- Bootstrap automático do Supabase ainda sinaliza MIGRATIONS_FAILED: schema foi restaurado manualmente. Não promover banco como se todas as migrations tivessem sido reproduzidas.
- QA apresentou erros em convite/upsell fora do fluxo testado; não tratados como sucesso do sistema inteiro.
- CI remoto e review antes de promoção. Nenhuma autorização de produção inferida dos testes.

## Evidências

- `live-verification-2026-09-11.json`: primeira rodada.
- `live-verification-round2-2026-09-11.json`: disparos, nodes e chat real entre dois números.
- `live-verification-round4-2026-09-11.json`: grafo, figurinha e novo teste exact.
- `../../docs/integrations/uazapi-capabilities.md`: inventário e recursos prioritários.

Transporte QA dos eventos reais: SSE filtrado por destinatário autorizado e replay no webhook QA. Isso não configura nem homologa a entrega HTTP direta do webhook remoto para QA. Payloads brutos, telefones e tokens não acompanham estas evidências no Git.
