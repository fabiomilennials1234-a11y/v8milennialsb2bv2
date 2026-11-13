/*
 * Torque LP: modais de agenda e de dúvidas, envio ao webhook e fallback de motion.
 * Compartilhado por todas as LPs; o id da LP vem de `data-lp` no HTML.
 * Nunca registre dado do lead no console nem o coloque em URL.
 */
(function () {
  "use strict";

  var LEAD_WEBHOOK_URL = "https://n8nwebhook.v3l8jq.easypanel.host/webhook/torque-lp-lead";
  var AGENDA = { id: "gabriel", calLink: "gabriel-aurelio-gipp-uekpuj/30min" };
  var AGENDA_URL = "https://cal.com/" + AGENDA.calLink;
  var CAL_BRAND = "#FFC800"; /* ouro V5: hsl(47 100% 50%) */
  var CAL_BRAND_TEXT = "#211A08"; /* --on-gold */
  var WHATSAPP_URL = "https://wa.me/5548984334050?text=" + encodeURIComponent("VIM PELOS ANUNCIOS E QUERO TIRAR ALGUMAS DUVIDAS!");
  var BUSY_RELEASE_MS = 2000;
  var CAL_IFRAME_WAIT_MS = 8000;
  var CAL_READY_WAIT_MS = 20000;
  var CAL_SCRIPT_URL = "https://app.cal.com/embed/embed.js";
  /* bookingSuccessful é o evento antigo e traz o `booking`; o V2 só entra se o antigo deixar de vir. */
  var BOOKING_V2_GRACE_MS = 800;

  var lpRoot = document.querySelector("[data-lp]");
  var LP_ID = lpRoot ? lpRoot.getAttribute("data-lp") : "";

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }

  function trackingFields() {
    var data = {
      consent: true,
      lp: LP_ID,
      pagina: window.location.href.split("#")[0],
      referrer: document.referrer || "",
      enviado_em: new Date().toISOString()
    };
    var q = new URLSearchParams(window.location.search);
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (k) { if (q.get(k)) data[k] = q.get(k); });
    return data;
  }

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function readCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    if (!m) return "";
    /* Cookie malformado não pode travar o envio do lead. */
    try { return decodeURIComponent(m[1]); } catch (e) { return ""; }
  }

  /* fbp e fbc identificam o clique no anúncio e vão ao n8n para a CAPI casar o evento. */
  function metaFields(eventId) {
    var data = { event_id: eventId };
    var fbp = readCookie("_fbp");
    var fbclid = new URLSearchParams(window.location.search).get("fbclid");
    var fbc = readCookie("_fbc") || (fbclid ? "fb.1." + Date.now() + "." + fbclid : "");
    if (fbp) data.fbp = fbp;
    if (fbc) data.fbc = fbc;
    return data;
  }

  /* Lido na hora de abrir a agenda: o cookie _fbp só existe depois que o pixel carrega. */
  function calMetadata() {
    var meta = metaFields("");
    return window.TorqueCalMetadata.build({ lp: LP_ID, url: window.location.href, referrer: document.referrer, fbp: meta.fbp, fbc: meta.fbc });
  }

  /* Atribuição é opcional, como o pixel: sem ela a reserva acontece e o webhook do servidor cria o lead. */
  function calConfig() {
    try { return window.TorqueCalMetadata.toConfig(calMetadata()); } catch (e) { return {}; }
  }

  function agendaLink() {
    try { return window.TorqueCalMetadata.withQuery(AGENDA_URL, calMetadata()); } catch (e) { return AGENDA_URL; }
  }

  function refreshAgendaLinks() {
    var href = agendaLink();
    $$("[data-cal-link]").forEach(function (link) { link.href = href; });
  }

  /* Mesmo event_id no navegador e no webhook: é assim que a Meta deduplica. Nunca pode travar o fluxo. */
  function trackConversion(name, eventId) {
    try { if (window.fbq) window.fbq("track", name, {}, { eventID: eventId }); } catch (e) { /* pixel é opcional */ }
  }

  function postLead(payload) {
    return fetch(LEAD_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true, mode: "cors" });
  }

  /* ---------- diálogo: foco preso, Esc e devolução de foco vêm do <dialog> nativo ---------- */
  function setupDialog(dialog) {
    var trigger = null;
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
    });
    dialog.addEventListener("close", function () {
      document.documentElement.classList.remove("lpm-open");
      /* O <dialog> já devolve o foco; aqui só cobre navegador que não focou o link ao clicar. */
      var active = document.activeElement;
      if (trigger && trigger.isConnected && (!active || active === document.body)) trigger.focus();
    });
    return function open(from) {
      trigger = from;
      document.documentElement.classList.add("lpm-open");
      dialog.showModal();
    };
  }

  function mountDialog(html) {
    var holder = document.createElement("div");
    holder.innerHTML = html;
    var dialog = holder.firstElementChild;
    document.body.appendChild(dialog);
    return dialog;
  }

  var CLOSE_BUTTON = '<button type="button" class="lpm-close" data-close aria-label="Fechar">✕</button>';
  var PRIVACY_LINK = '<a href="/privacidade" target="_blank" rel="noopener">Política de Privacidade</a>';

  /* ---------- Agendar: embed inline do Cal.com, criado só na primeira abertura ---------- */
  var agendaDialog = mountDialog(
    '<dialog class="lpm lpm-agenda" aria-labelledby="agendaTitle">' +
      '<div class="lpm-card">' +
        '<header class="lpm-head">' +
          '<div><p class="lpm-eyebrow">Demonstração do Torque</p><h2 id="agendaTitle" tabindex="-1" autofocus>Escolha o melhor horário.</h2></div>' +
          CLOSE_BUTTON +
        '</header>' +
        '<div class="lpm-embed" id="calInline">' +
            '<p class="lpm-load" id="calLoading" role="status">Carregando agenda…</p>' +
            '<div class="lpm-fail" id="calFail" role="alert" hidden>' +
              '<p>Não foi possível abrir a agenda aqui.</p>' +
              '<a class="lpm-fail-btn" data-cal-link href="' + AGENDA_URL + '" target="_blank" rel="noopener">Abrir a agenda em nova aba</a>' +
            '</div>' +
          '</div>' +
        '<div class="lpm-done" id="calDone" role="status" hidden>' +
          '<h3>✓ Reunião marcada!</h3><p id="calDoneWhen"></p>' +
          '<p>Você vai receber a confirmação por e-mail com o link da reunião. Até lá!</p>' +
        '</div>' +
        '<footer class="lpm-foot">' +
          '<p>Ao agendar, você concorda com a nossa ' + PRIVACY_LINK + '.</p>' +
          '<p id="calFallbackRow">A agenda não carregou? <a data-cal-link href="' + AGENDA_URL + '" target="_blank" rel="noopener">Abrir em uma nova aba →</a></p>' +
        '</footer>' +
      '</div>' +
    '</dialog>'
  );
  var openAgendaDialog = setupDialog(agendaDialog);
  var calStarted = false;
  var calTimers = {};
  var bookingSent = false;

  function textOf(v) { return typeof v === "string" ? v.trim() : ""; }

  /*
   * Resposta de pergunta de qualificação: o Cal manda o texto da opção, mas pode embrulhar em { label, value }.
   * Desembrulha `value` como o `txt` do n8n (workflow YVJSnwZ8Zgby432e); objeto sem `value` fica vazio aqui
   * (o `txt` junta firstName/lastName, regra que só serve ao nome).
   */
  function answerOf(v) {
    if (v == null) return "";
    if (typeof v === "object") return "value" in v ? answerOf(v.value) : "";
    return String(v).trim();
  }

  /* Slug no Cal = chave no payload. O valor é o texto da opção, igual ao do formulário do evento no Cal. */
  var QUALIFICATION_KEYS = ["erp", "cargo"];

  /*
   * Respostas do formulário do evento, no payload do Cal. Fontes em calcom/cal.com:
   * packages/embeds/embed-core/src/sdk-action-manager.ts (envelope `detail.data`) e
   * apps/web/modules/bookings/hooks/useBookings.ts (`booking` é a resposta de /api/book/event).
   * `responses.name` pode vir como { firstName, lastName }. Sem dado, o campo segue vazio: nada é inventado.
   */
  function readResponses(booking) {
    var b = booking || {};
    var responses = b.responses || {};
    var attendee = (b.attendees && b.attendees[0]) || {};
    var name = responses.name;
    if (name && typeof name === "object") name = [name.firstName, name.lastName].filter(Boolean).join(" ");
    var answers = {
      nome: textOf(name) || textOf(attendee.name),
      email: textOf(responses.email) || textOf(attendee.email),
      whatsapp: textOf(responses.telefone) || textOf(attendee.phoneNumber),
      empresa: textOf(responses.empresa),
      desafio: textOf(responses.maior_dificuldade)
    };
    /* Pergunta que ainda não existe no evento do Cal chega vazia: o payload mantém a chave. */
    QUALIFICATION_KEYS.forEach(function (key) { answers[key] = answerOf(responses[key]); });
    return answers;
  }

  function notifyBooking(data) {
    if (bookingSent) return;
    bookingSent = true;
    var booking = data.booking || {};
    var answers = readResponses(booking);
    var when = textOf(booking.startTime) || textOf(data.date) || textOf(data.startTime);
    /* O uid puro é o id que o app Meta Pixel do Cal e o webhook do n8n também usam: a Meta conta a reserva uma vez. */
    var uid = textOf(booking.uid) || textOf(data.uid);
    var eventId = uid || randomId();
    trackConversion("Schedule", eventId);
    var payload = Object.assign(trackingFields(), metaFields(eventId), {
      evento: "reuniao_marcada",
      nome: answers.nome,
      email: answers.email,
      whatsapp: answers.whatsapp,
      empresa: answers.empresa,
      desafio: answers.desafio,
      erp: answers.erp,
      cargo: answers.cargo,
      reuniao_em: when,
      agenda: AGENDA.id,
      agenda_link: AGENDA_URL,
      booking_uid: uid
    });
    try { postLead(payload).catch(function () {}); } catch (e) { /* o agendamento já aconteceu no Cal.com */ }

    var d = when ? new Date(when) : null;
    var quando = d && !isNaN(d) ? d.toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }) : "";
    $("#calDoneWhen").textContent = quando ? "Reunião marcada para " + quando + "." : "Sua reunião foi marcada.";
    $("#calDone").hidden = false;
    $("#calInline").hidden = true;
    $("#calFallbackRow").hidden = true;
  }

  function eventData(event) {
    return (event && event.detail && event.detail.data) || {};
  }

  function loadCalEmbed() {
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
    })(window, CAL_SCRIPT_URL, "init");
  }

  function calScript() {
    return document.querySelector('script[src="' + CAL_SCRIPT_URL + '"]');
  }

  function setCalStatus(status) {
    $("#calLoading").hidden = status !== "loading";
    $("#calFail").hidden = status !== "failed";
  }

  /* Nunca fica em "Carregando": sem script, sem iframe ou sem resposta do Cal, oferece o link direto. */
  function failCal() {
    clearTimeout(calTimers.iframe);
    clearTimeout(calTimers.ready);
    setCalStatus("failed");
  }

  /* Se o embed nem chegou a criar o iframe, reabrir o modal tenta do zero. */
  function resetCalIfNeverLoaded() {
    if (!calStarted || $("#calFail").hidden || $("#calInline iframe")) return;
    var script = calScript();
    if (script) script.remove();
    delete window.Cal;
    calStarted = false;
  }

  function watchCal() {
    calTimers.iframe = setTimeout(function () {
      if (!$("#calInline iframe")) failCal();
    }, CAL_IFRAME_WAIT_MS);
    calTimers.ready = setTimeout(failCal, CAL_READY_WAIT_MS);
    var script = calScript();
    if (script) script.addEventListener("error", failCal);
  }

  function startCal() {
    resetCalIfNeverLoaded();
    if (calStarted) return;
    calStarted = true;
    setCalStatus("loading");
    var ns = AGENDA.id;
    var brand = { "cal-brand": CAL_BRAND, "cal-brand-text": CAL_BRAND_TEXT };
    var calApi;
    loadCalEmbed();
    window.Cal("init", ns, { origin: "https://app.cal.com" });
    watchCal();
    calApi = window.Cal.ns[ns];
    calApi("inline", {
      elementOrSelector: "#calInline",
      calLink: AGENDA.calLink,
      config: Object.assign({ layout: "month_view", theme: "dark", useSlotsViewOnSmallScreen: "true" }, calConfig())
    });
    calApi("ui", { theme: "dark", cssVarsPerTheme: { light: brand, dark: brand }, hideEventTypeDetails: false, layout: "month_view" });
    calApi("on", { action: "bookingSuccessful", callback: function (e) { notifyBooking(eventData(e)); } });
    calApi("on", { action: "bookingSuccessfulV2", callback: function (e) {
      var data = eventData(e);
      setTimeout(function () { notifyBooking(data); }, BOOKING_V2_GRACE_MS);
    } });
    calApi("on", { action: "linkReady", callback: function () {
      clearTimeout(calTimers.iframe);
      clearTimeout(calTimers.ready);
      setCalStatus("ready");
    } });
    calApi("on", { action: "linkFailed", callback: failCal });
  }

  function openAgenda(from) {
    refreshAgendaLinks();
    openAgendaDialog(from);
    startCal();
  }

  /* ---------- Tirar dúvidas: formulário curto, e o WhatsApp abre mesmo se o webhook falhar ---------- */
  function fieldHtml(id, label, attrs, error) {
    return '<div class="lpm-field">' +
      '<label for="' + id + '">' + label + '</label>' +
      '<input id="' + id + '" required aria-describedby="' + id + '-erro" ' + attrs + '>' +
      '<p class="lpm-err" id="' + id + '-erro" hidden>' + error + '</p>' +
    '</div>';
  }

  /* Mesmas opções, no mesmo texto, da pergunta `erp` da reserva no Cal: o CRM agrupa pelo valor. Texto fixo, sem escape. */
  var ERP_OPTIONS = ["Omie", "Bling", "Tiny (Olist)", "Sankhya", "TOTVS (Protheus/Winthor)", "SAP Business One", "Conta Azul", "Outro", "Não usamos ERP"];

  function selectHtml(id, label, name, options, error) {
    return '<div class="lpm-field">' +
      '<label for="' + id + '">' + label + '</label>' +
      '<select id="' + id + '" name="' + name + '" required aria-describedby="' + id + '-erro">' +
        '<option value="" disabled selected>Selecione</option>' +
        options.map(function (o) { return '<option value="' + o + '">' + o + '</option>'; }).join("") +
      '</select>' +
      '<p class="lpm-err" id="' + id + '-erro" hidden>' + error + '</p>' +
    '</div>';
  }

  var duvidasDialog = mountDialog(
    '<dialog class="lpm lpm-lead" aria-labelledby="duvidasTitle">' +
      '<form class="lpm-card" id="duvidasForm" novalidate>' +
        '<header class="lpm-head">' +
          '<div><h2 id="duvidasTitle" tabindex="-1" autofocus>Tirar minhas dúvidas</h2><p>Preencha e continue a conversa com a gente no WhatsApp.</p></div>' +
          CLOSE_BUTTON +
        '</header>' +
        fieldHtml("d-nome", "Nome", 'type="text" name="nome" autocomplete="name"', "Informe seu nome.") +
        fieldHtml("d-empresa", "Nome da empresa", 'type="text" name="empresa" autocomplete="organization"', "Informe o nome da empresa.") +
        selectHtml("d-erp", "Qual ERP sua empresa usa?", "erp", ERP_OPTIONS, "Selecione o ERP da empresa.") +
        fieldHtml("d-whatsapp", "WhatsApp — DDD + número", 'type="tel" name="whatsapp" autocomplete="tel-national" inputmode="tel" placeholder="(00) 00000-0000"', "DDD + número, sem +55") +
        fieldHtml("d-email", "E-mail", 'type="email" name="email" autocomplete="email" inputmode="email"', "Informe um e-mail válido.") +
        '<button type="submit" class="lpm-submit">Continuar no WhatsApp →</button>' +
        '<p class="lpm-legal">Ao enviar, você concorda com a nossa ' + PRIVACY_LINK + '.</p>' +
      '</form>' +
    '</dialog>'
  );
  var openDuvidasDialog = setupDialog(duvidasDialog);

  /*
   * Dispara sem esperar resposta, para o WhatsApp abrir no mesmo tick do toque: no iOS, navegar depois
   * de uma espera perde o gesto do usuário e o app pode não abrir. text/plain dispensa preflight.
   * Falha no envio nunca impede a navegação.
   */
  function fireLead(payload) {
    var json = JSON.stringify(payload);
    var type = "text/plain;charset=UTF-8";
    var queued = false;
    try { queued = !!navigator.sendBeacon && navigator.sendBeacon(LEAD_WEBHOOK_URL, new Blob([json], { type: type })); } catch (e) { /* cai no fetch */ }
    if (queued) return;
    try {
      fetch(LEAD_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": type }, body: json, keepalive: true, mode: "cors" }).catch(function () {});
    } catch (e) { /* o WhatsApp abre mesmo assim */ }
  }

  (function initDuvidas() {
    var form = $("#duvidasForm");
    var submit = $(".lpm-submit", form);
    var fields = $$("input, select", form);
    var duvidaEventId = null;

    /* O n8n descarta em silêncio telefone inválido: a página barra antes. */
    function valid(f) {
      var v = f.value.trim();
      if (f.type === "tel") return window.TorquePhone.isValid(v);
      return f.type === "email" ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) : v !== "";
    }
    function mark(f, ok) {
      if (ok) f.removeAttribute("aria-invalid"); else f.setAttribute("aria-invalid", "true");
      $("#" + f.id + "-erro").hidden = ok;
    }
    function setBusy(busy) {
      submit.disabled = busy;
      if (busy) submit.setAttribute("aria-busy", "true"); else submit.removeAttribute("aria-busy");
    }

    function revalidate(e) {
      if (e.target.getAttribute("aria-invalid") && valid(e.target)) mark(e.target, true);
    }
    form.addEventListener("input", function (e) {
      if (e.target.type === "tel") e.target.value = window.TorquePhone.format(e.target.value);
      revalidate(e);
    });
    /* Safari antigo só avisa `change` no <select>. */
    form.addEventListener("change", revalidate);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (submit.disabled) return;
      var firstBad = null;
      fields.forEach(function (f) { var ok = valid(f); mark(f, ok); if (!ok && !firstBad) firstBad = f; });
      if (firstBad) { firstBad.focus(); return; }
      setBusy(true);
      /* Reenvio depois de voltar do WhatsApp é a mesma conversão: mesmo id, sem novo Lead no pixel. */
      if (!duvidaEventId) {
        duvidaEventId = randomId();
        trackConversion("Lead", duvidaEventId);
      }
      var payload = Object.assign(trackingFields(), metaFields(duvidaEventId), {
        evento: "duvida",
        nome: $("#d-nome").value.trim(),
        empresa: $("#d-empresa").value.trim(),
        erp: $("#d-erp").value,
        whatsapp: window.TorquePhone.digits($("#d-whatsapp").value),
        email: $("#d-email").value.trim()
      });
      fireLead(payload);
      window.location.assign(WHATSAPP_URL);
      /* Abrir o app nem sempre descarrega a página: quem volta encontra o botão ativo. O atraso evita duplo envio. */
      setTimeout(function () { setBusy(false); }, BUSY_RELEASE_MS);
    });
    /* Quem volta do WhatsApp pelo botão do navegador encontra o formulário utilizável. */
    window.addEventListener("pageshow", function () { setBusy(false); });
  })();

  /* ---------- CTAs ---------- */
  /* Link direto (#agendar, nova aba) já sai com a atribuição; o pixel ainda pode não ter gravado o cookie. */
  refreshAgendaLinks();
  document.addEventListener("click", function (e) {
    var cta = e.target.closest ? e.target.closest("[data-agendar],[data-duvidas]") : null;
    if (!cta) return;
    e.preventDefault();
    /* Safari anterior ao 15.4 não tem <dialog>: vai direto ao destino. */
    if (typeof agendaDialog.showModal !== "function") {
      window.location.assign(cta.hasAttribute("data-agendar") ? agendaLink() : WHATSAPP_URL);
      return;
    }
    if (cta.hasAttribute("data-agendar")) openAgenda(cta); else openDuvidasDialog(cta);
  });

  /* ---------- Motion: sem animation-timeline, IntersectionObserver revela o que entra na tela ---------- */
  (function initMotionFallback() {
    var supported = window.CSS && CSS.supports && CSS.supports("animation-timeline", "view()");
    var calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (supported || calm || !window.IntersectionObserver) return;
    /* Mesma lista do @supports (animation-timeline:view()) em torque-lp-v5.css: mudou lá, mude aqui. */
    var targets = $$(".wrap>.split,.wrap>.even,.wrap>.pipe,.wrap>.lanes,.wrap>.bento,.wrap>.journey,.wrap>.stack,.h2,.rows li,.ben,.p-node,.mm,.team,.chat,.tl li,.alert,.demo,.big,.seq p,.journey .j")
      .filter(function (el) { return !el.closest(".hero-stage"); });
    /* A classe só entra aqui: se o JS falhar, nada fica escondido. */
    document.documentElement.classList.add("lp-io");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("lp-in");
        io.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    targets.forEach(function (el) { el.classList.add("lp-reveal"); io.observe(el); });
  })();
})();
