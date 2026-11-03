/* ============================================================
   Módulo Hábitos: lista de hábitos con nombre/emoji editables y
   grilla mensual (tocá un día: hecho → a mitad → vacío).
   Datos: clave "habits" = { list:[{id,name,emoji}], log:{ id:{ "AAAA-MM-DD": "done"|"half" } } }
   ============================================================ */
(function () {
  const QUOTES = [
    "Pequeños pasos, todos los días.", "No tiene que ser perfecto, tiene que ser constante.",
    "Cada día cuenta, incluso los de a mitad.", "Lo que repetís, te construye.",
    "Hoy alcanza con hacer un poquito.", "Crecer lleva tiempo, como las plantas.",
    "Sos más constante de lo que creés.", "Un día a la vez.",
  ];
  const empty = () => ({ list: [], log: {} });
  let store = empty(), ok = false;
  let cur = null;                       // id del hábito abierto
  let month = new Date(); month.setDate(1);
  let adding = false, hview = "month", year = new Date().getFullYear();

  const saver = App.makeSaver(() => "habits", () => store, () => ok);

  async function load() {
    try {
      const s = await Backend.get("habits");
      store = Object.assign(empty(), s || {});
      store.list = store.list || []; store.log = store.log || {};
      ok = true;
    } catch (e) { store = empty(); ok = false; App.toast("No se pudieron cargar los hábitos."); }
  }
  function reset() { store = empty(); ok = false; cur = null; adding = false; }

  const byId = (id) => store.list.find((h) => h.id === id);
  const monthDays = () => {
    const y = month.getFullYear(), m = month.getMonth();
    return { n: new Date(y, m + 1, 0).getDate(), lead: (new Date(y, m, 1).getDay() + 6) % 7, y, m };
  };
  function pctFor(id, y, m) {
    const { n } = { n: new Date(y, m + 1, 0).getDate() };
    const log = store.log[id] || {}; let pts = 0;
    for (let d = 1; d <= n; d++) {
      const v = log[y + "-" + U.pad(m + 1) + "-" + U.pad(d)];
      pts += v === "done" ? 1 : v === "half" ? 0.5 : 0;
    }
    return Math.round((pts / n) * 100);
  }

  /* ----- lista ----- */
  function renderList() {
    const now = new Date();
    $("hab-list").innerHTML = store.list.length ? store.list.map((h) =>
      '<button class="habit-card" data-open="' + h.id + '"><span class="h-emoji">' + U.esc(h.emoji || "✦") + '</span><span class="h-name">' +
      U.esc(h.name) + '</span><span class="h-bar" role="img" aria-label="' + pctFor(h.id, now.getFullYear(), now.getMonth()) + '% este mes"><span style="width:' + pctFor(h.id, now.getFullYear(), now.getMonth()) + '%"></span></span></button>'
    ).join("") : '<p class="muted" style="text-align:center;margin:18px 0">Todavía no tenés hábitos. ¡Creá el primero!</p>';

    $("hab-add").innerHTML = adding
      ? '<form class="habit-form" id="hab-new-form"><input class="emoji-input mini-input" id="hab-new-emoji" type="text" value="✦" maxlength="4" aria-label="Emoji" />' +
        '<input class="mini-input" id="hab-new-name" type="text" placeholder="Nombre del hábito" />' +
        '<button type="submit" class="mini-btn">Crear</button><button type="button" class="btn-ghost" id="hab-new-cancel">Cancelar</button></form>'
      : '<button class="add-btn" id="hab-new-btn">+ Nuevo hábito</button>';
  }

  /* ----- detalle ----- */
  function renderDetail() {
    const h = byId(cur);
    if (!h) { App.go("habitos"); return; }
    $("hab-title").textContent = (h.emoji || "✦") + " " + h.name;
    $("hab-month-label").textContent = U.monthLabel(U.monthKey(month));
    const { n, lead, y, m } = monthDays();
    const log = store.log[h.id] || {}, today = U.today();
    let html = U.DOW.map((d) => '<div class="muted" style="text-align:center;font-size:10.5px">' + d + "</div>").join("");
    for (let i = 0; i < lead; i++) html += '<button class="day-cell pad" disabled></button>';
    for (let d = 1; d <= n; d++) {
      const iso = y + "-" + U.pad(m + 1) + "-" + U.pad(d), v = log[iso] || "";
      html += '<button class="day-cell ' + v + (iso === today ? " today" : "") + '" data-day="' + iso + '"' + (iso > today ? " disabled" : "") + ">" + d + "</button>";
    }
    $("hab-grid").innerHTML = html;
    const p = pctFor(h.id, y, m);
    $("hab-progress-text").textContent = p + "%";
    $("hab-progress-fill").style.width = p + "%";
    renderYear();
    $("hab-delete-btn").textContent = deleting ? "¿Seguro? Tocá de nuevo para eliminar" : "Eliminar hábito";
  }
  let deleting = false;

  /* ----- año completo: 12 meses con cuadraditos ----- */
  function renderYear() {
    const h = byId(cur); if (!h) return;
    $("hab-year-label").textContent = year;
    const log = store.log[h.id] || {}, today = U.today();
    let html = "", total = 0;
    for (let m = 0; m < 12; m++) {
      const n = new Date(year, m + 1, 0).getDate(), lead = (new Date(year, m, 1).getDay() + 6) % 7;
      let cells = "";
      for (let i = 0; i < lead; i++) cells += '<i class="yc pad"></i>';
      for (let d = 1; d <= n; d++) {
        const iso = year + "-" + U.pad(m + 1) + "-" + U.pad(d), v = log[iso] || "";
        if (v === "done") total++;
        cells += '<i class="yc ' + v + (iso > today ? " future" : "") + '" title="' + d + " " + U.MESES[m] + '"></i>';
      }
      html += '<div class="ymonth"><div class="ymonth-name">' + U.MESES[m].slice(0, 3) + '</div><div class="ymonth-grid">' + cells + "</div></div>";
    }
    $("hab-year-grid").innerHTML = html;
    $("hab-year-text").textContent = total + " día" + (total === 1 ? "" : "s");
  }
  function setView(v) {
    hview = v;
    document.querySelectorAll("#hab-view button").forEach((b) => b.classList.toggle("active", b.dataset.hview === v));
    $("hab-month-view").hidden = v !== "month"; $("hab-year-view").hidden = v !== "year";
    $("hab-delete-btn").hidden = false;
  }

  function openHabit(id) {
    cur = id; deleting = false; year = new Date().getFullYear(); setView("month");
    month = new Date(); month.setDate(1);
    $("hab-rename-form").hidden = true;
    $("hab-quote").textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    App.go("habito");
  }

  function bind() {
    $("hab-list").addEventListener("click", (e) => { const b = e.target.closest("[data-open]"); if (b) openHabit(b.dataset.open); });
    $("hab-add").addEventListener("click", (e) => {
      if (e.target.id === "hab-new-btn") { adding = true; renderList(); $("hab-new-name").focus(); }
      if (e.target.id === "hab-new-cancel") { adding = false; renderList(); }
    });
    $("hab-add").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("hab-new-name").value.trim();
      if (!name) { App.toast("Escribí un nombre para el hábito."); return; }
      store.list.push({ id: U.uid(), name, emoji: $("hab-new-emoji").value.trim() || "✦" });
      adding = false; saver.schedule(); renderList();
    });
    $("hab-grid").addEventListener("click", (e) => {
      const b = e.target.closest("[data-day]"); if (!b) return;
      const log = (store.log[cur] = store.log[cur] || {}), iso = b.dataset.day, v = log[iso];
      if (!v) log[iso] = "done"; else if (v === "done") log[iso] = "half"; else delete log[iso];
      saver.schedule(); renderDetail();
    });
    const shift = (d) => { month = new Date(month.getFullYear(), month.getMonth() + d, 1); renderDetail(); };
    $("hab-prev").addEventListener("click", () => shift(-1));
    $("hab-next").addEventListener("click", () => shift(1));
    $("hab-view").addEventListener("click", (e) => { const b = e.target.closest("[data-hview]"); if (b) setView(b.dataset.hview); });
    $("hab-yprev").addEventListener("click", () => { year--; renderYear(); });
    $("hab-ynext").addEventListener("click", () => { year++; renderYear(); });
    $("hab-rename-btn").addEventListener("click", () => {
      const h = byId(cur), f = $("hab-rename-form");
      f.hidden = !f.hidden;
      if (!f.hidden) { $("hab-rename-emoji").value = h.emoji || "✦"; $("hab-rename-name").value = h.name; $("hab-rename-name").focus(); }
    });
    $("hab-rename-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("hab-rename-name").value.trim();
      if (!name) { App.toast("El nombre no puede quedar vacío."); return; }
      const h = byId(cur); h.name = name; h.emoji = $("hab-rename-emoji").value.trim() || "✦";
      $("hab-rename-form").hidden = true; saver.schedule(); renderDetail();
    });
    $("hab-delete-btn").addEventListener("click", () => {
      if (!deleting) { deleting = true; renderDetail(); return; }
      store.list = store.list.filter((h) => h.id !== cur); delete store.log[cur];
      saver.schedule(); cur = null; deleting = false; App.go("habitos");
    });
  }
  bind();

  // para la pantalla "Hoy"
  App.hab = {
    today() { const t = U.today(); return store.list.map((h) => ({ id: h.id, name: h.name, emoji: h.emoji || "✦", state: (store.log[h.id] || {})[t] || "" })); },
    cycle(id) {
      const log = (store.log[id] = store.log[id] || {}), t = U.today(), v = log[t];
      if (!v) log[t] = "done"; else if (v === "done") log[t] = "half"; else delete log[t];
      saver.schedule();
    },
  };

  App.hooks.habitos = () => { adding = false; renderList(); };
  App.hooks.habito = renderDetail;
  App.register("habitos", {
    load, reset,
    teaser() {
      if (!store.list.length) return "Creá tus hábitos y seguí tu constancia";
      const now = new Date();
      const avg = Math.round(store.list.reduce((s, h) => s + pctFor(h.id, now.getFullYear(), now.getMonth()), 0) / store.list.length);
      return store.list.length + " hábito" + (store.list.length > 1 ? "s" : "") + " · " + avg + "% este mes";
    },
  });
})();
