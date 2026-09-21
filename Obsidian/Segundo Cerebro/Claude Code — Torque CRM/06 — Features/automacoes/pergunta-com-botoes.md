# Pergunta com botões — implementação candidata

Node exclusivo de automações WhatsApp, `question_buttons`. Não altera contratos de nodes Copilot. Uma mensagem com até três opções, cada ID estável ligado a uma saída; alternativas `other_response`, `timeout` e `send_failure`. Imagem fixa opcional armazenada em bucket privado.

Ocorrência e definição congeladas antes do HTTP. Fila serializa organização, instância e telefone somente enquanto a pergunta estiver pendente. Primeiro ingresso durável elegível vence, com locks compartilhados com timeout. Prazo começa no aceite original do provedor. Envio incerto nunca autoriza reenvio; consultas limitadas por ocorrência e instância recuperam o aceite ou mantêm incerteza explícita.

Ativação valida referências e conexões no servidor. Importação exige reconectar instância/imagem; duplicação local preserva o ativo. Histórico projeta apenas estado e resultado após autorização. Excluir instância preserva ocorrências/ingressos, evitando execução órfã.

Gate: `organizations.feature_flags.workflow_question_buttons`, desligado por padrão. Desligar impede novos snapshots; execuções já congeladas continuam. Migrations devem preceder publicação do webhook/worker; sem RPCs, ingresso devolve erro recuperável.

Estado em 2026-09-21: candidato local, testes unitários e contratos transacionais no banco de produção com rollback. Texto/imagem reais confirmados pelo CTO em TorqueSDR; ainda não comprovam jornada implantada completa. Não habilitar para todas as organizações com base nesses testes. Matriz Android/iOS/Web/Desktop permanece sem cobertura completa.

Fontes: `.specs/pergunta-com-botoes/` e `tests/integration/workflow-buttons/README.md`. PRD #2141; tickets #2142–#2150. Nenhum ticket encerrado por esta nota.


## Atualização do piloto

Backend implantado em produção sob autorização do CTO: migrations 60–68, webhook v107, worker v163, imagem v1. Um snapshot de teste autorizado na TorqueSDR recebeu aceite com imagem privada; aguardando resposta. Gate geral permanece desligado; frontend não publicado. PR #2153 em draft. Actions bloqueado por cobrança/limite antes de iniciar jobs. Detalhes e estado atual em `.specs/pergunta-com-botoes/implementacao-tdd.md` e evidências de deploy/piloto.
