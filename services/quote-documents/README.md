# Serviço de documentos de orçamento

Implementação em desenvolvimento. Não ativar agentes antes dos gates do roadmap.

Serviço interno separado das Edge Functions. O Word é tratado como dados não confiáveis: sem macros, campos executáveis, objetos incorporados, entidades XML, relacionamentos externos ou expressões. Limites: arquivo 5 MiB, ZIP expandido 25 MiB, 300 entradas, 100 produtos, conversão 35 segundos. O serviço não guarda documentos; diretórios temporários são removidos após conversão. Storage e auditoria ficam no CRM.

## Modelo

Campos escalares: `{{customer}}`, `{{address}}`, `{{payment_terms}}`, etc. Chaves ASCII minúsculas com underscore, não notação com pontos. Uma única linha de tabela deve conter `{{items.description}}`, `{{items.quantity}}`, `{{items.unit_price}}`, `{{items.total}}`; opcionais `{{items.code}}` e `{{items.unit}}`. Cabeçalhos e rodapés aceitam campos escalares. Runs divididos pelo Word são suportados.

Os campos `subtotal`, `total`, `freight`, `discount`, `tax`, `extra` são calculados pelo backend e não aceitam totais livres da IA. Entradas monetárias em centavos inteiros; quantidade decimal positiva até três casas, separador ponto. Arredondamento por item, meio centavo para cima. Frete, impostos, extras e descontos precisam ser informados explicitamente, inclusive zero. A origem comercial autorizada ainda precisa ser definida para a Hoppe.

## Operação

Configurar `QUOTE_DOCUMENT_TOKEN` como segredo aleatório com pelo menos 32 caracteres. Nunca commitar o valor. `docker compose up --build -d` inicia o serviço em loopback 8096; colocar atrás de proxy TLS e limitação de taxa/corpo (8 MiB). A rede interna impede saída da aplicação. Confirmar restrição de egress e limites de memória/processos no provedor real, que pode não aplicar todos os atributos do Compose.

Nas Edge Functions: `QUOTE_DOCUMENT_URL=https://<endpoint-interno-autenticado>` e o mesmo `QUOTE_DOCUMENT_TOKEN`. `/health` exige bearer e informa disponibilidade do binário, não comprova conversão. `/inspect` recebe `template` base64; `/render` recebe `template`, `values`, `items`, `convert_to_pdf` booleano. Resposta contém `file` base64 e `format`. Não há fallback silencioso de PDF para Word.

Executar os testes Python com `python -m unittest discover -s services/quote-documents -p 'test_*.py'`. Os testes usam fixtures e simulam a conversão; NÃO substituem conversão real, inspeção de todas as páginas e ensaio de timeout/memória no container.

## Fluxo e segurança

Tool v1 `generate_order_request`: status → save → prepare → confirmação real `CONFIRMO <código>` → generate → send. Alterar o rascunho invalida a confirmação. `send` enfileira `send_quote_document`; o worker resolve destinatário e instância no servidor. Arquivos ficam no bucket privado `copilot-quotes`, nunca na base de conhecimento/RAG.

Estados `sending` ou `reconcile` não permitem reenvio automático. Verificar o provedor e o histórico antes de qualquer intervenção operacional. O status `sent` representa aceite do provedor, não leitura nem entrega comprovada. Pausa humana, agente desligado ou falha na leitura do gate bloqueiam envio. Eventos são gravados transacionalmente em `copilot_quote_events`; logs gerais não recebem valores/corpo do orçamento.

## Pendências antes de produção

- Preparar e aprovar visualmente o Word Hoppe sem dados residuais do exemplo; renderizador local está sem LibreOffice bundled.
- Build e ensaio real do container, proxy TLS, recursos, egress e conversão PDF.
- Definir origem de preços/condições e diferença entre total de produtos e total do exemplo.
- Validar migration, API de permissões e Storage em branch efêmera, regenerar tipos pelo schema e revisar PR.
- Implementar/homologar recuperação assistida de geração interrompida e reconciliação de envio, política de retenção e limpeza de modelos órfãos.
- Homologar conversa completa, acesso de dois tenants, mudanças de configuração durante geração, destinatário e anexo real.
- Reconectar e vincular a instância WhatsApp da Hoppe, hoje desconectada e sem agente associado na consulta desta tarefa.
- Runtime v2 e simulador de conversa ainda não usam esta tool; piloto restrito ao v1 confirmado da Hoppe.

Rollback inicial: desligar a flag da tool no agente e bloquear novos jobs. Não apagar tabelas, auditoria nem documentos enviados. Manter worker capaz de identificar jobs já aceitos/ambíguos até concluir reconciliação. Deploy não foi executado nesta implementação.
# Liberação global em modo de testes

A ferramenta não tem allowlist de organizações. O catálogo é global e cada agente nasce com `can_generate_order_request=false`; importar um modelo não ativa outros agentes.

Envios reais exigem a variável **server-side** `COPILOT_QUOTE_LIVE_SEND_ENABLED=true`. Ausente ou diferente desse valor, tanto o enqueue quanto o worker recusam o envio. Manter ausente nesta fase de simulações; o parâmetro não é controlável pela IA nem pelo navegador.

O chat de simulação expõe a definição da ferramenta configurada, mas não persiste rascunhos nem gera/envia arquivos. A geração de arquivo de teste permanece no botão da configuração, com dados fictícios e sem WhatsApp. O fluxo completo conversa → documento no simulador ainda não está homologado.
