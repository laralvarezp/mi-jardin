/* ============================================================
   Pantalla "Hoy" (inicio): una mirada tranquila al día.
   Muestra las actividades de hoy y un resumen de tareas.
   Para agregar algo rápido está el botón "+" flotante.
   ============================================================ */
(function () {
  const root = () => $("home-today");

  function renderToday() {
    if (!App.dd) return;
    const events = App.dd.todayEvents(), tasks = App.dd.homeTasks();
    const now = new Date(), nowM = now.getHours() * 60 + now.getMinutes();
    const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const over = tasks.filter((t) => t.overdue).length;

    let h = '<div class="today-box"><div class="today-head"><span>· hoy ·</span></div>';
    h += events.length ? '<div class="today-list">' + events.slice(0, 4).map(({ ev, date, color, person }) =>
      '<button class="today-ev' + (ev.end !== "00:00" && mins(ev.end) <= nowM ? " past" : "") + '" data-ev="' + ev.id + '" data-date="' + date + '">' +
      '<span class="te-time">' + ev.start + '</span><span class="te-dot" style="background:' + color + '"></span>' +
      '<span class="te-name">' + U.esc(ev.name) + (person ? " <i>· " + U.esc(person) + "</i>" : "") + "</span></button>").join("") +
      (events.length > 4 ? '<button class="link-btn" data-go="diaadia">y ' + (events.length - 4) + " más ›</button>" : "") + "</div>"
      : '<p class="today-empty">Nada agendado. Día libre ✧</p>';
    h += '<button class="today-pill" data-alltasks="1"><span>↬</span> ' + (tasks.length ? tasks.length + " tarea" + (tasks.length === 1 ? "" : "s") + " por hacer" : "sin tareas pendientes") +
      (over ? ' <b>· ' + over + " vencida" + (over === 1 ? "" : "s") + "</b>" : "") + "</button></div>";
    root().innerHTML = h;
  }

  function closeFab() { $("fab-menu").hidden = true; $("fab").setAttribute("aria-expanded", "false"); $("fab").classList.remove("open"); }

  function bind() {
    $("fab").addEventListener("click", () => {
      const open = $("fab-menu").hidden;
      $("fab-menu").hidden = !open; $("fab").setAttribute("aria-expanded", String(open)); $("fab").classList.toggle("open", open);
    });
    $("home-new-task").addEventListener("click", () => { closeFab(); App.dd.newTask(); });
    $("home-new-event").addEventListener("click", () => { closeFab(); App.dd.newEvent(); });
    document.addEventListener("click", (e) => { if (!e.target.closest("#fab-wrap")) closeFab(); });
    root().addEventListener("click", (e) => {
      const ev = e.target.closest("[data-ev]");
      if (ev) { App.dd.editEvent(ev.dataset.ev, ev.dataset.date); return; }
      if (e.target.closest("[data-alltasks]")) App.dd.showTasks();
    });
  }
  bind();
  App.renderToday = renderToday;
})();
