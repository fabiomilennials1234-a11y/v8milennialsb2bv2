# Oráculo — fundação e contrato frontend

Data: 2026-09-08. SCRUM-587 / SCRUM-594. Branch `codex/oraculo-fundacao-tdd`.

Correções: isolamento entre organizações e usuários, plano contratado, teto de ferramentas inválidas, persistência atômica, memória acumulada e telemetria. RPC de gravação usa lock e comparação da versão; conflito definitivo `PT409` após ensaio real revelar timeout com `40001`.

Frontend envia organização selecionada, particiona histórico/cache, preserva histórico ao continuar e ignora respostas atrasadas após trocar conversa. Carregamento e erro de histórico bloqueiam envio até resolução.

Validação: 860 testes backend, 10 frontend, 8 PostgREST/Auth reais. Branches QA removidas; produção não alterada. Replay completo da main bloqueado por preflight herdado SCRUM-639; alvo do QA descrito em `.specs/oraculo/FUNDACAO-TDD.md`. E2E implantado e revisão de drift permanecem pendentes. Aplicar ambas migrations do Oráculo antes de implantar edge function.
