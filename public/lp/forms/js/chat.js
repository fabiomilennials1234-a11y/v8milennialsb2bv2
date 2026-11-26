/* =========================================================================
   TORQUE · Cadastro interativo (chat)
   Copy: "25.11 TORQUE FORMS — Milennials". Integração: webhook n8n das LPs
   (workflow "Torque · Landing Pages → TorqueCRM") + agenda Cal.com sorteada.
   ========================================================================= */
(function () {
  "use strict";

  /* ---------------- Configuração ---------------- */
  var CONFIG = {
    webhook: "https://n8nwebhook.v3l8jq.easypanel.host/webhook/torque-lp-lead",
    lp: "iaparab2b",
    totalSteps: 8,
    // Só a agenda do Gabriel nesta LP (as outras LPs sorteiam Leo/Gabriel).
    // Para voltar a sortear, adicione mais itens: a escolha abaixo funciona com qualquer quantidade.
    agendas: [
      { id: "gabriel", host: "Gabriel", calLink: "gabriel-aurelio-gipp-uekpuj/30min" }
    ]
  };
  var AGENDA = CONFIG.agendas[Math.floor(Math.random() * CONFIG.agendas.length)];

  /* ---------------- Copy (documento) ---------------- */
  var T = {
    intro1: "O Torque desenvolve inteligências artificiais especializadas em indústrias e distribuidoras pra atender novos compradores, recuperar clientes que pararam de comprar e aumentar o faturamento da sua empresa.",
    intro2: "Agende uma apresentação e veja como aplicar essas inteligências artificiais no seu comercial.",
    askNome: "Bora começar? Qual seu nome?",
    phNome: "Digite seu nome e sobrenome...",
    askWhats: "Prazer, {nome}! Qual seu WhatsApp?",
    phWhats: "(11) 99999-9999",
    askCargo: "E qual o seu cargo na empresa?",
    cargos: ["Proprietário ou fundador", "Sócio", "CEO ou presidente", "Diretor", "Gerente ou coordenador comercial", "Vendedor ou representante comercial", "Outro"],
    cargoDono: "Perfeito, {nome}! Vamos te mostrar como a inteligência artificial pode aumentar a capacidade comercial da sua empresa pra aumentar seu faturamento, sem necessariamente precisar contratar mais vendedores.",
    cargoGestor: "Perfeito, {nome}! Vamos te mostrar como a inteligência artificial pode ajudar seus vendedores a aproveitarem melhor as oportunidades comerciais e aumentarem suas vendas.",
    cargoVendedor: "Legal, {nome}! A inteligência artificial do Torque pode ajudar você a dedicar mais tempo às negociações e ao fechamento de pedidos.",
    askDecVendedor: "Você participa das decisões sobre a contratação de novas ferramentas comerciais na empresa?",
    decVendedor: ["Sim, sou um dos responsáveis", "Participo da decisão", "Não, outra pessoa é responsável"],
    askDecOutro: "Entendi! Você participa das decisões comerciais da empresa?",
    decOutro: ["Sim", "Participo junto com outras pessoas", "Não"],
    askEmpresa: "Me conta um pouco sobre sua empresa. Hoje, vocês são uma indústria ou distribuidora?",
    empresas: ["Indústria / Fábrica", "Distribuidora / Atacadista", "Indústria e distribuidora", "Outro tipo de empresa"],
    empIndustria: "Excelente! O Torque é especializado na realidade comercial das indústrias, desde o atendimento de novos lojistas até a recuperação de clientes que pararam de comprar.",
    empDistribuidora: "Excelente! O Torque é especializado em operações comerciais como a sua, ajudando distribuidoras a atenderem mais compradores e aumentarem as vendas dentro da própria carteira de clientes.",
    empAmbas: "Perfeito! As inteligências artificiais do Torque foram desenvolvidas justamente pra operações comerciais como a sua.",
    askModelo: "Entendi! Hoje, sua empresa vende principalmente para outras empresas ou para consumidores finais?",
    modelos: ["Para outras empresas (B2B)", "Para consumidores finais (B2C)", "Para ambos"],
    askFat: "Hoje, qual é o faturamento médio mensal da sua empresa?",
    fats: ["Até R$ 50 mil/mês", "De R$ 50 mil a R$ 100 mil/mês", "De R$ 100 mil a R$ 300 mil/mês", "De R$ 300 mil a R$ 500 mil/mês", "De R$ 500 mil a R$ 1 milhão/mês", "De R$ 1 milhão a R$ 5 milhões/mês", "Acima de R$ 5 milhões/mês"],
    fatBaixo: "Entendi! Nessa fase, aproveitar melhor cada oportunidade comercial pode ajudar sua empresa a crescer sem aumentar tanto os custos da operação.",
    fatMedio: "Perfeito! Vamos identificar onde a inteligência artificial pode ajudar sua empresa a aproveitar melhor as oportunidades comerciais pra aumentar seu faturamento.",
    fatAlto: "Com esse volume de faturamento, faz sentido entender quanto sua empresa pode estar deixando de vender por falta de atendimento, acompanhamento comercial ou reativação de clientes antigos.",
    askDif: "Agora me conta: em qual dessas situações você acredita que sua empresa mais perde oportunidades de venda hoje?",
    difs: [
      ["Demora pra atender novos clientes", [
        "É exatamente isso que a <strong>IA SDR</strong> do Torque ajuda a resolver. Ela atende os compradores que chegam pelo WhatsApp 24 horas por dia, inclusive quando seu comercial não está trabalhando.",
        "Na apresentação, vamos te mostrar como utilizar essa inteligência artificial pra reduzir a perda de oportunidades e aumentar suas vendas."]],
      ["Vendedores atendendo muitos curiosos", [
        "A <strong>IA SDR</strong> do Torque atende e qualifica os novos compradores de acordo com o perfil de cliente ideal da sua empresa.",
        "Assim, seus vendedores podem dedicar mais tempo a negociar com compradores qualificados e fechar pedidos."]],
      ["Clientes antigos que pararam de comprar", [
        "O Torque possui uma inteligência artificial desenvolvida justamente pra recuperar clientes que pararam de comprar de indústrias e distribuidoras.",
        "Na apresentação, vamos te mostrar como trabalhar sua própria base de clientes pra aumentar seu faturamento."]],
      ["Orçamentos enviados que não viram vendas", [
        "Muitas vezes, esses compradores ainda têm interesse nos seus produtos, mas ninguém do comercial dá continuidade à negociação.",
        "Na apresentação, vamos avaliar como a inteligência artificial pode ajudar sua empresa a recuperar essas oportunidades e aumentar suas vendas."]],
      ["Clientes atuais que poderiam comprar mais", [
        "Você não precisa necessariamente conquistar novos clientes pra aumentar seu faturamento.",
        "Vamos te mostrar como a <strong>IA Vendedora</strong> do Torque pode ajudar sua empresa a aproveitar melhor as oportunidades de venda dentro da própria carteira de clientes."]],
      ["Falta de vendedores pra atender toda a demanda", [
        "O Torque possui três inteligências artificiais que atuam em diferentes etapas da operação comercial: atendimento e qualificação, vendas e recuperação de clientes antigos.",
        "Vamos te mostrar como aumentar sua capacidade comercial sem necessariamente precisar contratar mais vendedores."]],
      ["Tenho mais de uma dessas dificuldades", [
        "Entendi! Nesse caso, faz sentido te apresentar o ecossistema completo do Torque.",
        "Além das três inteligências artificiais, você ainda recebe um CRM e uma plataforma de disparos pra trabalhar sua base de clientes."]],
      ["Quero entender como aplicar IA na minha empresa", [
        "Perfeito! Na nossa apresentação, vamos entender como funciona seu comercial e identificar quais inteligências artificiais fazem mais sentido pra aumentar o faturamento da sua empresa."]]
    ],
    email1: "Estamos quase lá, {nome}!",
    email2: "Qual seu melhor e-mail? Vamos enviar por lá as informações da nossa apresentação.",
    phEmail: "Seu melhor e-mail...",
    agenda1: "Tudo certo, {nome}!",
    agenda2: "Agora, agende uma apresentação gratuita e veja na prática como as inteligências artificiais do Torque podem ajudar sua empresa a aumentar as vendas e o faturamento.",
    calTitle: "Agenda Torque",
    calSub: "Escolha o melhor horário para sua apresentação gratuita.",
    booked1: "Pronto, {nome}! Sua apresentação com o Torque está agendada.",
    booked2: "Nosso time vai te mostrar como aplicar inteligência artificial na sua operação comercial, considerando as informações que você compartilhou com a gente.",
    booked3: "Até lá!",
    fora1: "O Torque é especializado na operação comercial de indústrias e distribuidoras.",
    fora2: "Pelas informações que você compartilhou, precisamos avaliar se nossas soluções fazem sentido para o modelo de negócio da sua empresa.",
    fora3: "Vamos encaminhar seu contato para nosso time avaliar.",
    foraBtn: "Finalizar cadastro",
    alt1: "Não encontrou um horário que funciona pra você?",
    alt2: "Nosso time pode entrar em contato pelo WhatsApp pra combinar o melhor momento para sua apresentação.",
    altBtn: "Prefiro agendar pelo WhatsApp"
  };

  var GRUPO_DONO = [T.cargos[0], T.cargos[1], T.cargos[2]];
  var GRUPO_GESTOR = [T.cargos[3], T.cargos[4]];
  var CARGO_VENDEDOR = T.cargos[5];

  /* ---------------- Utilidades ---------------- */
  var doc = document;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var thread = doc.getElementById("thread");
  var answer = doc.getElementById("answer");
  var typing = doc.getElementById("typing");
  var AV = '<span class="row__av" aria-hidden="true"><img src="assets/torque-icone-192.png" width="28" height="25" alt="" /></span>';

  var S = {
    nome: "", primeiro: "", whatsapp: "", email: "",
    cargo: "", decisor: "", empresa: "", modelo: "", faturamento: "", desafio: "",
    perfil: "prioritario", status: "", leadEventId: "", booked: false, whatsPref: false
  };
  var leadSent = Promise.resolve();

  function wait(ms) { return new Promise(function (r) { setTimeout(r, reduced ? Math.min(ms, 120) : ms); }); }
  function realWait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fill(s) { return s.replace(/\{nome\}/g, esc(S.primeiro)); }
  function el(tag, cls) { var e = doc.createElement(tag); if (cls) e.className = cls; return e; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  /* Cookie malformado não pode travar o envio do lead. */
  function cookie(n) {
    var m = doc.cookie.match(new RegExp("(?:^|; )" + n + "=([^;]*)"));
    if (!m) return "";
    try { return decodeURIComponent(m[1]); } catch (e) { return ""; }
  }
  /* Tempo do "digitando…" proporcional ao tamanho da mensagem (as poucas tags de ênfase não mudam o ritmo). */
  function typingTime(html) { return Math.max(650, Math.min(1900, 380 + html.length * 12)); }

  function scrollToEnd() {
    requestAnimationFrame(function () {
      window.scrollTo({ top: doc.documentElement.scrollHeight, behavior: reduced ? "auto" : "smooth" });
    });
  }

  /* ---------------- Progresso ---------------- */
  function setStep(n, pct) {
    var p = typeof pct === "number" ? pct : Math.round((n - 1) / CONFIG.totalSteps * 100);
    doc.getElementById("stepNow").textContent = String(Math.min(n, CONFIG.totalSteps));
    doc.getElementById("progressFill").style.width = p + "%";
    doc.getElementById("progress").setAttribute("aria-valuenow", String(p));
  }

  /* ---------------- Mensagens ---------------- */
  function lastIsBot() { var l = thread.lastElementChild; return !!(l && l.classList.contains("row--bot")); }

  function bot(html, opt) {
    opt = opt || {};
    var first = !lastIsBot();
    typing.classList.toggle("is-first", first);
    typing.hidden = false;
    if (!opt.noScroll) scrollToEnd();
    return wait(typingTime(html)).then(function () {
      typing.hidden = true;
      var li = el("li", "row row--bot is-new" + (first ? " is-first" : ""));
      li.innerHTML = AV + '<div class="bubble"><span class="sr-only">Torque: </span>' + html + "</div>";
      thread.appendChild(li);
      if (!opt.noScroll) scrollToEnd();
      return wait(260);
    });
  }
  function bots(list, opt) {
    return list.reduce(function (p, h) { return p.then(function () { return bot(h, opt); }); }, Promise.resolve());
  }
  function user(text) {
    var li = el("li", "row row--user is-new");
    li.innerHTML = '<div class="bubble"><span class="sr-only">Você: </span><span class="t"></span></div>';
    li.querySelector(".t").textContent = text;
    thread.appendChild(li);
    scrollToEnd();
  }
  function showAnswer(node, noScroll) {
    answer.innerHTML = "";
    answer.classList.remove("is-in");
    answer.appendChild(node);
    void answer.offsetWidth;
    answer.classList.add("is-in");
    if (!noScroll) scrollToEnd();
  }

  /* ---------------- Opções ---------------- */
  var KEYS = "ABCDEFGHIJ";
  function askOptions(list, label) {
    return new Promise(function (resolve) {
      var fs = el("fieldset", "opts" + (list.some(function (o) { return o.length > 34; }) ? " opts--wide" : ""));
      var lg = el("legend", "sr-only"); lg.textContent = label || "Escolha uma opção"; fs.appendChild(lg);
      var done = false;
      var btns = list.map(function (txt, i) {
        var b = el("button", "opt"); b.type = "button";
        b.innerHTML = '<span class="opt__k" aria-hidden="true">' + KEYS[i] + '</span><span class="opt__t"></span>';
        b.querySelector(".opt__t").textContent = txt;
        b.addEventListener("click", function () { pick(i); });
        fs.appendChild(b);
        return b;
      });
      function onKey(e) {
        if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
        var i = KEYS.indexOf(String(e.key).toUpperCase());
        if (i >= 0 && i < list.length) { e.preventDefault(); pick(i); }
      }
      function pick(i) {
        if (done) return; done = true;
        doc.removeEventListener("keydown", onKey);
        btns[i].classList.add("is-picked"); fs.classList.add("is-done");
        btns.forEach(function (b) { b.disabled = true; });
        wait(280).then(function () { answer.innerHTML = ""; user(list[i]); resolve(list[i]); });
      }
      doc.addEventListener("keydown", onKey);
      showAnswer(fs);
      if (finePointer) btns[0].focus({ preventScroll: true });
    });
  }

  /* ---------------- Botão de ação ---------------- */
  function askAction(label, ghost, noScroll) {
    return new Promise(function (resolve) {
      var b = el("button", "act" + (ghost ? " act--ghost" : "")); b.type = "button";
      b.innerHTML = '<span class="act__t"></span><span class="act__ic" aria-hidden="true"><svg width="18" height="18"><use href="#i-' + (ghost ? "chat" : "arrow") + '"/></svg></span>';
      b.querySelector(".act__t").textContent = label;
      b.addEventListener("click", function () { b.disabled = true; answer.innerHTML = ""; user(label); resolve(label); });
      showAnswer(b, noScroll);
    });
  }

  /* ---------------- Campo de texto ---------------- */
  function askText(o) {
    return new Promise(function (resolve) {
      var form = el("form", "composer"); form.noValidate = true;
      form.innerHTML =
        '<label class="sr-only" for="f-' + o.name + '">' + esc(o.label) + "</label>" +
        '<div class="composer__box"><input id="f-' + o.name + '" name="' + o.name + '" />' +
        '<button type="submit" aria-label="Enviar"><svg width="20" height="20" aria-hidden="true"><use href="#i-arrow"/></svg></button></div>' +
        '<div class="composer__hint"><span class="composer__err" role="alert"></span>' +
        (finePointer ? '<span class="composer__kbd" aria-hidden="true">Enter <kbd>↵</kbd></span>' : "") + "</div>";
      var input = form.querySelector("input"), err = form.querySelector(".composer__err"), sug = null;
      input.type = o.type || "text";
      input.placeholder = o.placeholder || "";
      input.autocomplete = o.autocomplete || "on";
      input.setAttribute("enterkeyhint", "send");
      if (o.inputmode) input.setAttribute("inputmode", o.inputmode);
      if (o.autocapitalize) input.setAttribute("autocapitalize", o.autocapitalize);
      if (o.type === "email") input.spellcheck = false;
      input.maxLength = o.maxLength || 120;

      input.addEventListener("input", function () {
        if (o.mask) { var v = o.mask(input.value); if (v !== input.value) input.value = v; }
        form.classList.remove("is-invalid"); err.textContent = "";
        if (o.suggest) {
          var s = o.suggest(input.value.trim());
          if (s && !sug) {
            sug = el("button", "suggest"); sug.type = "button";
            sug.addEventListener("click", function () { input.value = sug.getAttribute("data-v"); sug.remove(); sug = null; input.focus(); });
            form.appendChild(sug);
          }
          if (s) { sug.setAttribute("data-v", s); sug.innerHTML = "Você quis dizer <b>" + esc(s) + "</b>?"; }
          else if (sug) { sug.remove(); sug = null; }
        }
      });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var v = input.value.trim(), msg = o.validate(v);
        if (msg) {
          form.classList.remove("is-invalid"); void form.offsetWidth; form.classList.add("is-invalid");
          err.textContent = msg; input.focus();
          return;
        }
        var out = o.normalize ? o.normalize(v) : v;
        answer.innerHTML = "";
        user(o.display ? o.display(out) : out);
        resolve(out);
      });
      showAnswer(form);
      input.focus({ preventScroll: true });
    });
  }

  /* ---------------- Validações ---------------- */
  var PARTICULAS = /^(de|da|do|das|dos|e)$/i;
  function nomeNormalizado(v) {
    var s = v.replace(/\s+/g, " ").trim();
    var semMistura = s === s.toLowerCase() || s === s.toUpperCase();
    if (!semMistura) return s;
    return s.toLowerCase().split(" ").map(function (w, i) {
      return i > 0 && PARTICULAS.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }
  function validaNome(v) {
    var partes = v.replace(/\s+/g, " ").trim().split(" ").filter(function (p) { return p.length > 0; });
    if (!v) return "Digite seu nome e sobrenome.";
    if (/[0-9@_#$%*=+<>{}\[\]\\/|]/.test(v)) return "Use apenas letras no seu nome.";
    if (partes.length < 2 || partes[0].length < 2) return "Digite seu nome e sobrenome.";
    return "";
  }
  function soDigitos(v) {
    var d = String(v).replace(/\D/g, "");
    if ((d.length === 12 || d.length === 13) && d.indexOf("55") === 0) d = d.slice(2);
    return d.slice(0, 11);
  }
  function mascaraTel(v) {
    var d = soDigitos(v);
    if (d.length > 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
    if (d.length > 6) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    if (d.length > 2) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length > 0) return "(" + d;
    return "";
  }
  function validaTel(v) {
    var d = soDigitos(v);
    if (d.length < 10) return "Digite seu WhatsApp com DDD.";
    if (!/^[1-9][1-9]/.test(d)) return "Confira o DDD do seu WhatsApp.";
    if (d.length === 11 && d.charAt(2) !== "9") return "Confira o número do seu WhatsApp.";
    return "";
  }
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var DOMINIOS = {
    "gmail.con": "gmail.com", "gmail.co": "gmail.com", "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmial.com": "gmail.com", "gmai.com": "gmail.com",
    "gamil.com": "gmail.com", "gnail.com": "gmail.com", "gmail.com.br": "gmail.com", "gmaill.com": "gmail.com",
    "hotmail.con": "hotmail.com", "hotmail.co": "hotmail.com", "hotmal.com": "hotmail.com", "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com",
    "outlook.con": "outlook.com", "outlok.com": "outlook.com", "outlook.co": "outlook.com",
    "yahoo.con": "yahoo.com", "yahoo.com.b": "yahoo.com.br", "yaho.com": "yahoo.com",
    "icloud.con": "icloud.com", "icloud.co": "icloud.com"
  };
  function sugestaoEmail(v) {
    var m = v.toLowerCase().match(/^([^\s@]+)@([^\s@]+)$/);
    if (!m || !DOMINIOS[m[2]]) return "";
    return m[1] + "@" + DOMINIOS[m[2]];
  }
  function validaEmail(v) { return EMAIL_RE.test(v) ? "" : "Digite um e-mail válido."; }

  /* ---------------- Envio do lead (n8n → TorqueCRM) ---------------- */
  var PERFIL_LABEL = { prioritario: "", avaliacao_comercial: "avaliar perfil (outro tipo de empresa)", fora_do_perfil: "fora do perfil (vende para consumidor final)" };

  function payload(extra) {
    var q = new URLSearchParams(window.location.search);
    var d = {
      nome: S.nome,
      whatsapp: S.whatsapp,
      email: S.email,
      // campos que o workflow já grava (notes + campos personalizados)
      cargo: [S.cargo, S.decisor ? "decisão: " + S.decisor : ""].filter(Boolean).join(" · "),
      segmento: [S.empresa, S.modelo, PERFIL_LABEL[S.perfil]].filter(Boolean).join(" · "),
      faturamento: S.faturamento,
      desafio: S.desafio,
      // campos dedicados (para mapear no n8n quando quiser)
      cargo_informado: S.cargo,
      decisor: S.decisor,
      tipo_empresa: S.empresa,
      modelo_venda: S.modelo,
      perfil: S.perfil,
      status_cadastro: S.status,
      origem_cta: q.get("cta") || "",
      consent: true,
      lp: CONFIG.lp,
      agenda: AGENDA.id,
      agenda_link: "https://cal.com/" + AGENDA.calLink,
      pagina: window.location.href.split("#")[0],
      referrer: doc.referrer || "",
      enviado_em: new Date().toISOString()
    };
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (k) { if (q.get(k)) d[k] = q.get(k); });
    var fbp = cookie("_fbp"), fbc = cookie("_fbc") || (q.get("fbclid") ? "fb.1." + Date.now() + "." + q.get("fbclid") : "");
    if (fbp) d.fbp = fbp;
    if (fbc) d.fbc = fbc;
    return Object.assign(d, extra || {});
  }

  function post(data) {
    var body = JSON.stringify(data);
    function tryFetch(n) {
      if (!window.fetch) return Promise.reject(new Error("sem fetch"));
      return fetch(CONFIG.webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true, mode: "cors" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return true; })
        .catch(function (e) { if (n > 0) return realWait(1500).then(function () { return tryFetch(n - 1); }); throw e; });
    }
    return tryFetch(1).catch(function (e) {
      // último recurso: beacon (text/plain — o workflow aceita)
      try { if (navigator.sendBeacon && navigator.sendBeacon(CONFIG.webhook, new Blob([body], { type: "text/plain" }))) return true; } catch (x) {}
      if (window.console) console.error("[lead] falha no envio:", e);
      return false;
    });
  }

  function track(evt, params, eventId) {
    try { if (typeof window.fbq === "function") window.fbq("track", evt, params || {}, eventId ? { eventID: eventId } : undefined); } catch (e) {}
    try { (window.dataLayer = window.dataLayer || []).push({ event: "torque_" + evt.toLowerCase(), lp: CONFIG.lp }); } catch (e) {}
  }

  /* ---------------- Agenda Cal.com ---------------- */
  var calLoaded = false;
  function loadCal() {
    if (calLoaded) return;
    (function (C, A, L) {
      var p = function (a, ar) { a.q.push(ar); };
      var d = C.document;
      C.Cal = C.Cal || function () {
        var cal = C.Cal, ar = arguments;
        if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement("script")).src = A; cal.loaded = true; }
        if (ar[0] === L) {
          var api = function () { p(api, arguments); };
          var namespace = ar[1]; api.q = api.q || [];
          if (typeof namespace === "string") { cal.ns[namespace] = cal.ns[namespace] || api; p(cal.ns[namespace], ar); p(cal, ["initNamespace", namespace]); }
          else p(cal, ar);
          return;
        }
        p(cal, ar);
      };
    })(window, "https://app.cal.com/embed/embed.js", "init");
    calLoaded = true;
  }
  /* Atribuição na reserva do Cal (mesmo módulo das outras LPs: /lp/_shared/cal-metadata.js).
     Só parâmetros de campanha e fbp/fbc — nunca dado do lead na URL. Opcional: sem ele a reserva acontece igual. */
  function calMetadata() {
    try {
      if (!window.TorqueCalMetadata) return null;
      var q = new URLSearchParams(window.location.search);
      var fbc = cookie("_fbc") || (q.get("fbclid") ? "fb.1." + Date.now() + "." + q.get("fbclid") : "");
      return window.TorqueCalMetadata.build({ lp: CONFIG.lp, url: window.location.href, referrer: doc.referrer, fbp: cookie("_fbp"), fbc: fbc });
    } catch (e) { return null; }
  }
  function calFallbackUrl() {
    var base = "https://cal.com/" + AGENDA.calLink, meta = calMetadata();
    try { return meta ? window.TorqueCalMetadata.withQuery(base, meta) : base; } catch (e) { return base; }
  }

  function showCalendar() {
    var li = el("li", "row row--wide row--cal is-new");
    li.innerHTML =
      '<section class="cal" id="calCard" aria-labelledby="calTitle">' +
        '<header class="cal__head"><span class="cal__ic" aria-hidden="true"><svg width="22" height="22"><use href="#i-cal"/></svg></span>' +
        '<div><h2 id="calTitle">' + T.calTitle + "</h2><p>" + T.calSub + "</p></div></header>" +
        '<div class="cal__body"><div class="cal__embed" id="calInline"></div><div class="cal__loading" role="status">Carregando horários disponíveis…</div></div>' +
        '<div class="cal__foot">A agenda não carregou? <a id="calFallback" target="_blank" rel="noopener">Abrir em uma nova aba</a></div>' +
      "</section>";
    thread.appendChild(li);
    var card = li.querySelector(".cal");
    li.querySelector("#calFallback").href = calFallbackUrl();
    requestAnimationFrame(function () { li.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }); });

    loadCal();
    var ns = "torque_" + AGENDA.id;
    var Cal = window.Cal;
    Cal("init", ns, { origin: "https://app.cal.com" });
    Cal.ns[ns]("inline", {
      elementOrSelector: "#calInline",
      calLink: AGENDA.calLink,
      // nome e e-mail já respondidos no chat chegam preenchidos no formulário de reserva do Cal
      config: Object.assign(
        { layout: "month_view", theme: "dark", useSlotsViewOnSmallScreen: "true", name: S.nome, email: S.email },
        (function () { var m = calMetadata(); try { return m ? window.TorqueCalMetadata.toConfig(m) : {}; } catch (e) { return {}; } })()
      )
    });
    Cal.ns[ns]("ui", { theme: "dark", cssVarsPerTheme: { dark: { "cal-brand": "#ED9227" }, light: { "cal-brand": "#ED9227" } }, hideEventTypeDetails: false, layout: "month_view" });
    Cal.ns[ns]("on", { action: "linkReady", callback: function () { card.classList.add("is-ready"); } });
    Cal.ns[ns]("on", { action: "bookingSuccessful", callback: onBooked });
    // bookingSuccessful (antigo) traz o `booking`; o V2 só vale se o antigo não vier (mesma regra do lp.js compartilhado)
    Cal.ns[ns]("on", { action: "bookingSuccessfulV2", callback: function (e) { realWait(800).then(function () { onBooked(e); }); } });
    // se o evento "linkReady" não vier, libera a área quando o iframe existir
    realWait(9000).then(function () { if (doc.querySelector("#calInline iframe")) card.classList.add("is-ready"); });
  }

  function onBooked(ev) {
    if (S.booked) return;
    S.booked = true;
    var det = ev && ev.detail ? ev.detail : ev;
    var data = (det && det.data) || {};
    var booking = data.booking || {};
    var when = booking.startTime || data.startTime || data.date || "";
    var valid = !!when && !isNaN(Date.parse(when));
    // uid da reserva = event_id do Schedule: o app Meta Pixel do Cal e o n8n usam o mesmo id, a Meta conta uma vez
    var bookingUid = booking.uid || data.uid || "";
    var schedId = bookingUid || "schedule-" + uid();
    S.status = "reuniao_agendada";
    var extra = { event_id: schedId, status_cadastro: S.status, booking_uid: bookingUid };
    if (valid) { extra.evento = "reuniao_marcada"; extra.reuniao_em = new Date(when).toISOString(); }
    else extra.evento = "reuniao_marcada_sem_data"; // o workflow exige data válida para mover a etapa
    leadSent.then(function () { return post(payload(extra)); });
    track("Schedule", { content_name: "Torque IA · agendamento" }, schedId);
    finishBooked(valid ? new Date(when) : null);
  }

  function finishBooked(date) {
    answer.innerHTML = "";
    setStep(8, 100);
    doc.getElementById("status").textContent = "online agora";
    var quando = date ? date.toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }) : "";
    bots([fill(T.booked1), T.booked2, T.booked3]).then(function () {
      var li = el("li", "row row--wide is-new");
      li.innerHTML = '<div class="done"><span class="done__ic" aria-hidden="true"><svg width="20" height="20"><use href="#i-check"/></svg></span><span><b>Apresentação agendada</b><small>' +
        (quando ? esc(quando.charAt(0).toUpperCase() + quando.slice(1)) + " · " : "") + "com " + esc(AGENDA.host) + "</small></span></div>";
      thread.appendChild(li);
      scrollToEnd();
    });
  }

  /* ---------------- Ramificações finais ---------------- */
  function foraDoPerfil() {
    S.perfil = "fora_do_perfil";
    return bots([T.fora1, T.fora2, T.fora3]).then(function () {
      return askAction(T.foraBtn);
    }).then(function () {
      S.status = "fora_do_perfil";
      setStep(CONFIG.totalSteps, 100);
      post(payload({ event_id: "lead-" + uid() }));
      var li = el("li", "row row--wide is-new");
      li.innerHTML = '<div class="done"><span class="done__ic" aria-hidden="true"><svg width="20" height="20"><use href="#i-check"/></svg></span><span><b>Cadastro finalizado</b><small>Seu contato foi encaminhado para o nosso time.</small></span></div>';
      thread.appendChild(li);
      scrollToEnd();
    });
  }

  function alternativaWhatsapp() {
    return realWait(reduced ? 200 : 1800).then(function () {
      if (S.booked) return;
      return bots([T.alt1, T.alt2], { noScroll: true }).then(function () {
        if (S.booked) return;
        return askAction(T.altBtn, true, true).then(function () {
          S.whatsPref = true;
          S.status = "prefere_agendar_whatsapp";
          leadSent.then(function () { return post(payload({ evento: "agendar_whatsapp", event_id: S.leadEventId })); });
          setStep(CONFIG.totalSteps, 100);
          return bot("Combinado, " + esc(S.primeiro) + "! Nosso time vai te chamar no WhatsApp <strong>" + esc(S.whatsapp) + "</strong> pra combinar o melhor momento para sua apresentação.");
        });
      });
    });
  }

  /* ---------------- Roteiro ---------------- */
  function run() {
    setStep(1);
    return wait(500)
      .then(function () { return bots([T.intro1, T.intro2, T.askNome]); })
      .then(function () {
        return askText({ name: "nome", label: "Nome completo", placeholder: T.phNome, autocomplete: "name", autocapitalize: "words", maxLength: 80, validate: validaNome, normalize: nomeNormalizado });
      })
      .then(function (nome) {
        S.nome = nome; S.primeiro = nome.split(" ")[0];
        setStep(2);
        return bot(fill(T.askWhats));
      })
      .then(function () {
        return askText({ name: "whatsapp", label: "Telefone com DDD", type: "tel", inputmode: "tel", placeholder: T.phWhats, autocomplete: "tel-national", maxLength: 16, mask: mascaraTel, validate: validaTel, normalize: mascaraTel });
      })
      .then(function (tel) {
        S.whatsapp = tel;
        setStep(3);
        return bot(T.askCargo).then(function () { return askOptions(T.cargos, T.askCargo); });
      })
      .then(function (cargo) {
        S.cargo = cargo;
        if (GRUPO_DONO.indexOf(cargo) >= 0) { S.decisor = "sim (sócio/dono/CEO)"; return bot(fill(T.cargoDono)); }
        if (GRUPO_GESTOR.indexOf(cargo) >= 0) return bot(fill(T.cargoGestor));
        if (cargo === CARGO_VENDEDOR) {
          return bots([fill(T.cargoVendedor), T.askDecVendedor])
            .then(function () { return askOptions(T.decVendedor, T.askDecVendedor); })
            .then(function (d) { S.decisor = d; });
        }
        return bot(T.askDecOutro)
          .then(function () { return askOptions(T.decOutro, T.askDecOutro); })
          .then(function (d) { S.decisor = d; });
      })
      .then(function () {
        setStep(4);
        return bot(T.askEmpresa).then(function () { return askOptions(T.empresas, T.askEmpresa); });
      })
      .then(function (emp) {
        S.empresa = emp;
        if (emp === T.empresas[0]) return bot(T.empIndustria);
        if (emp === T.empresas[1]) return bot(T.empDistribuidora);
        if (emp === T.empresas[2]) return bot(T.empAmbas);
        return bot(T.askModelo)
          .then(function () { return askOptions(T.modelos, T.askModelo); })
          .then(function (m) {
            S.modelo = m;
            if (m === T.modelos[1]) return "fora";
            S.perfil = "avaliacao_comercial";
          });
      })
      .then(function (flag) {
        if (flag === "fora") return foraDoPerfil().then(function () { throw "fim"; });
        setStep(5);
        return bot(T.askFat).then(function () { return askOptions(T.fats, T.askFat); });
      })
      .then(function (fat) {
        S.faturamento = fat;
        var i = T.fats.indexOf(fat);
        setStep(6);
        return bot(i <= 1 ? T.fatBaixo : i <= 3 ? T.fatMedio : T.fatAlto);
      })
      .then(function () {
        return bot(T.askDif).then(function () { return askOptions(T.difs.map(function (d) { return d[0]; }), T.askDif); });
      })
      .then(function (dif) {
        S.desafio = dif;
        var resp = T.difs.filter(function (d) { return d[0] === dif; })[0][1];
        return bots(resp);
      })
      .then(function () {
        setStep(7);
        return bots([fill(T.email1), T.email2]);
      })
      .then(function () {
        return askText({ name: "email", label: "E-mail", type: "email", inputmode: "email", placeholder: T.phEmail, autocomplete: "email", autocapitalize: "off", maxLength: 120, validate: validaEmail, normalize: function (v) { return v.toLowerCase(); }, suggest: sugestaoEmail });
      })
      .then(function (email) {
        S.email = email;
        // Cadastro concluído (ainda sem agendamento): registra tudo no CRM agora
        S.status = "cadastro_concluido_sem_agendamento";
        S.leadEventId = "lead-" + uid();
        leadSent = post(payload({ event_id: S.leadEventId }));
        track("Lead", { content_name: "Torque IA · cadastro" }, S.leadEventId);
        setStep(8);
        return bots([fill(T.agenda1), T.agenda2]);
      })
      .then(function () {
        showCalendar();
        return alternativaWhatsapp();
      })
      .catch(function (e) { if (e !== "fim" && window.console) console.error(e); });
  }

  /* ---------------- Início ---------------- */
  (function () {
    var back = doc.getElementById("backLink");
    if (back) {
      var href = window.location.protocol === "file:" ? "../iaparab2b/index.html" : "../iaparab2b/";
      var q = new URLSearchParams(window.location.search); q.delete("cta");
      back.href = href + (q.toString() ? "?" + q.toString() : "");
    }
  })();
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", run); else run();
})();
