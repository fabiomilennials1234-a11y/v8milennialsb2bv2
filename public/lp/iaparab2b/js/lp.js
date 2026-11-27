/* TORQUE · LP IA — interações (vanilla, sem dependências) */
(function () {
  "use strict";

  var doc = document;
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var hasIO = "IntersectionObserver" in window;

  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }

  /* ------------------------------------------------------------------
     1 · CTAs → cadastro em chat (pasta irmã: /lp/forms/), levando UTMs e o CTA clicado
     ------------------------------------------------------------------ */
  (function () {
    var isLocal = window.location.protocol === "file:";
    var base = window.location.search;
    $$("[data-cta]").forEach(function (a) {
      var href = a.getAttribute("href") || "../forms/";
      if (isLocal) href = "../forms/index.html"; // abrir direto do disco (pastas irmãs)
      var params = new URLSearchParams(base);
      params.set("cta", a.getAttribute("data-cta-id") || "lp");
      a.setAttribute("href", href + "?" + params.toString());
    });
  })();

  /* ------------------------------------------------------------------
     2 · Header com fundo ao rolar
     ------------------------------------------------------------------ */
  (function () {
    var hdr = $("#hdr"); if (!hdr) return;
    var ticking = false;
    function update() { hdr.classList.toggle("is-scrolled", window.scrollY > 24); ticking = false; }
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  })();

  /* ------------------------------------------------------------------
     3 · Reveals ao rolar
     ------------------------------------------------------------------ */
  (function () {
    $$("[data-reveal-group]").forEach(function (g) {
      $$("[data-reveal]", g).forEach(function (el, i) { el.style.setProperty("--i", i); });
    });
    var items = $$("[data-reveal]");
    if (!hasIO || reduced) { items.forEach(function (el) { el.classList.add("is-in"); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    items.forEach(function (el) { io.observe(el); });
  })();

  /* ------------------------------------------------------------------
     4 · Animações contínuas só quando visíveis
     ------------------------------------------------------------------ */
  (function () {
    var els = $$("[data-anim]");
    if (reduced) {
      els.forEach(function (el) { el.classList.add("no-anim"); });
      var hv = $(".hero__visual"); if (hv) hv.classList.add("no-anim");
      return;
    }
    if (!hasIO) { els.forEach(function (el) { el.classList.add("is-playing"); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { e.target.classList.toggle("is-playing", e.isIntersecting); });
    }, { rootMargin: "80px 0px" });
    els.forEach(function (el) { io.observe(el); });
  })();

  /* ------------------------------------------------------------------
     5 · Hero: conversa da IA SDR em loop + inclinação com o mouse
     ------------------------------------------------------------------ */
  (function () {
    var con = $("#heroConsole"), visual = $(".hero__visual");
    if (!con || reduced) return;
    var msgs = $$(".cmsg", con), typing = $(".ctyping", con), quals = $$(".qual", con), deal = $(".float--deal", visual);
    var timers = [], running = false;

    function at(ms, fn) { timers.push(setTimeout(fn, ms)); }
    function stop() { timers.forEach(clearTimeout); timers = []; running = false; }
    function reset() {
      msgs.forEach(function (m) { m.classList.remove("is-on"); });
      quals.forEach(function (q) { q.classList.remove("is-on"); });
      typing.classList.remove("is-on");
      if (deal) deal.classList.remove("is-on");
      con.classList.remove("is-reset");
    }
    function show(i) { typing.classList.remove("is-on"); msgs[i].classList.add("is-on"); }
    function type() { typing.classList.add("is-on"); }
    function cycle() {
      reset();
      at(450, function () { show(0); });
      at(1250, type);
      at(2900, function () { show(1); });
      at(4400, function () { show(2); });
      at(5100, type);
      at(6900, function () { show(3); });
      at(7500, function () { quals[0].classList.add("is-on"); });
      at(7800, function () { quals[1].classList.add("is-on"); });
      at(8100, function () { quals[2].classList.add("is-on"); });
      at(8700, function () { if (deal) deal.classList.add("is-on"); });
      at(14500, function () { con.classList.add("is-reset"); if (deal) deal.classList.remove("is-on"); });
      at(15200, cycle);
    }
    function start() { if (running) return; running = true; cycle(); }

    if (hasIO) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting && !doc.hidden) start(); else stop(); });
      }, { threshold: 0.2 }).observe(con);
    } else start();
    doc.addEventListener("visibilitychange", function () { if (doc.hidden) stop(); });

    // inclinação sutil
    if (finePointer && window.innerWidth > 1080) {
      var hero = $(".hero"), raf = 0;
      hero.addEventListener("pointermove", function (ev) {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          var r = con.getBoundingClientRect();
          var x = (ev.clientX - (r.left + r.width / 2)) / window.innerWidth;
          var y = (ev.clientY - (r.top + r.height / 2)) / window.innerHeight;
          con.style.setProperty("--ry", (-7 + x * 10).toFixed(2) + "deg");
          con.style.setProperty("--rx", (3 - y * 8).toFixed(2) + "deg");
        });
      });
      hero.addEventListener("pointerleave", function () { con.style.removeProperty("--ry"); con.style.removeProperty("--rx"); });
    }
  })();

  /* ------------------------------------------------------------------
     6 · Brilho que segue o cursor nos cards
     ------------------------------------------------------------------ */
  if (finePointer) {
    $$("[data-glow]").forEach(function (card) {
      card.addEventListener("pointermove", function (ev) {
        var r = card.getBoundingClientRect();
        card.style.setProperty("--mx", (ev.clientX - r.left) + "px");
        card.style.setProperty("--my", (ev.clientY - r.top) + "px");
      });
    });
  }

  /* ------------------------------------------------------------------
     7 · Contadores do mock de disparos
     ------------------------------------------------------------------ */
  (function () {
    var nums = $$("[data-count]"); if (!nums.length) return;
    var fmt = function (n) { return Math.round(n).toLocaleString("pt-BR"); };
    function run(el) {
      var target = +el.getAttribute("data-count");
      if (reduced) { el.textContent = fmt(target); return; }
      var t0 = null, dur = 1800;
      function step(t) {
        if (!t0) t0 = t;
        var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(target * e);
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    if (!hasIO) { nums.forEach(run); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { run(e.target); io.unobserve(e.target); } });
    }, { threshold: 0.4 });
    nums.forEach(function (el) { io.observe(el); });
  })();

  /* ------------------------------------------------------------------
     8 · FAQ: uma pergunta aberta por vez (fallback p/ navegadores sem details[name])
     ------------------------------------------------------------------ */
  (function () {
    var qs = $$(".qa");
    qs.forEach(function (d) {
      d.addEventListener("toggle", function () {
        if (!d.open) return;
        qs.forEach(function (o) { if (o !== d && o.open) o.open = false; });
      });
    });
  })();

  /* ------------------------------------------------------------------
     9 · CTA fixo no celular (some no hero e na chamada final)
     ------------------------------------------------------------------ */
  (function () {
    var bar = $("#mcta"); if (!bar || !hasIO) return;
    var link = $("a", bar);
    var watch = [$(".hero__cta"), $("#agendar"), $(".ftr")].filter(Boolean);
    var visible = new Map();
    function update() {
      var anyVisible = false;
      visible.forEach(function (v) { if (v) anyVisible = true; });
      var on = !anyVisible && window.scrollY > 200;
      bar.classList.toggle("is-on", on);
      link.setAttribute("tabindex", on ? "0" : "-1");
      bar.setAttribute("aria-hidden", on ? "false" : "true");
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { visible.set(e.target, e.isIntersecting); });
      update();
    });
    watch.forEach(function (el) { visible.set(el, false); io.observe(el); });
  })();
})();
