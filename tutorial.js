/* ============================================================
   Tutoriales guiados: una luz marca el botón y un globito explica qué tocar.
   Aparecen una sola vez al entrar a cada sección y se repiten con el botón "?".
   Lo ya visto se guarda en la clave "tutorials" = { seen: { clave: true } }.
   Paso: { sel (selector o función), h, p, vis (dibujo, para pasos sin botón), before() }
   ============================================================ */
(function () {
  const $q = (s) => document.querySelector(s);
  const click = (s) => { const e = $q(s); if (e) e.click(); };
  const cells = '<div class="tv-cells"><span class="tv-cell"></span><span class="tv-cell done">✓</span><span class="tv-cell half"></span></div><div class="tv-cap"><span>vacío</span><span>1 toque</span><span>2 toques</span></div>';
  const TUTS = {
    economia: { steps: [
      { sel: "#eco-view-toggle", h: "Confirmado y proyectado", p: "<b>Confirmado</b> cuenta solo lo que ya cobraste y pagaste. <b>Proyectado</b> suma también lo que está pendiente." },
      { sel: "#eco-tabs", h: "Tus secciones", p: "Ingresos, gastos, ahorro y gráficos. Tocá una para cambiar." },
      { before: () => click('[data-etab="ingresos"]'), sel: '#eco-p-ingresos [data-go="trabajos"]', h: "Cargá tus trabajos acá", p: "Tocá este link para ir a <b>Tarifas</b>: ahí ponés cuánto cobrás por hora y a quién atendés." },
      { sel: '#eco-income-list [data-act="expand-work"]', h: "El sueldo se arma solo", p: "Sale de los eventos de trabajo que agendás. Tocá la fila para ver el detalle por persona y por sesión." },
      { sel: '#eco-income-list [data-act="toggle-work"]', h: "Marcá lo que cobrás", p: "Este círculo marca todo el sueldo como cobrado. Adentro podés tildar sesión por sesión. Con la <b>fecha de cobro</b>, el ingreso pasa solo al mes en que cobrás." },
      { sel: "#eco-p-ingresos .add-btn", h: "Un ingreso a mano", p: "Con el <b>+</b> sumás cualquier ingreso que no venga de tus trabajos." },
      { sel: "#eco-p-ingresos .import-btn", h: "Importá movimientos", p: "Sumá los movimientos de tu resumen sin cargarlos uno por uno." },
    ] },
    trabajo: { steps: [
      { sel: "#work-add", h: "Tocá el + para agregar un trabajo", p: "Cada trabajo tiene su valor por hora. Si todavía no cargaste ninguno, empezá por acá y después volvé a ver este tutorial con el <b>?</b>." },
      { sel: "#work-list .job-name", h: "Ponele nombre", p: "Por ejemplo \"Acompañante\" o \"Niñera\"." },
      { sel: "#work-list .job-mode", h: "Por hora o sueldo fijo", p: "Elegí <b>Por hora</b> si cobrás según tus horas, o <b>Sueldo fijo mensual</b> si cobrás lo mismo todos los meses." },
      { sel: "#work-list .job-rates", h: "Cuánto cobrás", p: "Poné el valor de la hora. Si los feriados o fines de semana valen distinto, cargalo en <b>Valor especial</b>." },
      { sel: () => { const b = $q('#work-list [data-lag="0"]'); return b && b.parentElement; }, h: "¿Cuándo te pagan?", p: "<b>Al mes siguiente</b> si cobrás mes vencido. El ingreso se suma al mes en que cobrás, no al mes en que trabajaste." },
      { sel: "#work-list [data-newperson]", h: "Personas o clientes", p: "Agregalas acá. Después aparecen para elegir cuando agendás un evento de este trabajo." },
    ] },
    evento: { onEnd: () => click("#ev-cancel"), steps: [
      { sel: '[data-go="categorias"]', h: "Tus categorías", p: "Acá cambiás los nombres y colores de tus categorías, o creás nuevas." },
      { sel: "#dd-new-btn", h: "Tocá el + para crear un evento", p: "Así agendás una actividad. Para un trabajo, seguí los próximos pasos." },
      { before: () => click("#dd-new-btn"), sel: "#ev-cats", h: "Elegí la categoría Trabajo", p: "Con esa categoría aparece la pregunta de qué trabajo es. Si no la tenés, creala con <b>+ Nueva</b>." },
      { before: () => { const c = [...document.querySelectorAll('#ev-cats [data-catpick]')].find((x) => /^trabajo/i.test(x.textContent.trim())); if (c && !c.classList.contains("selected")) c.click(); }, sel: "#ev-job-wrap", h: "¿Qué trabajo es?", p: "Elegí cuál y con quién. Si la lista está vacía, primero cargá tus trabajos en <b>Tarifas</b>." },
      { sel: "#ev-start", h: "Elegí el horario", p: "Tocá acá y elegís el inicio y el fin en la misma ventana. La app calcula cuánto vas a cobrar." },
      { sel: "#ev-repeat", h: "¿Se repite?", p: "Elegí <b>Todas las semanas</b> o <b>Elegir los días de la semana</b>, por ejemplo lunes, miércoles y viernes." },
      { sel: "#ev-actions .btn-primary", h: "Guardá el evento", p: "Los ingresos aparecen solos en <b>Economía → Ingresos</b>, como pendientes." },
    ] },
    habito: { steps: [
      { sel: ".habit-grid .day-cell.today", h: "Tocá el día", p: "Cada toque cambia el estado del día. Los días anteriores también se pueden marcar, por si te olvidaste." },
      { vis: cells, h: "Un toque por día", p: "Un toque es <b>hecho</b>, dos toques es <b>a medias</b> y un tercero lo vuelve a vacío." },
      { sel: "#hab-view", h: "Mes o año", p: "Cambiá la vista para ver tu constancia en todo el año." },
    ] },
  };
  const SCREEN_TUT = { habito: "habito", trabajos: "trabajo", economia: "economia", diaadia: "evento" };
  let seen = {}, ok = false, cur = null, steps = [], i = 0;

  async function load() {
    try { const s = await Backend.get("tutorials"); seen = (s && s.seen) || {}; ok = true; } catch (e) { seen = {}; ok = false; }
  }
  function reset() { seen = {}; ok = false; end(true); }
  function markSeen(key) {
    if (!ok || seen[key]) return;
    seen[key] = true;
    Backend.set("tutorials", { seen }).catch(() => {});
  }

  const target = (st) => { if (!st.sel) return null; const e = typeof st.sel === "function" ? st.sel() : $q(st.sel); return e && e.getClientRects().length ? e : null; };
  function runBefore(st) { try { if (st.before) st.before(); } catch (e) { /* sigue */ } }

  // arma la lista de pasos que se pueden mostrar (los que apuntan a algo que no está a la vista se saltan)
  function show(n, dir) {
    for (; n >= 0 && n < steps.length; n += dir) {
      const st = steps[n]; runBefore(st);
      if (!st.sel || target(st)) { i = n; draw(); return; }
    }
    end(false);
  }
  function draw() {
    const st = steps[i], el = target(st), tip = $("tour-tip"), ring = $("tour-ring"), last = i === steps.length - 1;
    $("tour-h").textContent = st.h; $("tour-p").innerHTML = st.p;
    $("tour-vis").innerHTML = st.vis || ""; $("tour-vis").hidden = !st.vis;
    $("tour-dots").innerHTML = steps.map((_, k) => '<i class="' + (k === i ? "on" : "") + '"></i>').join("");
    $("tour-next").textContent = last ? "Entendido" : "Siguiente";
    $("tour-back").hidden = i === 0; $("tour-skip").hidden = last;
    $("tour").hidden = false;
    if (el) {
      el.scrollIntoView({ block: "center" });
      requestAnimationFrame(() => place(el, ring, tip));
    } else {
      ring.hidden = true; $("tour").classList.add("center");
      tip.style.cssText = "";
    }
  }
  function place(el, ring, tip) {
    const r = el.getBoundingClientRect(), pad = 6, vw = window.innerWidth, vh = window.innerHeight;
    ring.hidden = false; $("tour").classList.remove("center");
    ring.style.cssText = "left:" + (r.left - pad) + "px;top:" + (r.top - pad) + "px;width:" + (r.width + pad * 2) + "px;height:" + (r.height + pad * 2) + "px";
    tip.style.cssText = "visibility:hidden";
    const tw = Math.min(320, vw - 24), th = tip.offsetHeight;
    let top = r.bottom + pad + 12;
    if (top + th > vh - 12) top = r.top - pad - 12 - th;
    if (top < 12) top = Math.max(12, Math.min(vh - th - 12, r.bottom + 12));
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(12, Math.min(vw - tw - 12, left));
    tip.style.cssText = "width:" + tw + "px;top:" + top + "px;left:" + left + "px";
  }
  function start(key) {
    const t = TUTS[key]; if (!t) return;
    end(true);
    cur = key; steps = t.steps; i = 0;
    show(0, 1);
  }
  function end(silent) {
    const k = cur, t = k && TUTS[k];
    cur = null; $("tour").hidden = true;
    if (!silent && k) { markSeen(k); if (t && t.onEnd) t.onEnd(); }
  }
  function next() { if (!cur) return; if (i >= steps.length - 1) end(false); else show(i + 1, 1); }
  function back() { if (cur && i > 0) show(i - 1, -1); }

  const origGo = App.go;
  App.go = (name) => {
    end(true);
    origGo(name);
    const k = SCREEN_TUT[name];
    if (k && ok && !seen[k]) setTimeout(() => { if (App.screen === name && !seen[k] && !cur) start(k); }, 450);
  };

  // botón "?" en las pantallas que tienen tutorial
  [["economia", "economia"], ["trabajos", "trabajo"], ["habito", "habito"], ["diaadia", "evento"]].forEach(([screen, key]) => {
    const bar = document.querySelector('[data-screen="' + screen + '"] .topbar');
    if (!bar) return;
    const b = document.createElement("button");
    b.className = "tut-q"; b.type = "button"; b.textContent = "?"; b.setAttribute("aria-label", "Ver el tutorial"); b.dataset.tut = key;
    bar.appendChild(b);
  });
  document.addEventListener("click", (e) => { const q = e.target.closest("[data-tut]"); if (q) start(q.dataset.tut); });
  $("tour-next").addEventListener("click", next);
  $("tour-back").addEventListener("click", back);
  $("tour-skip").addEventListener("click", () => end(false));
  window.addEventListener("resize", () => { if (cur && !$("tour").hidden) { const el = target(steps[i]); if (el) place(el, $("tour-ring"), $("tour-tip")); } });

  App.register("tutorial", { load, reset });
})();
