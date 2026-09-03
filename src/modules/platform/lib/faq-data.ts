/**
 * Conteúdo do FAQ (Central de Ajuda) do Torque CRM.
 *
 * Perguntas rotineiras dos usuários, agrupadas por categoria. O campo `icon`
 * guarda o nome de um ícone lucide-react (PascalCase) resolvido em runtime pela
 * página Faq via FAQ_ICON_MAP. Conteúdo editável por humano — sem dependência de
 * backend.
 *
 * Gerado a partir da documentação do produto (workflow torque-faq-content).
 */

export interface FaqItem {
  question: string;
  answer: string;
  /** Termos extras usados pela busca (além de pergunta + resposta). */
  keywords?: string[];
}

export interface FaqCategory {
  /** slug kebab-case — usado como id de âncora e key. */
  id: string;
  title: string;
  /** Subtítulo curto da categoria. */
  description: string;
  /** Nome de um ícone lucide-react (PascalCase). Fallback: HelpCircle. */
  icon: string;
  items: FaqItem[];
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    "id": "conta",
    "title": "Conta, login e equipe",
    "description": "Como acessar sua conta, gerenciar a equipe e alternar entre organizações.",
    "icon": "Users",
    "items": [
      {
        "question": "Como faço para entrar no Torque?",
        "answer": "Acesse a tela de login e entre com seu email e senha. Sua conta é criada quando você aceita o convite da sua empresa. Se ainda não recebeu acesso, peça ao administrador da sua organização para te convidar.",
        "keywords": [
          "login",
          "entrar",
          "email e senha",
          "acesso",
          "convite"
        ]
      },
      {
        "question": "Esqueci minha senha. Como recupero o acesso?",
        "answer": "Na tela de login, use a opção de recuperar senha: você recebe um link por email para criar uma nova. Se o email não chegar, o administrador ou o suporte também conseguem disparar uma nova senha para você.",
        "keywords": [
          "recuperar senha",
          "esqueci a senha",
          "redefinir",
          "reset de senha",
          "email"
        ]
      },
      {
        "question": "Como convido um novo membro para a equipe?",
        "answer": "Vá em Configurações (Pitstop) e abra a área de Equipe para enviar o convite. Apenas administradores gerenciam a equipe. Cada organização tem um limite de usuários conforme o plano, então, se o convite não passar, pode ser que você tenha atingido esse limite.",
        "keywords": [
          "convidar membro",
          "adicionar usuário",
          "equipe",
          "limite de usuários",
          "admin"
        ]
      },
      {
        "question": "Como troco de organização dentro do sistema?",
        "answer": "Se você participa de mais de uma organização, use o seletor de organização no topo da tela para alternar entre elas. Cada organização tem seus próprios leads, funis e equipe, separados das demais, então confirme em qual você está antes de começar a trabalhar.",
        "keywords": [
          "trocar de organização",
          "alternar org",
          "multi-empresa",
          "seletor"
        ]
      },
      {
        "question": "Qual a diferença entre admin e membro? E onde entram SDR e Closer?",
        "answer": "Existem dois níveis de acesso: administrador (acesso total à organização) e membro (acesso ao dia a dia de leads e atendimento). Admins cuidam de equipe, integrações e configurações. Já SDR e Closer não são níveis de acesso, são apenas rótulos para indicar a função da pessoa nos leads.",
        "keywords": [
          "papéis",
          "admin",
          "membro",
          "permissões",
          "SDR",
          "Closer"
        ]
      },
      {
        "question": "Por que não consigo acessar uma tela ou ação que um colega usa?",
        "answer": "O acesso é controlado por permissões. Além do seu nível (admin ou membro), o administrador pode ligar ou desligar recursos e definir o que cada um pode fazer, como criar ou excluir leads. Se algo aparece bloqueado para você, peça ao admin para ajustar sua permissão.",
        "keywords": [
          "permissões",
          "acesso bloqueado",
          "não consigo acessar",
          "admin"
        ]
      },
      {
        "question": "Como mudo minha foto de perfil e meus dados de conta?",
        "answer": "Abra as configurações do seu perfil pelo menu do seu usuário para atualizar foto, nome e demais dados pessoais. Mudanças de nível de acesso e permissões continuam sendo feitas pelo administrador.",
        "keywords": [
          "foto de perfil",
          "perfil",
          "dados da conta",
          "editar perfil"
        ]
      }
    ]
  },
  {
    "id": "whatsapp",
    "title": "WhatsApp e conexão de número",
    "description": "Como conectar, reconectar e organizar os números de WhatsApp da sua equipe.",
    "icon": "Smartphone",
    "items": [
      {
        "question": "Como conecto meu número de WhatsApp ao Torque?",
        "answer": "Vá em Configurações (Pitstop) e abra a área de WhatsApp. Crie uma nova conexão e o sistema mostra um QR code na tela. No celular, abra o WhatsApp, vá em Aparelhos conectados e escaneie o código. Em poucos segundos o número fica online e já envia e recebe mensagens pelo Chat.",
        "keywords": [
          "conectar",
          "QR code",
          "WhatsApp",
          "configurações"
        ]
      },
      {
        "question": "Meu número caiu. Como reconecto?",
        "answer": "Isso costuma acontecer quando o celular fica sem internet ou desliga. Vá em Configurações > WhatsApp, encontre o número que aparece como offline e gere um novo QR code para escanear de novo. Mantenha o celular ligado, com internet e com o WhatsApp aberto para evitar quedas.",
        "keywords": [
          "desconectou",
          "caiu",
          "reconectar",
          "offline",
          "QR code"
        ]
      },
      {
        "question": "O que significam os status online, offline e desconectado?",
        "answer": "Online quer dizer que o número está ativo e pronto para enviar e receber mensagens. Offline indica que a conexão caiu temporariamente, geralmente por falta de internet no celular, e pode voltar sozinha. Desconectado significa que a sessão foi encerrada e você precisa gerar um novo QR code.",
        "keywords": [
          "status",
          "online",
          "offline",
          "desconectado"
        ]
      },
      {
        "question": "Posso conectar mais de um número na mesma conta?",
        "answer": "Sim. Cada número é uma conexão separada dentro da organização. A quantidade que você pode conectar depende do seu plano. Se atingiu o limite e precisa de mais números, fale com o administrador ou faça upgrade do plano.",
        "keywords": [
          "vários números",
          "múltiplos",
          "limite",
          "plano"
        ]
      },
      {
        "question": "Quem da equipe pode usar cada número?",
        "answer": "Cada número tem uma lista de membros liberados. Nas configurações da conexão você define quais vendedores podem enviar mensagens por aquele número. Isso evita que todos usem o mesmo número e ajuda a organizar o atendimento por pessoa ou por time.",
        "keywords": [
          "quem pode usar",
          "membros",
          "permissão",
          "equipe"
        ]
      },
      {
        "question": "Preciso deixar o celular ligado para o WhatsApp funcionar?",
        "answer": "Sim. A conexão funciona como o WhatsApp Web, então o celular precisa ficar ligado, com internet e com o WhatsApp ativo para manter a conexão estável. Se o aparelho ficar muito tempo offline, a sessão pode cair e você terá que reconectar com um novo QR code.",
        "keywords": [
          "celular ligado",
          "internet",
          "conexão",
          "estabilidade"
        ]
      },
      {
        "question": "Conectei o número, mas as mensagens antigas não aparecem. É normal?",
        "answer": "Sim. Ao conectar, o Chat passa a receber as conversas novas a partir dali. Para trazer o histórico anterior, use a opção de sincronizar histórico nas configurações do WhatsApp; ela roda em segundo plano e mostra o progresso.",
        "keywords": [
          "histórico",
          "mensagens antigas",
          "sincronização",
          "conversas"
        ]
      },
      {
        "question": "Meu número foi banido ou bloqueado pelo WhatsApp. O que eu faço?",
        "answer": "Primeiro, entenda o motivo: quase sempre o bloqueio vem de disparo em massa sem cuidado, de muitas denúncias de clientes ou do uso de um número novo e \"frio\" para muito volume. Para voltar a operar rápido, troque a conexão para um número reserva que você já mantém aquecido — assim o atendimento não para. Em paralelo, tente recuperar o número banido pelo próprio WhatsApp (no app, em Ajuda, peça a revisão): isso pode levar de horas a dias e nem sempre é aceito. Se os banimentos se repetem por causa de volume, a solução definitiva é migrar para a API Oficial do Meta.",
        "keywords": [
          "banido",
          "bloqueado",
          "número banido",
          "recuperar número",
          "número reserva",
          "aquecido",
          "API oficial"
        ]
      },
      {
        "question": "Como evito que meu número de WhatsApp seja banido?",
        "answer": "Aqueça números novos: comece com pouco volume e aumente aos poucos, tendo conversas de verdade antes de sair disparando. Nos disparos, use o plano de lote em vez de mandar tudo de uma vez, personalize as mensagens (evite texto idêntico em massa) e fale só com quem tem relação com você ou pediu contato — listas frias e compradas são o caminho mais rápido para a denúncia. Responder às conversas também ajuda: número que só dispara e nunca recebe resposta chama atenção. E mantenha sempre um número reserva aquecido de prontidão para assumir se o principal cair.",
        "keywords": [
          "evitar banimento",
          "aquecer número",
          "prevenção",
          "plano de lote",
          "não ser bloqueado"
        ]
      },
      {
        "question": "Qual a diferença entre conectar por QR code e usar a API Oficial do Meta?",
        "answer": "A conexão por QR code é a padrão do Torque: gratuita, rápida e usa o seu número como no WhatsApp Web. É ótima para atendimento e volume moderado, mas fica sujeita a bloqueio se você exagerar nos disparos. A API Oficial do Meta (WhatsApp Business Platform) é paga — o Meta cobra por conversa — e em troca oferece um número verificado, muito mais estável para alto volume, com selo de conta oficial e risco de banimento bem menor; ela exige aprovação e o uso de modelos de mensagem aprovados pelo Meta. Se você depende de disparos grandes e constantes, vale considerar a API Oficial: fale com o suporte para habilitar.",
        "keywords": [
          "QR code",
          "API oficial",
          "Meta",
          "WhatsApp Business",
          "pago",
          "número verificado",
          "diferença"
        ]
      }
    ]
  },
  {
    "id": "chat",
    "title": "Chat e atendimento",
    "description": "Como conversar com seus clientes, usar respostas prontas e organizar atendimentos.",
    "icon": "MessageSquare",
    "items": [
      {
        "question": "Como envio uma mensagem, foto ou áudio para o cliente?",
        "answer": "Abra a conversa no menu Chat e use a barra de digitação embaixo. Para texto, é só escrever e enviar. Para mídia, clique no ícone de anexo e escolha imagem, vídeo, áudio ou documento; o áudio também pode ser gravado na hora pelo microfone. Cada mensagem mostra se foi enviada, entregue ou lida.",
        "keywords": [
          "enviar mensagem",
          "áudio",
          "foto",
          "mídia",
          "Chat"
        ]
      },
      {
        "question": "Para que serve digitar \"/\" na barra de mensagem?",
        "answer": "Ao digitar \"/\", o Torque abre seus textos prontos (templates) para você inserir uma resposta sem redigitar. O texto entra na conversa já preenchido, inclusive com dados como o nome do lead. É a forma mais rápida de mandar respostas que você usa toda hora. Os templates são criados na área de Templates.",
        "keywords": [
          "templates",
          "atalho",
          "barra",
          "resposta rápida"
        ]
      },
      {
        "question": "Posso programar uma mensagem para ser enviada mais tarde?",
        "answer": "Sim. No Chat você cria uma mensagem agendada escolhendo data e hora; ela dispara sozinha no horário marcado, sem você precisar estar online. As mensagens agendadas também aparecem na sua Agenda, junto com reuniões e follow-ups.",
        "keywords": [
          "mensagem agendada",
          "programar",
          "agendar",
          "data e hora"
        ]
      },
      {
        "question": "O que são as notas internas? O cliente consegue ver?",
        "answer": "As notas internas são anotações dentro da conversa, visíveis só para a sua equipe. O cliente não recebe e não enxerga. Use para registrar contexto, combinados ou avisos para quem for atender depois. Elas aparecem no histórico, separadas das mensagens reais.",
        "keywords": [
          "notas internas",
          "anotação",
          "privado",
          "equipe"
        ]
      },
      {
        "question": "Como encontro uma conversa específica?",
        "answer": "Use a busca no topo da lista de conversas para procurar pelo nome ou contato. Você também pode marcar conversas com etiquetas e filtrar por elas depois. Conversas que você não quer mais ver na lista principal podem ser arquivadas, sem serem apagadas.",
        "keywords": [
          "buscar conversa",
          "busca",
          "tags",
          "filtrar",
          "arquivar"
        ]
      },
      {
        "question": "Consigo reagir, editar, fixar ou apagar uma mensagem que já enviei?",
        "answer": "Sim. Clique sobre a mensagem para abrir as opções: reagir com emoji, editar, fixar, marcar como lida, baixar a mídia e apagar para todos. Lembre que apagar para todos depende das regras do próprio WhatsApp, como o tempo desde o envio.",
        "keywords": [
          "reagir",
          "editar",
          "fixar",
          "apagar",
          "deletar para todos"
        ]
      },
      {
        "question": "Como envio botões ou um botão de PIX pelo Chat?",
        "answer": "Use o menu de envio ao lado da barra de digitação. Por ali você manda mensagens com botões para o cliente clicar e também o botão de PIX, que facilita o pagamento. Esses recursos funcionam nas conversas de WhatsApp.",
        "keywords": [
          "botões",
          "PIX",
          "pagamento",
          "WhatsApp"
        ]
      }
    ]
  },
  {
    "id": "leads",
    "title": "Leads",
    "description": "Como cadastrar, importar, organizar e distribuir seus leads.",
    "icon": "UserPlus",
    "items": [
      {
        "question": "Como cadastro um lead novo?",
        "answer": "Vá em Leads (Combustível) e clique em criar lead. Preencha nome, telefone, email, empresa, origem e qualquer campo personalizado da sua empresa. Ao salvar, o lead entra na sua lista e pode ir para um funil. Leads também chegam automaticamente por WhatsApp, formulários e anúncios.",
        "keywords": [
          "criar lead",
          "cadastrar lead",
          "novo lead",
          "Combustível"
        ]
      },
      {
        "question": "Como importo uma planilha de leads (CSV ou Excel)?",
        "answer": "Na tela de Leads, use a opção de importar e suba seu arquivo CSV ou Excel. O Torque tenta encaixar as colunas nos campos automaticamente, e você confere esse mapeamento antes de confirmar. Escolha para qual funil os leads vão. No fim, você recebe um resumo de quantos foram importados, duplicados ou deram erro.",
        "keywords": [
          "importar",
          "planilha",
          "CSV",
          "Excel",
          "mapeamento"
        ]
      },
      {
        "question": "Como uso tags para organizar e segmentar meus leads?",
        "answer": "As tags são compartilhadas por toda a empresa. Você pode aplicá-las em um lead ou em vários de uma vez e depois usá-las como filtro para montar listas e públicos de disparo. Crie tags consistentes, como 'quente', 'reuniao-agendada' ou 'sem-resposta', para facilitar a segmentação.",
        "keywords": [
          "tags",
          "etiquetas",
          "segmentar",
          "filtro"
        ]
      },
      {
        "question": "Como atribuo um responsável (SDR ou Closer) a um lead?",
        "answer": "Abra o lead e defina o responsável; o Torque permite separar os papéis de responsável, SDR e Closer no mesmo lead. Para distribuir muitos leads de uma vez, selecione vários e use a ação em massa de atribuir.",
        "keywords": [
          "responsável",
          "SDR",
          "Closer",
          "atribuir",
          "distribuição"
        ]
      },
      {
        "question": "Como faço várias ações de uma vez (mover, taggear, atribuir, disparar)?",
        "answer": "Na lista de leads, selecione vários e use as ações em massa: mover de etapa, atribuir responsável, adicionar tag ou apagar em lote. Há também o disparo rápido para enviar uma mensagem ao grupo selecionado de uma vez. É a forma mais ágil de trabalhar grandes volumes.",
        "keywords": [
          "ações em massa",
          "em lote",
          "mover",
          "disparo rápido",
          "selecionar vários"
        ]
      },
      {
        "question": "Como exporto meus leads para uma planilha?",
        "answer": "Você pode exportar seus leads em CSV. A exportação é feita por etapa do funil, então selecione o estágio desejado antes de exportar. O arquivo abre normalmente no Excel ou no Google Sheets.",
        "keywords": [
          "exportar",
          "CSV",
          "planilha",
          "download",
          "por etapa"
        ]
      },
      {
        "question": "Apaguei um lead sem querer. Dá para recuperar?",
        "answer": "Dá. Quando você apaga um lead, ele vai para a Lixeira em vez de sumir de vez. De lá você restaura o lead de volta para a base. Se quiser eliminar em definitivo, use a opção de apagar permanentemente dentro da Lixeira.",
        "keywords": [
          "lixeira",
          "apagar lead",
          "restaurar",
          "recuperar"
        ]
      }
    ]
  },
  {
    "id": "funis",
    "title": "Funis, etapas e reuniões",
    "description": "Como acompanhar seus leads pelas etapas de venda e organizar reuniões.",
    "icon": "Filter",
    "items": [
      {
        "question": "O que é um funil no Torque e para que serve?",
        "answer": "Um funil é o caminho visual que o lead percorre da entrada até o fechamento, organizado em etapas (colunas) no formato Kanban. Cada organização monta os funis que precisa — toda conta nasce com um Funil de Vendas pronto e você cria, renomeia ou exclui funis livremente. Você acompanha em que ponto cada lead está pelo menu Funis.",
        "keywords": [
          "funil",
          "pipeline",
          "kanban",
          "etapas"
        ]
      },
      {
        "question": "Como movo um lead de uma etapa para outra?",
        "answer": "No menu Funis, na visão Kanban, arraste o card do lead da coluna atual para a etapa desejada. Você também pode mudar a etapa pela visão em lista ou tabela. Para mover vários de uma vez, use a ação em massa 'Mover etapa'. A mudança aparece na hora para o resto da equipe.",
        "keywords": [
          "mover card",
          "arrastar",
          "kanban",
          "etapa",
          "ação em lote"
        ]
      },
      {
        "question": "Como agendo uma reunião com um lead?",
        "answer": "Pelo card do lead, ou no funil onde ele está, agende informando data, hora, responsável e observações. Se sua conta estiver conectada ao Google Calendar, a reunião é sincronizada. O funil mostra uma contagem regressiva até o dia e você marca depois se o lead compareceu ou faltou.",
        "keywords": [
          "agendar reunião",
          "data",
          "hora",
          "responsável",
          "Google Calendar"
        ]
      },
      {
        "question": "Preciso remarcar uma reunião. Como faço?",
        "answer": "No card do lead, use a opção de remarcar e defina a nova data e hora. Se o Google Calendar estiver conectado, o evento é atualizado junto. A reunião continua aparecendo na sua Agenda com a nova data.",
        "keywords": [
          "remarcar",
          "reagendar",
          "reunião",
          "Google Calendar"
        ]
      },
      {
        "question": "Como crio um funil personalizado para o meu processo?",
        "answer": "Você pode criar quantos funis quiser. No menu Funis, crie um novo definindo nome, cor e ícone, e adicione as etapas que fizerem sentido para o seu processo. Você pode editar o nome, a cor e o ícone de cada etapa, reordená-las ou excluí-las quando precisar.",
        "keywords": [
          "funil personalizado",
          "criar funil",
          "etapas",
          "cor",
          "ícone"
        ]
      },
      {
        "question": "Como registro quando perco um lead?",
        "answer": "Quando a negociação não avança, marque o lead como perdido e escolha o motivo, por exemplo preço, sem retorno ou comprou de concorrente. Esses motivos são personalizáveis pela sua empresa. Registrar o motivo ajuda os relatórios a mostrar por que os negócios estão sendo perdidos.",
        "keywords": [
          "motivo de perda",
          "perdido",
          "razão de perda",
          "personalizável"
        ]
      },
      {
        "question": "Posso ver métricas e conversão de cada funil?",
        "answer": "Sim. Cada funil mostra suas próprias métricas: total vendido, conversão entre etapas, reuniões do dia, taxa de comparecimento e faltas, ranking da equipe e gráficos. Use esses números para enxergar onde os leads estão travando.",
        "keywords": [
          "métricas",
          "conversão",
          "comparecimento",
          "ranking",
          "relatório"
        ]
      }
    ]
  },
  {
    "id": "ia",
    "title": "Copilot (Inteligência Artificial)",
    "description": "Como o agente de IA atende seus leads e como configurá-lo.",
    "icon": "Bot",
    "items": [
      {
        "question": "O que a IA (Copilot) faz pelos meus leads?",
        "answer": "O Copilot é um agente de IA que conversa com seus leads pelo WhatsApp e pelo Instagram de forma automática, em português. Ele recebe o contato, faz as primeiras perguntas para qualificar, move o lead de etapa, agenda reunião, envia material e passa a conversa para um vendedor na hora certa. A ideia é tirar do time o trabalho repetitivo da primeira linha de atendimento.",
        "keywords": [
          "copilot",
          "ia",
          "o que faz",
          "agente",
          "atendimento automático"
        ]
      },
      {
        "question": "Como ligo ou desligo a IA para um lead específico?",
        "answer": "Cada lead tem um botão para ligar e desligar a IA, e qualquer vendedor que veja o lead pode usá-lo. Ao desligar, o agente para de responder aquele contato e a conversa fica só com o humano. Se uma resposta da IA já estava sendo gerada no momento em que você desligou, em alguns casos ela ainda pode sair, então desligue assim que decidir assumir.",
        "keywords": [
          "ligar ia",
          "desligar ia",
          "por lead",
          "assumir conversa",
          "pausar ia"
        ]
      },
      {
        "question": "A IA passa preço, prazo ou desconto para o cliente?",
        "answer": "Só se essas informações estiverem cadastradas para o agente. Sem uma fonte autorizada, o Copilot não inventa valores: ele dá uma resposta honesta e genérica ou transfere para um humano. Ele não monta orçamento sozinho nem calcula condições de pagamento. Para a IA falar de valores, inclua a política de preços no contexto do agente.",
        "keywords": [
          "preço",
          "valor",
          "prazo",
          "desconto",
          "orçamento",
          "não inventa"
        ]
      },
      {
        "question": "Como a IA aprende sobre a minha empresa e produtos?",
        "answer": "Você alimenta o agente de duas formas: pelo contexto do negócio (empresa, resumo dos produtos, diferenciais, dores do cliente, região de atendimento) e pela base de conhecimento, onde você cadastra perguntas e respostas e anexa documentos como PDF, DOC ou TXT. O agente consulta esse material durante a conversa para responder com base no que é seu.",
        "keywords": [
          "base de conhecimento",
          "catálogo",
          "documentos",
          "contexto do negócio",
          "treinar ia"
        ]
      },
      {
        "question": "Como crio e configuro um agente de IA?",
        "answer": "A criação é feita no Playground, o editor onde você escreve as instruções do agente e vê uma prévia da conversa ao vivo. Lá você define nome, tom de voz, objetivo, regras de qualificação e o contexto do negócio. Criar um agente exige ser administrador, e só o administrador pode vincular o agente a um número ou funil de WhatsApp.",
        "keywords": [
          "criar agente",
          "configurar",
          "playground",
          "tom de voz",
          "objetivo"
        ]
      },
      {
        "question": "Quando a IA passa o atendimento para um vendedor humano?",
        "answer": "O agente transfere para um humano quando chega num ponto que exige uma pessoa, como uma negociação mais delicada ou um pedido fora do que ele sabe responder. Você define nas instruções do agente em que situações ele deve transferir. A partir daí, o lead aparece para o responsável tocar a conversa.",
        "keywords": [
          "transferir humano",
          "passar para vendedor",
          "quando transfere",
          "atendimento humano"
        ]
      },
      {
        "question": "A IA pode mandar a primeira mensagem ou só responde?",
        "answer": "Além de responder, o agente também pode iniciar a conversa: mandar a primeira mensagem para um lead novo, reengajar quem sumiu ou tentar resgatar um cliente da carteira. O único requisito é que o lead tenha telefone cadastrado. Esse comportamento é definido na configuração do agente.",
        "keywords": [
          "primeira mensagem",
          "proativo",
          "reengajamento",
          "iniciar conversa"
        ]
      }
    ]
  },
  {
    "id": "automacoes",
    "title": "Automações (Turbo)",
    "description": "Como criar fluxos que executam ações sozinhos quando algo acontece com um lead.",
    "icon": "Zap",
    "items": [
      {
        "question": "O que são as Automações (Turbo)?",
        "answer": "O Turbo é o motor de automações do Torque. Você monta um fluxo que dispara sozinho quando algo acontece (um lead novo entra, muda de etapa, fica sem responder) e executa ações em sequência: enviar WhatsApp, mudar etapa, adicionar tag, criar follow-up, atribuir responsável e mais. É como um 'se isso, então aquilo' que trabalha pelo seu time o tempo todo.",
        "keywords": [
          "turbo",
          "automação",
          "o que é",
          "fluxo"
        ]
      },
      {
        "question": "Como crio uma automação do zero?",
        "answer": "Abra o Turbo e crie um novo fluxo. Todo fluxo começa por um gatilho (o evento que dá a partida) e depois você vai ligando os blocos: ações, esperas e condições. Configure cada bloco, ligue tudo até o fim e ative o fluxo. Dica: comece por um modelo pronto e adapte, é mais rápido do que montar na tela em branco.",
        "keywords": [
          "criar",
          "novo fluxo",
          "como fazer",
          "montar automação"
        ]
      },
      {
        "question": "Quais são os gatilhos mais usados no dia a dia?",
        "answer": "Os três mais usados são: 'lead criado' (quando um lead novo entra, com filtro por origem ou funil), 'mudou de etapa' (quando o lead avança ou volta no funil) e 'sem resposta' (quando o lead fica um tempo sem te responder). Também são comuns 'lead respondeu', 'tag adicionada' e 'reunião não confirmada'.",
        "keywords": [
          "gatilho",
          "lead novo",
          "mudou etapa",
          "sem resposta"
        ]
      },
      {
        "question": "Tem automação pronta para eu não começar do zero?",
        "answer": "Sim. Toda organização tem modelos prontos: Boas-vindas, Recuperação de quem não respondeu, NPS pós-venda e Reativação semanal, além de modelos de disparo com áudio, texto e imagem. Escolha o mais próximo do seu objetivo, duplique e ajuste os textos e os tempos para a sua operação.",
        "keywords": [
          "template",
          "modelo pronto",
          "boas-vindas",
          "nps",
          "reativação"
        ]
      },
      {
        "question": "Como uso o nome do lead e outros dados dentro das mensagens?",
        "answer": "Use variáveis entre chaves duplas e o Turbo troca pelo valor real na hora do envio. As mais usadas são {{nome}}, {{primeiro_nome}} (só o primeiro nome do lead), {{empresa}}, {{telefone}}, {{estagio}}, {{responsavel}} e {{saudacao}} (que vira Bom dia ou Boa tarde automaticamente). Para campos personalizados, use {{custom.nome_do_campo}}. As variáveis só preenchem valores, não fazem contas.",
        "keywords": [
          "variável",
          "nome do lead",
          "personalizar mensagem",
          "saudação"
        ]
      },
      {
        "question": "Por que minha automação demorou para disparar?",
        "answer": "É normal haver uma pequena espera. O Turbo verifica os fluxos a cada minuto, então conte com essa diferença entre o evento e a primeira ação. Se você usou um bloco de espera de minutos, horas ou dias, ele só continua quando o tempo passar.",
        "keywords": [
          "demorou",
          "atraso",
          "não disparou na hora",
          "espera"
        ]
      },
      {
        "question": "Dá para a automação enviar só em horário comercial?",
        "answer": "Sim. Use um bloco de janela de horário comercial no fluxo: se o momento estiver fora do horário, ele segura a execução e retoma quando o horário abrir. Assim você evita disparar WhatsApp de madrugada e mantém o tom profissional da operação.",
        "keywords": [
          "horário comercial",
          "janela",
          "não enviar de madrugada"
        ]
      }
    ]
  },
  {
    "id": "disparos",
    "title": "Disparos em massa",
    "description": "Como enviar a mesma mensagem para vários leads de uma vez, com segurança para o seu número.",
    "icon": "Megaphone",
    "items": [
      {
        "question": "Como faço um disparo em massa para vários leads de uma vez?",
        "answer": "Na tela de Leads, filtre ou selecione os contatos que vão receber, escolha a ação de disparo e monte a mensagem (texto, áudio, imagem ou um template pronto). Depois é só escolher entre enviar tudo de uma vez (disparo imediato) ou distribuir o envio em etapas ao longo dos dias (plano de lote). Para listas grandes, prefira o plano de lote: ele protege o seu número de WhatsApp.",
        "keywords": [
          "disparo em massa",
          "enviar para vários",
          "disparo rápido",
          "plano de lote",
          "WhatsApp"
        ]
      },
      {
        "question": "Qual a diferença entre disparo imediato e plano de lote?",
        "answer": "O disparo imediato manda a mensagem para toda a lista de uma vez só — ideal para volumes pequenos e avisos urgentes. O plano de lote quebra a mesma lista em partes, enviadas aos poucos ao longo de horas ou dias, e você pode pausar, retomar ou cancelar no meio do caminho. Espalhar o envio no tempo reduz bastante o risco de bloqueio do número.",
        "keywords": [
          "disparo imediato",
          "plano de lote",
          "lotes",
          "aos poucos",
          "pausar"
        ]
      },
      {
        "question": "Como escolho quem vai receber o disparo?",
        "answer": "O público sai dos seus leads: use as tags e os filtros (origem, etapa do funil, responsável) para montar a lista certa antes de disparar. Você pode selecionar vários leads na tela de Leads ou aplicar o disparo a uma etapa inteira do funil. Confira a lista antes de enviar para não incluir quem não deveria.",
        "keywords": [
          "público",
          "segmentar",
          "tags",
          "filtro",
          "selecionar leads"
        ]
      },
      {
        "question": "Como uso o nome do lead e outros dados na mensagem do disparo?",
        "answer": "Use variáveis entre chaves duplas e o sistema troca pelo valor real de cada lead no envio: {{nome}}, {{primeiro_nome}} (só o primeiro nome do lead), {{empresa}}, {{saudacao}} (que vira Bom dia ou Boa tarde) e campos personalizados com {{custom.nome_do_campo}}. Personalizar a mensagem, em vez de mandar um texto idêntico para todo mundo, deixa o disparo mais natural e ajuda a proteger o seu número.",
        "keywords": [
          "variável",
          "personalizar",
          "nome do lead",
          "saudação"
        ]
      },
      {
        "question": "Por que aparece uma taxa de erro nos meus disparos?",
        "answer": "A taxa de erro mostra quantas mensagens não foram entregues. Os motivos mais comuns são número inválido, lead sem WhatsApp ou queda momentânea da conexão. Antes de disparar, confira se os telefones estão corretos e se o seu número de WhatsApp está online.",
        "keywords": [
          "taxa de erro",
          "não entregue",
          "número inválido",
          "WhatsApp offline"
        ]
      },
      {
        "question": "Como acompanho o resultado de um disparo?",
        "answer": "Depois do envio você acompanha quantas mensagens foram enviadas, quantas foram entregues, quantas deram erro e quantos leads responderam. Use esses números para ajustar a mensagem ou o público antes do próximo disparo.",
        "keywords": [
          "resultado",
          "enviadas",
          "entregues",
          "respostas",
          "acompanhar"
        ]
      },
      {
        "question": "Disparo em massa pode derrubar ou banir o meu número?",
        "answer": "Pode, sim — enviar muita mensagem de uma vez, para contatos que não esperam o seu contato, é o que mais causa bloqueio de número no WhatsApp. Para se proteger, use o plano de lote, personalize as mensagens, fale só com quem tem relação com você e mantenha um número reserva já aquecido. Se você precisa de alto volume com segurança, o caminho é a API Oficial do Meta — veja os detalhes na seção de WhatsApp.",
        "keywords": [
          "banir",
          "bloqueio",
          "segurança",
          "número reserva",
          "API oficial"
        ]
      }
    ]
  },
  {
    "id": "carteira",
    "title": "Carteira, pós-venda e produtos",
    "description": "Como cuidar dos clientes que já compraram, gerar recompras e gerenciar produtos.",
    "icon": "Wallet",
    "items": [
      {
        "question": "Como transformo um lead em cliente na Carteira?",
        "answer": "Quando o lead fecha negócio, você o converte em cliente e ele passa a viver na Carteira, com uma linha do tempo de tudo que aconteceu: atendimentos, pedidos e reuniões. A partir daí ele entra na gestão de pós-venda, e o histórico do lead continua junto na ficha do cliente.",
        "keywords": [
          "converter lead em cliente",
          "carteira",
          "pós-venda",
          "cliente"
        ]
      },
      {
        "question": "O que significam os segmentos Ouro, Prata, Resgate e Dormindo?",
        "answer": "São faixas que o Torque atribui automaticamente aos clientes pela saúde do relacionamento: Ouro e Prata são os mais valiosos e recorrentes, Novo é quem acabou de comprar, Dormindo é quem parou de comprar há um tempo, Resgate é quem você deveria reativar e Em atraso é quem está devendo. Use os segmentos para priorizar quem abordar primeiro.",
        "keywords": [
          "segmentação",
          "ouro",
          "prata",
          "resgate",
          "dormindo"
        ]
      },
      {
        "question": "Como faço uma recompra rápida para um cliente que já comprou?",
        "answer": "Use o pedido rápido na ficha do cliente: ele repete um pedido com os itens já conhecidos, sem montar tudo de novo. Você pode lançar por itens ou como venda avulsa. Pedidos podem passar por aprovação, e você aprova, rejeita ou aprova vários de uma vez.",
        "keywords": [
          "recompra",
          "pedido rápido",
          "pedidos",
          "venda avulsa",
          "aprovar"
        ]
      },
      {
        "question": "Como crio e envio uma proposta para o cliente?",
        "answer": "Monte a proposta escolhendo produtos, valores e validade. Ela ganha uma data com contagem regressiva e fica ligada ao funil de fechamento da sua organização, então você acompanha tudo no Kanban. Quando é marcada como vendida ou perdida, isso reflete nas métricas e pode disparar suas automações.",
        "keywords": [
          "proposta",
          "criar proposta",
          "validade",
          "funil de propostas",
          "valores"
        ]
      },
      {
        "question": "Como cadastro um produto e quais tipos existem?",
        "answer": "Vá em Produtos e cadastre informando nome, código e tipo. São três tipos: recorrente (mensal), projeto (valor fechado de um trabalho) e unitário (venda por unidade). Você também pode criar variações e anexar materiais como PDFs, contratos e links, que ficam à mão na hora de vender.",
        "keywords": [
          "cadastrar produto",
          "produtos",
          "recorrente",
          "projeto",
          "unitário"
        ]
      },
      {
        "question": "Como vejo se minha carteira está saudável?",
        "answer": "Abra o painel de Saúde da Carteira: ele mostra os indicadores principais, como taxa de recorrência, clientes em atraso, ticket médio e receita em risco. É o lugar para saber rapidamente quais clientes estão prestes a sair e quanto da sua receita está ameaçada.",
        "keywords": [
          "saúde da carteira",
          "recorrência",
          "em atraso",
          "ticket médio",
          "receita em risco"
        ]
      },
      {
        "question": "Dá para fazer upsell e reativação na base de clientes?",
        "answer": "Sim. Na área de Upsell você vê sua base de clientes em Kanban ou lista e cria fluxos de recompra, resgate e reativação de quem está dormindo. O sistema reposiciona os clientes conforme regras e mostra métricas como percentual de recompra e quais são as próximas recompras esperadas.",
        "keywords": [
          "upsell",
          "recompra",
          "reativação",
          "resgate",
          "base de clientes"
        ]
      }
    ]
  },
  {
    "id": "agenda",
    "title": "Agenda, Google Calendar e follow-ups",
    "description": "Como acompanhar compromissos, conectar o Google Calendar e gerenciar follow-ups.",
    "icon": "CalendarDays",
    "items": [
      {
        "question": "Onde vejo minha agenda e o que aparece nela?",
        "answer": "Abra o módulo de Agenda. Ela é unificada: reúne num só lugar suas reuniões, os follow-ups, as mensagens agendadas e as confirmações de reunião do funil. Use a visão por dia para enxergar o que tem para hoje. Se você conectou o Google Calendar, os eventos dele também aparecem na mesma tela.",
        "keywords": [
          "agenda",
          "reuniões",
          "follow-ups",
          "compromissos do dia"
        ]
      },
      {
        "question": "Como crio um follow-up?",
        "answer": "No lead ou na área de Follow-ups, crie um novo informando a data e a prioridade (baixa, média ou alta). Ele passa a aparecer na sua agenda e nas listas de follow-up. Você pode marcar a opção de o Copilot poder resolvê-lo, para a IA cuidar dele quando fizer sentido.",
        "keywords": [
          "criar follow-up",
          "follow-up",
          "prioridade",
          "data",
          "lembrete"
        ]
      },
      {
        "question": "Como vejo os follow-ups atrasados?",
        "answer": "Na área de Follow-ups há filtros por período: hoje, atrasados e próximos. Selecione o filtro de atrasados para ver tudo que venceu e ainda não foi concluído. Eles também aparecem destacados na sua agenda. Conclua cada um assim que tratar o lead para tirá-lo dessa lista.",
        "keywords": [
          "follow-up atrasado",
          "vencidos",
          "filtro",
          "hoje",
          "próximos"
        ]
      },
      {
        "question": "Como conecto meu Google Calendar ao Torque?",
        "answer": "Vá em Configurações (Pitstop) e abra o painel Google Calendar. Clique em conectar e autorize o acesso na tela do Google, usando a conta da sua agenda. Depois disso, seus eventos do Google passam a aparecer na agenda do Torque e a sincronização de reuniões fica ativa.",
        "keywords": [
          "conectar google calendar",
          "integração google",
          "autorizar",
          "sincronizar agenda"
        ]
      },
      {
        "question": "As reuniões que crio no Torque vão para o Google Calendar? E o contrário?",
        "answer": "Sim, a sincronização funciona nos dois sentidos. Reuniões agendadas no Torque vão para o seu Google Calendar, e os eventos que já estão no Google aparecem na agenda do Torque. Para isso funcionar, é preciso ter conectado sua conta Google em Configurações > Google Calendar.",
        "keywords": [
          "sincronização",
          "bidirecional",
          "google calendar",
          "reunião"
        ]
      },
      {
        "question": "Por que apareceu erro de acesso ao conectar o Google?",
        "answer": "Esse erro quase sempre é de permissão: na tela do Google você precisa autorizar o acesso ao calendário para concluir a conexão. Se recusou ou fechou a janela antes de aceitar, volte em Configurações > Google Calendar e tente de novo, marcando a permissão. Se continuar negado, fale com o administrador ou o suporte.",
        "keywords": [
          "erro google",
          "acesso negado",
          "permissão calendário",
          "não consigo conectar"
        ]
      }
    ]
  },
  {
    "id": "relatorios",
    "title": "Relatórios, metas e comissões",
    "description": "Como acompanhar números do time, definir metas e visualizar comissões.",
    "icon": "BarChart2",
    "items": [
      {
        "question": "Onde vejo os números gerais do meu time?",
        "answer": "Abra o Dashboard principal, em Relatórios. No topo ele mostra quatro indicadores-chave: leads novos no período, taxa de conversão, ticket médio (separado entre receita recorrente e projeto) e receita total. Use o seletor de período no canto para trocar a janela de tempo; os números atualizam em tempo real.",
        "keywords": [
          "dashboard",
          "indicadores",
          "período",
          "tempo real"
        ]
      },
      {
        "question": "O que significam conversão, ticket médio e receita?",
        "answer": "Conversão é o percentual de leads que avançaram até a venda no período. Ticket médio é o valor médio por venda, mostrado separadamente para receita recorrente (mensalidade) e projeto (valor único). Receita é a soma do que foi fechado. Há ainda relatórios mais detalhados por funil, financeiro e por origem.",
        "keywords": [
          "conversão",
          "ticket médio",
          "receita",
          "recorrente",
          "projeto"
        ]
      },
      {
        "question": "Como defino as metas do time e de cada vendedor?",
        "answer": "As metas, individuais e de time, ficam na área de produtividade e são configuradas por quem é administrador. Os vendedores veem as próprias metas, mas só o admin edita. O painel de Relatórios apenas mostra o progresso; quem define os valores é a área de metas.",
        "keywords": [
          "metas",
          "individuais",
          "time",
          "admin",
          "progresso"
        ]
      },
      {
        "question": "Onde vejo o ranking e quem está na frente?",
        "answer": "O ranking mostra a equipe ordenada por métrica (vendas, reuniões e outras) e por período. Você também pode criar competições com ranking ao vivo, definindo o critério e prêmios por posição. O pódio dessa competição também aparece girando na TV de parede.",
        "keywords": [
          "ranking",
          "leaderboard",
          "pódio",
          "competição",
          "prêmios"
        ]
      },
      {
        "question": "Como o Torque calcula minhas comissões?",
        "answer": "A área de comissões mostra os valores por mês e por membro, incluindo bônus, com um gráfico de acompanhamento. É uma visão de comissão para o comercial, não uma folha de pagamento: o Torque não emite holerite nem faz o pagamento. Use os números para conferir e leve o fechamento para o seu RH ou financeiro.",
        "keywords": [
          "comissões",
          "bônus",
          "mensal",
          "folha de pagamento"
        ]
      },
      {
        "question": "Como funciona a TV de parede para mostrar resultados no escritório?",
        "answer": "A TV de parede é um painel feito para uma tela grande. Ele gira automaticamente entre blocos a cada poucos segundos: desempenho do time, funil, propostas quentes e a competição com o pódio. Basta abri-lo numa TV ou monitor e deixar rodando, sem precisar mexer.",
        "keywords": [
          "TV de parede",
          "pódio",
          "rotativo",
          "competição"
        ]
      }
    ]
  },
  {
    "id": "planos",
    "title": "Planos, assinatura e cobrança",
    "description": "Como funcionam os planos, o pagamento e os limites da sua organização.",
    "icon": "CreditCard",
    "items": [
      {
        "question": "Quais planos o Torque oferece e qual a diferença entre eles?",
        "answer": "São três planos: Starter, Pro e Enterprise. A diferença principal está nos limites de uso (quantos leads, usuários, agentes de IA, números de WhatsApp e funis você pode ter) e em quais recursos ficam liberados. Quanto maior o plano, maiores os limites. Para escolher o ideal, fale com o time comercial.",
        "keywords": [
          "planos",
          "Starter",
          "Pro",
          "Enterprise",
          "diferença",
          "limites"
        ]
      },
      {
        "question": "Como funciona o período de teste?",
        "answer": "Ao começar, sua organização entra em um período de teste para você experimentar o Torque antes de pagar. A duração é definida na contratação. Quando o teste termina, é preciso ativar a assinatura para continuar usando. Aproveite o período para conectar o WhatsApp, importar seus leads e montar seus funis.",
        "keywords": [
          "trial",
          "teste",
          "período",
          "experimentar"
        ]
      },
      {
        "question": "Quais formas de pagamento posso usar?",
        "answer": "A cobrança é feita pela Asaas e você pode pagar por cartão de crédito, boleto ou PIX. A assinatura é recorrente, então no cartão a renovação é automática a cada ciclo. Com boleto ou PIX, fique atento à data de vencimento para não deixar a conta atrasar.",
        "keywords": [
          "pagamento",
          "PIX",
          "cartão",
          "boleto",
          "Asaas"
        ]
      },
      {
        "question": "Como mudo de plano (upgrade ou downgrade)?",
        "answer": "A troca de plano altera os limites e os recursos liberados para a organização. Quem cuida disso é o administrador, em geral junto com o time comercial do Torque. Se você precisa de mais leads, usuários, números de WhatsApp ou funis, fale com o suporte ou o comercial para ajustar seu plano.",
        "keywords": [
          "mudar plano",
          "upgrade",
          "downgrade",
          "trocar plano"
        ]
      },
      {
        "question": "O que acontece se eu atrasar o pagamento?",
        "answer": "Quando o pagamento atrasa, a assinatura entra em estado de atraso e aparece um aviso dentro do sistema, mas você ainda usa normalmente por um período de tolerância. Se o atraso persistir, a conta é suspensa e o acesso é bloqueado até a regularização. Assim que o pagamento é confirmado pela Asaas, o acesso volta automaticamente.",
        "keywords": [
          "atraso",
          "pagamento atrasado",
          "bloqueio",
          "suspensão",
          "aviso"
        ]
      },
      {
        "question": "Quais são os limites do meu plano e onde vejo isso?",
        "answer": "Cada plano define limites para itens como número de leads, usuários, agentes de IA, números de WhatsApp e funis personalizados. Esses limites valem para toda a organização e são aplicados automaticamente. Ao tentar passar de um limite, o Torque avisa; se isso atrapalha sua operação, pode ser hora de subir de plano.",
        "keywords": [
          "limites",
          "leads",
          "usuários",
          "WhatsApp",
          "funis"
        ]
      },
      {
        "question": "Tenho um cupom de desconto. Onde aplico?",
        "answer": "Você aplica o cupom no momento do pagamento, antes de finalizar. O sistema valida na hora e, se for válido, o desconto entra no seu plano. Se o cupom não for aceito, confira se digitou corretamente e se ele ainda está dentro da validade.",
        "keywords": [
          "cupom",
          "desconto",
          "código promocional"
        ]
      }
    ]
  }
];
