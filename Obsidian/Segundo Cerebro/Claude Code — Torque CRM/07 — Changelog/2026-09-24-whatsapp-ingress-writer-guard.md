# Guarda de rotas do piloto WhatsApp — 2026-09-24

Guarda central e no adapter impede criação/reconfiguração legada para UUIDs
explicitamente protegidos; lista vazia por padrão. Proxy retorna409 sanitizado,
rebind registra skip sem afirmar sucesso/verificação. Configuração inválida
falha fechado. Envio, status e conexão preservados.

Testes incluem provider/handlers reais com transporte controlado, autenticação
negativa e ausência de qualquer escrita para instância protegida. Patch preparado
sobre bundles vivos anteriores à políticaSQL28, preservando dependências e
funcionalidades ainda não publicadas. Versões e ativação ficam registradas no PR.

Não habilita ingresso dedicado nem muda rotas do fornecedor. Economia nova não
contabilizada; próxima etapa exige serviço/SQL29, capacidade e recuperação antes
da troca controlada de tráfego.
