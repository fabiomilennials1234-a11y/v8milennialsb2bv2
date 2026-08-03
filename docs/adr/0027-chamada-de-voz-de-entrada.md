# A ligação que entra toca para quem tem acesso ao número

**Status:** accepted (2026-08-03)
**Estende:** [ADR-0024](./0024-torquecalls-voice-call-plane.md) (plano de chamada) · [ADR-0025](./0025-instance-routing-policy.md) (a instância decide) · [ADR-0026](./0026-gravacao-de-chamada-na-vps.md) (gravação)

## Context

O TorqueCalls liga para fora desde 2026-08-02, e desde 2026-08-03 grava. Mas quando **o cliente liga**, o CRM não sabe de nada: a ligação toca no celular pareado e desaparece. Não vira histórico, não vira duração, não vira gravação — e ligação perdida não existe como informação.

A VPS já recebe a oferta. `onIncomingOffer` (`cmd/server/session.go:148`) cria o gerenciador de chamada, respeita o teto de simultâneas e sabe recusar (`rejectOffer`). O CRM também já foi desenhado para isto: `CallDirection` tem `"inbound"`, `fn_voip_call_reserve` aceita direção de entrada, e existe o ato `call.accept` no token.

**O encanamento existe; faltam as pontas.** Ninguém avisa o CRM, ninguém cria a linha da chamada (a RPC do webhook só *atualiza*), e não há tela de atender — o `useVoiceCall` inteiro é construído em torno de discar.

Medições que informaram as decisões:

- **427 de 914 contatos** dos últimos 90 dias **não têm lead** (47%). Ligação de número desconhecido não é caso raro.
- **1.199 de 1.533 leads** têm responsável definido (78%).
- **4 vendedores ativos** na organização de teste, **1 número com voz**, e a lista de acesso dele está **vazia**.
- A instância "sdr" tem **4 vendedores** na lista e voz desligada — é o caso real que a feature vai atender.

## Decisões

1. **Toca para quem tem acesso à instância — a mesma lista que o inbox usa.**

   `whatsapp_instance_allowed_members`, sem conceito novo. Lista vazia significa **toda a organização**, exatamente como nas mensagens.

   Avaliada e recusada a alternativa "exigir lista explícita para receber", com o argumento de que receber é mais intrusivo que ver: **uma regra só no produto ganha** de uma regra que é quase igual mas não é. Duas regras parecidas se confundem no primeiro suporte.

   Também recusado tocar pelo **responsável do lead**: quem liga pode não ter lead (47% dos contatos), e o número é da empresa, não do vendedor.

   **Isto inverte o papel do gate do ADR-0025.** Na saída ele pergunta *"este vendedor pode usar este número?"*; na entrada ele responde *"quem deve ser chamado?"*. Mesma tabela, pergunta diferente — e é por isso que ele funciona quando ainda não há operador.

2. **Registrar E atender no CRM**, não só registrar.

   O caminho mais barato — anotar a ligação e continuar atendendo pelo celular — foi avaliado e recusado por decisão do CTO. O vendedor atende com o contexto do lead na tela.

3. **O CRM toca enquanto o WhatsApp mantiver a chamada viva. Sem prazo próprio.**

   Recusado um temporizador do CRM (30 s) por dois motivos: ele exigiria calibração, e — na variante que **recusa** a chamada — mataria o atendimento pelo celular, deixando um temporizador do CRM decidir por quem está com o telefone na mão.

   **O CRM nunca recusa a oferta.** Ele desiste de tocar quando o WhatsApp desiste; a decisão de recusar é do WhatsApp ou do humano, nunca de um prazo nosso.

4. **Número sem lead: registra a ligação, não inventa cadastro.**

   `lead_id` nulo, vínculo por telefone. Se o lead nascer depois, a ligação antiga aparece nele — a mesma regra do chat, onde **84,5% das mensagens não têm `lead_id`**.

   Recusada a criação automática de lead: com 47% dos contatos sem cadastro, produziria centenas de leads sem nome nem origem — engano, entregador e fornecedor incluídos —, e poluir funil é difícil de desfazer.

5. **Voz desligada: o CRM não toca e não oferece atender, mas REGISTRA que a ligação entrou.**

   O interruptor é do CRM, não do WhatsApp: o celular toca de qualquer jeito. Que o cliente ligou é fato do **relacionamento**, não da feature — e vale no histórico mesmo para quem não usa voz pelo CRM, pela mesma lógica que registra mensagem recebida que ninguém respondeu.

   Recusado um segundo interruptor só para entrada: mais uma chave para explicar, esquecer ligada ou desligada, num produto onde a única instância com voz nem tem lista preenchida.

## Consequências

- **`fn_voip_apply_vps_event` passa a CRIAR linha**, e hoje ela só atualiza. É a mudança mais delicada da fatia: essa função é o coração do webhook e carrega 87 asserções. Criar na entrada não pode abrir caminho para criar na saída, onde a criação já tem dono (`fn_voip_call_reserve`).

- **A máquina de fases inverte.** Hoje ela começa em "pedindo microfone" e vai para "autorizando" — discar. Receber é o caminho oposto: chega um aviso, o operador aceita, e **só então** o microfone é pedido. O guardião de exaustividade posto em 2026-08-02 já protege isso: fase nova sem classificar **reprova a compilação**.

- **A perna estéreo se inverte na gravação.** No ADR-0026 o operador fica à esquerda e o lead à direita. Isso tem de continuar verdadeiro na entrada, onde os papéis chegam trocados — senão "vendedor à esquerda" vira mentira e a análise de fala mede a pessoa errada.

- **Celular e CRM tocam juntos, e isso é aceito.** O protocolo do WhatsApp resolve a corrida: quem atender primeiro leva, os outros param. Não é conflito.

- **Quem não estiver com o CRM aberto não recebe.** Limitação natural do desenho, registrada para ninguém a descobrir na prática.

- **Quem atender vira o operador da chamada** — e daí decorrem, de graça, o gate de gravação ("o vendedor ouve as próprias", ADR-0026) e o histórico atribuído.

## Fora de escopo, explicitamente

- **Notificação fora do CRM** (celular, área de trabalho) — hoje só toca para quem está com a tela aberta.
- **Fila ou distribuição inteligente** entre vendedores — todos da lista tocam ao mesmo tempo.
- **Horário de atendimento** — a ligação toca a qualquer hora.
- **Transcrição**, que continua sendo a fase 2 da gravação.
