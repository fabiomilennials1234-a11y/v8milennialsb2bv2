/**
 * Página de Política de Privacidade — TorqueCRM
 * Rota pública (sem autenticação) — usada para verificação do OAuth Google
 */

export default function Privacidade() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold mb-2">Política de Privacidade</h1>
          <p className="text-sm text-muted-foreground">
            TorqueCRM · Última atualização: fevereiro de 2026
          </p>
        </div>

        <div className="space-y-8 text-sm leading-relaxed text-muted-foreground">

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Quem somos</h2>
            <p>
              O <strong>TorqueCRM</strong> é uma plataforma de CRM e gestão de equipes
              comerciais desenvolvida pela <strong>Millennials B2B</strong>. Nossa plataforma
              ajuda equipes de vendas a gerenciar leads, compromissos e comunicações com clientes.
            </p>
            <p className="mt-2">
              Website:{" "}
              <a
                href="https://torquecrm.com.br"
                className="text-primary underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                https://torquecrm.com.br
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. Dados coletados</h2>
            <p>Coletamos apenas os dados necessários para o funcionamento da plataforma:</p>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li>Nome, e-mail e informações de perfil para autenticação</li>
              <li>Dados de leads inseridos pela equipe comercial</li>
              <li>
                <strong>Integração Google Calendar:</strong> com sua permissão explícita,
                acessamos seu calendário do Google para criar e gerenciar compromissos
                agendados pela plataforma. Armazenamos seu e-mail Google e tokens de acesso
                de forma criptografada (AES-256) exclusivamente para esta finalidade.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              3. Uso das informações do Google Calendar
            </h2>
            <p>
              O acesso ao Google Calendar é utilizado <strong>exclusivamente</strong> para:
            </p>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li>Criar eventos de reunião no seu calendário quando um compromisso é agendado</li>
              <li>Gerar links do Google Meet automaticamente para as reuniões</li>
              <li>Verificar disponibilidade antes de agendar compromissos</li>
              <li>Sincronizar alterações de eventos feitas no Google Calendar de volta ao CRM</li>
            </ul>
            <p className="mt-3">
              Não compartilhamos dados do seu Google Calendar com terceiros, não utilizamos
              para publicidade e não acessamos outros dados além dos calendários explicitamente
              autorizados.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Como armazenamos seus dados</h2>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li>
                Os dados são armazenados em servidores seguros da{" "}
                <strong>Supabase</strong> (infraestrutura AWS).
              </li>
              <li>
                Tokens de acesso ao Google são criptografados com <strong>AES-256-GCM</strong>{" "}
                antes do armazenamento.
              </li>
              <li>O acesso aos dados é restrito por políticas de segurança em nível de linha (RLS).</li>
              <li>Utilizamos HTTPS em todas as comunicações.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Compartilhamento de dados</h2>
            <p>
              Não vendemos, alugamos ou compartilhamos seus dados pessoais com terceiros,
              exceto quando necessário para operação do serviço (provedores de infraestrutura)
              ou quando exigido por lei.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Seus direitos</h2>
            <p>Você tem direito a:</p>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li>Acessar os dados que armazenamos sobre você</li>
              <li>Corrigir dados incorretos</li>
              <li>
                <strong>Revogar o acesso ao Google Calendar</strong> a qualquer momento nas
                Configurações da plataforma
              </li>
              <li>Solicitar a exclusão da sua conta e todos os dados associados</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Retenção de dados</h2>
            <p>
              Mantemos seus dados enquanto sua conta estiver ativa. Após o encerramento da
              conta, os dados são excluídos em até 30 dias, exceto quando retidos por
              obrigação legal.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Cookies</h2>
            <p>
              Utilizamos apenas cookies essenciais para autenticação e manutenção de sessão.
              Não utilizamos cookies de rastreamento ou publicidade.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Contato</h2>
            <p>
              Para dúvidas sobre esta política ou para exercer seus direitos, entre em contato:
            </p>
            <p className="mt-2">
              <strong>E-mail:</strong>{" "}
              <a
                href="mailto:contato@torquecrm.com.br"
                className="text-primary underline"
              >
                contato@torquecrm.com.br
              </a>
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              10. Alterações nesta política
            </h2>
            <p>
              Reservamo-nos o direito de atualizar esta política periodicamente. Alterações
              significativas serão comunicadas por e-mail ou por aviso na plataforma.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-border text-xs text-muted-foreground/60 text-center">
          © {new Date().getFullYear()} TorqueCRM · Millennials B2B · Todos os direitos reservados
        </div>
      </div>
    </div>
  );
}
