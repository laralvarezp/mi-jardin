/* ============================================================
   Módulo Día a día: agenda (de hora a hora), tareas y categorías.
   Datos: clave "diaadia" = { cats, events, pending }
   Evento: { id, name, cat, date, start:"HH:MM", end:"HH:MM", repeat:"none"|"weekly", until, skip:[fechas] }
   Tarea ("pending"): { id, name, cat, due:"AAAA-MM-DD"|"", done, eventId }
   ============================================================ */
(function () {
  const H0 = 6, H1 = 24;                           // la agenda va de 6:00 a 24:00
  // alto de cada hora: se ajusta al alto de la pantalla para que entren todas las horas, en día y en semana
  const hpx = () => Math.max(20, Math.min(view === "week" ? 40 : 46, Math.floor((window.innerHeight - (view === "week" ? 260 : 384)) / (H1 - H0))));
  const defaults = () => ({
    cats: [
      { id: "c1", name: "Facultad", color: App.sw(208, 2) }, { id: "c2", name: "Trabajo", color: App.sw(28, 2) },
      { id: "c3", name: "Personal", color: App.sw(112, 2) }, { id: "c4", name: "Salud", color: App.sw(6, 2) },
    ],
    events: [], pending: [],
  });
  let store = defaults(), ok = false;
  let tab = "agenda", view = "day", sel = U.today();
  let editing = null;            // evento en edición (o null si es nuevo)
  let occDate = null;            // día de la repetición que se tocó
  let pendingSave = null;        // datos del formulario esperando elegir alcance
  let scopeMode = null;          // "save" | "delete" mientras se pregunta el alcance
  let assigning = null;          // id de la tarea que se está asignando
  let pickCat = null, delArm = null, openPal = null, catDelArm = null;
  let taskEditing = null, taskCat = null, taskDelArm = false, taskFilter = "todo";

  const saver = App.makeSaver(() => "diaadia", () => store, () => ok);
  const cat = (id) => store.cats.find((c) => c.id === id);
  const catColor = (id) => (cat(id) ? cat(id).color : "#B39B7C");

  async function load() {
    try {
      const s = await Backend.get("diaadia");
      store = s ? Object.assign(defaults(), s) : defaults();
      store.cats = store.cats || []; store.events = store.events || []; store.pending = store.pending || [];
      ok = true;
    } catch (e) { store = defaults(); ok = false; App.toast("No se pudo cargar Día a día. Recargá la página."); }
  }
  function reset() { store = defaults(); ok = false; tab = "agenda"; view = "day"; sel = U.today(); closeSheet(); closeTask(); }

  /* ---------- eventos por día ---------- */
  const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const minsEnd = (t) => (t === "00:00" ? 1440 : mins(t));       // "00:00" como fin = medianoche
  const hhmm = (m) => U.pad(Math.floor(m / 60) % 24) + ":" + U.pad(m % 60);
  function occursOn(ev, iso) {
    if (ev.repeat === "weekly") return iso >= ev.date && (ev.days && ev.days.length ? ev.days.includes(U.dow(iso)) : U.dow(iso) === U.dow(ev.date)) && (!ev.until || iso <= ev.until) && !(ev.skip && ev.skip.includes(iso));
    return ev.date === iso;
  }
  const eventsOn = (iso) => store.events.filter((e) => occursOn(e, iso)).sort((a, b) => mins(a.start) - mins(b.start));

  // columnas para eventos que se superponen
  function layout(list) {
    const out = []; let cluster = [], clusterEnd = -1;
    const flush = () => {
      const cols = [];
      cluster.forEach((it) => {
        let c = cols.findIndex((end) => end <= it.s);
        if (c < 0) { c = cols.length; cols.push(0); }
        cols[c] = it.e; it.col = c;
      });
      cluster.forEach((it) => { it.cols = cols.length; out.push(it); });
      cluster = []; clusterEnd = -1;
    };
    list.forEach((ev) => {
      const it = { ev, s: mins(ev.start), e: Math.max(minsEnd(ev.end), mins(ev.start) + 15) };
      if (cluster.length && it.s >= clusterEnd) flush();
      cluster.push(it); clusterEnd = Math.max(clusterEnd, it.e);
    });
    if (cluster.length) flush();
    return out;
  }

  /* ---------- agenda ---------- */
  function colHTML(iso, withHead) {
    const items = layout(eventsOn(iso));
    const HPX = hpx(), total = (H1 - H0) * HPX;
    const d = U.parse(iso);
    const evs = items.map((it) => {
      const top = Math.max(0, (it.s - H0 * 60) / 60 * HPX), h = Math.max(view === "week" ? 12 : 20, (it.e - it.s) / 60 * HPX - 2);
      const w = 100 / it.cols, c = catColor(it.ev.cat);
      return '<button class="ev" data-ev="' + it.ev.id + '" style="top:' + top + "px;height:" + h + "px;left:calc(" + it.col * w + "% + 1px);width:calc(" + w + "% - 3px);background:" + U.hexA(c, 0.28) + ";border-left-color:" + c + '">' +
        "<b>" + U.esc(it.ev.name) + "</b>" + (view === "day" && h >= 36 ? "<small>" + it.ev.start + " – " + it.ev.end + (it.ev.repeat === "weekly" ? " ↻" : "") + (it.ev.person && App.work && App.work.personName(it.ev.job, it.ev.person) && !it.ev.name.includes(App.work.personName(it.ev.job, it.ev.person)) ? " · " + U.esc(App.work.personName(it.ev.job, it.ev.person)) : "") + "</small>" : "") + "</button>";
    }).join("");
    return '<div class="tl-col">' + (withHead
      ? '<button class="tl-head' + (iso === U.today() ? " today" : "") + '" data-pick="' + iso + '">' + U.DOW[U.dow(iso)] + "<b>" + d.getDate() + "</b></button>"
      : '<div class="tl-spacer"></div>') +
      '<div class="tl-body" data-date="' + iso + '" style="height:' + total + 'px">' + evs + "</div></div>";
  }

  function renderAgenda() {
    const ws = U.weekStart(sel), we = U.addDays(ws, 6);
    const a = U.parse(ws), b = U.parse(we);
    $("dd-week-label").textContent = a.getDate() + (a.getMonth() !== b.getMonth() ? " " + U.MESES[a.getMonth()].slice(0, 3) : "") + " – " + b.getDate() + " " + U.MESES[b.getMonth()].slice(0, 3) + " " + b.getFullYear();
    document.querySelectorAll("#dd-view button").forEach((x) => x.classList.toggle("active", x.dataset.view === view));

    $("dd-day-tabs").hidden = view === "week";
    $("dd-day-tabs").innerHTML = Array.from({ length: 7 }, (_, i) => {
      const iso = U.addDays(ws, i);
      return '<button class="day-tab' + (iso === sel ? " active" : "") + (iso === U.today() ? " today" : "") + '" data-pick="' + iso + '"><span class="dname">' + U.DOW[i] + '</span><span class="dnum">' + U.parse(iso).getDate() + "</span>" + (eventsOn(iso).length ? '<span class="has-ev"></span>' : "") + "</button>";
    }).join("");

    let hours = '<div class="tl-hours"><div class="tl-spacer"></div>';
    for (let h = H0; h < H1; h++) hours += '<div class="tl-hour">' + h + ":00</div>";
    hours += "</div>";
    const days = view === "week" ? Array.from({ length: 7 }, (_, i) => U.addDays(ws, i)) : [sel];
    const tl = $("dd-timeline");
    const HPX = hpx();
    tl.style.setProperty("--hpx", HPX + "px");
    tl.innerHTML = '<div class="tl' + (view === "week" ? " week" : "") + '" style="--hpx:' + HPX + 'px">' + hours + days.map((d) => colHTML(d, view === "week")).join("") + "</div>";
  }

  /* ---------- tareas (bandeja de pendientes) ---------- */
  const todoCount = () => store.pending.filter((t) => !t.done).length;
  function dueBadge(t) {
    if (!t.due) return "";
    const dm = U.fmtDM(t.due);
    if (!t.done && t.due < U.today()) return '<span class="due-badge overdue">venció ' + dm + "</span>";
    if (!t.done && U.daysUntil(t.due) <= 2) return '<span class="due-badge soon">vence ' + dm + "</span>";
    return '<span class="due-badge">vence ' + dm + "</span>";
  }
  function assignedEvent(t) { return t.eventId ? store.events.find((e) => e.id === t.eventId) : null; }

  function renderPending() {
    $("dd-pend-tab").textContent = "Pendientes" + (todoCount() ? " (" + todoCount() + ")" : "");
    document.querySelectorAll("#dd-task-filter button").forEach((b) => b.classList.toggle("active", b.dataset.filter === taskFilter));
    let list = store.pending.filter((t) => taskFilter === "todo" ? !t.done : taskFilter === "hechas" ? t.done : true);
    list = list.slice().sort((a, b) => (a.done - b.done) || ((a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : 0));
    $("dd-pending-list").innerHTML = list.length ? list.map((t) => {
      const ev = assignedEvent(t), c = t.cat && cat(t.cat);
      return '<div class="task-row' + (t.done ? " done" : "") + '">' +
        '<button class="checkbox' + (t.done ? " checked" : "") + '" data-tdone="' + t.id + '" aria-label="' + (t.done ? "Marcar como no hecha" : "Marcar como hecha") + '">' + (t.done ? "✓" : "") + "</button>" +
        '<button class="task-body" data-tedit="' + t.id + '"><span class="task-name">' + U.esc(t.name) + '</span><span class="task-meta">' +
        (c ? '<span class="cat-tag"><i style="background:' + c.color + '"></i>' + U.esc(c.name) + "</span>" : "") + dueBadge(t) + "</span></button>" +
        (ev ? '<button class="mini-btn assigned" data-tev="' + ev.id + '">↬ ' + U.fmtDM(ev.date) + " " + ev.start + "</button>"
            : t.done ? "" : '<button class="mini-btn" data-assign="' + t.id + '">Asignar</button>') + "</div>";
    }).join("") : '<p class="muted" style="text-align:center;margin:18px 0">' + (taskFilter === "hechas" ? "Todavía no marcaste nada como hecho." : "No tenés pendientes. ✦") + "</p>";
  }

  /* ---------- categorías: administrador ---------- */
  function renderCats() {
    $("dd-cat-list").innerHTML = store.cats.map((c) =>
      '<div class="cat-row"><button class="swatch-btn" data-pal="' + c.id + '" style="background:' + c.color + '" aria-label="Cambiar color"></button>' +
      '<input type="text" value="' + U.esc(c.name) + '" data-catname="' + c.id + '" aria-label="Nombre de la categoría" />' +
      '<button class="' + (catDelArm === c.id ? "btn-danger" : "icon-btn") + '" data-catdel="' + c.id + '">' + (catDelArm === c.id ? "¿Seguro?" : "✕") + "</button></div>" +
      (openPal === c.id ? '<div class="palette" data-palfor="' + c.id + '">' + App.paletteHTML(c.color) + "</div>" : "")
    ).join("") || '<p class="muted">Sin categorías.</p>';
  }

  /* ---------- selector de categoría (con "+ Nueva") para la hoja de actividad y la de tarea ---------- */
  const pickers = {
    "ev-cats": { get: () => pickCat, set: (v) => { pickCat = v; }, creating: false, pal: false, color: null },
    "task-cats": { get: () => taskCat, set: (v) => { taskCat = v; }, creating: false, pal: false, color: null },
  };
  function renderPicker(id) {
    const p = pickers[id];
    if (!p.color) p.color = App.sw(HUES[store.cats.length % HUES.length], 2);
    let h = store.cats.map((c) =>
      '<button type="button" class="cat-chip' + (p.get() === c.id ? " selected" : "") + '" data-cp="' + id + '" data-catpick="' + c.id + '"><span class="dot" style="background:' + c.color + '"></span>' + U.esc(c.name) + "</button>").join("");
    h += '<button type="button" class="cat-chip new" data-cp="' + id + '" data-catnew="1">+ Nueva</button>';
    if (p.creating) {
      h += '<div class="cat-create"><input id="' + id + '-newname" type="text" placeholder="Nombre de la categoría" maxlength="30" autocomplete="off" />' +
        '<button type="button" class="swatch-btn" data-cp="' + id + '" data-cpal="1" style="background:' + p.color + '" aria-label="Elegir color"></button>' +
        '<button type="button" class="mini-btn" data-cp="' + id + '" data-catsave="1">Crear</button>' +
        '<button type="button" class="btn-ghost" data-cp="' + id + '" data-catcancel="1" aria-label="Cancelar">✕</button></div>';
      if (p.pal) h += '<div class="palette" data-cpalette="' + id + '">' + App.paletteHTML(p.color) + "</div>";
    }
    $(id).innerHTML = h;
  }
  function createCat(id) {
    const p = pickers[id], name = $(id + "-newname").value.trim();
    if (!name) { App.toast("Escribí un nombre para la categoría."); return; }
    const c = { id: U.uid(), name, color: p.color };
    store.cats.push(c);
    p.set(c.id); p.creating = false; p.pal = false; p.color = null;
    saver.schedule(); renderPicker(id);
  }
  function bindPickers() {
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-cp]");
      if (el) {
        const id = el.dataset.cp, p = pickers[id];
        if (el.dataset.catpick) { p.set(p.get() === el.dataset.catpick ? null : el.dataset.catpick); renderPicker(id); if (id === "ev-cats") onCatChange(); }
        else if (el.dataset.catnew) { p.creating = true; p.pal = false; p.color = null; renderPicker(id); $(id + "-newname").focus(); }
        else if (el.dataset.cpal) { p.pal = !p.pal; renderPicker(id); }
        else if (el.dataset.catsave) createCat(id);
        else if (el.dataset.catcancel) { p.creating = false; p.pal = false; renderPicker(id); }
        return;
      }
      const sw = e.target.closest("[data-cpalette] [data-color]");
      if (sw) {
        const id = sw.parentNode.dataset.cpalette;
        pickers[id].color = sw.dataset.color; pickers[id].pal = false; renderPicker(id);
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const m = /^(ev-cats|task-cats)-newname$/.exec(e.target.id || "");
      if (m) { e.preventDefault(); createCat(m[1]); }
    });
  }

  /* ---------- reloj de agujas: inicio y fin en la misma ventana ---------- */
  const ck = { t: { start: { h12: 9, m: 0, pm: false }, end: { h12: 10, m: 0, pm: false } }, w: "start", mode: "h" };
  const cur = () => ck.t[ck.w];
  // en la tarde (PM) el reloj muestra 13, 14… 23; a la medianoche, 00
  const h24Of = (x, h12) => (x.pm ? (h12 === 12 ? 12 : h12 + 12) : h12 === 12 ? 0 : h12);
  const toHM = (x) => U.pad(h24Of(x, x.h12)) + ":" + U.pad(x.m);
  function fromHM(str) {
    const [h, m] = (str || "09:00").split(":").map(Number);
    return { pm: h >= 12, h12: h % 12 === 0 ? 12 : h % 12, m: Math.round(m / 5) * 5 % 60 };
  }
  function ckRender() {
    const x = cur();
    $("ck-hour").textContent = U.pad(h24Of(x, x.h12));
    $("ck-min").textContent = U.pad(x.m);
    $("ck-hour").classList.toggle("on", ck.mode === "h"); $("ck-min").classList.toggle("on", ck.mode === "m");
    $("ck-am").classList.toggle("on", !x.pm); $("ck-pm").classList.toggle("on", x.pm);
    $("ck-t-start").classList.toggle("on", ck.w === "start"); $("ck-t-end").classList.toggle("on", ck.w === "end");
    $("ck-t-start").innerHTML = "<small>Desde</small>" + toHM(ck.t.start); $("ck-t-end").innerHTML = "<small>Hasta</small>" + toHM(ck.t.end);
    const C = 120, R = 86, val = ck.mode === "h" ? x.h12 % 12 : x.m / 5, ang = val / 12 * 2 * Math.PI;
    const hx = C + R * Math.sin(ang), hy = C - R * Math.cos(ang);
    let svg = '<svg viewBox="0 0 240 240" id="ck-svg" aria-label="Reloj"><circle cx="120" cy="120" r="116" class="ck-face"/>' +
      '<line x1="120" y1="120" x2="' + hx + '" y2="' + hy + '" class="ck-hand"/><circle cx="120" cy="120" r="4" class="ck-center"/><circle cx="' + hx + '" cy="' + hy + '" r="19" class="ck-knob"/>';
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * 2 * Math.PI, label = ck.mode === "h" ? U.pad(h24Of(x, i === 0 ? 12 : i)) : U.pad(i * 5);
      svg += '<text x="' + (C + R * Math.sin(a)) + '" y="' + (C - R * Math.cos(a) + 4.5) + '" text-anchor="middle" class="ck-num' + (i === val ? " sel" : "") + '">' + label + "</text>";
    }
    $("ck-dial").innerHTML = svg + "</svg>";
  }
  function ckPoint(e) {
    const r = $("ck-svg").getBoundingClientRect(), x = cur();
    let a = Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180 / Math.PI;
    if (a < 0) a += 360;
    if (ck.mode === "h") { const h = Math.round(a / 30) % 12; x.h12 = h === 0 ? 12 : h; }
    else x.m = (Math.round(a / 30) % 12) * 5;
    ckRender();
  }
  function openClock(which) {
    ck.t.start = fromHM($("ev-start").value); ck.t.end = fromHM($("ev-end").value);
    ck.w = which; ck.mode = "h";
    ckRender(); $("clock-overlay").hidden = false;
  }
  function clockOK() {
    const s = toHM(ck.t.start); let e = toHM(ck.t.end);
    if (minsEnd(e) <= mins(s)) e = hhmm(Math.min(mins(s) + 60, 1440));   // si el fin quedó antes del inicio, se acomoda (+1 h)
    $("ev-start").value = s; $("ev-end").value = e;
    $("clock-overlay").hidden = true;
    updatePay();
  }
  function bindClock() {
    const dial = $("ck-dial");
    let down = false;
    dial.addEventListener("pointerdown", (e) => { down = true; try { dial.setPointerCapture(e.pointerId); } catch (x) { /* sin captura */ } ckPoint(e); });
    dial.addEventListener("pointermove", (e) => { if (down) ckPoint(e); });
    dial.addEventListener("pointerup", () => {
      if (!down) return; down = false;
      if (ck.mode === "h") { ck.mode = "m"; }
      else if (ck.w === "start") { ck.w = "end"; ck.mode = "h"; }     // terminó el inicio: sigue con el fin
      ckRender();
    });
    dial.addEventListener("pointercancel", () => { down = false; });
    $("ck-t-start").addEventListener("click", () => { ck.w = "start"; ck.mode = "h"; ckRender(); });
    $("ck-t-end").addEventListener("click", () => { ck.w = "end"; ck.mode = "h"; ckRender(); });
    $("ck-hour").addEventListener("click", () => { ck.mode = "h"; ckRender(); });
    $("ck-min").addEventListener("click", () => { ck.mode = "m"; ckRender(); });
    $("ck-am").addEventListener("click", () => { cur().pm = false; ckRender(); });
    $("ck-pm").addEventListener("click", () => { cur().pm = true; ckRender(); });
    $("ck-cancel").addEventListener("click", () => { $("clock-overlay").hidden = true; });
    $("ck-ok").addEventListener("click", clockOK);
    $("clock-overlay").addEventListener("click", (e) => { if (e.target.id === "clock-overlay") $("clock-overlay").hidden = true; });
    $("ev-start").addEventListener("click", () => openClock("start"));
    $("ev-end").addEventListener("click", () => openClock("end"));
  }

  /* ---------- trabajo / persona / feriado dentro de la hoja ---------- */
  const fmt$ = (n) => "$" + U.fmt(n);
  function fillJobSelect(selJob, selPerson) {
    const jobs = App.work ? App.work.jobs() : [];
    $("ev-job").innerHTML = '<option value="">Ninguno</option>' + jobs.map((j) => '<option value="' + j.id + '">' + U.esc(j.name || "Sin nombre") + "</option>").join("");
    $("ev-job").value = selJob && jobs.some((j) => j.id === selJob) ? selJob : "";
    showJobField();
    syncJob(selPerson);
  }
  // "¿Qué trabajo es?" aparece solo si la categoría elegida es Trabajo (o si la actividad ya tenía uno)
  const isWorkCat = () => { const c = pickCat && cat(pickCat); return !!c && /^trabajo/i.test(c.name.trim()); };
  function showJobField() {
    const has = App.work && App.work.jobs().length > 0;
    $("ev-job-wrap").hidden = !(has && (isWorkCat() || $("ev-job").value));
  }
  function onCatChange() {
    if (!isWorkCat()) { $("ev-job").value = ""; }
    showJobField(); syncJob();
  }
  function syncJob(selPerson) {
    const jid = $("ev-job").value, job = jid ? App.work.byId(jid) : null;
    $("ev-person-wrap").hidden = !job;
    $("ev-person-new").hidden = true;
    if (job) {
      const people = job.people || [];
      $("ev-person").innerHTML = '<option value="">' + (people.length ? "Elegir…" : "Sin personas cargadas") + "</option>" + people.map((p) => '<option value="' + p.id + '">' + U.esc(p.name) + "</option>").join("");
      $("ev-person").value = selPerson && people.some((p) => p.id === selPerson) ? selPerson : "";
    }
    $("ev-holiday-wrap").hidden = !(job && Number(job.rateHoliday) > 0);
    if ($("ev-holiday-wrap").hidden) $("ev-holiday").checked = false;
    updatePay();
  }
  function updatePay() {
    const jid = $("ev-job").value, el = $("ev-pay");
    if (!jid || !$("ev-date").value || !$("ev-start").value || !$("ev-end").value) { el.hidden = true; return; }
    const p = App.work.pay({ job: jid, start: $("ev-start").value, end: $("ev-end").value, holiday: $("ev-holiday").checked }, $("ev-date").value);
    if (!p) { el.hidden = true; return; }
    const h = Math.round(p.hours * 100) / 100;
    el.hidden = false;
    el.textContent = "≈ " + fmt$(p.amount) + " · " + String(h).replace(".", ",") + " h" + (p.special ? " · valor especial" : "") + (p.travel ? " · incluye viáticos" : "");
  }

  /* ---------- hoja para crear / editar actividades ---------- */
  function openSheet(ev, defaults, occ) {
    editing = ev || null; delArm = null; occDate = occ || null; hideScope();
    const d = ev ? Object.assign({}, ev, occ ? { date: occ } : {}) : defaults || {};
    $("sheet-title").textContent = assigning ? "Asignar tarea" : ev ? "Editar actividad" : "Nueva actividad";
    $("ev-name").value = d.name || "";
    pickCat = d.cat && cat(d.cat) ? d.cat : (assigning ? null : store.cats.length ? store.cats[0].id : null);
    pickers["ev-cats"].creating = false; pickers["ev-cats"].pal = false;
    renderPicker("ev-cats");
    fillJobSelect(d.job, d.person);
    $("ev-holiday").checked = !!d.holiday && !$("ev-holiday-wrap").hidden;
    $("ev-date").value = d.date || sel;
    $("ev-start").value = d.start || "09:00";
    $("ev-end").value = d.end || "10:00";
    $("ev-repeat").value = d.repeat === "weekly" ? (d.days && d.days.length ? "days" : "weekly") : "none";
    evDays = d.days && d.days.length ? d.days.slice() : [U.dow($("ev-date").value || sel)];
    renderDays(); syncRepeat();
    $("ev-until").value = d.until || "";
    $("ev-repeat-hint").hidden = true;
    updatePay();
    $("ev-error").textContent = "";
    $("ev-delete").hidden = !ev; $("ev-delete").textContent = "Eliminar";
    $("sheet-overlay").hidden = false;
    document.body.style.overflow = "hidden";
  }
  let evDays = [];
  function renderDays() {
    $("ev-days").innerHTML = U.DOW.map((n, i) => '<button type="button" class="day-chip' + (evDays.includes(i) ? " on" : "") + '" data-dow="' + i + '" aria-pressed="' + evDays.includes(i) + '">' + n.slice(0, 2) + "</button>").join("");
  }
  function syncRepeat() {
    const v = $("ev-repeat").value;
    $("ev-until-wrap").hidden = v === "none";
    $("ev-days-wrap").hidden = v !== "days";
    $("ev-date-label").textContent = v === "none" ? "Fecha" : "Desde el";
  }
  function closeSheet() {
    $("sheet-overlay").hidden = true; $("clock-overlay").hidden = true;
    editing = null; assigning = null; delArm = null; occDate = null; hideScope();
    if (!taskEditing && $("task-overlay").hidden) document.body.style.overflow = "";
  }
  function saveSheet() {
    let name = $("ev-name").value.trim();
    const date = $("ev-date").value, start = $("ev-start").value, end = $("ev-end").value;
    const err = (m) => { $("ev-error").textContent = m; };
    const jobId = $("ev-job").value || "", personId = jobId ? $("ev-person").value : "";
    if (!name && jobId) {                       // sin nombre: "Trabajo · Persona"
      const j = App.work.byId(jobId), pn = App.work.personName(jobId, personId);
      name = (j.name || "Trabajo") + (pn ? " · " + pn : "");
    }
    if (!name) return err("Escribí el nombre de la actividad.");
    if (!date) return err("Elegí el día.");
    if (!start || !end) return err("Elegí la hora de inicio y la de fin.");
    if (minsEnd(end) <= mins(start)) return err("La hora de fin tiene que ser después de la de inicio.");
    const rv = $("ev-repeat").value, repeat = rv === "none" ? "none" : "weekly", until = repeat === "weekly" ? $("ev-until").value : "";
    if (rv === "days" && !evDays.length) return err("Elegí al menos un día de la semana.");
    if (until && until < date) return err("La fecha final no puede ser anterior al primer día.");
    const data = { name, cat: pickCat, date, start, end, repeat, until, job: jobId, person: personId, holiday: jobId ? $("ev-holiday").checked : false, days: rv === "days" ? evDays.slice().sort() : [] };
    if (editing && editing.repeat === "weekly") { pendingSave = data; showScope("save"); return; }
    let saved = editing;
    if (editing) Object.assign(editing, data);
    else { saved = Object.assign({ id: U.uid() }, data); store.events.push(saved); }
    if (assigning) { const t = store.pending.find((x) => x.id === assigning); if (t) t.eventId = saved.id; }
    sel = date;
    closeSheet(); saver.schedule(); renderAll();
  }

  /* ---------- eventos que se repiten: ¿solo este, los siguientes o todos? ---------- */
  function showScope(mode) {
    scopeMode = mode;
    $("ev-scope-q").textContent = mode === "delete" ? "¿Qué querés eliminar?" : "¿A cuáles querés aplicar el cambio?";
    $("ev-scope").hidden = false; $("ev-actions").hidden = true; $("ev-error").textContent = "";
    $("ev-scope").scrollIntoView({ block: "nearest" });
  }
  function hideScope() {
    scopeMode = null; pendingSave = null;
    const a = $("ev-scope"); if (a) a.hidden = true;
    const b = $("ev-actions"); if (b) b.hidden = false;
  }
  function endSeriesBefore(ev, occ) {          // corta la serie para que termine antes de occ
    if (occ <= ev.date) store.events = store.events.filter((x) => x !== ev);
    else ev.until = U.addDays(occ, -1);
  }
  function applyScope(scope) {
    const ev = editing, occ = occDate || ev.date;
    if (scopeMode === "delete") {
      if (scope === "one") ev.skip = (ev.skip || []).concat([occ]);
      else if (scope === "following") endSeriesBefore(ev, occ);
      else store.events = store.events.filter((x) => x !== ev);
    } else {
      const d = pendingSave;
      if (scope === "one") {
        ev.skip = (ev.skip || []).concat([occ]);
        store.events.push(Object.assign({ id: U.uid() }, d, { repeat: "none", until: "" }));
      } else if (scope === "following") {
        endSeriesBefore(ev, occ);
        store.events.push(Object.assign({ id: U.uid() }, d));
      } else {                                  // todos: se corre toda la serie si cambió el día
        const shift = Math.round((U.parse(d.date) - U.parse(occ)) / 86400000);
        Object.assign(ev, d, { date: U.addDays(ev.date, shift), skip: [] });
        if (d.repeat !== "weekly") ev.until = "";
      }
      sel = d.date;
    }
    closeSheet(); saver.schedule(); renderAll();
  }

  /* ---------- hoja de tarea ---------- */
  function openTask(t) {
    taskEditing = t || null; taskDelArm = false;
    $("task-title").textContent = t ? "Editar tarea" : "Nueva tarea";
    $("task-name").value = t ? t.name : "";
    taskCat = t && t.cat && cat(t.cat) ? t.cat : null;
    pickers["task-cats"].creating = false; pickers["task-cats"].pal = false;
    renderPicker("task-cats");
    $("task-due").value = t ? t.due || "" : "";
    $("task-error").textContent = "";
    $("task-delete").hidden = !t; $("task-delete").textContent = "Eliminar";
    $("task-overlay").hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeTask() {
    $("task-overlay").hidden = true; taskEditing = null;
    if ($("sheet-overlay").hidden) document.body.style.overflow = "";
  }
  function saveTask() {
    const name = $("task-name").value.trim();
    if (!name) { $("task-error").textContent = "Escribí qué tenés que hacer."; return; }
    const data = { name, cat: taskCat, due: $("task-due").value };
    if (taskEditing) Object.assign(taskEditing, data);
    else store.pending.push(Object.assign({ id: U.uid(), done: false, eventId: "" }, data));
    closeTask(); saver.schedule(); renderAll();
  }

  /* ---------- general ---------- */
  function setTab(t) {
    tab = t;
    document.querySelectorAll("#dd-tabs .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
    $("dd-agenda").hidden = t !== "agenda"; $("dd-pending").hidden = t !== "pendientes";
    renderAll();
  }
  function renderAll() { renderPending(); if (tab === "agenda") renderAgenda(); if (App.refreshHome) App.refreshHome(); }

  function bind() {
    bindPickers(); bindClock();
    $("dd-tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); });
    $("dd-view").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) { view = b.dataset.view; renderAgenda(); } });
    const screen = $("screen-diaadia");
    screen.addEventListener("click", (e) => {
      const wk = e.target.closest("[data-week]");
      if (wk) { sel = U.addDays(sel, 7 * Number(wk.dataset.week)); renderAgenda(); return; }
      if (e.target.closest("[data-today]")) { sel = U.today(); renderAgenda(); return; }
      const pk = e.target.closest("[data-pick]");
      if (pk) { sel = pk.dataset.pick; view = "day"; renderAgenda(); return; }
      const ev = e.target.closest("[data-ev]");
      if (ev) {
        const col = ev.closest(".tl-body");
        openSheet(store.events.find((x) => x.id === ev.dataset.ev), null, col ? col.dataset.date : null);
        return;
      }
      const body = e.target.closest(".tl-body");
      if (body) {                                   // tocar un lugar vacío: crear actividad a esa hora
        const r = body.getBoundingClientRect();
        const m = Math.floor(((e.clientY - r.top) / hpx()) * 2) / 2 * 60 + H0 * 60;
        const s = Math.min(Math.max(m, H0 * 60), 22.5 * 60);
        openSheet(null, { date: body.dataset.date, start: hhmm(s), end: hhmm(s + 60) });
        return;
      }
      const f = e.target.closest("[data-filter]");
      if (f) { taskFilter = f.dataset.filter; renderPending(); return; }
      const dn = e.target.closest("[data-tdone]");
      if (dn) { const t = store.pending.find((x) => x.id === dn.dataset.tdone); t.done = !t.done; saver.schedule(); renderPending(); return; }
      const ed = e.target.closest("[data-tedit]");
      if (ed) { openTask(store.pending.find((x) => x.id === ed.dataset.tedit)); return; }
      const tev = e.target.closest("[data-tev]");
      if (tev) { const x = store.events.find((y) => y.id === tev.dataset.tev); if (x) openSheet(x, null, x.date); return; }
      const as = e.target.closest("[data-assign]");
      if (as) {
        assigning = as.dataset.assign;
        const t = store.pending.find((x) => x.id === assigning);
        openSheet(null, { name: t.name, cat: t.cat, date: t.due && t.due >= U.today() ? t.due : U.today(), start: "09:00", end: "10:00" });
        return;
      }
    });
    screen.addEventListener("submit", (e) => {
      if (e.target.id !== "dd-quick-form") return;
      e.preventDefault();
      const inp = $("dd-quick-name"), name = inp.value.trim();
      if (!name) return;
      store.pending.push({ id: U.uid(), name, cat: null, due: "", done: false, eventId: "" });
      inp.value = ""; saver.schedule(); renderPending(); inp.focus();
    });
    $("dd-new-btn").addEventListener("click", () => openSheet(null, { date: sel }));

    // hoja de actividad
    $("ev-form").addEventListener("submit", (e) => { e.preventDefault(); saveSheet(); });
    $("ev-cancel").addEventListener("click", closeSheet);
    $("sheet-overlay").addEventListener("click", (e) => { if (e.target.id === "sheet-overlay") closeSheet(); });
    $("ev-job").addEventListener("change", () => syncJob(""));
    ["ev-holiday", "ev-date"].forEach((id) => $(id).addEventListener("change", updatePay));
    $("ev-person-add").addEventListener("click", () => { $("ev-person-new").hidden = false; $("ev-person-name").focus(); });
    const savePerson = () => {
      const n = $("ev-person-name").value.trim(); if (!n) return;
      const pid = App.work.addPerson($("ev-job").value, n);
      $("ev-person-name").value = ""; syncJob(pid);
    };
    $("ev-person-save").addEventListener("click", savePerson);
    $("ev-person-name").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); savePerson(); } });
    $("ev-repeat").addEventListener("change", () => { if (!evDays.length) evDays = [U.dow($("ev-date").value || sel)]; renderDays(); syncRepeat(); });
    $("ev-date").addEventListener("change", () => { if ($("ev-repeat").value === "days" && !evDays.length) { evDays = [U.dow($("ev-date").value)]; renderDays(); } });
    $("ev-days").addEventListener("click", (e) => {
      const b = e.target.closest("[data-dow]"); if (!b) return;
      const d = Number(b.dataset.dow); evDays = evDays.includes(d) ? evDays.filter((x) => x !== d) : evDays.concat([d]); renderDays();
    });
    $("ev-scope").addEventListener("click", (e) => {
      const b = e.target.closest("[data-scope]"); if (!b) return;
      if (b.dataset.scope === "back") { hideScope(); return; }
      applyScope(b.dataset.scope);
    });
    $("ev-delete").addEventListener("click", () => {
      if (editing && editing.repeat === "weekly") { showScope("delete"); return; }
      if (!delArm) { delArm = true; $("ev-delete").textContent = "¿Seguro?"; return; }
      store.events = store.events.filter((x) => x !== editing);
      closeSheet(); saver.schedule(); renderAll();
    });

    // hoja de tarea
    $("task-form").addEventListener("submit", (e) => { e.preventDefault(); saveTask(); });
    $("task-cancel").addEventListener("click", closeTask);
    $("task-overlay").addEventListener("click", (e) => { if (e.target.id === "task-overlay") closeTask(); });
    $("task-due-clear").addEventListener("click", () => { $("task-due").value = ""; });
    $("task-delete").addEventListener("click", () => {
      if (!taskDelArm) { taskDelArm = true; $("task-delete").textContent = "¿Seguro?"; return; }
      store.pending = store.pending.filter((x) => x !== taskEditing);
      closeTask(); saver.schedule(); renderAll();
    });

    // categorías
    const cl = $("dd-cat-list");
    cl.addEventListener("click", (e) => {
      const pal = e.target.closest("[data-pal]");
      if (pal) { openPal = openPal === pal.dataset.pal ? null : pal.dataset.pal; renderCats(); return; }
      const sw = e.target.closest("[data-color]");
      if (sw) { cat(sw.parentNode.dataset.palfor).color = sw.dataset.color; openPal = null; saver.schedule(); renderCats(); return; }
      const del = e.target.closest("[data-catdel]");
      if (del) {
        if (catDelArm !== del.dataset.catdel) { catDelArm = del.dataset.catdel; renderCats(); return; }
        store.cats = store.cats.filter((c) => c.id !== catDelArm); catDelArm = null;
        saver.schedule(); renderCats();
      }
    });
    cl.addEventListener("input", (e) => {
      if (e.target.dataset.catname) { cat(e.target.dataset.catname).name = e.target.value; saver.schedule(); }
    });
    $("dd-cat-add").addEventListener("click", () => {
      store.cats.push({ id: U.uid(), name: "Nueva categoría", color: App.sw(HUES[store.cats.length % HUES.length], 2) });
      saver.schedule(); renderCats();
    });
  }
  bind();

  /* ---------- lo que usan "Hoy" y "Trabajo" ---------- */
  const nextHour = () => { const d = new Date(); return Math.min((d.getHours() + 1) * 60, 22 * 60); };
  App.dd = {
    newEvent() { const s = Math.max(nextHour(), H0 * 60); openSheet(null, { date: U.today(), start: hhmm(s), end: hhmm(s + 60) }); },
    newTask() { openTask(null); },
    editEvent(id, occ) { const e = store.events.find((x) => x.id === id); if (e) openSheet(e, null, occ); },
    todayEvents() {
      const iso = U.today();
      return eventsOn(iso).map((ev) => ({ ev, date: iso, color: catColor(ev.cat), person: (() => { const p = ev.job && ev.person && App.work ? App.work.personName(ev.job, ev.person) : ""; return p && !ev.name.includes(p) ? p : ""; })() }));
    },
    homeTasks() {                                     // vencidas y de hoy primero; después el resto por fecha
      const t = U.today();
      return store.pending.filter((x) => !x.done).sort((a, b) => ((a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : 0)).map((x) => ({
        id: x.id, name: x.name, due: x.due, overdue: !!x.due && x.due < t, today: x.due === t, cat: x.cat && cat(x.cat) ? cat(x.cat) : null,
      }));
    },
    toggleTask(id) { const t = store.pending.find((x) => x.id === id); if (t) { t.done = !t.done; saver.schedule(); renderAll(); } },
    quickTask(name) { store.pending.push({ id: U.uid(), name, cat: null, due: "", done: false, eventId: "" }); saver.schedule(); renderAll(); },
    showTasks() { App.go("diaadia"); setTab("pendientes"); },
    occurrencesIn(monthKey) {                         // [{ev, date}] de un mes, con repeticiones
      const [y, m] = monthKey.split("-").map(Number), n = new Date(y, m, 0).getDate(), out = [];
      for (let d = 1; d <= n; d++) { const iso = monthKey + "-" + U.pad(d); eventsOn(iso).forEach((ev) => out.push({ ev, date: iso })); }
      return out;
    },
  };

  App.hooks.diaadia = () => { renderAll(); };
  App.hooks.categorias = () => { openPal = null; catDelArm = null; renderCats(); };
  App.register("diaadia", {
    load, reset,
    teaser() {
      if (!ok) return "Agenda y tareas";
      const n = eventsOn(U.today()).length, p = todoCount();
      return "Hoy: " + (n ? n + " actividad" + (n > 1 ? "es" : "") : "sin actividades") + (p ? " · " + p + " tarea" + (p > 1 ? "s" : "") + " por hacer" : "");
    },
  });
})();
