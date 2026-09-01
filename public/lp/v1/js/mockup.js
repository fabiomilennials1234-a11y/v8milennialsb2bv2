/* ============================================================
   TORQUE · Variação 01 — Product Preview
   Interatividade do mockup (portada do index da raiz:
   script.js + script2.js, apenas as partes do preview)
   ============================================================ */
(function () {
  "use strict";
  if (typeof gsap === "undefined") return;

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Escala do preview ----------
     A largura de design acompanha o viewport (os breakpoints do Tailwind
     dentro do mockup são por viewport): no desktop ~1200px reduzido para a
     coluna; no mobile a largura de design = viewport, então o mockup usa o
     próprio layout responsivo em escala 1. */
  var scaleWrap = document.getElementById("mockupScale");
  var previewCol = document.querySelector(".hero__preview");
  function fitMockup() {
    if (!scaleWrap || !previewCol) return;
    var vw = window.innerWidth;
    // no mobile o conteúdo interno do mockup precisa de ~560px de largura
    // mínima; renderiza em 560 e reduz via zoom em vez de deixar cortar
    var design = vw < 760 ? 560 : Math.min(1200, Math.max(320, vw - 48));
    scaleWrap.style.width = design + "px";
    scaleWrap.style.zoom = Math.min(1, previewCol.clientWidth / design);
  }
  fitMockup();
  window.addEventListener("resize", fitMockup);

  /* ---------- Entrada do mockup no scroll ---------- */
  if (!prefersReduced && typeof ScrollTrigger !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
    gsap.from(".hero-mockup", {
      y: 60, opacity: 0, scale: 0.96, duration: 1.2, ease: "power4.out",
      scrollTrigger: { trigger: "#mockup-showcase", start: "top 80%", once: true },
      onComplete: function () { gsap.set(".hero-mockup", { clearProps: "opacity,scale" }); }
    });
    gsap.from(".float-card", {
      y: 30, opacity: 0, duration: 0.8, stagger: 0.15, ease: "power3.out",
      scrollTrigger: { trigger: "#mockup-showcase", start: "top 80%", once: true }
    });
  }

  /* ---------- Mockup nav: troca de páginas com transição ---------- */
  var navLinks = document.querySelectorAll(".nav-link[data-page]");
  var isSwitching = false;

  navLinks.forEach(function (link) {
    link.addEventListener("click", function (e) {
      e.preventDefault();
      if (isSwitching) return;
      var target = document.getElementById("page-" + link.dataset.page);
      if (!target || target.classList.contains("active")) return;

      isSwitching = true;
      var current = document.querySelector(".dash-page.active");

      navLinks.forEach(function (l) { l.classList.remove("active"); });
      link.classList.add("active");

      if (current) {
        gsap.to(current, {
          opacity: 0, y: 8, duration: 0.22, ease: "power2.in",
          onComplete: function () {
            current.classList.remove("active");
            target.classList.add("active");
            gsap.fromTo(target,
              { opacity: 0, y: -8 },
              { opacity: 1, y: 0, duration: 0.4, ease: "power3.out",
                onComplete: function () { isSwitching = false; } });
          }
        });
      } else {
        target.classList.add("active");
        isSwitching = false;
      }
    });
  });

  /* ---------- Tilt do mockup com o mouse ---------- */
  var mockupSection = document.getElementById("mockup-showcase");
  var mockupTilt = mockupSection ? mockupSection.querySelector(".hero-mockup") : null;
  if (mockupSection && mockupTilt && !prefersReduced && window.matchMedia("(hover: hover)").matches) {
    mockupSection.addEventListener("mousemove", function (e) {
      var rect = mockupSection.getBoundingClientRect();
      var cx = rect.width / 2, cy = rect.height / 2;
      var dx = (e.clientX - rect.left - cx) / cx;
      var dy = (e.clientY - rect.top - cy) / cy;
      gsap.to(mockupTilt, {
        rotateY: -4 + dx * 3,
        rotateX: 8 - dy * 3,
        duration: 0.6, ease: "power2.out", overwrite: "auto"
      });
      mockupSection.querySelectorAll(".float-card").forEach(function (el, i) {
        gsap.to(el, {
          x: dx * (i + 1) * 8,
          y: dy * (i + 1) * 6,
          duration: 0.8, ease: "power2.out", overwrite: "auto"
        });
      });
    });
  }

  /* ---------- Sparkline no mockup ---------- */
  var sparkPath = document.querySelector("#sparkPath");
  if (sparkPath && !prefersReduced && typeof ScrollTrigger !== "undefined") {
    var len = sparkPath.getTotalLength();
    sparkPath.style.strokeDasharray = len;
    sparkPath.style.strokeDashoffset = len;
    gsap.to(sparkPath, {
      strokeDashoffset: 0, duration: 2.5, ease: "power2.inOut",
      scrollTrigger: { trigger: sparkPath, start: "top 90%", once: true }
    });
  }

  /* ---------- Barras do gráfico ---------- */
  if (typeof ScrollTrigger !== "undefined" && !prefersReduced) {
    ScrollTrigger.batch(".mock-bar", {
      start: "top 90%",
      onEnter: function (batch) {
        gsap.from(batch, {
          scaleY: 0, transformOrigin: "bottom",
          duration: 0.8, ease: "power2.out", stagger: 0.05
        });
      },
      once: true
    });
  }

  /* ---------- Contadores [data-counter] dentro do mockup ---------- */
  function animateCounter(el) {
    var target = parseFloat(el.dataset.target);
    var decimals = parseInt(el.dataset.decimals || "0", 10);
    var suffix = el.dataset.suffix || "";
    var prefix = el.dataset.prefix || "";
    if (prefersReduced) {
      el.textContent = prefix + target.toFixed(decimals).replace(".", ",") + suffix;
      return;
    }
    gsap.fromTo(el, { textContent: 0 }, {
      textContent: target, duration: 2, ease: "power2.out",
      snap: { textContent: decimals === 0 ? 1 : 0.1 },
      onUpdate: function () {
        var v = parseFloat(el.textContent);
        el.textContent = prefix + v.toFixed(decimals).replace(".", ",") + suffix;
      }
    });
  }
  if (typeof ScrollTrigger !== "undefined") {
    document.querySelectorAll("[data-counter]").forEach(function (el) {
      ScrollTrigger.create({
        trigger: el, start: "top 85%", once: true,
        onEnter: function () { animateCounter(el); }
      });
    });
  }

  /* ---------- Oráculo Comercial — painel de IA ---------- */
  var aiFab = document.querySelector("#ai-fab");
  var oraculoPanel = document.querySelector("#oraculo-panel");
  var oraculoClose = document.querySelector("#oraculo-close");
  var oraculoResponse = document.querySelector("#oraculo-response");
  var oraculoResponseText = document.querySelector("#oraculo-response-text");
  var oraculoChips = document.querySelectorAll(".oraculo-chip");
  var aiBubble = document.querySelector("#ai-bubble");

  var oraculoAnswers = {
    "Como está meu mês?": "Você está em <strong>1% da meta</strong> com 9 dias restantes. Para chegar em R$ 210K, preciso que o time foque nas <strong>19 propostas abertas</strong> — 6 delas com score acima de 80 podem fechar até sexta. Posso priorizá-las?",
    "Quem precisa de atenção?": "<strong>Marina Lopes</strong> está 38% abaixo da meta e sem follow-ups há 4 dias. <strong>Carlos Andrade</strong> tem 3 propostas paradas no estágio \"Negociação\" há mais de 7 dias. Sugiro check-in 1:1 com ambos.",
    "Qual produto focar?": "<strong>Plano Pro Anual</strong> tem ticket médio 2,4x maior e ciclo de venda 38% menor. Dos seus 777 leads, 142 demonstraram interesse nesse plano. Quer que eu crie uma cadência de follow-up direcionada?"
  };

  function openOraculo() {
    if (!oraculoPanel) return;
    oraculoPanel.style.display = "block";
    if (aiBubble) aiBubble.classList.add("hidden-bubble");
    gsap.fromTo(oraculoPanel.firstElementChild,
      { y: 20, opacity: 0, scale: 0.92 },
      { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: "back.out(1.4)" });
  }
  function closeOraculo() {
    if (!oraculoPanel) return;
    gsap.to(oraculoPanel.firstElementChild, {
      y: 10, opacity: 0, scale: 0.95, duration: 0.25, ease: "power2.in",
      onComplete: function () {
        oraculoPanel.style.display = "none";
        if (aiBubble) aiBubble.classList.remove("hidden-bubble");
      }
    });
  }

  if (aiFab) {
    aiFab.addEventListener("click", function (e) {
      e.stopPropagation();
      if (oraculoPanel.style.display === "none" || !oraculoPanel.style.display) openOraculo();
      else closeOraculo();
    });
  }
  if (oraculoClose) {
    oraculoClose.addEventListener("click", function (e) {
      e.stopPropagation();
      closeOraculo();
    });
  }
  oraculoChips.forEach(function (chip) {
    chip.addEventListener("click", function (e) {
      e.stopPropagation();
      var answer = oraculoAnswers[chip.textContent.trim()];
      if (!answer || !oraculoResponse) return;
      oraculoResponse.classList.remove("hidden");
      oraculoResponseText.innerHTML = '<span class="inline-flex gap-1"><span class="w-1 h-1 rounded-full bg-purple-400 animate-bounce"></span><span class="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style="animation-delay:0.15s"></span><span class="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style="animation-delay:0.3s"></span></span>';
      gsap.fromTo(oraculoResponse, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 });
      setTimeout(function () { oraculoResponseText.innerHTML = answer; }, 900);
    });
  });

  /* ---------- Ticker de notificações (float card) ---------- */
  var notifications = [
    { name: "Carlos Andrade", action: "fechou negócio", value: "R$ 24.800" },
    { name: "Marina Lopes", action: "novo lead qualificado", value: "Hot" },
    { name: "Felipe Souza", action: "agendou reunião", value: "15h" },
    { name: "Patrícia Rocha", action: "avançou no funil", value: "Proposta" }
  ];
  var notifIndex = 0;
  var notifEl = document.querySelector("#notif-content");
  if (notifEl && !prefersReduced) {
    setInterval(function () {
      notifIndex = (notifIndex + 1) % notifications.length;
      var n = notifications[notifIndex];
      gsap.to(notifEl, {
        opacity: 0, y: -10, duration: 0.3,
        onComplete: function () {
          notifEl.querySelector(".notif-name").textContent = n.name;
          notifEl.querySelector(".notif-action").textContent = n.action;
          notifEl.querySelector(".notif-value").textContent = n.value;
          gsap.fromTo(notifEl, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 });
        }
      });
    }, 3500);
  }

  /* ============================================================
     DashboardTV — painel comercial ao vivo (entrada suave)
     ============================================================ */
  (function () {
    var page = document.getElementById("page-dashboardtv");
    if (!page) return;
    var clockTimer = null;

    var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
    function tween(dur, onUpdate, onDone) {
      if (prefersReduced) { onUpdate(1); if (onDone) onDone(); return; }
      var t0 = performance.now();
      (function frame(now) {
        var p = Math.min(1, (now - t0) / dur);
        onUpdate(easeOut(p));
        if (p < 1) requestAnimationFrame(frame); else if (onDone) onDone();
      })(t0);
    }

    var fmt = function (v, dec) { return (dec ? v.toFixed(dec) : String(Math.round(v))).replace(".", ","); };
    function countUp(el) {
      var to = parseFloat(el.dataset.to);
      var dec = el.dataset.dec ? parseInt(el.dataset.dec, 10) : 0;
      var pre = el.dataset.prefix || "", suf = el.dataset.suffix || "";
      if (!to) { el.textContent = pre + fmt(0, dec) + suf; return; }
      tween(1100, function (p) { el.textContent = pre + fmt(to * p, dec) + suf; });
    }

    function fillThermo() {
      var f = page.querySelector("#tv-thermo-fill");
      if (!f) return;
      var h = f.dataset.h || 0;
      requestAnimationFrame(function () {
        f.style.transition = "height 1.3s cubic-bezier(.2,.85,.25,1)";
        f.style.height = h + "%";
      });
    }
    function fillBars() {
      page.querySelectorAll(".tv-bar").forEach(function (b) {
        var row = b.closest(".tv-funnel-row");
        var w = b.dataset.w || (row && row.dataset.w) || 0;
        requestAnimationFrame(function () { b.style.width = w + "%"; });
      });
    }

    function enter() {
      var items = page.querySelectorAll(".tv-anim");
      if (!prefersReduced) {
        gsap.killTweensOf(items);
        gsap.fromTo(items, { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: 0.5, ease: "power3.out", stagger: 0.05 });
      } else {
        items.forEach(function (i) { i.style.opacity = 1; });
      }
      page.querySelectorAll(".tv-count").forEach(countUp);
      setTimeout(fillThermo, 150);
      setTimeout(fillBars, 250);
    }

    function tickClock() {
      var el = page.querySelector("#tv-clock");
      if (!el) return;
      var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
      el.textContent = p(d.getHours()) + ":" + p(d.getMinutes());
    }
    function startClock() { if (clockTimer) return; tickClock(); clockTimer = setInterval(tickClock, 1000); }
    function stopClock() { clearInterval(clockTimer); clockTimer = null; }

    document.querySelectorAll(".nav-link[data-page]").forEach(function (link) {
      link.addEventListener("click", function () {
        if (link.dataset.page === "dashboardtv") {
          setTimeout(function () { enter(); startClock(); }, 320);
        } else {
          stopClock();
        }
      });
    });
  })();

  /* ============================================================
     Carteira (seção 02) — abas de segmento + visões, dados fictícios
     ============================================================ */
  (function () {
    var rowsEl = document.getElementById("cartRows");
    var tabsEl = document.getElementById("cartTabs");
    var viewsEl = document.getElementById("cartViews");
    var footerEl = document.getElementById("cartFooter");
    if (!rowsEl || !tabsEl) return;

    // n=cliente, e=empresa, h=health, r=recompra, rc=cor, t=ticket,
    // td=tendência (1 sobe, 0 estável, -1 cai), seg=segmento, cat=flags extras
    var CLIENTES = [
      { n: "Metalúrgica Andrade", e: "2 pedidos · Ricardo Tavares", h: 88, r: "em dia", rc: "ok", t: "R$ 12.400", td: 1, seg: "ouro", cat: [] },
      { n: "Cintya Sousa", e: "3 pedidos · Magic Color", h: 84, r: "pedido em 4 dias", rc: "soon", t: "R$ 4.120", td: 1, seg: "ouro", cat: ["previsto"] },
      { n: "Móveis Planalto", e: "5 pedidos · Sérgio Dias", h: 91, r: "em dia", rc: "ok", t: "R$ 6.120", td: 1, seg: "ouro", cat: [] },
      { n: "Embalagens Rio Claro", e: "2 pedidos · Paula Lima", h: 76, r: "pedido em 6 dias", rc: "soon", t: "R$ 3.850", td: 0, seg: "prata", cat: ["previsto"] },
      { n: "Distribuidora Pampa", e: "1 pedido · Jorge Ruas", h: 64, r: "12 dias atrasado", rc: "late", t: "R$ 2.230", td: -1, seg: "prata", cat: ["atrasada"] },
      { n: "HigiCats", e: "1 pedido · Moisés Santos", h: 58, r: "21 dias atrasado", rc: "late", t: "R$ 1.920", td: -1, seg: "prata", cat: ["atrasada"] },
      { n: "AgroSul Insumos", e: "1 pedido · Beatriz Melo", h: 70, r: "8 dias atrasado", rc: "late", t: "R$ 1.980", td: 0, seg: "novos", cat: ["atrasada"] },
      { n: "Washington Nascimento", e: "1 pedido · WN Alimentos", h: 72, r: "primeiro pedido há 12d", rc: "ok", t: "R$ 1.450", td: 0, seg: "novos", cat: [] },
      { n: "Max Holanda", e: "1 pedido · Mimbo Açaí", h: 74, r: "em dia", rc: "ok", t: "R$ 2.920", td: 1, seg: "novos", cat: [] },
      { n: "Chips Naturais", e: "1 pedido · Thaís Borges", h: 69, r: "em dia", rc: "ok", t: "R$ 1.920", td: 0, seg: "novos", cat: [] },
      { n: "Brasil Engrenagens", e: "1 pedido · Gabriel", h: 41, r: "96 dias atrasado", rc: "late", t: "R$ 4.200", td: -1, seg: "resgate", cat: ["atrasada"] },
      { n: "Gráfica Juizforana", e: "1 pedido · Fábio Jr.", h: 45, r: "75 dias atrasado", rc: "late", t: "R$ 2.921", td: -1, seg: "resgate", cat: ["atrasada"] },
      { n: "Armazém Colon", e: "2 pedidos · Jonas", h: 52, r: "sem pedidos há 6 meses", rc: "mute", t: "R$ 3.621", td: 0, seg: "dormindo", cat: [] },
      { n: "LD Cosméticos", e: "2 pedidos · Rudimar", h: 49, r: "sem pedidos há 8 meses", rc: "mute", t: "R$ 2.095", td: 0, seg: "dormindo", cat: [] }
    ];

    var SEG_BADGE = {
      ouro: ["OURO", "rgba(255,212,0,0.12)", "#ffd400"],
      prata: ["PRATA", "rgba(245,242,227,0.1)", "#b5b0a4"],
      novos: ["NOVO", "rgba(59,130,246,0.12)", "#93c5fd"],
      resgate: ["RESGATE", "rgba(239,68,68,0.12)", "#f87171"],
      dormindo: ["DORMINDO", "rgba(168,85,247,0.12)", "#c084fc"]
    };
    var REC_COLOR = { ok: "#4ade80", soon: "#f0a94f", late: "#f87171", mute: "#8a857a" };
    var MAX_ROWS = 6;

    function healthColor(h) { return h >= 80 ? "#4ade80" : h >= 60 ? "#facc15" : "#f87171"; }
    function trend(td) {
      return td > 0 ? '<span style="color:#4ade80;">↗ Subindo</span>'
        : td < 0 ? '<span style="color:#f87171;">↘ Caindo</span>'
        : '<span style="color:#8a857a;">— Estável</span>';
    }

    function filtro(seg) {
      if (seg === "todos") return CLIENTES;
      if (seg === "previsto" || seg === "atrasada") {
        return CLIENTES.filter(function (c) { return c.cat.indexOf(seg) !== -1; });
      }
      return CLIENTES.filter(function (c) { return c.seg === seg; });
    }

    function render(seg) {
      var list = filtro(seg);
      var shown = list.slice(0, MAX_ROWS);
      rowsEl.innerHTML = shown.map(function (c) {
        var b = SEG_BADGE[c.seg];
        return '<div class="crow">' +
          '<div class="min-w-0"><div class="text-[9px] text-cream font-medium truncate">' + c.n + '</div>' +
          '<div class="text-[8px] text-mute truncate">' + c.e + '</div></div>' +
          '<div class="text-[8.5px] font-semibold" style="color:' + healthColor(c.h) + ';">● ' + c.h + '</div>' +
          '<div class="text-[8.5px]" style="color:' + REC_COLOR[c.rc] + ';">' + c.r + '</div>' +
          '<div class="text-[9px] text-cream">' + c.t + '</div>' +
          '<div class="text-[8.5px] crow__hide-sm">' + trend(c.td) + '</div>' +
          '<div class="crow__hide-sm"><span class="text-[7.5px] font-bold px-1.5 py-0.5 rounded" style="background:' + b[1] + '; color:' + b[2] + ';">' + b[0] + '</span></div>' +
          '</div>';
      }).join("");
      if (footerEl) {
        footerEl.innerHTML =
          '<span>mostrando ' + shown.length + " de " + list.length + " clientes</span>" +
          '<span style="color:#ED9227;" class="font-medium">Exportar ↓</span>';
      }
    }

    tabsEl.addEventListener("click", function (e) {
      var btn = e.target.closest(".ctab");
      if (!btn) return;
      tabsEl.querySelectorAll(".ctab").forEach(function (t) { t.classList.remove("is-active"); });
      btn.classList.add("is-active");
      render(btn.dataset.seg);
    });

    if (viewsEl) {
      viewsEl.addEventListener("click", function (e) {
        var btn = e.target.closest(".cview");
        if (!btn) return;
        viewsEl.querySelectorAll(".cview").forEach(function (v) { v.classList.remove("is-active"); });
        btn.classList.add("is-active");
        document.querySelectorAll("[data-cart-view]").forEach(function (panel) {
          panel.hidden = panel.dataset.cartView !== btn.dataset.view;
        });
      });
    }

    render("todos");
  })();
})();
