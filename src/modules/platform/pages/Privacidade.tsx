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
            TorqueCRM · Última atualização: junho de 2026
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
              <li>
                <strong>Integração WhatsApp Business (API Oficial da Meta):</strong> quando
                você conecta o seu número de WhatsApp Business pela plataforma, acessamos as
                mensagens trocadas com os seus contatos (conteúdo, números de telefone, nomes
                de exibição e horários), o identificador da sua conta do WhatsApp Business
                (WABA) e do número de telefone, e os tokens de acesso correspondentes —
                armazenados de forma criptografada e usados exclusivamente para enviar e
                receber mensagens em seu nome dentro do CRM.
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
            <h2 className="text-lg font-semibold text-foreground mb-2">
              4. Integração com o WhatsApp Business (API Oficial da Meta)
            </h2>
            <p>
              O TorqueCRM oferece a conexão do seu número de WhatsApp Business por meio da{" "}
              <strong>API Oficial da Plataforma de WhatsApp Business da Meta</strong> (WhatsApp
              Business Cloud API). A conexão é <strong>opcional</strong> e iniciada
              explicitamente por você através do fluxo de cadastro incorporado (Embedded
              Signup) da Meta. Nesse processo atuamos como{" "}
              <strong>Provedor de Tecnologia (Tech Provider)</strong>: as mensagens são enviadas
              e recebidas em seu nome, a partir do seu próprio número.
            </p>
            <p className="mt-3">O acesso ao WhatsApp Business é utilizado <strong>exclusivamente</strong> para:</p>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li>Enviar e receber mensagens entre você e os seus contatos/leads dentro do CRM</li>
              <li>Exibir o histórico de conversas na caixa de entrada da plataforma</li>
              <li>Registrar status de entrega e leitura das mensagens</li>
              <li>Gerenciar modelos de mensagem (templates) aprovados pela Meta</li>
            </ul>
            <p className="mt-3">
              Os dados de mensagens, números, tokens de acesso e identificadores (WABA e número
              de telefone) são armazenados de forma criptografada e isolados por organização.{" "}
              <strong>Não</strong> utilizamos o conteúdo das suas mensagens do WhatsApp para
              publicidade, treinamento de modelos de terceiros ou qualquer finalidade alheia à
              operação do CRM, e <strong>não</strong> os compartilhamos com terceiros além dos
              provedores de infraestrutura estritamente necessários.
            </p>
            <p className="mt-3">
              Você pode <strong>desconectar o WhatsApp a qualquer momento</strong> nas
              Configurações da plataforma; a desconexão revoga o nosso acesso ao seu número.
              O uso da integração observa os{" "}
              <a
                href="https://www.whatsapp.com/legal/business-policy/"
                className="text-primary underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Termos e Políticas de Negócios do WhatsApp
              </a>{" "}
              e as Políticas da Plataforma da Meta.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Como armazenamos seus dados</h2>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li>
                Os dados são armazenados em servidores seguros da{" "}
                <strong>Supabase</strong> (infraestrutura AWS).
              </li>
              <li>
                Tokens de acesso ao Google e ao WhatsApp/Meta são criptografados com{" "}
                <strong>AES-256-GCM</strong> antes do armazenamento.
              </li>
              <li>O acesso aos dados é restrito por políticas de segurança em nível de linha (RLS).</li>
              <li>Utilizamos HTTPS em todas as comunicações.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Compartilhamento de dados</h2>
            <p>
              Não vendemos, alugamos ou compartilhamos seus dados pessoais com terceiros,
              exceto quando necessário para operação do serviço (provedores de infraestrutura)
              ou quando exigido por lei.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Seus direitos</h2>
            <p>Você tem direito a:</p>
            <ul className="mt-2 list-disc list-inside space-y-1">
              <li>Acessar os dados que armazenamos sobre você</li>
              <li>Corrigir dados incorretos</li>
              <li>
                <strong>Revogar o acesso ao Google Calendar</strong> a qualquer momento nas
                Configurações da plataforma
              </li>
              <li>
                <strong>Desconectar o WhatsApp Business</strong> a qualquer momento nas
                Configurações da plataforma
              </li>
              <li>Solicitar a exclusão da sua conta e todos os dados associados</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Retenção de dados</h2>
            <p>
              Mantemos seus dados enquanto sua conta estiver ativa. Após o encerramento da
              conta, os dados são excluídos em até 30 dias, exceto quando retidos por
              obrigação legal.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Cookies</h2>
            <p>
              Utilizamos apenas cookies essenciais para autenticação e manutenção de sessão.
              Não utilizamos cookies de rastreamento ou publicidade.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. Contato</h2>
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
              11. Alterações nesta política
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
