---
tags:
  - torque-crm
  - moc
  - arquitetura
created: 2026-04-14
last_updated: 2026-04-14
status: active
---

# MOC - Arquitetura

**Resumo**: Mapa de conteudo para tudo relacionado a arquitetura, stack, decisoes tecnicas e estrutura do sistema Torque CRM.

## Visao de Alto Nivel

- [[Visao Geral]] - Stack, multi-tenancy, design system, autenticacao
- [[Modulos]] - 46+ pages, 122+ hooks, 78+ edge functions mapeados
- [[Integracoes]] - 9+ servicos externos (Evolution, Meta, TinyERP, Asaas, n8n, etc.)
- [[Arquitetura 3 Camadas]] - Diretivas → Orquestracao → Execucao

## Decisoes e Specs

- [[ADR-2026-04-12-arquitetura-inicial]] - 9 decisoes arquiteturais documentadas
- [[Project PROJECT]] - Visao do projeto (specs)
- [[Project STATE]] - Estado atual do projeto

## Specs do Codebase

- [[Specs/ARCHITECTURE]] - Documento de arquitetura formal
- [[Specs/STACK]] - Stack tecnologica detalhada
- [[Specs/STRUCTURE]] - Estrutura de pastas
- [[Specs/CONVENTIONS]] - Convencoes de codigo
- [[Specs/INTEGRATIONS]] - Mapa de integracoes
- [[Specs/TESTING]] - Estrategia de testes
- [[Specs/CONCERNS]] - Preocupacoes e riscos

## Infraestrutura

- [[Supabase Setup]] - Configuracao Supabase
- [[OpenRouter Setup]] - Configuracao LLM provider
- [[Analise Logging SaaS]] - Sistema de logging multi-tenant
- [[Resumo Logging SaaS]] - Resumo do logging

## Seguranca

- [[Revisao Seguranca]] - Auditoria de seguranca
- [[Permissoes Sistema]] - RBAC 4 camadas
- [[Guia Erro 500]] - Troubleshooting RLS

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Operacional]]
- [[MOC - Features]]
- [[Relatorio Abril]]
