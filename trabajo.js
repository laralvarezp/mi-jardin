/* ============================================================
   Módulo Trabajo: tarifas por hora, personas/clientes y cálculo de
   lo que vas a cobrar a partir de los eventos del calendario.
   Datos: clave "work" = { jobs:[{ id, name, rate, rateHoliday, travel, people:[{id,name}] }] }
   Los eventos del calendario guardan: job (id), person (id), holiday (true/false).
   ============================================================ */
(function () {
  let store = { jobs: [] }, ok = false, delArm = null;
  const saver = App.makeSaver(() => "work", () => store, () => ok);

  async function load() {
    try {
      const s = await Backend.get("work");
      store = Object.assign({ jobs: [] }, s || {});
      store.jobs = store.jobs || [];
      ok = true;
    } catch (e) { store = { jobs: [] }; ok = false; App.toast("No se pudieron cargar tus trabajos."); }
  }
  function reset() { store = { jobs: [] }; ok = false; delArm = null; }

  const jobs = () => store.jobs;
  const byId = (id) => store.jobs.find((j) => j.id === id);
  const personName = (jobId, pid) => { const j = byId(jobId), p = j && (j.people || []).find((x) => x.id === pid); return p ? p.name : ""; };
  function addPerson(jobId, name) {
    const j = byId(jobId); if (!j || !name.trim()) return "";
    j.people = j.people || [];
    const ex = j.people.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
    if (ex) return ex.id;
    const p = { id: U.uid(), name: name.trim() }; j.people.push(p); saver.schedule(); return p.id;
  }

  const mins = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const minsEnd = (t) => (t === "00:00" ? 1440 : mins(t));
  // Cuánto se cobra por un evento en un día: horas × tarifa (+ viáticos por turno).
  // Fin de semana o evento marcado como feriado usan la tarifa de feriado, si el trabajo la tiene.
  function pay(ev, iso) {
    const j = byId(ev.job); if (!j || !ev.start || !ev.end || j.mode === "monthly") return null;
    const hours = Math.max(0, (minsEnd(ev.end) - mins(ev.start)) / 60);
    const special = (U.dow(iso) >= 5 || !!ev.holiday) && Number(j.rateHoliday) > 0;
    const rate = special ? Number(j.rateHoliday) : Number(j.rate) || 0;
    const travel = j.noTravel ? 0 : Number(j.travel) || 0;   // si "no sumar viáticos", no entran en tus ingresos
    return { hours, rate, special, travel: travel, travelFull: Number(j.travel) || 0, amount: Math.round(hours * rate + travel) };
  }

  // Resumen del mes para la pantalla de Economía.
  function summary(monthKey) {
    const today = U.today(), out = {}, order = [];
    const worked = {};                                      // horas trabajadas en trabajos con sueldo fijo (solo informativo)
    (App.dd ? App.dd.occurrencesIn(monthKey) : []).forEach(({ ev, date }) => {
      const jj = ev.job && byId(ev.job);
      if (jj && jj.mode === "monthly" && ev.start && ev.end) {
        const w = (worked[jj.id] = worked[jj.id] || { hours: 0, list: [], people: {} }), hrs = Math.max(0, (minsEnd(ev.end) - mins(ev.start)) / 60), pn0 = personName(jj.id, ev.person);
        w.hours += hrs; w.list.push({ date, person: pn0, hours: hrs, name: ev.name });
        if (pn0) w.people[pn0] = (w.people[pn0] || 0) + hrs;
        return;
      }
      const p = pay(ev, date); if (!p) return;
      const j = byId(ev.job);
      if (!out[j.id]) { out[j.id] = { job: j, shifts: 0, hours: 0, amount: 0, hoursDone: 0, amountDone: 0, people: {}, sessions: [] }; order.push(j.id); }
      const o = out[j.id];
      o.shifts++; o.hours += p.hours; o.amount += p.amount;
      if (date <= today) { o.hoursDone += p.hours; o.amountDone += p.amount; }
      const pn = personName(j.id, ev.person);
      if (pn) o.people[pn] = (o.people[pn] || 0) + p.hours;
      o.sessions.push({ key: ev.id + "@" + date, date, person: pn, hours: p.hours, amount: p.amount, travel: p.travel, tvFull: p.travelFull, name: ev.name });
    });
    store.jobs.filter((j) => j.mode === "monthly" && Number(j.monthly) > 0).forEach((j) => {   // sueldo fijo: una sola fila por mes
      const amt = Number(j.monthly); order.push(j.id);
      const w = worked[j.id] || { hours: 0, list: [], people: {} };
      out[j.id] = { job: j, fixed: true, shifts: w.list.length, hours: w.hours, worked: w.list, amount: amt, hoursDone: 0, amountDone: amt, people: w.people, sessions: [{ key: "mensual", date: "", person: "", hours: 0, amount: amt, name: "Sueldo mensual" }] };
    });
    const list = order.map((id) => out[id]);
    return { list, total: list.reduce((s, o) => s + o.amount, 0), totalDone: list.reduce((s, o) => s + o.amountDone, 0) };
  }

  /* ---------- pantalla de tarifas ---------- */
  function render() {
    $("work-list").innerHTML = store.jobs.length ? store.jobs.map((j) =>
      '<div class="card job-card" data-job="' + j.id + '">' +
      '<div class="job-top"><input type="text" class="job-name" value="' + U.esc(j.name) + '" data-f="name" aria-label="Nombre del trabajo" placeholder="Nombre del trabajo" />' +
      '<button class="' + (delArm === j.id ? "btn-danger" : "icon-btn") + '" data-jdel="' + j.id + '">' + (delArm === j.id ? "¿Seguro?" : "✕") + "</button></div>" +
      '<div class="seg job-mode"><button data-mode="hour" class="seg-btn ' + (j.mode !== "monthly" ? "active" : "") + '">Por hora</button><button data-mode="monthly" class="seg-btn ' + (j.mode === "monthly" ? "active" : "") + '">Sueldo fijo mensual</button></div>' +
      (j.mode === "monthly"
        ? '<div class="job-rates"><label>Sueldo por mes<span class="money"><i>$</i><input type="text" inputmode="numeric" value="' + U.esc(j.monthly || "") + '" data-f="monthly" /></span></label></div><p class="hint" style="margin:0">Aparece solo cada mes en Ingresos. No hace falta cargar horas.</p>'
        : '<div class="job-rates">' +
      '<label>Hora normal<span class="money"><i>$</i><input type="text" inputmode="numeric" value="' + U.esc(j.rate || "") + '" data-f="rate" /></span></label>' +
      '<label>Valor especial <small>(feriado o fin de semana)</small><span class="money"><i>$</i><input type="text" inputmode="numeric" value="' + U.esc(j.rateHoliday || "") + '" data-f="rateHoliday" placeholder="igual" /></span></label>' +
      '<label>Viáticos por turno<span class="money"><i>$</i><input type="text" inputmode="numeric" value="' + U.esc(j.travel || "") + '" data-f="travel" placeholder="0" /></span></label></div>' +
        '<label class="check-line"><input type="checkbox" data-f="noTravel"' + (j.noTravel ? " checked" : "") + ' /> <span>Viáticos desactivados por defecto <small>(en cada turno podés tildar si te los pagaron)</small></span></label>') +
      '<div class="job-people-title" style="margin-top:12px">¿Cuándo te pagan?</div><div class="seg job-mode"><button data-lag="0" class="seg-btn ' + (Number(j.payLag) ? "" : "active") + '">En el mismo mes</button><button data-lag="1" class="seg-btn ' + (Number(j.payLag) ? "active" : "") + '">Al mes siguiente</button></div>' +
      '<p class="hint" style="margin:0 0 6px">El ingreso se suma al mes en que cobrás. Si ponés la fecha de cobro, se acomoda solo.</p>' +
      '<div class="job-people-title">Personas o clientes <small>(aparecen al agendar este trabajo)</small></div>' +
      '<div class="job-people">' + (j.people || []).map((p) => '<span class="person-chip">' + U.esc(p.name) + '<button data-pdel="' + p.id + '" aria-label="Quitar ' + U.esc(p.name) + '">✕</button></span>').join("") + "</div>" +
      '<div class="add-row"><input class="mini-input" type="text" placeholder="Agregar persona…" data-newperson="' + j.id + '" autocomplete="off" /><button class="mini-btn" data-padd="' + j.id + '">Agregar</button></div></div>'
    ).join("") : '<p class="muted" style="text-align:center;margin:18px 0">Todavía no cargaste trabajos. Agregá el primero y poné cuánto cobrás por hora.</p>';
  }

  function addJob() {
    store.jobs.push({ id: U.uid(), name: "", rate: "", rateHoliday: "", travel: "", people: [] });
    saver.schedule(); render();
    const inputs = document.querySelectorAll("#work-list .job-name");
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  function bind() {
    const list = $("work-list");
    list.addEventListener("input", (e) => {
      const f = e.target.dataset.f; if (!f) return;
      const j = byId(e.target.closest("[data-job]").dataset.job);
      if (f === "noTravel") j.noTravel = e.target.checked;
      else if (f === "name") j.name = e.target.value;
      else { const d = U.digits(e.target.value); e.target.value = d; j[f] = d; }
      saver.schedule();
    });
    list.addEventListener("click", (e) => {
      const card = e.target.closest("[data-job]"); if (!card) return;
      const j = byId(card.dataset.job);
      const del = e.target.closest("[data-jdel]");
      if (del) {
        if (delArm !== j.id) { delArm = j.id; render(); return; }
        store.jobs = store.jobs.filter((x) => x !== j); delArm = null; saver.schedule(); render(); return;
      }
      const lg = e.target.closest("[data-lag]");
      if (lg) { j.payLag = Number(lg.dataset.lag); saver.schedule(); render(); return; }
      const md = e.target.closest("[data-mode]");
      if (md) { j.mode = md.dataset.mode; saver.schedule(); render(); return; }
      const pd = e.target.closest("[data-pdel]");
      if (pd) { j.people = j.people.filter((p) => p.id !== pd.dataset.pdel); saver.schedule(); render(); return; }
      const pa = e.target.closest("[data-padd]");
      if (pa) addFromInput(card, j);
    });
    list.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.dataset.newperson) { e.preventDefault(); addFromInput(e.target.closest("[data-job]"), byId(e.target.dataset.newperson)); }
    });
    $("work-add").addEventListener("click", addJob);
  }
  function addFromInput(card, j) {
    const inp = card.querySelector("[data-newperson]");
    if (!inp.value.trim()) return;
    addPerson(j.id, inp.value); render();
    const again = document.querySelector('[data-job="' + j.id + '"] [data-newperson]'); if (again) again.focus();
  }
  bind();

  App.hooks.trabajos = render;
  App.work = { jobs, byId, personName, addPerson, pay, summary };
  App.register("trabajo", { load, reset });
})();
