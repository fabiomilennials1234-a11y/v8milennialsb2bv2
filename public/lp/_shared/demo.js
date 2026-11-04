/*
 * Torque por dentro: demonstração interativa das LPs, em JS puro.
 *
 * Cada [data-torque-app] vira uma instância independente, com `data-start` e `data-tour`.
 * Tudo é escrito com createTextNode, textContent ou a propriedade `value`: o que o visitante
 * digita nunca passa por innerHTML. O formulário de mensagem não tem `name`, não faz
 * requisição e o texto digitado só existe no estado desta instância.
 */
(function () {
  "use strict";

  var SVG_TAGS = { svg: 1, path: 1, circle: 1, rect: 1 };
  var SVG_NS = "http://www.w3.org/2000/svg";
  var TICK_MS = 2200;
  var HOLD_MS = 12000;
  var TABS = ["comando", "chat", "funis", "carteira", "automacoes", "metricas"];

  /* ---------- mini reconciliador: troca só o que mudou, para as animações não recomeçarem ---------- */
  function h(tag, props) {
    var kids = [];
    (function add(list) {
      for (var i = 0; i < list.length; i++) {
        var k = list[i];
        if (k === null || k === undefined || k === false || k === "") continue;
        if (Array.isArray(k)) add(k);
        else kids.push(typeof k === "object" ? k : String(k));
      }
    })(Array.prototype.slice.call(arguments, 2));
    return { tag: tag, props: props || {}, kids: kids };
  }

  function bindEvents(el, on) {
    el._on = on || {};
    el._bound = el._bound || {};
    Object.keys(el._on).forEach(function (type) {
      if (el._bound[type]) return;
      el._bound[type] = true;
      el.addEventListener(type, function (e) { if (el._on[type]) el._on[type](e); });
    });
  }

  function setProps(el, oldProps, props) {
    Object.keys(oldProps).forEach(function (name) {
      if (!(name in props) && name !== "on" && name !== "key") el.removeAttribute(name === "className" ? "class" : name);
    });
    Object.keys(props).forEach(function (name) {
      var value = props[name];
      if (name === "key") return;
      if (name === "on") { bindEvents(el, value); return; }
      if (name === "value") { if (el.value !== value) el.value = value; return; }
      if (oldProps[name] === value) return;
      if (name === "style") { el.style.cssText = value; return; }
      if (value === null || value === undefined) el.removeAttribute(name);
      else el.setAttribute(name, String(value));
    });
  }

  function create(node) {
    if (typeof node === "string") return document.createTextNode(node);
    var el = SVG_TAGS[node.tag] ? document.createElementNS(SVG_NS, node.tag) : document.createElement(node.tag);
    setProps(el, {}, node.props);
    node.kids.forEach(function (kid) { el.appendChild(create(kid)); });
    return el;
  }

  function sameKind(a, b) {
    if (typeof a === "string" || typeof b === "string") return typeof a === typeof b;
    return a.tag === b.tag && a.props.key === b.props.key;
  }

  function patchKids(parent, oldKids, kids) {
    var i;
    for (i = 0; i < kids.length; i++) {
      var dom = parent.childNodes[i];
      if (i >= oldKids.length) parent.appendChild(create(kids[i]));
      else if (!sameKind(oldKids[i], kids[i])) parent.replaceChild(create(kids[i]), dom);
      else if (typeof kids[i] === "string") { if (dom.nodeValue !== kids[i]) dom.nodeValue = kids[i]; }
      else {
        setProps(dom, oldKids[i].props, kids[i].props);
        patchKids(dom, oldKids[i].kids, kids[i].kids);
      }
    }
    for (i = oldKids.length - 1; i >= kids.length; i--) parent.removeChild(parent.childNodes[i]);
  }

  /* ---------- dados ilustrativos ---------- */
  var PILLS = {
    comando: ["Central da equipe", "Minha central"], chat: ["Conversas", "Disparos"],
    funis: ["Kanban", "Lista", "Timeline", "Analytics"], carteira: ["Clientes", "Pedidos", "Analytics"],
    automacoes: ["Workflows", "Editor", "Execuções"], metricas: ["Visão Geral", "Performance", "Saúde"]
  };
  var FILA = [
    { ini: "MS", empresa: "Metalúrgica Serra", msg: "Pode mandar a proposta?", hora: "14:26", contato: "Roberto Siqueira", valor: "R$ 143.000", etapa: "Proposta", acao: "Enviar proposta", tag: "Respondeu agora" },
    { ini: "BV", empresa: "Atacado Boa Vista", msg: "Quero repor o estoque.", hora: "14:21", contato: "Fernanda Kowalski", valor: "R$ 62.000", etapa: "Recompra", acao: "Confirmar pedido", tag: "Recompra" },
    { ini: "CI", empresa: "Casa do Ipê", msg: "Faturamos 18 milhões/ano.", hora: "13:52", contato: "Marcelo Becker", valor: "R$ 96.000", etapa: "Qualificado", acao: "Marcar reunião", tag: "Qualificado pela IA" },
    { ini: "RC", empresa: "Comercial Rio Claro", msg: "Pode refazer o pedido anterior?", hora: "13:18", contato: "Sandra Schmitt", valor: "R$ 38.000", etapa: "Recompra", acao: "Gerar pedido", tag: "Recompra" },
    { ini: "VS", empresa: "Grupo Vale Sul", msg: "Quero incluir a linha nova.", hora: "12:47", contato: "Eduardo Prado", valor: "R$ 87.000", etapa: "Mix", acao: "Enviar catálogo", tag: "Aumentar o mix" },
    { ini: "LP", empresa: "Loja Pioneira", msg: "Me liga depois das 15h?", hora: "11:32", contato: "Joana Batista", valor: "R$ 41.000", etapa: "Em conversa", acao: "Ligar às 15h", tag: "Tarefa criada pela IA" }
  ];
  var NOVO = { ini: "AU", empresa: "Distribuidora Aurora", msg: "Voltamos a comprar este mês.", hora: "agora", contato: "Marina Prado", valor: "R$ 211.000", etapa: "Reativação", acao: "Assumir negociação", tag: "Reativação · cliente respondeu" };
  var CONV = [
    { ini: "RS", nome: "Roberto Siqueira", empresa: "Metalúrgica Serra", etapa: "Em conversa", valor: "R$ 143.000", prev: "Quinta 15h fica ótimo.", hora: "13:24", msgs: [
      { t: "Boa tarde, Roberto! Aqui é a Ana, da Aurora. Faz 74 dias do seu último pedido. Posso te mandar a tabela nova?", h: "13:00", ai: true, me: true },
      { t: "Pode sim. Hoje estamos repondo tudo na planilha.", h: "13:06" },
      { t: "Esse é o cenário que mais atendemos. Posso te mostrar em 30 min? Tenho quinta às 10h ou 15h.", h: "13:12", ai: true, me: true },
      { t: "Quinta 15h fica ótimo.", h: "13:18" },
      { t: "Fechado! Enviei o convite para o seu e-mail e avisei o Rafael. Até quinta!", h: "13:24", ai: true, me: true }
    ] },
    { ini: "FK", nome: "Fernanda Kowalski", empresa: "Atacado Boa Vista", etapa: "Proposta", valor: "R$ 62.000", prev: "Vou levar para a diretoria.", hora: "10:24", msgs: [
      { t: "Fernanda, segue a proposta atualizada.", h: "10:02", me: true }, { t: "Perfeito, vou levar para a diretoria.", h: "10:24" }
    ] },
    { ini: "MB", nome: "Marcelo Becker", empresa: "Casa do Ipê", etapa: "Qualificado", valor: "R$ 96.000", prev: "Confirmada. Vou levar o gerente.", hora: "01:24", msgs: [
      { t: "Reunião confirmada para amanhã às 9h.", h: "01:10", ai: true, me: true }, { t: "Confirmada. Vou levar o gerente.", h: "01:24" }
    ] }
  ];
  var COLS = [["Novo", "hsl(36 6% 42%)"], ["Em conversa", "hsl(217 90% 55%)"], ["Reunião marcada", "hsl(47 100% 45%)"], ["Reunião realizada", "hsl(270 70% 58%)"], ["Proposta enviada", "hsl(30 90% 52%)"]];
  var AUTO = { 1: "Follow-up enviado", 2: "Convite enviado pela IA", 3: "Tarefa criada", 4: "Lembrete em 2 dias" };
  var CARDS = [
    { id: "roberto", ini: "RS", nome: "Roberto Siqueira", emp: "Metalúrgica Serra", valor: "R$ 143.000", origem: "Meta Ads", idade: "há 5 dias" },
    { id: "marcio", ini: "MT", nome: "Márcio Teixeira", emp: "Distribuidora Paulista", valor: "R$ 96.000", origem: "Evento", idade: "há 1 hora" },
    { id: "katia", ini: "KA", nome: "Kátia Albuquerque", emp: "Termoplásticos Manaus", valor: "R$ 221.000", origem: "Outros", idade: "há 5 horas" },
    { id: "daniela", ini: "DC", nome: "Daniela Couto", emp: "Papelão Ondulado", valor: "R$ 125.000", origem: "Evento", idade: "há 1 mês" },
    { id: "rodrigo", ini: "RW", nome: "Rodrigo Werner", emp: "Cerâmica Vale", valor: "R$ 234.000", origem: "Site", idade: "há 6 dias" },
    { id: "luciana", ini: "LP", nome: "Luciana Pereira", emp: "Moinho Rio Grande", valor: "R$ 211.000", origem: "Indicação", idade: "há 12 dias" },
    { id: "aline", ini: "AB", nome: "Aline Barbosa", emp: "Cosméticos Industriais", valor: "R$ 54.000", origem: "Indicação", idade: "há 9 dias" },
    { id: "paulo", ini: "PM", nome: "Paulo Menezes", emp: "Agroindustrial Centro", valor: "R$ 62.000", origem: "Meta Ads", idade: "há 10 dias" },
    { id: "fabio", ini: "FN", nome: "Fábio Nascimento", emp: "Hidráulica Recôncavo", valor: "R$ 36.000", origem: "Google Ads", idade: "há 19 dias" },
    { id: "patricia", ini: "PL", nome: "Patrícia Lemos", emp: "Embalagens Serra Azul", valor: "R$ 25.000", origem: "Evento", idade: "há 2 dias" },
    { id: "simone", ini: "SZ", nome: "Simone Zanella", emp: "Móveis Planejados", valor: "R$ 187.000", origem: "Site", idade: "há 3 dias" },
    { id: "ivone", ini: "IC", nome: "Ivone Carvalho", emp: "Madeireira Norte", valor: "R$ 205.000", origem: "Outros", idade: "há 2 meses" },
    { id: "henrique", ini: "HD", nome: "Henrique Dias", emp: "Eletrocabos Sorocaba", valor: "R$ 74.000", origem: "Indicação", idade: "há 8 dias" },
    { id: "ricardo", ini: "RO", nome: "Ricardo Okamoto", emp: "Aços Especiais", valor: "R$ 91.000", origem: "WhatsApp", idade: "há 15 dias" },
    { id: "bianca", ini: "BM", nome: "Bianca Moura", emp: "Ferragens Atlântico", valor: "R$ 211.000", origem: "Site", idade: "há 6 dias" }
  ];
  var CLIENTES = [
    { ini: "MS", nome: "Metalúrgica Serra", frequencia: "compra a cada 30 dias", ciclo: "a cada 30 d", status: "Recompra hoje", prox: "hoje", ult: "há 30 dias", ticket: "R$ 38.000", tag: "Hora de recomprar", acao: "Mensagem de recompra enviada pelo Torque", atr: false },
    { ini: "CH", nome: "Comercial Rio Claro", frequencia: "compra a cada 60 dias", ciclo: "a cada 60 d", status: "Atrasado 8 d", prox: "atrasado 8 d", ult: "há 68 dias", ticket: "R$ 11.000", tag: "Esfriando", acao: "Recuperação iniciada, 2º contato amanhã", atr: true },
    { ini: "AU", nome: "Distribuidora Aurora", frequencia: "compra a cada 45 dias", ciclo: "a cada 45 d", status: "Inativo", prox: "parou há 74 d", ult: "há 119 dias", ticket: "R$ 87.000", tag: "Reativação", acao: "Respondeu. Vendedor recebeu a oportunidade", atr: true },
    { ini: "VS", nome: "Grupo Vale Sul", frequencia: "compra a cada 25 dias", ciclo: "a cada 25 d", status: "Reduziu volume", prox: "em 12 dias", ult: "há 13 dias", ticket: "R$ 66.000", tag: "Mix e volume", acao: "Tarefa criada para o vendedor", atr: false },
    { ini: "LP", nome: "Loja Pioneira", frequencia: "compra a cada 51 dias", ciclo: "a cada 51 d", status: "Previsto em 9 d", prox: "em 9 dias", ult: "há 42 dias", ticket: "R$ 78.000", tag: "Comprando", acao: "Lembrete programado para o ciclo", atr: false }
  ];
  var NOS = [
    { ic: "⚡", t: "Gatilho", s: "Cliente sem comprar há 60 dias", d: "Dispara quando o ERP mostra que o cliente passou do ciclo de compra." },
    { ic: "⏱", t: "Janela comercial", s: "Só em horário de atendimento", d: "Segura o envio até o próximo horário comercial." },
    { ic: "▷", t: "Enviar WhatsApp", s: "Mensagem de reativação", d: "Envia a mensagem pelo canal da empresa, com o nome do cliente." },
    { ic: "◇", t: "Respondeu?", s: "Esperar resposta por 3 dias", d: "Sem resposta, um novo contato entra na fila." },
    { ic: "★", t: "Copilot + vendedor", s: "Qualifica e passa a oportunidade", d: "A IA conversa e o vendedor recebe quando existe oportunidade." }
  ];
  var PERIODOS = {
    "Hoje": [["Leads novos", "21", "hoje"], ["Follow-ups", "186", "feitos pelo Torque"], ["Reuniões", "6", "marcadas"], ["Vendas", "2", "fechadas"]],
    "Semana": [["Leads novos", "112", "nesta semana"], ["Follow-ups", "964", "feitos pelo Torque"], ["Reuniões", "31", "marcadas"], ["Vendas", "9", "fechadas"]],
    "Mês": [["Leads novos", "406", "108% sobre o mês anterior"], ["Follow-ups", "3.812", "feitos pelo Torque"], ["Reuniões", "118", "marcadas"], ["Vendas", "37", "fechadas"]]
  };

  /* ---------- ícones ---------- */
  function svg(children, extra) {
    return h("svg", Object.assign({ viewBox: "0 0 24 24" }, extra || {}), children);
  }
  function p(d) { return h("path", { d: d }); }
  var ICONS = {
    comando: function () { return svg([p("M12 14l4-4"), p("M3.3 19a10 10 0 1 1 17.4 0")]); },
    metricas: function () { return svg([p("M3 3v18h18"), p("M7 15l4-5 3 3 5-7")]); },
    chat: function () { return svg([p("M13 2 3 14h9l-1 8 10-12h-9z")]); },
    envio: function () { return svg([p("M22 2 11 13M22 2l-7 20-4-9-9-4z")]); },
    funis: function () { return svg([h("circle", { cx: 6, cy: 6, r: 3 }), h("circle", { cx: 18, cy: 6, r: 3 }), h("circle", { cx: 6, cy: 18, r: 3 }), p("M6 9v6M18 9a6 6 0 0 1-6 6H9")]); },
    carteira: function () { return svg([h("rect", { x: 3, y: 6, width: 18, height: 14, rx: 3 }), p("M3 10h18M16 15h2")]); },
    robo: function () { return svg([h("rect", { x: 4, y: 8, width: 16, height: 11, rx: 3 }), p("M12 8V4M9 13h.01M15 13h.01")]); },
    automacoes: function () { return svg([h("rect", { x: 3, y: 3, width: 8, height: 8, rx: 2 }), h("rect", { x: 13, y: 13, width: 8, height: 8, rx: 2 }), p("M11 7h4a2 2 0 0 1 2 2v4")]); }
  };

  var nextId = 0;

  function TorqueApp(mount) {
    this.mount = mount;
    this.tour = (mount.getAttribute("data-tour") || "on") === "on";
    this.draftId = "ta-draft-" + (++nextId);
    this.state = {
      tab: mount.getAttribute("data-start") || "comando", t: 0, hold: 0,
      sel: 0, chatSel: 0, ia: true, draft: "", extra: [],
      pos: { roberto: 0, marcio: 0, fabio: 0, katia: 1, daniela: 1, patricia: 1, rodrigo: 2, luciana: 2, simone: 2, aline: 3, ivone: 3, henrique: 3, paulo: 4, ricardo: 4, bianca: 4 }, moved: null,
      carSel: 0, carF: "todos", on: true, node: null, per: "Mês"
    };
    this.tree = [];
    this.reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (this.reduced) this.state.t = 4;
    this.render();
    var self = this;
    var hold = function () { self.state.hold = Date.now() + HOLD_MS; };
    mount.addEventListener("pointerdown", hold);
    mount.addEventListener("focusin", hold);
    if (!this.reduced) this.schedule();
  }

  /* Fora da viewport não há timer. Com reduced-motion ele nunca é criado. */
  TorqueApp.prototype.schedule = function () {
    var self = this;
    var start = function () { if (!self.timer) self.timer = setInterval(function () { self.tick(); }, TICK_MS); };
    var stop = function () { clearInterval(self.timer); self.timer = null; };
    if (!window.IntersectionObserver) { start(); return; }
    new IntersectionObserver(function (entries) {
      if (entries[entries.length - 1].isIntersecting) start(); else stop();
    }, { threshold: 0.2 }).observe(this.mount);
  };

  TorqueApp.prototype.set = function (patch) {
    Object.assign(this.state, patch);
    this.render();
  };

  TorqueApp.prototype.tick = function () {
    var s = this.state;
    if (document.hidden || Date.now() < s.hold) return;
    /*
     * Foco de teclado ou campo de texto dentro da demo: nada troca de tela nem some debaixo dele.
     * Clique de mouse deixa foco no botão sem :focus-visible; esse caso retoma depois dos 12 s.
     */
    var active = document.activeElement;
    if (this.mount.contains(active) && active.matches(":focus-visible")) return;
    if (this.tour && s.t >= 6) {
      this.set({ tab: TABS[(TABS.indexOf(s.tab) + 1) % TABS.length], t: 0 });
      return;
    }
    var next = { t: s.t + 1 };
    if (s.tab === "funis" && s.t % 2 === 0) {
      next.pos = Object.assign({}, s.pos, { roberto: (s.pos.roberto + 1) % 5 });
      next.moved = "roberto";
    }
    if (s.tab === "carteira") next.carSel = (s.carSel + 1) % 5;
    if (s.tab === "comando") next.sel = s.t < 1 ? 0 : (s.sel + 1) % 6;
    this.set(next);
  };

  /* Qualquer clique do visitante segura o autoplay por 12 s. */
  TorqueApp.prototype.touch = function (patch) {
    this.set(Object.assign({ hold: Date.now() + HOLD_MS }, patch));
  };

  TorqueApp.prototype.render = function () {
    var tree = [this.view()];
    patchKids(this.mount, this.tree, tree);
    this.tree = tree;
  };

  TorqueApp.prototype.navBtn = function (tab, label, icon) {
    var self = this, s = this.state;
    return h("button", { type: "button", "class": "ta-nav" + (s.tab === tab ? " on" : ""), "aria-label": label, "aria-current": s.tab === tab ? "true" : null, on: { click: function () { self.touch({ tab: tab, t: 0 }); } } }, ICONS[icon || tab]());
  };

  TorqueApp.prototype.view = function () {
    var self = this, s = this.state;
    var pillOn = s.tab === "automacoes" ? 1 : 0;
    var off = function (icon) { return h("span", { "class": "ta-nav off", "aria-hidden": "true" }, ICONS[icon]()); };
    var mob = function (tab, label) {
      return h("button", { type: "button", "class": "ta-nav" + (s.tab === tab ? " on" : ""), "aria-current": s.tab === tab ? "true" : null, on: { click: function () { self.touch({ tab: tab, t: 0 }); } } }, label);
    };
    var scene = { comando: this.comando, chat: this.chat, funis: this.funis, carteira: this.carteira, automacoes: this.automacoes, metricas: this.metricas }[s.tab].call(this);

    return h("div", { "class": "ta", role: "group", "aria-label": "Demonstração interativa do Torque", style: "font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: hsl(36 12% 10%)" },
      h("nav", { "class": "ta-rail", "aria-label": "Telas do sistema" },
        h("span", { "class": "ta-brand", "aria-hidden": "true" }, h("svg", { viewBox: "0 0 24 24", width: 24, height: 24, fill: "none", stroke: "hsl(30 85% 54%)", "stroke-width": 3 }, p("M8 3h8l5 9-5 9H8l-5-9z"), h("circle", { cx: 12, cy: 12, r: 2.5, fill: "hsl(30 85% 54%)", stroke: "none" }))),
        this.navBtn("comando", "Comando"), this.navBtn("metricas", "Métricas"), this.navBtn("chat", "Chat"), off("envio"),
        this.navBtn("funis", "Funis"), this.navBtn("carteira", "Carteira"),
        h("i", { "class": "ta-div", "aria-hidden": "true" }), off("robo"),
        this.navBtn("automacoes", "Automações"),
        h("span", { "class": "ta-av", "aria-hidden": "true" }, "AS")
      ),
      h("div", { "class": "ta-body" },
        h("header", { "class": "ta-top" },
          h("span", { "class": "ta-org" }, h("b", { "class": "ta-orgdot" }, "A"), "Aurora Distribuidora"),
          h("span", { "class": "ta-pill" }, PILLS[s.tab].map(function (t, i) { return h("span", { "class": i === pillOn ? "on" : "" }, t); })),
          h("span", { "class": "ta-me" },
            h("span", { "class": "ta-bell", "aria-hidden": "true" }, h("svg", { viewBox: "0 0 24 24" }, p("M6 9a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 21h4")), h("b", null, 2 + (s.t >= 1 ? 1 : 0))),
            h("span", { "class": "ta-user" }, "Ana Souza", h("em", null, "Gestora comercial"))
          )
        ),
        scene,
        h("nav", { "class": "ta-mobnav", "aria-label": "Telas do sistema" }, mob("comando", "Comando"), mob("chat", "Chat"), mob("funis", "Funis"), mob("carteira", "Carteira"), mob("automacoes", "Automações"), mob("metricas", "Métricas"))
      )
    );
  };

  function kpi(small, value, em, cls) {
    return h("div", { "class": "ta-kpi" + (cls ? " " + cls : "") }, h("small", null, small), h("b", null, value), h("em", null, em));
  }
  function tiles(rows) {
    return h("div", { "class": "ta-tiles" }, rows.map(function (r) { return h("div", null, h("em", null, r[0]), h("b", null, r[1])); }));
  }
  function rt(b, em) {
    return h("span", { "class": "ta-rt" }, h("b", null, b), h("em", null, em));
  }

  TorqueApp.prototype.comando = function () {
    var self = this, s = this.state, t = s.t;
    var fila = t >= 1 ? [NOVO].concat(FILA) : FILA;
    var foco = fila[Math.min(s.sel, fila.length - 1)];
    return h("div", { "class": "ta-scene", key: "comando" },
      h("div", { "class": "ta-head" }, h("div", null, h("h3", null, "Comando"), h("p", null, "Próximos passos da operação — central de trabalho da equipe.")), h("span", { "class": "ta-gold" }, "+ Novo lead")),
      h("div", { "class": "ta-kpis" },
        kpi("Clientes esperando", fila.length, "Fila de resposta da equipe"),
        kpi("Tarefas abertas", Math.max(5, 12 - t), "Do time, para hoje"),
        kpi("Follow-ups automáticos", 214 + t * 3, "Feitos pelo Torque hoje"),
        kpi("Reuniões hoje", 3 + (t >= 4 ? 1 : 0), "Marcadas pelo time e pela IA")
      ),
      h("div", { "class": "ta-ink" },
        h("div", { "class": "ta-inkhead" }, h("b", null, "Conversas aguardando"), h("span", { "class": "ta-count" }, fila.length + " clientes"), h("span", { "class": "ta-ghost" }, "Abrir chat →")),
        h("div", { "class": "ta-inksplit" },
          h("div", { "class": "ta-queue" }, fila.map(function (r, i) {
            var cls = "ta-row" + (r === foco ? " on" : "") + (r === NOVO && t < 3 ? " arrive" : "");
            return h("button", { type: "button", "class": cls, on: { click: function () { self.touch({ sel: i }); } } },
              h("span", { "class": "ta-avatar" }, r.ini), rt(r.empresa, r.msg), h("time", null, r.hora));
          })),
          h("div", { "class": "ta-focus" },
            h("small", null, foco.tag), h("h4", null, foco.empresa), h("p", null, foco.contato),
            tiles([["Negócio", foco.valor], ["Etapa", foco.etapa], ["Próxima ação", foco.acao]]),
            h("ul", { "class": "ta-log" }, h("li", null, "Follow-up enviado automaticamente"), h("li", null, "Cliente respondeu no WhatsApp"), h("li", null, "Oportunidade criada para o vendedor")),
            h("span", { "class": "ta-oncta" }, "Abrir conversa →")
          )
        )
      )
    );
  };

  TorqueApp.prototype.chat = function () {
    var self = this, s = this.state, t = s.t;
    var atual = CONV[s.chatSel];
    var live = s.chatSel === 0 && s.ia;
    var nShown = live ? Math.min(t + 1, atual.msgs.length) : atual.msgs.length;
    var msgs = atual.msgs.slice(0, nShown).concat(s.extra.filter(function (m) { return m.c === s.chatSel; }));
    return h("div", { "class": "ta-chat", key: "chat" },
      h("aside", { "class": "ta-inbox" },
        h("div", { "class": "ta-inboxh" }, h("b", null, "Inbox"), h("span", { "class": "ta-count" }, (5 - (t >= 3 ? 1 : 0)) + " não lidas")),
        CONV.map(function (c, i) {
          return h("button", { type: "button", "class": "ta-row" + (i === s.chatSel ? " on" : ""), on: { click: function () { self.touch({ chatSel: i }); } } },
            h("span", { "class": "ta-avatar" }, c.ini), rt(c.nome, c.prev), h("time", null, c.hora));
        })
      ),
      h("section", { "class": "ta-conv" },
        h("div", { "class": "ta-convh" }, h("span", { "class": "ta-avatar v" }, atual.ini), rt(atual.nome, atual.empresa), h("span", { "class": "ta-live" }, "Ao vivo")),
        h("div", { "class": "ta-iabar" + (s.ia ? "" : " off") },
          h("span", null, h("b", null, s.ia ? "IA ativa" : "IA pausada"), s.ia ? " O Copilot está atendendo esta conversa." : " Você assumiu esta conversa."),
          h("button", { type: "button", on: { click: function () { self.touch({ ia: !self.state.ia }); } } }, s.ia ? "Pausar IA" : "Devolver à IA")
        ),
        h("div", { "class": "ta-msgs" },
          msgs.map(function (m) {
            return h("div", { "class": "ta-msg" + (m.me ? " me" : "") + (m.ai ? " ai" : "") }, m.ai ? h("small", null, "Copilot") : null, m.t, h("time", null, m.h));
          }),
          live && nShown < atual.msgs.length ? h("div", { "class": "ta-typing", role: "img", "aria-label": "Digitando" }, h("i"), h("i"), h("i")) : null
        ),
        h("form", { "class": "ta-compose", on: { submit: function (e) {
          e.preventDefault();
          var st = self.state, v = st.draft.trim();
          if (!v) return;
          self.touch({ draft: "", ia: false, extra: st.extra.concat([{ t: v, h: "agora", me: true, c: st.chatSel }]) });
        } } },
          h("label", { "class": "ta-sr", "for": this.draftId }, "Mensagem"),
          h("input", { id: this.draftId, value: s.draft, placeholder: "Escreva uma mensagem", autocomplete: "off", on: { input: function (e) { self.touch({ draft: e.target.value }); } } }),
          h("button", { type: "submit", "aria-label": "Enviar" }, "→")
        )
      ),
      h("aside", { "class": "ta-lead" },
        h("div", { "class": "ta-leadc" }, h("small", null, "Lead"), h("h4", null, atual.nome), h("p", null, atual.empresa), h("div", null, h("em", null, "Negócio · " + atual.etapa), h("b", null, atual.valor))),
        h("h5", null, "Funis do lead"),
        h("div", { "class": "ta-frow" }, h("b", null, "Vendas"), h("span", null, atual.etapa)),
        h("div", { "class": "ta-frow g" }, h("b", null, "Recompra & Upsell"), h("span", null, "Ciclo vencendo")),
        h("h5", null, "Responsáveis"),
        h("div", { "class": "ta-frow" }, h("b", null, "Pré-venda"), h("span", null, "Copilot")),
        h("div", { "class": "ta-frow" }, h("b", null, "Vendas"), h("span", null, "Rafael Martins"))
      )
    );
  };

  TorqueApp.prototype.funis = function () {
    var self = this, s = this.state;
    return h("div", { "class": "ta-scene", key: "funis" },
      h("div", { "class": "ta-head" }, h("div", null, h("h3", null, "Funis"), h("p", null, "Clique em um cartão para avançar de etapa.")),
        h("span", { "class": "ta-darkpill" }, "Negócios ", h("b", null, 27), " Conversão ", h("b", null, (11.1 + s.pos.roberto * 0.2).toFixed(1).replace(".", ",") + "%"))),
      h("div", { "class": "ta-kanban" }, COLS.map(function (col, i) {
        var list = CARDS.filter(function (k) { return s.pos[k.id] === i; })
          .sort(function (a, b) { return (b.id === s.moved) - (a.id === s.moved); });
        return h("div", { "class": "ta-col" },
          h("header", null, h("i", { style: "background: " + col[1] }), h("b", null, col[0]), h("span", null, list.length + 3)),
          list.map(function (k) {
            var moved = k.id === s.moved;
            return h("button", { type: "button", "class": "ta-card-k" + (moved ? " just" : ""), on: { click: function () {
              var pos = Object.assign({}, self.state.pos);
              pos[k.id] = (pos[k.id] + 1) % 5;
              self.touch({ moved: k.id, pos: pos });
            } } },
              h("span", { "class": "ta-kh" }, h("span", { "class": "ta-avatar s" }, k.ini), rt(k.nome, k.emp)),
              h("span", { "class": "ta-kv" }, k.valor),
              h("span", { "class": "ta-kt" }, h("i", null, k.origem), h("i", null, k.idade)),
              moved && AUTO[i] ? h("span", { "class": "ta-kauto" }, AUTO[i]) : null
            );
          })
        );
      }))
    );
  };

  TorqueApp.prototype.carteira = function () {
    var self = this, s = this.state, t = s.t;
    var lista = s.carF === "atr" ? CLIENTES.filter(function (c) { return c.atr; }) : CLIENTES;
    var foco = lista[s.carSel % lista.length];
    return h("div", { "class": "ta-scene", key: "carteira" },
      h("div", { "class": "ta-head" }, h("div", null, h("h3", null, "Carteira de Clientes"), h("p", null, "Quem já compra, quando vai comprar de novo e quem está esfriando.")), h("span", { "class": "ta-gold" }, "Nova venda")),
      h("div", { "class": "ta-kpis" },
        kpi("Receita recorrente", "R$ 291.759", "clientes em dia com a recompra"),
        kpi("Pedidos esperados", 8 + (t % 3), "próximos 7 dias"),
        kpi("Em reativação", 47 + t, "contatos automáticos em andamento"),
        kpi("Recompra atrasada", 2, "R$ 34.000 em risco", "red")
      ),
      h("div", { "class": "ta-ink" },
        h("div", { "class": "ta-inkhead" }, h("b", null, "Radar de recompra"), h("span", { "class": "ta-count" }, lista.length + " clientes"),
          h("span", { "class": "ta-seg" },
            h("button", { type: "button", "class": s.carF === "todos" ? "on" : "", on: { click: function () { self.touch({ carF: "todos", carSel: 0 }); } } }, "Todos"),
            h("button", { type: "button", "class": s.carF === "atr" ? "on" : "", on: { click: function () { self.touch({ carF: "atr", carSel: 0 }); } } }, "Atrasados")
          )
        ),
        h("div", { "class": "ta-inksplit" },
          h("div", { "class": "ta-queue" }, lista.map(function (c, i) {
            return h("button", { type: "button", "class": "ta-row" + (c === foco ? " on" : ""), on: { click: function () { self.touch({ carSel: i }); } } },
              h("span", { "class": "ta-avatar sq" }, c.ini), rt(c.nome, c.ciclo), h("i", { "class": "ta-st" }, c.status));
          })),
          h("div", { "class": "ta-focus" },
            h("small", null, foco.tag), h("h4", null, foco.nome), h("p", null, foco.frequencia),
            tiles([["Próximo pedido", foco.prox], ["Último pedido", foco.ult], ["Ticket médio", foco.ticket]]),
            h("span", { "class": "ta-action" }, h("i"), foco.acao)
          )
        )
      )
    );
  };

  TorqueApp.prototype.automacoes = function () {
    var self = this, s = this.state, t = s.t;
    var live = s.on ? t % NOS.length : -1;
    var blocos = [["g", "Ação"], ["y", "Condição"], ["p", "Delay"], ["o", "Esperar Resposta"], ["y", "Janela Comercial"], ["r", "Definir Responsável"], ["b", "Copilot (Handoff)"]];
    var fluxo = [];
    NOS.forEach(function (n, i) {
      fluxo.push(h("button", { type: "button", "class": "ta-node" + (i === 0 ? " ink" : "") + (i === live ? " live" : "") + (i === s.node ? " sel" : ""), on: { click: function () { self.touch({ node: i }); } } },
        h("span", { "class": "ta-nic" }, n.ic), rt(n.t, n.s)));
      if (i < NOS.length - 1) fluxo.push(h("i", { "class": "ta-edge" + (i === live ? " run" : ""), "aria-hidden": "true" }));
    });
    return h("div", { "class": "ta-scene", key: "automacoes" },
      h("div", { "class": "ta-autobar" }, h("b", null, "Reativação de cliente parado"),
        h("button", { type: "button", "class": "ta-sw" + (s.on ? " on" : ""), role: "switch", "aria-checked": String(s.on), on: { click: function () { self.touch({ on: !self.state.on }); } } }, h("span", null, s.on ? "Ativo" : "Pausado"), h("i"))
      ),
      h("div", { "class": "ta-editor" },
        h("aside", { "class": "ta-blocks" }, h("b", null, "Blocos"), blocos.map(function (b) { return h("span", null, h("i", { "class": b[0] }), b[1]); })),
        h("div", { "class": "ta-flow" }, fluxo),
        h("aside", { "class": "ta-resumo" }, h("b", null, "Resumo"),
          h("div", null, h("em", null, "Gatilho"), h("b", null, "Sem compra há 60 dias")),
          h("div", null, h("em", null, "Execuções hoje"), h("b", null, 128 + (s.on ? t * 2 : 0))),
          h("div", null, h("em", null, "Responderam"), h("b", null, 31 + (s.on ? Math.floor(t / 2) : 0))),
          h("div", null, h("em", null, "Com o vendedor"), h("b", null, 9 + (s.on ? Math.floor(t / 4) : 0))),
          h("p", null, NOS[s.node === null ? Math.max(live, 0) : s.node].d)
        )
      )
    );
  };

  TorqueApp.prototype.metricas = function () {
    var self = this, s = this.state;
    var meta = Math.min(88, 70 + s.t * 3);
    return h("div", { "class": "ta-scene", key: "metricas" },
      h("div", { "class": "ta-head" }, h("div", null, h("h3", null, "Estúdio de Métricas"), h("p", null, "Os indicadores da organização, no período que você escolher.")),
        h("span", { "class": "ta-seg light" }, Object.keys(PERIODOS).map(function (per) {
          return h("button", { type: "button", "class": per === s.per ? "on" : "", on: { click: function () { self.touch({ per: per }); } } }, per);
        }))
      ),
      h("div", { "class": "ta-kpis" }, PERIODOS[s.per].map(function (k) { return kpi(k[0], k[1], k[2]); })),
      h("div", { "class": "ta-charts" },
        h("div", { "class": "ta-card" }, h("small", null, "Meta do mês"), h("b", { "class": "ta-big" }, meta + "%"), h("div", { "class": "ta-bar" }, h("i", { style: "width: " + meta + "%" })), h("em", null, "no ritmo · esperado 57%")),
        h("div", { "class": "ta-card" }, h("small", null, "Faturamento acumulado"),
          h("svg", { "class": "ta-line", viewBox: "0 0 600 180", preserveAspectRatio: "none", role: "img", "aria-label": "Linha de faturamento acima da linha esperada" },
            h("path", { "class": "exp", d: "M0 170 L600 20" }),
            h("path", { "class": "area", d: "M0 170 L60 150 L130 140 L190 105 L260 90 L320 60 L390 48 L440 32 L440 180 L0 180 Z" }),
            h("path", { "class": "real", d: "M0 170 L60 150 L130 140 L190 105 L260 90 L320 60 L390 48 L440 32" }),
            h("circle", { cx: 440, cy: 32, r: 6 })
          )
        )
      )
    );
  };

  Array.prototype.forEach.call(document.querySelectorAll("[data-torque-app]"), function (mount) {
    new TorqueApp(mount);
  });
})();
