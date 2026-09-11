/* ============================================================
   TORQUE — LP "Motion" (design system Kommo × identidade Torque)
   GSAP + ScrollTrigger · Motion (motion.dev) · three.js
   ============================================================ */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasGsap = typeof window.gsap !== "undefined";
  var hasMotion = typeof window.Motion !== "undefined" && typeof window.Motion.animate === "function";
  var hasThree = typeof window.THREE !== "undefined";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  if (hasGsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);
  if (hasGsap) gsap.ticker.lagSmoothing(0);
  $("#year") && ($("#year").textContent = String(new Date().getFullYear()));

  /* ============================================================
     0 · Cursor de mão (réplica do cursor 3D dos vídeos do Kommo)
     ============================================================ */
  var HAND_ID = 0;
  function handSvg(lens) {
    var id = "hg" + (++HAND_ID);
    var hand =
      '<svg viewBox="0 0 48 56" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFBF2"/><stop offset=".5" stop-color="#FBE3C3"/><stop offset="1" stop-color="#F2B15B"/></linearGradient></defs>' +
      '<path d="M18.5 5.5c0-2.2 1.8-4 4-4s4 1.8 4 4v19.5h2.2c1.9 0 3.5 1.6 3.5 3.5v1.2h2.3c1.9 0 3.5 1.6 3.5 3.5v1h2.3c1.9 0 3.5 1.6 3.5 3.5v5.8C43.8 50 37.3 55 30.5 55h-5.8c-4.7 0-9.1-2.3-11.8-6.1l-9.6-13.6c-1.3-1.8-.9-4.3.9-5.6 1.7-1.2 4-.9 5.3.7l9 9.7V5.5z" fill="url(#' + id + ')" stroke="#D97F14" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M21.2 9.5v16" stroke="#fff" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/>' +
      '</svg>';
    if (!lens) return hand;
    return (
      '<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="' + id + 'l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF7E6"/><stop offset="1" stop-color="#F5B863"/></linearGradient><radialGradient id="' + id + 'g" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#FFE9C2" stop-opacity=".25"/></radialGradient></defs>' +
      '<circle cx="24" cy="24" r="17" fill="url(#' + id + 'g)" stroke="url(#' + id + 'l)" stroke-width="5"/>' +
      '<path d="M36 36l15 15" stroke="#ED9227" stroke-width="7" stroke-linecap="round"/>' +
      '<path d="M40 32l13 13" stroke="#FFE45C" stroke-width="2.4" stroke-linecap="round" stroke-opacity=".8"/>' +
      '<path d="M15 20a9 9 0 0 1 9-8" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>' +
      '</svg>'
    );
  }
  $$(".hand").forEach(function (h) { h.innerHTML = handSvg(h.classList.contains("hand--lens")); });

  /* ============================================================
     1 · Header
     ============================================================ */
  var header = $("#header");
  var burger = $("#burger");
  function onScroll() { header.classList.toggle("is-scrolled", window.scrollY > 8); }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
  if (burger) {
    burger.addEventListener("click", function () {
      var open = header.classList.toggle("is-open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
    $$(".nav a").forEach(function (a) { a.addEventListener("click", function () { header.classList.remove("is-open"); }); });
  }

  /* ============================================================
     2 · Carrossel de canais do hero (Motion — springs)
     ============================================================ */
  (function () {
    var wrap = $("#channels");
    if (!wrap) return;
    var items = $$(".channels__item", wrap);
    var n = items.length, active = 0, step = 62;
    function place(animate) {
      items.forEach(function (el, i) {
        var d = i - active;
        if (d > n / 2) d -= n; if (d < -n / 2) d += n;
        var vis = Math.abs(d) <= 2;
        var scale = d === 0 ? 1.28 : Math.abs(d) === 1 ? 0.92 : 0.7;
        var op = d === 0 ? 1 : Math.abs(d) === 1 ? 0.85 : vis ? 0.45 : 0;
        var x = d * step;
        if (animate && hasMotion && !prefersReduced) {
          Motion.animate(el, { x: x, scale: scale, opacity: op }, { type: "spring", stiffness: 260, damping: 22 });
        } else {
          el.style.transform = "translate(" + x + "px,0) scale(" + scale + ")";
          el.style.opacity = op;
        }
        el.style.zIndex = d === 0 ? 3 : Math.abs(d) === 1 ? 2 : 1;
      });
    }
    place(false);
    if (prefersReduced) return;
    setInterval(function () { active = (active + 1) % n; place(true); }, 1700);
  })();

  /* ============================================================
     3 · Hero — blobs desfocados (three.js shader) = top-block-gradient do Kommo
     ============================================================ */
  (function () {
    var canvas = $("#heroCanvas");
    var fallback = $(".hero__bg-fallback");
    if (!canvas) return;
    if (!hasThree || prefersReduced) { canvas.remove(); return; }
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, powerPreference: "low-power" });
    } catch (e) { canvas.remove(); return; }
    renderer.setPixelRatio(0.35); // blobs desfocados: resolução baixa é invisível e muito mais leve
    var scene = new THREE.Scene();
    var cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    var uniforms = { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } };
    var mat = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: "void main(){gl_Position=vec4(position,1.0);}",
      fragmentShader: [
        "precision mediump float;",
        "uniform float uTime; uniform vec2 uRes;",
        "float blob(vec2 uv, vec2 c, float r){ float d=length(uv-c); return smoothstep(r, r*0.15, d); }",
        "void main(){",
        "  vec2 uv = gl_FragCoord.xy/uRes; float asp = uRes.x/uRes.y; uv.x *= asp; float t = uTime*0.18;",
        "  vec3 col = vec3(1.0); float acc = 0.0; vec3 sum = vec3(0.0);",
        "  float a;",
        "  a = blob(uv, vec2(0.22*asp + sin(t*0.9)*0.06, 0.55 + cos(t*1.1)*0.08), 0.42); sum += vec3(0.988,0.910,0.812)*a; acc += a;",   /* pêssego */
        "  a = blob(uv, vec2(0.50*asp + cos(t*0.7)*0.08, 0.42 + sin(t*0.8)*0.07), 0.50); sum += vec3(0.973,0.843,0.686)*a; acc += a;",   /* pêssego 2 */
        "  a = blob(uv, vec2(0.78*asp + sin(t*1.2)*0.07, 0.62 + cos(t*0.6)*0.09), 0.40); sum += vec3(1.0,0.914,0.639)*a; acc += a;",     /* amarelo claro */
        "  a = blob(uv, vec2(0.90*asp + cos(t*0.5)*0.05, 0.30 + sin(t*1.3)*0.06), 0.34); sum += vec3(0.961,0.725,0.369)*a; acc += a;",   /* laranja suave */
        "  a = blob(uv, vec2(0.08*asp + sin(t*0.6)*0.05, 0.28 + cos(t*0.9)*0.07), 0.32); sum += vec3(1.0,0.831,0.0)*a*0.85; acc += a*0.85;", /* amarelo Torque */
        "  a = blob(uv, vec2(0.62*asp + sin(t*0.4)*0.09, 0.85 + cos(t*1.0)*0.05), 0.36); sum += vec3(0.929,0.573,0.153)*a*0.75; acc += a*0.75;", /* laranja Torque */
        "  vec3 mixed = acc > 0.0 ? sum/acc : col;",
        "  col = mix(col, mixed, clamp(acc, 0.0, 1.0));",
        "  gl_FragColor = vec4(col, 1.0);",
        "}"
      ].join("\n")
    });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    function resize() {
      var w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
      renderer.setSize(w, h, false);
      uniforms.uRes.value.set(renderer.domElement.width, renderer.domElement.height);
    }
    resize(); window.addEventListener("resize", resize);
    if (fallback) fallback.style.opacity = "0";
    var running = true, start = performance.now();
    function frame(now) {
      if (running && !document.hidden && !document.body.classList.contains("calmodal-open")) {
        uniforms.uTime.value = (now - start) / 1000;
        renderer.render(scene, cam);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (en) { running = en[0].isIntersecting; }, { threshold: 0 }).observe(canvas);
    }
  })();

  /* ============================================================
     4 · VSL — autoplay mudo quando visível; clique reinicia com som
     ============================================================ */
  (function () {
    var video = $("#vslVideo"), overlay = $("#vslOverlay");
    if (!video || !overlay) return;
    var activated = false;
    function tryPlay() { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (en) {
        en.forEach(function (e) {
          if (e.isIntersecting) { if (!activated || video.paused) tryPlay(); }
          else if (!activated) video.pause();
        });
      }, { threshold: 0.35 }).observe(video);
    } else tryPlay();
    overlay.addEventListener("click", function () {
      activated = true;
      video.muted = false; video.loop = false; video.currentTime = 0;
      tryPlay();
      overlay.classList.add("is-hidden");
    });
    video.addEventListener("click", function () { if (activated) { video.paused ? tryPlay() : video.pause(); } });
    video.addEventListener("ended", function () { if (activated) { var t = $("#agendar"); t && t.scrollIntoView({ behavior: "smooth" }); } });
  })();

  /* ============================================================
     5 · Bloco "Por dentro" — abas + fluxo de automações + mão
     ============================================================ */
  (function () {
    var tabs = $$("#demoTabs .tab");
    var nodes = $$("#flow .node");
    var hand = $("#flowHand");
    var cfg = $("#flowCfg");
    var log = $$("#flowLog li");
    var lines = $$("#flow .flow__lines path");
    if (!tabs.length || !nodes.length) return;

    var STEPS = [
      { t: "Lead entrou", rows: [["Origem", "Meta Ads"], ["Canal", "WhatsApp"], ["Registro", "automático"]] },
      { t: "Qualifica", rows: [["Agente", "IA · perguntas B2B"], ["Classifica", "Bronze / Prata / Diamante"], ["Score", "0 a 100"]] },
      { t: "Distribui", rows: [["Regra", "rodízio entre SDRs"], ["SLA", "5 min"], ["Sem resposta", "redistribui"]] },
      { t: "Agenda", rows: [["Quem marca", "agente de IA"], ["Agenda", "do closer disponível"], ["Lembrete", "1h antes · WhatsApp"]] },
      { t: "Acompanha", rows: [["Gatilho", "3 dias parado"], ["Ação", "tarefa + alerta"], ["Para", "vendedor e gestor"]] },
      { t: "Follow-up", rows: [["D+1", "mensagem WhatsApp"], ["D+3", "ligação (tarefa)"], ["D+7", "e-mail com case"]] },
      { t: "Reativa", rows: [["Base", "sem contato há 90 dias"], ["Disparo", "3 variações + IA"], ["Resultado", "novas oportunidades"]] }
    ];
    var current = 0, timer = null, inView = false;

    function moveHandTo(el, cb) {
      if (!hand || prefersReduced || !hasGsap) { cb && cb(); return; }
      var flow = $("#flowGrid") || $("#flow");
      var fr = flow.getBoundingClientRect(), er = el.getBoundingClientRect();
      var x = er.left - fr.left + er.width * 0.55, y = er.top - fr.top + er.height * 0.55;
      gsap.to(hand, { x: x, y: y, opacity: 1, duration: 0.9, ease: "power3.inOut", onComplete: function () {
        gsap.fromTo(hand, { scale: 1 }, { scale: 0.86, duration: 0.12, yoyo: true, repeat: 1, ease: "power1.inOut", onComplete: cb });
      } });
    }

    function setStep(i, animateHand) {
      current = i;
      tabs.forEach(function (t, n) { t.classList.toggle("is-active", n === i); t.setAttribute("aria-selected", n === i ? "true" : "false"); });
      nodes.forEach(function (nd, n) {
        nd.classList.toggle("is-active", n === i);
        nd.classList.toggle("is-done", n < i);
        var b = nd.querySelector(".node__badge");
        if (b && hasGsap) gsap.to(b, { opacity: n === i ? 1 : 0, scale: n === i ? 1 : 0.7, duration: 0.3 });
      });
      lines.forEach(function (p, n) { p.classList.toggle("lit", n < i); });
      log.forEach(function (li, n) { li.classList.toggle("on", n <= i); });
      var s = STEPS[i];
      if (cfg) cfg.innerHTML = "<b>" + s.t + "</b>" + s.rows.map(function (r) { return '<div class="row"><span>' + r[0] + "</span><span>" + r[1] + "</span></div>"; }).join("");
      if (animateHand) moveHandTo(nodes[i]);
      if (hasMotion && !prefersReduced) Motion.animate(tabs[i], { scale: [1, 1.06, 1] }, { duration: 0.35 });
    }
    function next() { setStep((current + 1) % STEPS.length, true); }
    function startAuto() { stopAuto(); if (!prefersReduced) timer = setInterval(function () { if (inView && !document.hidden) next(); }, 3600); }
    function stopAuto() { if (timer) clearInterval(timer); timer = null; }

    tabs.forEach(function (t) { t.addEventListener("click", function () { setStep(+t.dataset.step, true); startAuto(); }); });
    setStep(0, false);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (en) { inView = en[0].isIntersecting; if (inView) { moveHandTo(nodes[current]); } }, { threshold: 0.3 }).observe($("#flow"));
    } else inView = true;
    startAuto();
  })();

  /* ============================================================
     6 · Mocks dos recursos — timelines GSAP disparadas por scroll
     ============================================================ */
  function handTo(hand, container, el, opts) {
    opts = opts || {};
    var cr = container.getBoundingClientRect(), er = el.getBoundingClientRect();
    return { x: er.left - cr.left + er.width * (opts.fx == null ? 0.5 : opts.fx) + (opts.dx || 0), y: er.top - cr.top + er.height * (opts.fy == null ? 0.5 : opts.fy) + (opts.dy || 0) };
  }
  function countUp(el, to, dur) {
    if (!hasGsap) { el.textContent = to; return; }
    var o = { v: 0 };
    return gsap.to(o, { v: to, duration: dur || 1.4, ease: "power2.out", onUpdate: function () { el.textContent = Math.round(o.v).toLocaleString("pt-BR"); } });
  }

  var MOCKS = {
    overview: function (root) {
      var tl = gsap.timeline({ repeat: 0 });
      tl.fromTo($$(".kpi", root), { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, stagger: 0.06 })
        .add(function () { $$("[data-count]", root).forEach(function (el) { countUp(el, +el.dataset.count); }); }, "<")
        .fromTo($$(".bar i", root), { scaleX: 0 }, { scaleX: 1, duration: 0.7, stagger: 0.08, ease: "power3.out" }, "-=0.2")
        .fromTo($$(".list__it", root), { x: -10, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, stagger: 0.05 }, "-=0.5");
      return tl;
    },
    metrics: function (root) {
      var tl = gsap.timeline({ repeat: -1, repeatDelay: 2.5 });
      tl.fromTo($$(".kpi", root), { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.08 })
        .add(function () { $$("[data-count]", root).forEach(function (el) { countUp(el, +el.dataset.count); }); }, "<")
        .fromTo($$(".chart i", root), { scaleY: 0 }, { scaleY: 1, duration: 0.6, stagger: 0.06, ease: "power3.out" }, "-=0.2")
        .fromTo($$(".bar i", root), { scaleX: 0 }, { scaleX: 1, duration: 0.7, stagger: 0.08, ease: "power3.out" }, "-=0.4")
        .to($$(".kpi", root)[3], { boxShadow: "0 0 0 2px rgba(237,146,39,.6)", duration: 0.3 }, "+=0.6")
        .to($$(".kpi", root)[3], { boxShadow: "0 0 0 0 rgba(237,146,39,0)", duration: 0.5 }, "+=1.2");
      return tl;
    },
    campaigns: function (root) {
      var hand = $("[data-hand]", root), rows = $$("[data-row]", root), chip = $("[data-ai-chip]", root), ans = $("[data-ai-answer]", root);
      var tl = gsap.timeline({ repeat: -1, repeatDelay: 2 });
      tl.set(rows, { className: "tbl__row" }).set(chip, { opacity: 0, y: 6, display: "none" }).set(ans, { opacity: 0, y: 6, display: "none" }).set(hand, { opacity: 0 });
      tl.add(function () { var p = handTo(hand, root, rows[3], { fx: 0.3, dx: 20, dy: 6 }); gsap.set(hand, { x: p.x, y: p.y }); })
        .to(hand, { opacity: 1, duration: 0.4 })
        .add(function () { var p = handTo(hand, root, rows[1], { fx: 0.3, dx: 20, dy: 6 }); gsap.to(hand, { x: p.x, y: p.y, duration: 1.1, ease: "power2.inOut" }); })
        .set(chip, { display: "inline-flex" }, "+=0.4")
        .to(chip, { opacity: 1, y: 0, duration: 0.4 })
        .add(function () { var p = handTo(hand, root, rows[0], { fx: 0.4, dx: 26, dy: 4 }); gsap.to(hand, { x: p.x, y: p.y, duration: 0.9, ease: "power2.inOut" }); }, "+=0.5")
        .add(function () { rows[0].classList.add("is-hi"); }, "+=0.9")
        .to(chip, { opacity: 0, y: -4, duration: 0.3 }, "+=0.8")
        .set(chip, { display: "none" })
        .set(ans, { display: "block" })
        .to(ans, { opacity: 1, y: 0, duration: 0.5 })
        .to(hand, { opacity: 0, duration: 0.5 }, "+=1.8");
      return tl;
    },
    ranking: function (root) {
      var rows = $$("[data-rank]", root), badges = $$("[data-badge]", root);
      var tl = gsap.timeline({ repeat: -1, repeatDelay: 2.5 });
      tl.fromTo(rows, { x: -12, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, stagger: 0.1 })
        .fromTo(badges, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, stagger: 0.1, ease: "back.out(2)" }, "-=0.3")
        .fromTo($$(".bar i", root), { scaleX: 0 }, { scaleX: 1, duration: 0.7, stagger: 0.08, ease: "power3.out" }, "-=0.2")
        .add(function () { rows[0].classList.add("is-hi"); }, "+=0.4")
        .add(function () { rows[0].classList.remove("is-hi"); }, "+=1.6");
      return tl;
    },
    ai: function (root) {
      var msgs = $$("[data-msg]", root), hand = $("[data-hand]", root), slot = $("#aiSlot", root), ev = $("[data-ev-new]", root), tag = $("[data-ai-tag]", root);
      var tl = gsap.timeline({ repeat: -1, repeatDelay: 2.4 });
      tl.set(msgs, { opacity: 0, y: 8 }).set(ev, { opacity: 0, scale: 0.9 }).set(tag, { opacity: 0 }).set(hand, { opacity: 0 });
      msgs.forEach(function (m, i) { tl.to(m, { opacity: 1, y: 0, duration: 0.35 }, i === 0 ? "+=0.2" : "+=0.55"); });
      tl.add(function () { var p = handTo(hand, root, msgs[4], { fx: 0.6 }); gsap.set(hand, { x: p.x, y: p.y }); }, "-=0.8")
        .to(hand, { opacity: 1, duration: 0.3 })
        .add(function () { var p = handTo(hand, root, slot, { fx: 0.5, fy: 0.5 }); gsap.to(hand, { x: p.x, y: p.y, duration: 1.0, ease: "power2.inOut" }); })
        .to(hand, { scale: 0.86, duration: 0.12, yoyo: true, repeat: 1 }, "+=1.0")
        .to(ev, { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(1.6)" }, "<")
        .to(tag, { opacity: 1, duration: 0.3 }, "+=0.3")
        .to(hand, { opacity: 0, duration: 0.4 }, "+=0.8");
      return tl;
    },
    inbox: function (root) {
      var row = $("[data-inbox]", root), typing = $("[data-typing]", root);
      var tl = gsap.timeline({ repeat: -1, repeatDelay: 2 });
      tl.set(row, { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, overflow: "hidden" }).set(typing, { opacity: 0 });
      tl.to(typing, { opacity: 1, duration: 0.3 }, "+=0.8")
        .to(typing, { opacity: 0, duration: 0.3 }, "+=1.6")
        .to(row, { opacity: 1, height: "auto", paddingTop: 9, paddingBottom: 9, duration: 0.5, ease: "power3.out" }, "+=0.3")
        .fromTo(row, { backgroundColor: "rgba(237,146,39,.18)" }, { backgroundColor: "rgba(237,146,39,0)", duration: 1.2 })
        .to(row, { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0, duration: 0.4 }, "+=2");
      return tl;
    },
    followup: function (root) {
      var checks = $$("[data-fu] .check", root);
      var tl = gsap.timeline({ repeat: -1, repeatDelay: 2.2 });
      tl.add(function () { checks.forEach(function (c) { c.classList.remove("done"); }); });
      checks.forEach(function (c, i) { tl.add(function () { c.classList.add("done"); }, "+=" + (i === 0 ? 0.6 : 0.7)); });
      tl.fromTo($$(".tbl__row .dot", root), { scale: 0.4 }, { scale: 1, duration: 0.3, stagger: 0.1, ease: "back.out(2)" }, "+=0.3");
      return tl;
    },
    reactivation: function (root) {
      var bar = $("[data-progress]", root), label = $("[data-progress-label]", root), items = $$("[data-react]", root);
      var tl = gsap.timeline({ repeat: -1, repeatDelay: 2.4 });
      var o = { p: 0 };
      tl.set(items, { opacity: 0, y: 8 }).set(o, { p: 0 })
        .to(o, { p: 100, duration: 4.2, ease: "power1.inOut", onUpdate: function () { bar.style.setProperty("--w", o.p + "%"); label.textContent = Math.round(o.p * 12.4).toLocaleString("pt-BR") + " de 1.240"; } })
        .add(function () { $$("[data-count]", root).forEach(function (el) { countUp(el, +el.dataset.count, 2.5); }); }, 0.4);
      items.forEach(function (it, i) { tl.to(it, { opacity: 1, y: 0, duration: 0.4 }, 0.8 + i * 0.9); });
      return tl;
    }
  };

  function initMocks() {
    if (!hasGsap || prefersReduced) {
      // sem animação: deixa tudo visível
      $$("[data-ai-chip],[data-ai-answer],[data-inbox],[data-react],[data-ev-new],[data-ai-tag],[data-typing]").forEach(function (el) { el.style.opacity = 1; el.style.display = ""; });
      $$("[data-count]").forEach(function (el) { el.textContent = el.dataset.count; });
      $$("[data-progress]").forEach(function (el) { el.style.setProperty("--w", "62%"); });
      $$(".check").forEach(function (c) { c.classList.add("done"); });
      return;
    }
    $$("[data-mock]").forEach(function (root) {
      var kind = root.dataset.mock, build = MOCKS[kind];
      if (!build) return;
      var tl = build(root.querySelector(".feat__mock") || root);
      tl.pause();
      ScrollTrigger.create({ trigger: root, start: "top 85%", end: "bottom 15%", onEnter: function () { tl.play(); }, onEnterBack: function () { tl.play(); }, onLeave: function () { tl.pause(); }, onLeaveBack: function () { tl.pause(); } });
    });
  }

  /* ============================================================
     7 · Blocos IA (vendedor / gestor) — pills que trocam a visão
     ============================================================ */
  (function () {
    var ctrls = $$('[data-ctrls="seller"] .ctrl'), panels = $$('[data-panels="seller"] .aiblock__panel');
    var idx = 0, t = null;
    function show(i) {
      idx = i;
      ctrls.forEach(function (c, n) { c.classList.toggle("is-active", n === i); c.setAttribute("aria-selected", n === i ? "true" : "false"); });
      panels.forEach(function (p, n) { p.classList.toggle("is-active", n === i); });
      if (hasGsap && !prefersReduced) gsap.fromTo(panels[i], { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" });
    }
    ctrls.forEach(function (c) { c.addEventListener("click", function () { show(+c.dataset.panel); restart(); }); });
    function restart() { if (t) clearInterval(t); if (!prefersReduced) t = setInterval(function () { if (!document.hidden) show((idx + 1) % panels.length); }, 5000); }
    if (ctrls.length) { var sec = $("#vendedor"); if ("IntersectionObserver" in window) new IntersectionObserver(function (en) { en[0].isIntersecting ? restart() : (t && clearInterval(t)); }).observe(sec); else restart(); }

    var mctrls = $$('[data-ctrls="manager"] .ctrl'), kpis = $$("#managerKpis .kpi");
    mctrls.forEach(function (c) {
      c.addEventListener("click", function () {
        var i = +c.dataset.kpi;
        mctrls.forEach(function (x) { var on = x === c; x.classList.toggle("is-active", on); x.setAttribute("aria-selected", on ? "true" : "false"); });
        kpis.forEach(function (k, n) { k.classList.toggle("is-hi", n === i); });
        if (hasMotion && !prefersReduced) Motion.animate(kpis[i], { scale: [1, 1.08, 1] }, { duration: 0.45 });
      });
    });
  })();

  /* ============================================================
     8 · Hexágono 3D (three.js) no botão flutuante
     ============================================================ */
  (function () {
    var holder = $("#hex3d");
    if (!holder) return;
    if (!hasThree || prefersReduced) { holder.classList.add("fallback"); return; }
    var size = 58;
    var renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch (e) { holder.classList.add("fallback"); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size);
    holder.appendChild(renderer.domElement);
    var scene = new THREE.Scene();
    var cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100); cam.position.set(0, 0, 9.4);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    var key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(3, 4, 5); scene.add(key);
    var rim = new THREE.DirectionalLight(0xffd400, 0.6); rim.position.set(-4, -2, 3); scene.add(rim);
    // hexágono flat-top (como o ícone do logo), anel + núcleo circular
    function hexShape(r) { var s = new THREE.Shape(); for (var i = 0; i < 6; i++) { var a = i * Math.PI / 3; var x = Math.cos(a) * r, y = Math.sin(a) * r; i === 0 ? s.moveTo(x, y) : s.lineTo(x, y); } s.closePath(); return s; }
    var outer = hexShape(2.2); var hole = hexShape(1.45); hole.autoClose = true; outer.holes.push(hole);
    var ring = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.6, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 3 }), new THREE.MeshStandardMaterial({ color: 0xed9227, roughness: 0.35, metalness: 0.25 }));
    var core = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.65, 48), new THREE.MeshStandardMaterial({ color: 0xed9227, roughness: 0.3, metalness: 0.3 }));
    core.rotation.x = Math.PI / 2;
    var g = new THREE.Group(); ring.position.z = -0.25; g.add(ring); g.add(core); scene.add(g);
    var running = true, spin = 0, extra = 0;
    var fab = $("#fab");
    if (fab) {
      fab.addEventListener("mouseenter", function () { spin = 0.28; });
      fab.addEventListener("touchstart", function () { spin = 0.28; }, { passive: true });
    }
    function frame() {
      if (running && !document.hidden) {
        var tt = performance.now() / 1000;
        extra += spin; spin *= 0.9;
        g.rotation.y = Math.sin(tt * 0.9) * 0.5 + extra; g.rotation.x = Math.sin(tt * 0.6) * 0.22;
        renderer.render(scene, cam);
      }
      requestAnimationFrame(frame);
    }
    frame();
    document.addEventListener("visibilitychange", function () { running = !document.hidden; });
  })();

  /* ============================================================
     9 · Formulário → n8n → TorqueCRM  +  agenda Cal.com
     (mesma integração das LPs v1/v2/v3)
     ============================================================ */
  var LEAD_WEBHOOK_URL = "https://n8nwebhook.v3l8jq.easypanel.host/webhook/torque-lp-lead";
  var LEAD_LP_ID = "demonstracao";
  var CAL_AGENDAS = [
    { id: "leo", host: "Leo", calLink: "leonardo-meireles-yubftg/apresentacao-milennialsb2b" },
    { id: "gabriel", host: "Gabriel", calLink: "gabriel-aurelio-gipp-uekpuj/30min" }
  ];
  var CAL_AGENDA = CAL_AGENDAS[Math.random() < 0.5 ? 0 : 1];
  var calLoaded = false, calMounted = false, calLead = null;

  function leadPayload(formEl) {
    var data = {};
    new FormData(formEl).forEach(function (v, k) { data[k] = typeof v === "string" ? v.trim() : v; });
    var q = new URLSearchParams(window.location.search);
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (k) { if (q.get(k)) data[k] = q.get(k); });
    data.consent = true;
    data.lp = LEAD_LP_ID;
    data.agenda = CAL_AGENDA.id;
    data.agenda_link = "https://cal.com/" + CAL_AGENDA.calLink;
    data.pagina = window.location.href.split("#")[0];
    data.referrer = document.referrer || "";
    data.enviado_em = new Date().toISOString();
    return data;
  }
  function sendLead(formEl) {
    if (!window.fetch) return Promise.reject(new Error("fetch indisponível"));
    return fetch(LEAD_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(leadPayload(formEl)), keepalive: true, mode: "cors" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r; });
  }
  function loadCalEmbed(cb) {
    if (window.Cal && calLoaded) return cb();
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
    calLoaded = true; cb();
  }
  function calFallbackUrl(lead) {
    var q = [];
    if (lead && lead.nome) q.push("name=" + encodeURIComponent(lead.nome));
    if (lead && lead.email) q.push("email=" + encodeURIComponent(lead.email));
    return "https://cal.com/" + CAL_AGENDA.calLink + (q.length ? "?" + q.join("&") : "");
  }
  function notifyBooking(detail) {
    if (!calLead) return;
    var data = detail && detail.data ? detail.data : {};
    var when = (data.date || (data.booking && data.booking.startTime) || "");
    var payload = Object.assign({}, calLead, { evento: "reuniao_marcada", reuniao_em: when, agenda: CAL_AGENDA.id, enviado_em: new Date().toISOString() });
    try { fetch(LEAD_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true, mode: "cors" }).catch(function () {}); } catch (e) {}
    var done = $("#calDone"), stage = $("#calInline");
    if (done) {
      var d = when ? new Date(when) : null;
      var quando = d && !isNaN(d) ? d.toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }) : "";
      $("#calDoneWhen").textContent = quando ? "Reunião marcada para " + quando + " com " + CAL_AGENDA.host + "." : "Reunião marcada com " + CAL_AGENDA.host + ".";
      done.hidden = false; if (stage) stage.hidden = true;
    }
  }
  function openCalModal(lead) {
    calLead = lead || null;
    var modal = $("#calModal");
    if (!modal) { window.open(calFallbackUrl(lead), "_blank"); return; }
    $("#calHost").textContent = CAL_AGENDA.host;
    $("#calFallback").href = calFallbackUrl(lead);
    modal.hidden = false;
    document.body.classList.add("calmodal-open");
    if (hasGsap) gsap.globalTimeline.pause();
    loadCalEmbed(function () {
      if (calMounted) return;
      calMounted = true;
      var ns = CAL_AGENDA.id;
      Cal("init", ns, { origin: "https://app.cal.com" });
      Cal.ns[ns]("inline", {
        elementOrSelector: "#calInline", calLink: CAL_AGENDA.calLink,
        config: Object.assign({ layout: "month_view", theme: "light", useSlotsViewOnSmallScreen: "true" }, lead ? { name: lead.nome || "", email: lead.email || "" } : {})
      });
      Cal.ns[ns]("ui", { theme: "light", cssVarsPerTheme: { light: { "cal-brand": "#ED9227" }, dark: { "cal-brand": "#ED9227" } }, hideEventTypeDetails: false, layout: "month_view" });
      Cal.ns[ns]("on", { action: "bookingSuccessful", callback: notifyBooking });
    });
  }
  function closeCalModal() {
    var modal = $("#calModal"); if (!modal) return;
    modal.hidden = true; document.body.classList.remove("calmodal-open");
    if (hasGsap) gsap.globalTimeline.resume();
  }
  document.addEventListener("click", function (e) { if (e.target.closest("[data-close-cal]")) closeCalModal(); });
  document.addEventListener("keydown", function (e) { var m = $("#calModal"); if (e.key === "Escape" && m && !m.hidden) closeCalModal(); });

  (function () {
    var form = $("#demoForm"); if (!form) return;
    var stepEls = $$(".form__step", form), stepLabel = $("#stepLabel"), stepCount = $("#stepCount"), stepBar = $("#stepBar"), formSub = $("#formSub");
    var STEP_NAMES = ["Seus dados", "Qualificação"], SUB_TEXTS = ["Preencha seus dados para continuar:", "Só mais 3 respostas rápidas:"];
    var current = 0;
    function fieldOk(f) { return f.type === "checkbox" ? f.checked : f.type === "radio" ? !!form.querySelector('[name="' + f.name + '"]:checked') : f.type === "email" ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.value.trim()) : f.value.trim() !== ""; }
    function validateStep(i) { var ok = true; $$("[required]", stepEls[i]).forEach(function (f) { var v = fieldOk(f); f.classList.toggle("is-invalid", !v); if (!v) ok = false; }); return ok; }
    function goTo(i) {
      current = Math.max(0, Math.min(stepEls.length - 1, i));
      stepEls.forEach(function (s, n) { s.classList.toggle("is-active", n === current); });
      stepLabel.textContent = "Passo 0" + (current + 1) + " · " + STEP_NAMES[current];
      stepCount.textContent = (current + 1) + "/" + stepEls.length;
      stepBar.style.width = ((current + 1) / stepEls.length * 100) + "%";
      formSub.textContent = SUB_TEXTS[current];
      var first = stepEls[current].querySelector("input, select");
      if (first && window.matchMedia("(hover: hover)").matches) first.focus({ preventScroll: true });
    }
    // máscara simples de telefone
    var tel = $("#f-whats");
    if (tel) tel.addEventListener("input", function () {
      var v = tel.value.replace(/\D/g, "").slice(0, 11);
      if (v.length > 6) v = "(" + v.slice(0, 2) + ") " + v.slice(2, 7) + "-" + v.slice(7);
      else if (v.length > 2) v = "(" + v.slice(0, 2) + ") " + v.slice(2);
      tel.value = v;
    });
    form.addEventListener("click", function (e) {
      if (e.target.closest("[data-next]")) { if (validateStep(current)) goTo(current + 1); }
      else if (e.target.closest("[data-prev]")) goTo(current - 1);
    });
    form.addEventListener("input", function (e) { var f = e.target; if (f.classList && f.classList.contains("is-invalid") && fieldOk(f)) f.classList.remove("is-invalid"); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      for (var i = 0; i < stepEls.length; i++) { if (!validateStep(i)) { goTo(i); return; } }
      var success = $("#formSuccess"), errBox = $("#formError"), submitBtn = form.querySelector('button[type="submit"]');
      errBox.hidden = true;
      submitBtn.disabled = true; submitBtn.classList.add("is-loading");
      var leadData = leadPayload(form);
      sendLead(form).then(function () {
        success.hidden = false; form.classList.add("is-done"); formSub.hidden = true;
        openCalModal(leadData);
      }).catch(function (err) {
        submitBtn.disabled = false; submitBtn.classList.remove("is-loading");
        errBox.hidden = false; errBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
        if (window.console) console.error("[lead] falha no envio:", err);
      });
    });
  })();

  /* ============================================================
     10 · Reveals (GSAP + ScrollTrigger) e entrada do hero
     ============================================================ */
  function initReveals() {
    if (!hasGsap) { document.documentElement.classList.remove("js"); return; }
    if (prefersReduced) { $$("[data-reveal],[data-hero-fade]").forEach(function (el) { el.classList.add("is-in"); el.style.opacity = 1; el.style.transform = "none"; }); return; }
    gsap.fromTo("[data-hero-fade]", { y: 22, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, stagger: 0.1, ease: "power3.out", delay: 0.1 });
    $$("[data-reveal]").forEach(function (el) {
      var group = el.closest("[data-reveal-group]"), delay = 0;
      if (group) { var sib = $$("[data-reveal]", group); delay = (sib.indexOf(el) % 12) * 0.07; }
      gsap.to(el, { y: 0, opacity: 1, duration: 0.85, delay: delay, ease: "power3.out", scrollTrigger: { trigger: group || el, start: "top 88%", once: true }, onStart: function () { el.classList.add("is-in"); } });
    });
  }

  function boot() { initReveals(); initMocks(); if (hasGsap && window.ScrollTrigger) setTimeout(function () { ScrollTrigger.refresh(); }, 600); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.addEventListener("load", function () { if (hasGsap && window.ScrollTrigger) ScrollTrigger.refresh(); });
})();
