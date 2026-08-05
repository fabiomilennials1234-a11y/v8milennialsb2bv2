# A gravação de chamada mora na VPS, dentro do processo de voz

**Status:** accepted (2026-08-02)
**Supera parcialmente:** [ADR-0024](./0024-torquecalls-voice-call-plane.md) — a recomendação de processo separado para gravação

## Context

O vendedor liga pelo TorqueCalls, conversa, desliga — e o que foi dito desaparece. O gestor dá feedback sobre o que o vendedor **conta** que aconteceu; o vendedor, que é quem mais aprenderia se pudesse se ouvir, nunca se ouve.

Depois do S11 e do S13 (ambos em produção nesta data), o CRM sabe **que** a ligação aconteceu e **quanto** durou. Medido: 14 chamadas, 2 atendidas, 122 s de média. Continua sem saber **o que foi falado** — `call_logs` com desfecho e duração é recibo, não registro.

A infraestrutura já estava pronta e ociosa: o áudio das duas pontas atravessa a VPS em PCM cru (`OnBrowserPCM` traz o microfone do vendedor; o caminho de saída leva a voz do lead), e `call_logs.recording_url` existe vazio desde que a tabela foi criada.

O ADR-0024 registrou, ao decidir o plano de chamada: *"Sob qualquer licença, gravação e transcrição exigem processo separado. Isso é custo de arquitetura, não só de licença — e também é a versão boa (falha isolada, deploy e escala distintos)."*

## Decisões

1. **A gravação mora na VPS, e não no navegador.**

   O navegador foi avaliado a sério: `MediaRecorder` sairia de graça, já em opus, sem uma linha de codec e sem CPU na VPS — que tem 8,8% de steal time. Foi recusado por um motivo de produto, não técnico: a amostra passaria a depender de o vendedor manter a aba aberta.

   **Gravação que depende de disciplina humana produz a mesma amostra enviesada que gravação sob demanda produziria** — e a ligação que mais ensina é justamente a que o vendedor não teria gravado. O propósito é treino; treino com amostra escolhida pelo avaliado não é treino.

2. **Isto supera a recomendação de processo separado do ADR-0024.** Antifalhas ganhou de isolamento de processo, por decisão do CTO. Fica explícito que é troca, não descuido: aceita-se `libopus` e CPU de encoding dentro do binário que serve as chamadas, em troca de gravação que não depende da máquina do vendedor.

3. **O que sobra do ADR-0024 vira requisito duro: falha na gravação NÃO pode derrubar a chamada.** Encoding em goroutine própria, com recuperação de pânico. Gravação que morre deixa a voz viva. A ligação é o produto; a gravação é o registro dela.

   Esta é a parte do isolamento que continua valendo, e é o preço de aceitar a decisão 2.

4. **Opus, estéreo — vendedor à esquerda, lead à direita.**

   A VPS só tem `mlow`, o codec do WhatsApp, que não toca em navegador. Entra `libopus`.

   O estéreo custa o mesmo em bytes e preserva informação que já está disponível de graça: as duas pernas chegam separadas, e somá-las seria descartá-la. Dela saem percentual de fala por pessoa, interrupções, e — na fase de transcrição — falante identificado sem adivinhação.

   Ordem de grandeza que sustentou a escolha do codec, no cenário de 10 vendedores × 20 ligações/dia × 3 min: PCM cru daria **~600 GB/ano**; opus dá **~2,4 GB/ano**. Hoje os dois são irrelevantes (2 ligações atendidas); a diferença só morde ao escalar, e migrar acervo depois é pior que codificar desde já.

5. **O transporte reusa o S11, sem superfície nova.** A gravação é mais um evento no envelope assinado que já está em produção. A autenticação do download reusa o par de chaves no sentido CRM→VPS: o CRM cunha, a VPS verifica.

   **A VPS continua sem qualquer credencial de escrita no Supabase** — é o CRM que puxa, nunca a VPS que empurra. A assimetria é deliberada: uma ponta comprometida não escreve na outra.

6. **Grava toda ligação, automaticamente — mas só persiste se houve atendimento.** Ligação que ninguém atendeu não tem conversa. Como isso só se sabe no fim, o buffer roda sempre e a escrita acontece no encerramento.

7. **Ouvem: admin e gestor (todas da organização) e o vendedor (só as próprias).** Colega não ouve colega.

   Isto **diverge de propósito** de `voip_can_see_call`, que amarra visibilidade ao lead: um lead reatribuído faria o vendedor perder a gravação da ligação que ele mesmo fez. Material de treino pertence a quem o produziu.

   O vendedor ouvir a si mesmo é o que faz a gravação virar autocorreção em vez de vigilância.

8. **O áudio vive 90 dias; o texto, quando existir, é permanente.**

   Retenção não foi decidida por custo — com opus, guardar três anos custa quase o mesmo que três meses. Foi decidida por passivo: ligação de seis meses atrás não treina ninguém, e não se acumula acervo que ninguém revisa. **O expurgo apaga o objeto no armazenamento, não só a referência** — senão "90 dias" é intenção, não fato.

9. **Sem aviso ao lead, por ora — e cada gravação carimba sob qual regime nasceu.**

   Decisão do CTO. O carimbo é o que impede "por ora" de virar permanente por omissão: se a política mudar, as gravações antigas continuam distinguíveis das novas, em vez de formarem um acervo indistinguível.

   Registrado explicitamente: gravação sem aviso sustenta o uso de treino interno com risco assumido, e **enfraquece** o uso de "registro do que foi combinado" como prova. A decisão é reversível para a frente e irreversível para trás — áudio já gravado não ganha base depois.

## Consequências

- **O binário de voz ganha uma dependência de codec e CPU de encoding.** Se o encoding se mostrar caro sob concorrência, a saída não é remover a gravação: é mover o encoding para fora do processo, que é para onde o ADR-0024 apontava. A decisão 3 mantém essa porta aberta, porque a gravação já é isolada por goroutine.

- **Transcrição fica muito mais barata depois.** O estéreo entrega falante identificado de graça; sem ele, seria diarização por heurística, que erra.

- **O acervo nasce sem aviso.** É passivo assumido, limitado pelos 90 dias e rastreável pelo carimbo de regime.

- **Nada disto funciona sem S11 e S13**, que são pré-requisitos vivos: sem o webhook não há evento por onde a gravação chegar; sem `call_logs` não há linha onde o endereço morar.

## Rejeitados explicitamente

- **Gravar no navegador** — amostra dependente de aba aberta (decisão 1).
- **Gravar sob demanda, o vendedor apertando um botão** — o avaliado escolhe o que o gestor vê, e a ligação que ensina é a que ele não grava.
- **PCM/WAV cru com compressão adiada** — evita a dependência de codec hoje, mas cria migração de acervo depois, e 600 GB/ano no cenário cheio.
- **Guardar os frames `mlow` como chegam** — pequeno e sem CPU, mas só o Go decodifica, e as duas pernas ficariam em formatos diferentes.
- **Mono, as duas vozes somadas** — descarta de graça informação que já se tem.
- **Herdar `voip_can_see_call` para decidir quem ouve** — consistência de graça, mas o vendedor perderia a própria gravação quando o lead fosse reatribuído.
