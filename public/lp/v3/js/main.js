/* ============================================================
   TORQUE · Variação 03 "Com VSL" — Interações
   ============================================================ */
(function () {
  "use strict";

  document.documentElement.classList.add("js");

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ============================================================
     1 · Canvas de fundo — partículas leves
     ============================================================ */
  (function () {
    var canvas = document.getElementById("bgCanvas");
    if (!canvas || prefersReduced) return;

    var ctx = canvas.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var W = 0, H = 0, visible = true;

    function resize() {
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    var pCount = window.innerWidth < 760 ? 16 : 32;
    var particles = [];
    for (var i = 0; i < pCount; i++) {
      particles.push({
        x: Math.random(), y: Math.random(),
        r: 0.6 + Math.random() * 1.4,
        s: 0.00012 + Math.random() * 0.00028,
        o: 0.08 + Math.random() * 0.2
      });
    }

    function frame() {
      requestAnimationFrame(frame);
      if (!visible || document.hidden || document.body.classList.contains("calmodal-open")) return;
      ctx.clearRect(0, 0, W, H);
      for (var p = 0; p < particles.length; p++) {
        var pt = particles[p];
        pt.y -= pt.s;
        if (pt.y < -0.02) { pt.y = 1.02; pt.x = Math.random(); }
        ctx.fillStyle = "rgba(245, 242, 227, " + pt.o + ")";
        ctx.fillRect(pt.x * W, pt.y * H, pt.r, pt.r);
      }
    }
    requestAnimationFrame(frame);

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
      }, { threshold: 0 }).observe(canvas);
    }
  })();

  /* ============================================================
     2 · VSL vertical — autoplay mudo + overlay para ativar o som
     Comportamento clássico de VSL: ao clicar no overlay, o vídeo
     reinicia do zero com áudio.
     ============================================================ */
  (function () {
    var video = document.getElementById("vslVideo");
    var overlay = document.getElementById("vslOverlay");
    var placeholder = document.getElementById("vslPlaceholder");
    if (!video || !overlay) return;

    var hasSource = !!(video.currentSrc || video.getAttribute("src") || video.querySelector("source"));

    if (hasSource) {
      if (placeholder) placeholder.hidden = true;
      // autoplay mudo quando o hero está visível
      var tryPlay = function () { video.play().catch(function () {}); };
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (entries) {
          if (entries[0].isIntersecting) tryPlay(); else video.pause();
        }, { threshold: 0.35 }).observe(video);
      } else {
        tryPlay();
      }
    }

    overlay.addEventListener("click", function () {
      if (hasSource) {
        video.currentTime = 0;
        video.muted = false;
        video.loop = false;
        video.controls = true;
        video.play().catch(function () {});
        overlay.classList.add("is-hidden");
      } else {
        // sem vídeo configurado ainda: leva ao agendamento
        var target = document.getElementById("agendar");
        if (target) target.scrollIntoView({ behavior: "smooth" });
      }
    });

    // pausar/despausar clicando no próprio vídeo depois de ativado
    video.addEventListener("click", function () {
      if (overlay.classList.contains("is-hidden")) {
        if (video.paused) video.play(); else video.pause();
      }
    });
  })();

  /* ============================================================
     3 · Formulário em 2 passos — navegação, validação e sucesso
     (integrar com o endpoint real de captura / agenda no stub)
     ============================================================ */
  /* ============================================================
     Envio do lead → n8n → TorqueCRM (org Torque)
     Workflow: "Torque · Landing Pages (v1/v2/v3) → TorqueCRM"
     ============================================================ */
  var LEAD_WEBHOOK_URL = "https://n8nwebhook.v3l8jq.easypanel.host/webhook/torque-lp-lead";
  var LEAD_LP_ID = "v3";

  function leadPayload(formEl) {
    var data = {};
    new FormData(formEl).forEach(function (v, k) { data[k] = typeof v === "string" ? v.trim() : v; });
    var q = new URLSearchParams(window.location.search);
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (k) {
      if (q.get(k)) data[k] = q.get(k);
    });
    data.consent = formEl.querySelector('[name="consent"]') ? !!formEl.querySelector('[name="consent"]:checked') : true;
    data.lp = LEAD_LP_ID;
    data.agenda = CAL_AGENDA.id;
    data.agenda_link = "https://cal.com/" + CAL_AGENDA.calLink;
    data.pagina = window.location.href.split("#")[0];
    data.referrer = document.referrer || "";
    data.enviado_em = new Date().toISOString();
    return data;
  }

  function sendLead(formEl) {
    var body = JSON.stringify(leadPayload(formEl));
    if (!window.fetch) return Promise.reject(new Error("fetch indisponível"));
    return fetch(LEAD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
      keepalive: true,
      mode: "cors"
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r;
    });
  }

  /* ============================================================
     Agendamento Cal.com — sorteio entre duas agendas, embed inline
     após o formulário, prefill com nome/e-mail e aviso ao CRM
     quando a reunião é marcada.
     ============================================================ */
  var CAL_AGENDAS = [
    { id: "leo",     host: "Leo",     calLink: "leonardo-meireles-yubftg/apresentacao-milennialsb2b" },
    { id: "gabriel", host: "Gabriel", calLink: "gabriel-aurelio-gipp-uekpuj/30min" }
  ];
  // sorteio 50/50, feito uma vez por visita (fica estável se o usuário reenviar)
  var CAL_AGENDA = CAL_AGENDAS[Math.random() < 0.5 ? 0 : 1];
  var calLoaded = false, calMounted = false, calLead = null;

  function loadCalEmbed(cb) {
    if (window.Cal && calLoaded) return cb();
    (function (C, A, L) {
      var p = function (a, ar) { a.q.push(ar); };
      var d = C.document;
      C.Cal = C.Cal || function () {
        var cal = C.Cal, ar = arguments;
        if (!cal.loaded) {
          cal.ns = {}; cal.q = cal.q || [];
          d.head.appendChild(d.createElement("script")).src = A;
          cal.loaded = true;
        }
        if (ar[0] === L) {
          var api = function () { p(api, arguments); };
          var namespace = ar[1];
          api.q = api.q || [];
          if (typeof namespace === "string") { cal.ns[namespace] = cal.ns[namespace] || api; p(cal.ns[namespace], ar); p(cal, ["initNamespace", namespace]); }
          else p(cal, ar);
          return;
        }
        p(cal, ar);
      };
    })(window, "https://app.cal.com/embed/embed.js", "init");
    calLoaded = true;
    cb();
  }

  function calFallbackUrl(lead) {
    var q = [];
    if (lead && lead.nome) q.push("name=" + encodeURIComponent(lead.nome));
    if (lead && lead.email) q.push("email=" + encodeURIComponent(lead.email));
    return "https://cal.com/" + CAL_AGENDA.calLink + (q.length ? "?" + q.join("&") : "");
  }

  function notifyBooking(detail) {
    // avisa o n8n → Torque: lead passa para "reunião marcada" com a data
    if (!calLead) return;
    var data = detail && detail.data ? detail.data : {};
    var when = (data.date || (data.booking && data.booking.startTime) || "");
    var payload = Object.assign({}, calLead, {
      evento: "reuniao_marcada",
      reuniao_em: when,
      agenda: CAL_AGENDA.id,
      enviado_em: new Date().toISOString()
    });
    try {
      fetch(LEAD_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true, mode: "cors" }).catch(function () {});
    } catch (e) {}
    var done = document.getElementById("calDone");
    var stage = document.getElementById("calInline");
    if (done) {
      var d = when ? new Date(when) : null;
      var quando = d && !isNaN(d) ? d.toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }) : "";
      var q = document.getElementById("calDoneWhen");
      if (q) q.textContent = quando ? "Reunião marcada para " + quando + " com " + CAL_AGENDA.host + "." : "Reunião marcada com " + CAL_AGENDA.host + ".";
      done.hidden = false;
      if (stage) stage.hidden = true;
    }
  }

  function openCalModal(lead) {
    calLead = lead || null;
    var modal = document.getElementById("calModal");
    if (!modal) { window.open(calFallbackUrl(lead), "_blank"); return; }
    var host = document.getElementById("calHost");
    if (host) host.textContent = CAL_AGENDA.host;
    var fb = document.getElementById("calFallback");
    if (fb) fb.href = calFallbackUrl(lead);
    modal.hidden = false;
    document.body.classList.add("calmodal-open");
    if (window.gsap) gsap.globalTimeline.pause(); // libera CPU para o iframe do Cal

    loadCalEmbed(function () {
      if (calMounted) return;
      calMounted = true;
      var ns = CAL_AGENDA.id;
      Cal("init", ns, { origin: "https://app.cal.com" });
      Cal.ns[ns]("inline", {
        elementOrSelector: "#calInline",
        calLink: CAL_AGENDA.calLink,
        config: Object.assign(
          { layout: "month_view", theme: "dark", useSlotsViewOnSmallScreen: "true" },
          lead ? { name: lead.nome || "", email: lead.email || "" } : {}
        )
      });
      Cal.ns[ns]("ui", {
        theme: "dark",
        cssVarsPerTheme: { light: { "cal-brand": "#ED9227" }, dark: { "cal-brand": "#ED9227" } },
        hideEventTypeDetails: false,
        layout: "month_view"
      });
      Cal.ns[ns]("on", { action: "bookingSuccessful", callback: notifyBooking });
    });
  }

  function closeCalModal() {
    var modal = document.getElementById("calModal");
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("calmodal-open");
    if (window.gsap) gsap.globalTimeline.resume();
  }
  document.addEventListener("click", function (e) { if (e.target.closest("[data-close-cal]")) closeCalModal(); });
  document.addEventListener("keydown", function (e) {
    var m = document.getElementById("calModal");
    if (e.key === "Escape" && m && !m.hidden) closeCalModal();
  });

  var form = document.getElementById("demoForm");
  if (form) {
    var stepEls = form.querySelectorAll(".form__step");
    var stepLabel = document.getElementById("stepLabel");
    var stepCount = document.getElementById("stepCount");
    var stepBar = document.getElementById("stepBar");
    var formSub = document.getElementById("formSub");
    var STEP_NAMES = ["Seus dados", "Qualificação"];
    var SUB_TEXTS = ["Preencha seus dados para continuar:", "Só mais 3 respostas rápidas:"];
    var current = 0;

    function fieldOk(field) {
      return field.type === "checkbox" ? field.checked
           : field.type === "radio" ? !!form.querySelector('[name="' + field.name + '"]:checked')
           : field.value.trim() !== "";
    }

    function validateStep(i) {
      var valid = true;
      stepEls[i].querySelectorAll("[required]").forEach(function (field) {
        var ok = fieldOk(field);
        field.classList.toggle("is-invalid", !ok);
        if (!ok) valid = false;
      });
      return valid;
    }

    function goTo(i) {
      current = Math.max(0, Math.min(stepEls.length - 1, i));
      stepEls.forEach(function (s, n) { s.classList.toggle("is-active", n === current); });
      if (stepLabel) stepLabel.textContent = "Passo 0" + (current + 1) + " · " + STEP_NAMES[current];
      if (stepCount) stepCount.textContent = (current + 1) + "/" + stepEls.length;
      if (stepBar) stepBar.style.width = ((current + 1) / stepEls.length * 100) + "%";
      if (formSub) formSub.textContent = SUB_TEXTS[current];
      var first = stepEls[current].querySelector("input, select");
      if (first && window.matchMedia("(hover: hover)").matches) first.focus({ preventScroll: true });
    }

    form.addEventListener("click", function (e) {
      if (e.target.closest("[data-next]")) {
        if (validateStep(current)) goTo(current + 1);
      } else if (e.target.closest("[data-prev]")) {
        goTo(current - 1);
      }
    });

    form.addEventListener("input", function (e) {
      var f = e.target;
      if (f.classList && f.classList.contains("is-invalid") && fieldOk(f)) {
        f.classList.remove("is-invalid");
      }
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      for (var i = 0; i < stepEls.length; i++) {
        if (!validateStep(i)) { goTo(i); return; }
      }
      var success = document.getElementById("formSuccess");
      var errBox = document.getElementById("formError");
      var submitBtn = form.querySelector('button[type="submit"]');
      if (errBox) errBox.hidden = true;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.classList.add("is-loading"); }
      var leadData = leadPayload(form);
      sendLead(form).then(function () {
        success.hidden = false;
        form.classList.add("is-done");
        openCalModal(leadData);
      if (formSub) formSub.hidden = true;
      }).catch(function (err) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove("is-loading"); }
        if (errBox) { errBox.hidden = false; errBox.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
        if (window.console) console.error("[lead] falha no envio:", err);
      });
    });
  }

  /* ============================================================
     4 · GSAP — entradas e reveals
     ============================================================ */
  function initGsap() {
    if (typeof gsap === "undefined") {
      document.documentElement.classList.remove("js");
      return;
    }
    gsap.registerPlugin(ScrollTrigger);

    if (prefersReduced) {
      gsap.set("[data-reveal], [data-hero-fade]", { clearProps: "all" });
      return;
    }

    gsap.fromTo("[data-hero-fade]",
      { y: 22, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.9, stagger: 0.12, ease: "power3.out", delay: 0.15 });

    gsap.utils.toArray("[data-reveal]").forEach(function (el) {
      var group = el.closest("[data-reveal-group]");
      var delay = 0;
      if (group) {
        var siblings = Array.prototype.slice.call(group.querySelectorAll("[data-reveal]"));
        delay = (siblings.indexOf(el) % 12) * 0.07;
      }
      gsap.fromTo(el,
        { y: 28, opacity: 0 },
        {
          y: 0, opacity: 1, duration: 0.85, delay: delay, ease: "power3.out",
          scrollTrigger: { trigger: group || el, start: "top 86%", once: true }
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGsap);
  } else {
    initGsap();
  }
  /* ============================================================
     Mocks do sistema (.pm) — ativa animações ao entrar na tela,
     timer da discadora e tilt 3D no hover
     ============================================================ */
  (function () {
    var pms = document.querySelectorAll(".pm");
    if (!pms.length) return;

    function goLive(pm) {
      if (pm.classList.contains("is-live")) return;
      var items = pm.querySelectorAll(".pm__colhead, .pm__kpi, .pm__card, .pm__row, .pm__insight, .pm__foot, .pm__live");
      items.forEach(function (el, i) { el.style.animationDelay = (0.1 + i * 0.07).toFixed(2) + "s"; });
      pm.querySelectorAll(".pm__bars span").forEach(function (el, i) { el.style.animationDelay = (0.45 + i * 0.07).toFixed(2) + "s"; });
      pm.classList.add("is-live");

      var timer = pm.querySelector(".pm__timer");
      if (timer && !prefersReduced) {
        var s = 42;
        setInterval(function () {
          s++;
          var m = Math.floor(s / 60), r = s % 60;
          timer.textContent = (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
        }, 1000);
      }
    }

    if (prefersReduced || !("IntersectionObserver" in window)) {
      pms.forEach(goLive);
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { goLive(en.target); io.unobserve(en.target); }
        });
      }, { threshold: 0.35 });
      pms.forEach(function (pm) { io.observe(pm); });
    }

    // tilt 3D discreto no hover (só com mouse)
    if (!prefersReduced && window.matchMedia("(hover: hover)").matches) {
      pms.forEach(function (pm) {
        var host = pm.closest(".print, .apoio__card") || pm;
        host.addEventListener("pointermove", function (e) {
          var r = host.getBoundingClientRect();
          var x = (e.clientX - r.left) / r.width - 0.5;
          var y = (e.clientY - r.top) / r.height - 0.5;
          pm.style.transform = "perspective(900px) rotateX(" + (-y * 6).toFixed(2) + "deg) rotateY(" + (x * 8).toFixed(2) + "deg) translateY(-3px)";
        });
        host.addEventListener("pointerleave", function () { pm.style.transform = ""; });
      });
    }
  })();

  /* ============================================================
     Colmeia — hover/toque abre o hexágono e troca o mock do painel
     ============================================================ */
  (function () {
    var hive = document.getElementById("hive");
    var panel = document.getElementById("hivePanel");
    if (!hive || !panel) return;
    var hexes = hive.querySelectorAll(".hex");
    var items = panel.querySelectorAll(".hive__item");
    var hint = hive.querySelector(".hive__hint");
    var current = 0, hoverTimer = null;

    function replayMock(item) {
      var pm = item.querySelector(".pm");
      if (!pm || prefersReduced) return;
      pm.classList.remove("is-live");
      void pm.offsetWidth; // força reflow para a cascata rodar de novo
      var els = pm.querySelectorAll(".pm__colhead, .pm__kpi, .pm__card, .pm__row, .pm__insight, .pm__foot, .pm__live, .pm__field, .pm__score, .pm__tl li, .pm__stage");
      els.forEach(function (el, i) { el.style.animationDelay = (0.08 + i * 0.06).toFixed(2) + "s"; });
      pm.classList.add("is-live");
    }

    function activate(i) {
      if (i === current) return;
      current = i;
      hexes.forEach(function (h, n) {
        h.classList.toggle("is-on", n === i);
        h.setAttribute("aria-selected", n === i ? "true" : "false");
      });
      items.forEach(function (it, n) { it.classList.toggle("is-on", n === i); });
      replayMock(items[i]);
      if (hint) hint.classList.add("is-off");
    }

    hexes.forEach(function (h, i) {
      h.addEventListener("mouseenter", function () {
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(function () { activate(i); }, 60); // evita troca frenética ao atravessar
      });
      h.addEventListener("click", function () { activate(i); });
      h.addEventListener("focus", function () { activate(i); });
    });
    // setas do teclado navegam pela colmeia
    hive.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); hexes[(current + 1) % hexes.length].focus(); }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); hexes[(current - 1 + hexes.length) % hexes.length].focus(); }
    });
  })();
})();
