/* ============================================================
   Módulo Economía: ingresos, gastos, ahorro y gráficos.
   Datos: "month-data:AAAA-MM" (un registro por mes), "goals" y "recurring".
   Los ingresos del mes se arman con tres fuentes:
     · ingresos cargados a mano,
     · sueldo por trabajo (se calcula solo desde la agenda; acá se marca si ya lo cobraste),
     · reintegros (gastos que te devuelven).
   ============================================================ */
(function () {
  const defaultRecurring = () => ["Alquiler", "Luz", "Gas", "Internet"];
  const defaultGoals = () => [{ id: U.uid(), name: "Vacaciones", target: 1000000, saved: 0, deadline: "2027-01-01" }];
  const emptyMonth = () => ({ incomes: [], expenses: [], goalContributions: [], workPaid: {}, importedIds: [] });

  let current = new Date(); current.setDate(1);
  let data = emptyMonth();
  let goals = defaultGoals();
  let recurring = defaultRecurring();
  let monthOk = false, goalsOk = false, recOk = false;   // si una carga falló, no se guarda (así no se pisan datos)
  let viewMode = "confirmed", tab = "ingresos";
  let chartMode = "month", chartSeq = 0, noteId = null, hist = [];
  let editName = null;                                   // { kind, id } mientras se edita un nombre con el lápiz
  let openImpInc = false, openImpExp = false, openIncome = null, openExpense = null, openWork = null, openRefunds = false, armDel = null;
  let addingIncome = false, addingExpense = false, addingGoal = false, contributingGoal = null;

  const key = () => U.monthKey(current);
  const monthSaver = App.makeSaver(() => "month-data:" + key(), () => data, () => monthOk);
  const goalsSaver = App.makeSaver(() => "goals", () => goals, () => goalsOk);
  const recSaver = App.makeSaver(() => "recurring", () => recurring, () => recOk);
  const root = () => $("screen-economia");
  const find = (arr, id) => arr.find((x) => x.id === id);
  const num = (v) => Number(v) || 0;
  const newExpense = (name) => ({ id: U.uid(), name, amount: "", paid: false, paidDate: "", dueEnabled: false, dueDate: "" });

  /* ---------- carga ---------- */
  async function loadGoals() {
    try { const g = await Backend.get("goals"); goals = Array.isArray(g) ? g : defaultGoals(); goalsOk = true; }
    catch (e) { goals = defaultGoals(); goalsOk = false; App.toast("No se pudieron cargar las metas de ahorro."); }
  }
  async function loadRecurring() {
    try { const r = await Backend.get("recurring"); recurring = Array.isArray(r) ? r : defaultRecurring(); recOk = true; }
    catch (e) { recurring = defaultRecurring(); recOk = false; }
  }
  function limitMonth() { const n = new Date(); return U.monthKey(new Date(n.getFullYear(), n.getMonth() + 12, 1)); }
  async function loadMonth() {
    try {
      const s = await Backend.get("month-data:" + key());
      data = Object.assign(emptyMonth(), s || {});           // lo que no se usa más se conserva sin tocar
      data.incomes = data.incomes || []; data.expenses = data.expenses || [];
      data.goalContributions = data.goalContributions || []; data.workPaid = data.workPaid || {}; data.importedIds = data.importedIds || [];
      if (!s && recOk && key() >= U.monthKey(new Date()) && key() <= limitMonth()) {   // mes nuevo: aparecen tus gastos fijos, sin monto
        data.expenses = recurring.map((n) => newExpense(n));
        monthSaver.schedule();
      }
      monthOk = true;
      await loadWorkCache();
    } catch (e) { data = emptyMonth(); monthOk = false; App.toast("No se pudo cargar el mes. Recargá la página."); }
  }
  async function load() {
    current = new Date(); current.setDate(1);
    await Promise.all([loadGoals(), loadRecurring()]);
    await loadMonth();
  }
  function reset() {
    data = emptyMonth(); goals = defaultGoals(); recurring = defaultRecurring();
    monthOk = goalsOk = recOk = false; tab = "ingresos";
    openIncome = openExpense = openWork = contributingGoal = armDel = null; openRefunds = false;
    addingIncome = addingExpense = addingGoal = false;
  }
  async function changeMonth(delta) {
    await monthSaver.flush();
    const d = new Date(current); d.setDate(1); d.setMonth(d.getMonth() + delta);
    current = d; openIncome = openExpense = openWork = armDel = null; openRefunds = false;
    await loadMonth(); renderAll();
  }

  /* ---------- cuentas ---------- */
  const sum = (arr, f) => arr.filter(f).reduce((s, x) => s + num(x.amount), 0);
  const refundAmt = (e) => num(e.refundAmount) || num(e.amount);
  function workSplit(m, o) {
    const wp = (m.workPaid || {})[o.job.id] || {};
    let paid = 0, n = 0;
    o.sessions.forEach((x) => { if (isPaid(wp, x)) { paid += x.amount; n++; } });
    return { wp, paid, pend: o.amount - paid, n, total: o.sessions.length, all: n === o.sessions.length && n > 0, none: n === 0 };
  }
  const workRows = (m, k) => (App.work ? App.work.summary(k).list : []);

  /* ---- el sueldo cuenta en el mes en que se cobra (no en el que se trabajó) ----
     Cada "mes trabajado" (W) guarda sus tildes y su fecha de cobro en su propio registro.
     Una fila aparece en el mes de su fecha de cobro; sin fecha, en el mes de trabajo + el desfase del trabajo
     (0 = mismo mes, 1 = mes siguiente). Lo que sigue sin cobrar y sin fecha se va corriendo hasta el mes actual. */
  let wcache = {};                                          // registros de meses anteriores (para ver lo que se cobra este mes)
  const addM = (mk, n) => U.monthKey(new Date(Number(mk.slice(0, 4)), Number(mk.slice(5, 7)) - 1 + n, 1));
  // wp.pkg = horas que te pagaron por adelantado: cubren las sesiones sin tildar, de la más vieja a la más nueva.
  const splitOf = (wp, o) => {
    let paid = 0, n = 0, left = Number(wp && wp.pkg) || 0, covered = 0;
    const cov = {};
    o.sessions.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach((x) => {
      if (isPaid(wp, x)) { paid += x.amount; n++; cov[x.key] = 1; return; }
      if (left > 0.0001 && x.hours > 0) {
        const share = Math.min(1, left / x.hours);
        left -= x.hours * share; covered += x.hours * share; paid += x.amount * share; cov[x.key] = share;
        if (share > 0.9999) n++;
      }
    });
    paid = Math.round(paid);
    return { paid, pend: o.amount - paid, n, total: o.sessions.length, all: n === o.sessions.length && n > 0, pkg: Number(wp && wp.pkg) || 0, left: Math.max(0, left), covered, cov };
  };
  function effMonth(W, o, wp, st) {
    if (wp.date) return wp.date.slice(0, 7);
    const e = addM(W, Number(o.job.payLag) || 0), now = U.monthKey(new Date());
    return !st.all && !o.fixed && e < now && W >= addM(now, -3) ? now : e;     // lo sin cobrar se corre al mes actual (hasta 3 meses atrás)
  }
  function workItemsFor(k, recOf) {
    const get = recOf || ((W) => (W === key() ? data : wcache[W] || null)), out = [];
    if (!App.work) return out;
    for (let i = -6; i <= 0; i++) {
      const W = addM(k, i), rec = get(W);
      App.work.summary(W).list.forEach((o) => {
        const wp = ((rec && rec.workPaid) || {})[o.job.id] || {}, st = splitOf(wp, o);
        if (effMonth(W, o, wp, st) === k) out.push({ W, o, wp, st, id: W + "~" + o.job.id });
      });
    }
    return out;
  }
  async function loadWorkCache() {
    wcache = {};
    if (!App.work || !App.work.jobs().length) return;
    const k = key(), nowKey = U.monthKey(new Date());
    await Promise.all([-6, -5, -4, -3, -2, -1].map(async (i) => {
      const W = addM(k, i);
      try {
        const s = await Backend.get("month-data:" + W), rec = Object.assign(emptyMonth(), s || {});
        rec.workPaid = rec.workPaid || {};
        wcache[W] = rec;
      } catch (e) { wcache[W] = null; }
    }));
  }
  function wpRef(id) {
    const [W, jobId] = String(id).split("~"), rec = W === key() ? data : wcache[W];
    if (!rec) { App.toast("No se pudo abrir ese mes. Recargá la página."); return null; }
    rec.workPaid = rec.workPaid || {};
    return { W, jobId, rec, wp: (rec.workPaid[jobId] = rec.workPaid[jobId] || {}) };
  }
  async function saveWork(r) {
    if (r.W === key()) { monthSaver.schedule(); return; }
    try { await Backend.set("month-data:" + r.W, r.rec); } catch (e) { App.toast("No se pudo guardar. Probá de nuevo."); }
  }
  function movedToast(r) {                                  // avisa si el cobro pasó a contar en otro mes
    const o = App.work.summary(r.W).list.find((x) => x.job.id === r.jobId); if (!o) return;
    const m = effMonth(r.W, o, r.wp, splitOf(r.wp, o));
    if (m !== key()) App.toast("Cuenta en " + U.monthLabel(m) + ", el mes del cobro.");
  }

  // ingresos de un mes (confirmados = ya cobrados) sumando las tres fuentes
  function incomeParts(m, k, items) {
    let conf = 0, pend = 0;
    (m.incomes || []).forEach((i) => { if (i.done) conf += num(i.amount); else pend += num(i.amount); });
    (items || workItemsFor(k)).forEach((it) => { conf += it.st.paid; pend += it.st.pend; });
    (m.expenses || []).filter((e) => e.refundOn).forEach((e) => { if (e.refundDone) conf += refundAmt(e); else pend += refundAmt(e); });
    return { conf, pend };
  }
  function totals() {
    const inc = incomeParts(data, key());
    const expenseConfirmed = sum(data.expenses, (e) => e.paid), expensePending = sum(data.expenses, (e) => !e.paid);
    const confirmed = viewMode === "confirmed";
    return {
      incomeConfirmed: inc.conf, incomePending: inc.pend, expenseConfirmed, expensePending,
      totalIncome: confirmed ? inc.conf : inc.conf + inc.pend,
      totalOut: expenseConfirmed + (confirmed ? 0 : expensePending),
    };
  }

  /* ---------- pantalla ---------- */
  function renderAll() {
    $("eco-month-label").textContent = U.monthLabel(key());
    renderBalance(); renderIncomes(); renderExpenses(); renderGoals(); renderChart();
  }
  function setTab(t) {
    tab = t;
    document.querySelectorAll("#eco-tabs .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.etab === t));
    ["ingresos", "gastos", "ahorro", "graficos"].forEach((n) => { $("eco-p-" + n).hidden = n !== t; });
  }

  function renderBalance() {
    const t = totals(), bal = t.totalIncome - t.totalOut;
    const amt = $("eco-balance-amount");
    amt.textContent = (bal < 0 ? "-" : "") + "$" + U.fmt(Math.abs(bal));
    amt.classList.toggle("over", bal < 0);
    $("eco-balance-label").textContent = bal < 0 ? "Falta cubrir" : "Disponible";
    const pct = t.totalIncome > 0 ? Math.min(100, (t.totalOut / t.totalIncome) * 100) : 0;
    const bar = $("eco-progress");
    bar.style.width = pct + "%";
    bar.style.background = bal < 0 ? "var(--terracotta)" : pct > 80 ? "var(--butter)" : "var(--green)";
    $("eco-sum-income").textContent = "$" + U.fmt(t.totalIncome);
    $("eco-sum-expense").textContent = "$" + U.fmt(t.totalOut);
    $("eco-income-subtotal").innerHTML = "Cobrado <b>$" + U.fmt(t.incomeConfirmed) + "</b>" + (t.incomePending ? " · pendiente $" + U.fmt(t.incomePending) : "");
    $("eco-expense-subtotal").innerHTML = "Pagado <b>$" + U.fmt(t.expenseConfirmed) + "</b>" + (t.expensePending ? " · pendiente $" + U.fmt(t.expensePending) : "");
  }

  // nombre de una fila: texto, o un campo si se está editando; el lápiz aparece al expandir
  function nameHTML(kind, item, open) {
    if (editName && editName.kind === kind && editName.id === item.id)
      return '<input class="mini-input name-edit" type="text" value="' + U.esc(item.name) + '" data-change="' + kind + '-name" data-id="' + item.id + '" aria-label="Nombre" />';
    return '<span class="row-text">' + U.esc(item.name) + "</span>" +
      (open ? '<button class="pencil" data-act="edit-name" data-kind="' + kind + '" data-id="' + item.id + '" aria-label="Editar nombre">✎</button>' : "");
  }
  const delBtn = (act, id) => '<button class="del-btn' + (armDel === act + id ? " arm" : "") + '" data-act="' + act + '" data-id="' + id + '">' + (armDel === act + id ? "¿Seguro? Tocá de nuevo" : "Quitar") + "</button>";
  // monto: se ve como texto y el lápiz lo vuelve editable (así no se ve un bloque ni se agranda la pantalla)
  let editAmt = null, editPkg = null;
  function amtHTML(k, id, val, ph, label) {
    if (editAmt && editAmt.k === k && editAmt.id === id)
      return '<span class="muted">$</span><input class="amount-input" type="text" inputmode="numeric" placeholder="' + U.esc(ph || "0") + '" value="' + U.esc(val || "") + '" data-input="' + k + '" data-id="' + id + '" aria-label="' + U.esc(label) + '" />';
    return '<span class="amt-text">$' + (val ? U.fmt(num(val)) : "0") + '</span><button class="pencil" data-act="edit-amt" data-k="' + k + '" data-id="' + id + '" aria-label="' + U.esc(label) + '">✎</button>';
  }
  const NOTE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h8.5L19 8v12a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20z"/><path d="M14 3.5V8h5"/><path d="M9 12.5h6M9 16h4"/></svg>';
  const noteBtn = (has, act, id) => '<button class="note-btn' + (has ? " has" : "") + '" data-act="' + act + '" data-id="' + id + '" aria-label="' + (has ? "Ver o editar la nota" : "Agregar una nota") + '">' + NOTE_SVG + (has ? "" : "<sup>+</sup>") + "</button>";
  const caret = (open) => '<span class="caret">' + (open ? "▲" : "▼") + "</span>";
  const hoursTxt = (n) => String(Math.round(n * 100) / 100).replace(".", ",") + " h";

  /* ----- ingresos ----- */
  // etiquetas de fecha de cobro: "cobrado", "cobro 20/11", o la fecha en rojo si pasó y no se cobró
  function dateBadge(date, done) {
    if (!date) return "";
    const dm = U.fmtDM(date);
    if (done) return '<span class="due-badge done">cobrado ' + dm + "</span>";
    if (date < U.today()) return '<span class="due-badge overdue">cobro ' + dm + "</span>";
    return '<span class="due-badge' + (U.daysUntil(date) <= 2 ? " soon" : "") + '">cobro ' + dm + "</span>";
  }
  const incomeDateBadge = (inc) => dateBadge(inc.doneDate, inc.done);
  const checkBtn = (act, id, on, label) => '<button class="checkbox' + (on ? " checked" : "") + '" data-act="' + act + '" data-id="' + id + '" aria-label="' + label + '">' + (on ? "✓" : "") + "</button>";

  // cobro por sesión: wp.paid = { claveDeSesión: true }. (Si quedó el formato viejo {done}, cuenta todas las sesiones de ese momento.)
  const isPaid = (wp, sess) => (wp && wp.paid ? !!wp.paid[sess.key] : !!(wp && wp.done));
  function workState(m, o) {
    const wp = (m.workPaid || {})[o.job.id] || {};
    const paid = o.sessions.filter((x) => isPaid(wp, x));
    return { wp, n: paid.length, total: o.sessions.length, amt: paid.reduce((t, x) => t + x.amount, 0), all: paid.length === o.sessions.length && o.sessions.length > 0, none: !paid.length };
  }
  function migrateWork() {                                 // pasa el formato viejo al nuevo, así lo que agregues después queda pendiente
    let ch = false;
    workRows(data, key()).forEach((o) => {
      const wp = data.workPaid[o.job.id];
      if (wp && !wp.paid && wp.done) { wp.paid = {}; o.sessions.forEach((x) => { wp.paid[x.key] = true; }); delete wp.done; ch = true; }
    });
    if (ch) monthSaver.schedule();
  }
  function workRowHTML(it) {
    const o = it.o, id = it.id, t = it.st, wp = it.wp, open = openWork === id;
    const cb = '<button class="checkbox' + (t.all ? " checked" : t.n ? " half" : "") + '" data-act="toggle-work" data-id="' + id + '" aria-label="' + (t.all ? "Marcar todo como no cobrado" : "Marcar todo como cobrado") + '">' + (t.all ? "✓" : t.n ? "–" : "") + "</button>";
    const badge = t.all ? dateBadge(wp.date, true) : t.n ? '<span class="due-badge">' + t.n + " de " + t.total + " cobradas</span>" + dateBadge(wp.date, false) : t.pkg ? '<span class="due-badge">' + hoursTxt(t.covered) + " pagadas</span>" + dateBadge(wp.date, false) : dateBadge(wp.date, false);
    let h = '<div class="row-card auto' + (t.all ? " paid-inc" : "") + (open ? " has-detail" : "") + '">' + cb +
      '<span class="row-name" data-act="expand-work" data-id="' + id + '"><span class="row-text">Sueldo ' + U.esc(o.job.name || "") + (it.W !== key() ? " · " + U.MESES[Number(it.W.slice(5)) - 1].slice(0, 3).toLowerCase() : "") + "</span>" + (wp.note ? '<span class="note-mark" title="Tiene nota">' + NOTE_SVG.replace('width="18" height="18"', 'width="13" height="13"') + "</span>" : "") +
      badge + caret(open) + "</span>" +
      '<span class="auto-amount">$' + U.fmt(o.amount) + "</span></div>";
    if (open && o.fixed) {
      h += '<div class="row-detail"><div class="row-detail-line">‧ Fecha de cobro <input class="date-input" type="date" value="' + (wp.date || "") + '" data-change="work-date" data-id="' + id + '" /></div>' +
        '<div class="detail-note">Sueldo fijo mensual · ' + (o.worked && o.worked.length ? "trabajaste <b>" + hoursTxt(o.hours) + "</b> en " + o.shifts + " sesión" + (o.shifts === 1 ? "" : "es") : "las horas que agendes con este trabajo aparecen acá") + ".</div>" +
        '<div class="row-detail-line">' + noteBtn(!!wp.note, "note-work", id) + "</div>";
      const g = {};
      (o.worked || []).forEach((s) => { const k = s.person || "Sin persona"; (g[k] = g[k] || []).push(s); });
      Object.keys(g).sort().forEach((p) => {
        const list = g[p].sort((a, b) => (a.date < b.date ? -1 : 1)), hrs = list.reduce((x, y) => x + y.hours, 0);
        h += '<div class="person-block"><div class="person-head"><span>' + U.esc(p) + "</span><b>" + hoursTxt(hrs) + '</b></div><div class="person-sub">' + list.length + " sesión" + (list.length === 1 ? "" : "es") + "</div>" +
          list.map((s) => '<div class="session-line"><span class="sl-txt">' + U.fmtDM(s.date) + " · " + U.esc(s.name || "") + " · " + hoursTxt(s.hours) + "</span></div>").join("") + "</div>";
      });
      h += "</div>";
    } else if (open) {
      const groups = {};
      o.sessions.forEach((s) => { const k = s.person || "Sin persona"; (groups[k] = groups[k] || []).push(s); });
      h += '<div class="row-detail"><div class="row-detail-line">‧ Fecha de cobro <input class="date-input" type="date" value="' + (wp.date || "") + '" data-change="work-date" data-id="' + id + '" /></div>' +
        (o.fixed ? '<div class="detail-note">Sueldo fijo mensual.</div>' : '<div class="detail-note">' + o.shifts + " sesión" + (o.shifts === 1 ? "" : "es") + " · " + hoursTxt(o.hours) + " · se calcula desde tu agenda. Tildá cada una cuando la cobres, o todas juntas con el círculo de arriba.</div>");
      h += '<div class="row-detail-line">' + noteBtn(!!wp.note, "note-work", id) + "</div>";
      if (!o.fixed) {
        let pendH = 0; o.sessions.forEach((x) => { pendH += x.hours * (1 - (t.cov[x.key] || 0)); });
        h += '<div class="pkg-box"><div class="row-detail-line">‧ Horas pagadas por adelantado ' + (editPkg === id
          ? '<input class="pkg-input" type="text" inputmode="decimal" value="' + (wp.pkg || "") + '" placeholder="0" data-change="work-pkg" data-id="' + id + '" /> h'
          : "<b>" + hoursTxt(t.pkg) + '</b><button class="pencil" data-act="edit-pkg" data-id="' + id + '" aria-label="Editar horas pagadas por adelantado">✎</button>') + "</div>" +
          (t.pkg ? '<div class="detail-note">Trabajadas ' + hoursTxt(o.hours) + " · cubiertas " + hoursTxt(t.covered + o.sessions.reduce((a, x) => a + (isPaid(wp, x) ? x.hours : 0), 0)) +
            (pendH > 0.01 ? " · <b>faltan cobrar " + hoursTxt(pendH) + " ($" + U.fmt(t.pend) + ")</b>" : "") +
            (t.left > 0.01 ? " · <b>te quedan " + hoursTxt(t.left) + " a favor</b>" : "") + "</div>"
            : '<div class="detail-note">Si te pagan un paquete de horas, ponelas acá: se descuentan de tus sesiones. Si después cambian las horas, la cuenta se ajusta sola.</div>') + "</div>";
      }
      if (!o.fixed) Object.keys(groups).sort().forEach((p) => {
        const list = groups[p].sort((a, b) => (a.date < b.date ? -1 : 1));
        const hrs = list.reduce((s, x) => s + x.hours, 0), amt = list.reduce((s, x) => s + x.amount, 0);
        h += '<div class="person-block"><div class="person-head"><span>' + U.esc(p) + "</span><b>$" + U.fmt(amt) + '</b></div><div class="person-sub">' + list.length + " sesión" + (list.length === 1 ? "" : "es") + " · " + hoursTxt(hrs) + "</div>" +
          list.map((s) => '<div class="session-line"><button class="checkbox' + (isPaid(wp, s) ? " checked" : t.cov[s.key] ? " half" : "") + '" data-act="toggle-session" data-id="' + id + '" data-key="' + U.esc(s.key) + '" aria-label="Marcar como cobrada">' + (isPaid(wp, s) ? "✓" : t.cov[s.key] ? (t.cov[s.key] > 0.9999 ? "–" : "½") : "") + '</button><span class="sl-txt">' + U.DOW[U.dow(s.date)] + " " + U.fmtDM(s.date) + " · " + hoursTxt(s.hours) + "</span><span>$" + U.fmt(s.amount) + "</span></div>").join("") + "</div>";
      });
      h += "</div>";
    }
    return h;
  }

  function refundsRowHTML() {
    const items = data.expenses.filter((e) => e.refundOn);
    if (!items.length) return "";
    const total = items.reduce((s, e) => s + refundAmt(e), 0), got = items.filter((e) => e.refundDone).length;
    const pend = items.filter((e) => !e.refundDone && e.refundDate).map((e) => e.refundDate).sort();
    let h = '<div class="row-card auto' + (got === items.length ? " paid-inc" : "") + (openRefunds ? " has-detail" : "") + '">' + checkBtn("toggle-refunds-all", "all", got === items.length, "Marcar todos como recibidos") +
      '<span class="row-name" data-act="expand-refunds"><span class="row-text">Reintegros</span><span class="due-badge">' + got + " de " + items.length + " recibidos</span>" + (pend.length ? dateBadge(pend[0], false) : "") + caret(openRefunds) + "</span>" +
      '<span class="auto-amount">$' + U.fmt(total) + "</span></div>";
    if (openRefunds) {
      h += '<div class="row-detail">' + items.map((e) =>
        '<div class="refund-line">' + checkBtn("toggle-refund-one", e.id, !!e.refundDone, "Marcar como recibido") + '<span class="rl-name">' + U.esc(e.name) + '</span><span>$' + U.fmt(refundAmt(e)) + "</span></div>" +
          '<div class="refund-date">‧ Fecha de cobro <input class="date-input" type="date" value="' + (e.refundDate || "") + '" data-change="refund-date" data-id="' + e.id + '" />' + dateBadge(e.refundDate, e.refundDone) + "</div>").join("") +
        '<div class="row-detail-line">' + noteBtn(!!(data.refundsMeta && data.refundsMeta.note), "note-refunds", "all") + '</div><div class="detail-note">Son gastos tuyos que te devuelven. Se marcan desde cada gasto, con "Me lo reintegran".</div></div>';
    }
    return h;
  }

  function incomeRowHTML(inc) {
    const open = openIncome === inc.id;
    return '<div class="row-card' + (inc.done ? " paid-inc" : "") + (open ? " has-detail" : "") + '">' + checkBtn("toggle-income", inc.id, inc.done, inc.done ? "Marcar como pendiente" : "Marcar como cobrado") +
      '<span class="row-name" data-act="expand-income" data-id="' + inc.id + '">' + nameHTML("income", inc, open) + (inc.note ? '<span class="note-mark" title="Tiene nota">'+NOTE_SVG.replace('width="18" height="18"','width="13" height="13"')+'</span>' : "") + incomeDateBadge(inc) + caret(open) + "</span>" +
      amtHTML("income-amount", inc.id, inc.amount, "0", "Editar monto de " + inc.name) + '</div>' +
      (open ? '<div class="row-detail">' +
        '<div class="row-detail-line">‧ Fecha de cobro <input class="date-input" type="date" value="' + (inc.doneDate || "") + '" data-change="income-date" data-id="' + inc.id + '" /></div>' +
        '<div class="row-detail-line">' + noteBtn(!!inc.note, "note-income", inc.id) + delBtn("delete-income", inc.id) + "</div></div>" : "");
  }
  // lo importado va en una sola fila desplegable, con cada movimiento adentro (ordenado por fecha)
  function importedGroupHTML(kind) {
    const arr = (kind === "income" ? data.incomes : data.expenses).filter((x) => x.imp);
    if (!arr.length) return "";
    const open = kind === "income" ? openImpInc : openImpExp, delAct = "delete-" + kind;
    const dateOf = (x) => (kind === "income" ? x.doneDate : x.paidDate) || "";
    const list = arr.slice().sort((p, q) => (dateOf(p) < dateOf(q) ? -1 : dateOf(p) > dateOf(q) ? 1 : 0));
    const total = arr.reduce((t, x) => t + num(x.amount), 0);
    let h = '<div class="row-card auto' + (kind === "income" ? " paid-inc" : " done") + (open ? " has-detail" : "") + '"><span class="imp-mark">↧</span>' +
      '<span class="row-name" data-act="expand-imp-' + kind + '"><span class="row-text">Importado</span><span class="due-badge">' + arr.length + (arr.length === 1 ? " movimiento" : " movimientos") + "</span>" + caret(open) + "</span>" +
      '<span class="auto-amount">$' + U.fmt(total) + "</span></div>";
    if (open) h += '<div class="row-detail">' + list.map((x) =>
      '<div class="imp-line"><span class="il-date">' + U.fmtDM(dateOf(x)) + '</span><span class="il-name">' + nameHTML(kind, x, true) + '</span><span class="il-amt">$' + U.fmt(num(x.amount)) + "</span>" + delBtn(delAct, x.id) + "</div>").join("") +
      '<div class="detail-note">Viene de tu resumen importado. Ya cuenta como ' + (kind === "income" ? "cobrado" : "pagado") + ".</div></div>";
    return h;
  }
  // ordena por fecha (la más vieja primero; sin fecha, al final) y separa con una línea lo hecho de lo pendiente
  const byDate = (a, b) => (a.d && !b.d ? -1 : !a.d && b.d ? 1 : a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
  function splitHTML(entries, extraDone) {
    const done = entries.filter((e) => e.done).sort(byDate).map((e) => e.html).join("") + (extraDone || "");
    const pend = entries.filter((e) => !e.done).sort(byDate).map((e) => e.html).join("");
    return done + (done && pend ? '<div class="split-line"></div>' : "") + pend;
  }
  function renderIncomes() {
    migrateWork();
    const entries = [];
    workItemsFor(key()).forEach((it) => entries.push({ d: it.wp.date || "", done: it.st.all, html: workRowHTML(it) }));
    const refs = data.expenses.filter((e) => e.refundOn);
    if (refs.length) {
      const all = refs.every((e) => e.refundDone), ds = refs.filter((e) => e.refundDate).map((e) => e.refundDate).sort();
      entries.push({ d: ds[0] || "", done: all, html: refundsRowHTML() });
    }
    data.incomes.filter((i) => !i.imp).forEach((i) => entries.push({ d: i.doneDate || "", done: !!i.done, html: incomeRowHTML(i) }));
    let h = splitHTML(entries, importedGroupHTML("income"));
    if (!h) h = '<p class="muted empty-note">Todavía no hay ingresos este mes.</p>';
    $("eco-income-list").innerHTML = h;
    $("eco-income-add").innerHTML = addingIncome
      ? '<div class="add-row col"><input class="mini-input" id="eco-new-income-name" type="text" placeholder="Nombre del ingreso" data-enter="confirm-add-income" />' +
        '<div class="row"><input class="mini-input" id="eco-new-income-amount" type="text" inputmode="numeric" placeholder="Monto" data-enter="confirm-add-income" />' +
        '<button class="mini-btn" data-act="confirm-add-income">Agregar</button><button class="btn-ghost" data-act="cancel-add">Cancelar</button></div></div>'
      : '<button class="add-btn" data-act="start-add-income">+ Agregar ingreso</button>';
  }

  /* ----- gastos ----- */
  function dueClass(e) {
    if (!e.dueEnabled || !e.dueDate || e.paid) return null;
    const d = U.daysUntil(e.dueDate);
    return d < 0 ? "overdue" : d <= 2 ? "soon" : "";
  }
  function expenseRowHTML(exp) {
      const open = openExpense === exp.id, dc = dueClass(exp);
      return '<div class="row-card' + (exp.paid ? " done" : "") + (open ? " has-detail" : "") + '">' + checkBtn("toggle-expense", exp.id, exp.paid, exp.paid ? "Marcar como pendiente" : "Marcar como pagado") +
        '<span class="row-name' + (exp.paid ? " strike" : "") + '" data-act="expand-expense" data-id="' + exp.id + '">' + nameHTML("expense", exp, open) +
        (dc !== null ? '<span class="due-badge ' + dc + '">vence ' + U.fmtDM(exp.dueDate) + "</span>" : "") + (exp.refundOn ? '<span class="due-badge">↫ reintegro</span>' : "") + (exp.note ? '<span class="note-mark" title="Tiene nota">' + NOTE_SVG.replace('width="18" height="18"', 'width="13" height="13"') + "</span>" : "") + caret(open) + "</span>" +
        amtHTML("expense-amount", exp.id, exp.amount, "0", "Editar monto de " + exp.name) + '</div>' +
        (open ? '<div class="row-detail">' +
          (exp.paid ? '<div class="row-detail-line">‧ Fecha de pago <input class="date-input" type="date" value="' + (exp.paidDate || "") + '" data-change="expense-paid-date" data-id="' + exp.id + '" /></div>' : "") +
          '<div class="row-detail-line"><button class="switch' + (exp.dueEnabled ? " on" : "") + '" data-act="toggle-due" data-id="' + exp.id + '" aria-label="Activar vencimiento"><span class="switch-knob"></span></button> Tiene vencimiento' +
          (exp.dueEnabled ? ' <input class="date-input" type="date" value="' + (exp.dueDate || "") + '" data-change="expense-due-date" data-id="' + exp.id + '" />' : "") + "</div>" +
          '<div class="row-detail-line"><button class="switch' + (exp.refundOn ? " on" : "") + '" data-act="toggle-refund" data-id="' + exp.id + '" aria-label="Me lo reintegran"><span class="switch-knob"></span></button> Me lo reintegran' +
          (exp.refundOn ? ' ' + amtHTML("refund-amount", exp.id, exp.refundAmount || exp.amount, "mismo monto", "Editar monto a reintegrar") : "") + "</div>" +
          (exp.refundOn ? '<div class="detail-note">Aparece en Ingresos como Reintegros. Ahí lo marcás cuando te lo devuelven.</div>' : "") +
          '<div class="row-detail-line">' + noteBtn(!!exp.note, "note-expense", exp.id) + delBtn("delete-expense", exp.id) + "</div></div>" : "");
  }
  function renderExpenses() {
    const entries = data.expenses.filter((e) => !e.imp).map((e) => ({ d: e.paid ? e.paidDate || "" : e.dueEnabled ? e.dueDate || "" : "", done: !!e.paid, html: expenseRowHTML(e) }));
    $("eco-expense-list").innerHTML = splitHTML(entries, importedGroupHTML("expense")) || '<p class="muted empty-note">Todavía no hay gastos este mes.</p>';

    const free = recurring.filter((t) => !data.expenses.some((e) => e.name.toLowerCase() === t.toLowerCase()));
    $("eco-chips").innerHTML = free.map((t) => '<button class="chip" data-act="add-template" data-name="' + U.esc(t) + '">+ ' + U.esc(t) + "</button>").join("");
    $("eco-expense-add").innerHTML = addingExpense
      ? '<div class="add-row"><input class="mini-input" id="eco-new-expense-name" type="text" placeholder="Nombre del gasto" data-enter="confirm-add-expense" />' +
        '<button class="mini-btn" data-act="confirm-add-expense">OK</button><button class="btn-ghost" data-act="cancel-add">Cancelar</button></div>'
      : '<button class="add-btn" data-act="start-add-expense">+ Otro gasto</button>';
  }

  /* ----- ahorro ----- */
  function renderGoals() {
    const today = U.today();
    $("eco-goals").innerHTML = goals.map((g) => {
      const saved = num(g.saved), pct = g.target > 0 ? Math.min(100, (saved / g.target) * 100) : 0;
      const done = g.target > 0 && saved >= g.target, overdue = g.deadline && g.deadline < today && !done;
      return '<div class="goal-card"><div class="goal-top"><div><div class="goal-name">' + U.esc(g.name) + (done ? " ✦" : "") + "</div>" +
        (g.deadline ? '<div class="goal-deadline' + (overdue ? " overdue" : "") + '">' + (overdue ? "Venció el " : "Para el ") + U.fmtDM(g.deadline) + "</div>" : "") +
        '</div><button class="icon-btn" data-act="delete-goal" data-id="' + g.id + '" aria-label="Eliminar meta">✕</button></div>' +
        '<div class="goal-track"><div class="goal-fill' + (done ? " done" : "") + '" style="width:' + pct + '%"></div></div>' +
        '<div class="goal-bottom"><span><b>$' + U.fmt(saved) + "</b> de $" + U.fmt(g.target) + "</span>" +
        (contributingGoal === g.id
          ? '<span class="goal-contrib"><input id="eco-contrib-amount" type="text" inputmode="numeric" placeholder="Monto" data-enter="confirm-contribute" data-id="' + g.id + '" /><button class="mini-btn butter" data-act="confirm-contribute" data-id="' + g.id + '">Sumar</button><button class="btn-ghost" data-act="cancel-add">✕</button></span>'
          : '<button class="goal-btn" data-act="start-contribute" data-id="' + g.id + '">+ Agregar</button>') + "</div></div>";
    }).join("");
    $("eco-goal-add").innerHTML = addingGoal
      ? '<div class="add-row col"><input class="mini-input" id="eco-new-goal-name" type="text" placeholder="¿Qué querés lograr?" data-enter="confirm-add-goal" />' +
        '<div class="row"><input class="mini-input" id="eco-new-goal-target" type="text" inputmode="numeric" placeholder="Monto objetivo" data-enter="confirm-add-goal" />' +
        '<button class="mini-btn butter" data-act="confirm-add-goal">Crear</button><button class="btn-ghost" data-act="cancel-add">Cancelar</button></div></div>'
      : '<button class="add-btn" data-act="start-add-goal">+ Nueva meta</button>';
  }

  /* ---------- gráficos ---------- */
  const compact = (v) => v >= 1e6 ? (v / 1e6).toFixed(1).replace(".", ",").replace(",0", "") + " M" : v >= 1e3 ? Math.round(v / 1e3) + " mil" : String(v);
  function hbar(label, conf, pend, max, cls, valueText) {
    return '<div class="cb-row"><span class="cb-label">' + U.esc(label) + '</span><div class="cb-track">' +
      (conf > 0 ? '<span class="cb-seg ' + cls + '" style="width:' + (conf / max * 100) + '%"></span>' : "") +
      (pend > 0 ? '<span class="cb-seg ' + cls + ' pend" style="width:' + (pend / max * 100) + '%"></span>' : "") +
      '</div><span class="cb-val">' + valueText + "</span></div>";
  }
  function chartMonthHTML() {
    const inc = incomeParts(data, key());
    const expC = sum(data.expenses, (e) => e.paid), expP = sum(data.expenses, (e) => !e.paid);
    const max = Math.max(inc.conf + inc.pend, expC + expP, 1);
    let h = '<div class="chart-legend"><span><i class="sw inc"></i>Ingresos</span><span><i class="sw exp"></i>Gastos</span><span><i class="sw pend"></i>Pendiente</span></div>';
    h += hbar("Ingresos", inc.conf, inc.pend, max, "inc", "$" + U.fmt(inc.conf + inc.pend));
    h += hbar("Gastos", expC, expP, max, "exp", "$" + U.fmt(expC + expP));
    const items = data.expenses.filter((e) => num(e.amount) > 0).sort((a, b) => b.amount - a.amount);
    h += '<div class="chart-sub">En qué se va la plata</div>';
    if (!items.length) return h + '<p class="muted chart-empty">Cargá montos en tus gastos y los vas a ver acá.</p>';
    const top = items.slice(0, 7), rest = items.slice(7), imax = num(top[0].amount);
    top.forEach((e) => { h += hbar(e.name, e.paid ? num(e.amount) : 0, e.paid ? 0 : num(e.amount), imax, "exp", "$" + U.fmt(e.amount)); });
    if (rest.length) { const r = rest.reduce((s, e) => s + num(e.amount), 0); h += hbar("Otros", r, 0, imax, "exp", "$" + U.fmt(r)); }
    return h;
  }
  function topRound(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return "M" + x + "," + (y + h) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y + "H" + (x + w - r) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + "V" + (y + h) + "Z";
  }
  async function chartHistoryHTML(seq) {
    const keys = [];
    for (let i = 5; i >= 0; i--) keys.push(U.monthKey(new Date(current.getFullYear(), current.getMonth() - i, 1)));
    const recs = {}, all = [];
    for (let i = 11; i >= 0; i--) all.push(U.monthKey(new Date(current.getFullYear(), current.getMonth() - i, 1)));
    await Promise.all(all.map(async (k) => {
      if (k === key()) { recs[k] = data; return; }
      try { recs[k] = Object.assign(emptyMonth(), (await Backend.get("month-data:" + k)) || {}); } catch (e) { recs[k] = emptyMonth(); }
    }));
    const rows = keys.map((k) => ({ key: k, inc: incomeParts(recs[k], k, workItemsFor(k, (W) => recs[W] || null)).conf, exp: sum(recs[k].expenses || [], (e) => e.paid) }));
    if (seq !== chartSeq) return null;
    hist = rows;
    const maxV = Math.max(...rows.map((r) => Math.max(r.inc, r.exp)), 1);
    const step = Math.pow(10, Math.floor(Math.log10(maxV))), top = Math.ceil(maxV / step * 2) / 2 * step;
    const W = 340, H = 190, L = 40, B = 24, T = 10, R = 6, pw = W - L - R, ph = H - B - T, gw = pw / rows.length, bw = 13;
    let svg = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Ingresos y gastos de los últimos 6 meses" class="chart-svg">';
    [0, 0.5, 1].forEach((f) => {
      const y = T + ph - f * ph;
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="grid"/><text x="' + (L - 6) + '" y="' + (y + 3.5) + '" text-anchor="end" class="tick">' + (f ? "$" + compact(top * f) : "0") + "</text>";
    });
    rows.forEach((r, i) => {
      const cx = L + gw * i + gw / 2;
      [["inc", r.inc, cx - bw - 1], ["exp", r.exp, cx + 1]].forEach(([cls, v, x]) => {
        const h = v / top * ph;
        if (h > 0) svg += '<path d="' + topRound(x, T + ph - h, bw, h, 4) + '" class="bar ' + cls + '"><title>' + U.monthLabel(r.key) + " · " + (cls === "inc" ? "Ingresos" : "Gastos") + " $" + U.fmt(v) + "</title></path>";
      });
      svg += '<rect x="' + (cx - gw / 2) + '" y="' + T + '" width="' + gw + '" height="' + ph + '" fill="transparent" data-hi="' + i + '" style="cursor:pointer"/>';
      svg += '<text x="' + cx + '" y="' + (H - 7) + '" text-anchor="middle" class="tick' + (r.key === key() ? " now" : "") + '">' + U.MESES[Number(r.key.slice(5)) - 1].slice(0, 3) + "</text>";
    });
    svg += "</svg>";
    const table = '<div class="hist-table">' + rows.slice().reverse().map((r) =>
      "<div><span>" + U.monthLabel(r.key) + "</span><span>+$" + U.fmt(r.inc) + "</span><span>−$" + U.fmt(r.exp) + "</span></div>").join("") + "</div>";
    return '<div class="chart-legend"><span><i class="sw inc"></i>Ingresos cobrados</span><span><i class="sw exp"></i>Gastos pagados</span></div>' + svg +
      '<div class="chart-detail" id="eco-chart-detail">Tocá un mes para ver los montos.</div>' + table;
  }
  async function renderChart() {
    const box = $("eco-chart");
    if (chartMode === "month") { chartSeq++; box.innerHTML = chartMonthHTML(); return; }
    const seq = ++chartSeq, html = await chartHistoryHTML(seq);
    if (html !== null && seq === chartSeq) box.innerHTML = html;
  }

  /* ---------- pasar un ítem a otro mes (según su fecha) ---------- */
  async function moveToMonth(kind, item, dateIso) {
    const targetKey = (dateIso || "").slice(0, 7);
    if (!targetKey || targetKey === key()) return false;
    try {
      const target = Object.assign(emptyMonth(), (await Backend.get("month-data:" + targetKey)) || {});
      target[kind] = (target[kind] || []).concat([item]);
      await Backend.set("month-data:" + targetKey, target);
    } catch (e) { App.toast("No se pudo pasar al otro mes. Probá de nuevo."); return false; }
    data[kind] = data[kind].filter((x) => x.id !== item.id);
    openIncome = openExpense = null;
    monthSaver.schedule(); renderAll();
    App.toast("Pasó a " + U.monthLabel(targetKey) + ". Lo vas a ver en ese mes.");
    return true;
  }

  /* ---------- nota de un ingreso (burbuja) ---------- */
  function noteHolder(kind, id) {
    if (kind === "income") return find(data.incomes, id);
    if (kind === "expense") return find(data.expenses, id);
    if (kind === "work") { const r = wpRef(id); return r ? r.wp : null; }
    return (data.refundsMeta = data.refundsMeta || {});
  }
  function openNote(kind, id) {
    const h = noteHolder(kind, id); if (!h) return;
    const name = kind === "work" ? "Sueldo " + ((App.work.byId(String(id).split("~")[1]) || {}).name || "") : kind === "refunds" ? "Reintegros" : h.name;
    noteId = { kind, id }; $("note-title").textContent = "Nota · " + name; $("note-text").value = h.note || "";
    $("note-overlay").hidden = false; $("note-text").focus();
  }
  function closeNote() { $("note-overlay").hidden = true; noteId = null; }
  function saveNote() {
    const h = noteId && noteHolder(noteId.kind, noteId.id);
    if (h) {
      h.note = $("note-text").value.trim(); if (!h.note) delete h.note;
      if (noteId.kind === "work") saveWork(wpRef(noteId.id)); else monthSaver.schedule();
      renderIncomes(); renderExpenses();
    }
    closeNote();
  }

  /* ---------- gastos fijos: lista editable ---------- */
  function renderRec() {
    $("rec-list").innerHTML = recurring.map((n, i) => '<span class="person-chip">' + U.esc(n) + '<button data-recdel="' + i + '" aria-label="Quitar ' + U.esc(n) + '">✕</button></span>').join("") || '<span class="muted">Sin gastos fijos.</span>';
  }
  function addRec() {
    const inp = $("rec-new"), n = inp.value.trim();
    if (!n) return;
    if (!recurring.some((x) => x.toLowerCase() === n.toLowerCase())) { recurring.push(n); recSaver.schedule(); }
    inp.value = ""; renderRec(); renderExpenses(); inp.focus();
  }

  /* ---------- acciones ---------- */
  async function copyExpenses() {
    try {
      const prev = new Date(current); prev.setMonth(prev.getMonth() - 1);
      const s = await Backend.get("month-data:" + U.monthKey(prev));
      const names = new Set(data.expenses.map((e) => e.name.toLowerCase()));
      let added = 0;
      ((s && s.expenses) || []).forEach((e) => { if (!names.has(e.name.toLowerCase())) { data.expenses.push(newExpense(e.name)); added++; } });
      if (!added) App.toast("No hay gastos nuevos para copiar.");
      monthSaver.schedule(); renderAll();
    } catch (e) { App.toast("No se pudo copiar el mes anterior."); }
  }

  function exportExcel() {
    if (App.demo) { App.toast("En el tester no se descarga. En la app real baja un Excel."); return; }
    try {
      const t = totals(), wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
        "Mes": U.monthLabel(key()), "Ingresos cobrados": t.incomeConfirmed, "Ingresos proyectados": t.incomeConfirmed + t.incomePending,
        "Gastos pagados": t.expenseConfirmed, "Gastos proyectados": t.expenseConfirmed + t.expensePending,
        "Balance confirmado": t.incomeConfirmed - t.expenseConfirmed, "Ahorro acumulado (todas las metas)": goals.reduce((s, g) => s + num(g.saved), 0),
      }]), "Resumen");
      const inc = data.incomes.map((i) => ({ Ingreso: i.name, Detalle: "", Monto: num(i.amount), Cobrado: i.done ? "Sí" : "No", Fecha: i.doneDate || "" }));
      workItemsFor(key()).forEach((it) => {
        it.o.sessions.forEach((s) => inc.push({ Ingreso: "Sueldo " + it.o.job.name, Detalle: (s.person || "Sin persona") + " · " + (s.date || "mensual"), Monto: s.amount, Cobrado: isPaid(it.wp, s) ? "Sí" : "No", Fecha: it.wp.date || "" }));
      });
      data.expenses.filter((e) => e.refundOn).forEach((e) => inc.push({ Ingreso: "Reintegro", Detalle: e.name, Monto: refundAmt(e), Cobrado: e.refundDone ? "Sí" : "No", Fecha: e.refundDate || "" }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(inc), "Ingresos");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        data.expenses.map((e) => ({ Gasto: e.name, Monto: num(e.amount), Pagado: e.paid ? "Sí" : "No", "Fecha de pago": e.paidDate || "", Vencimiento: e.dueEnabled ? e.dueDate : "", Reintegro: e.refundOn ? refundAmt(e) : "" }))), "Gastos");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(goals.map((g) => ({ Meta: g.name, Ahorrado: num(g.saved), Objetivo: g.target, Fecha: g.deadline || "" }))), "Metas de ahorro");
      XLSX.writeFile(wb, "jardin-" + key() + ".xlsx");
    } catch (e) { App.toast("No se pudo generar el Excel."); }
  }

  /* ---------- importar movimientos de Mercado Pago ---------- */
  let impRows = [];
  const impKey = (r) => r.id + "|" + Math.round(r.amount * 100);
  const isYield = (r) => /^rendimientos/i.test(r.desc);
  const niceDesc = (r) => r.desc.replace(/^Devoluci[oó]n de pago\s*/i, "Devolución ").replace(/^Transferencia (recibida|enviada)\s*/i, "").replace(/^Pago de servicio\s*/i, "").replace(/^Pago con QR\s*/i, "").replace(/^Pago\s+/i, "").trim() || r.desc;
  let aliases = {};                                         // nombre de Mercado Pago -> nombre que le pusiste vos
  const aliasKey = (n) => String(n || "").trim().toLowerCase();
  const finalName = (r) => aliases[aliasKey(niceDesc(r))] || niceDesc(r);
  async function loadAliases() { try { aliases = (await Backend.get("mp-aliases")) || {}; } catch (e) { aliases = {}; } }
  function learnAlias(it, newName) {
    if (!it.orig || !newName || aliasKey(newName) === aliasKey(it.orig)) return;
    aliases[aliasKey(it.orig)] = newName;
    Backend.set("mp-aliases", aliases).catch(() => {});
  }
  const BIG = 20000;                                       // desde acá se compara con lo que ya cargaste a mano
  async function monthsFor(rows) {
    const out = {};
    for (const mk of [...new Set(rows.map((r) => r.date.slice(0, 7)))])
      out[mk] = mk === key() ? data : Object.assign(emptyMonth(), (await Backend.get("month-data:" + mk)) || {});
    return out;
  }
  // ¿hay algo parecido ya cargado a mano en ese mes? (mismo tipo y monto casi igual)
  function lookalike(r, m, mk) {
    const a = Math.abs(r.amount), close = (x) => Math.abs(x - a) <= Math.max(50, a * 0.01);
    if (r.amount > 0) {
      const i = (m.incomes || []).find((x) => !x.imp && close(num(x.amount))); if (i) return i.name;
      const w = workItemsFor(mk, (W) => (W === mk ? m : W === key() ? data : wcache[W] || null)).find((it) => close(it.o.amount)); if (w) return "Sueldo " + (w.o.job.name || "");
      const f = (m.expenses || []).find((e) => e.refundOn && close(refundAmt(e))); if (f) return "Reintegro " + f.name;
    } else {
      const e = (m.expenses || []).find((x) => !x.imp && close(num(x.amount))); if (e) return e.name;
    }
    return "";
  }
  async function startImport(rows) {
    if (!rows.length) { App.toast("No encontré movimientos en ese archivo. ¿Es el resumen de cuenta en pesos?"); return; }
    await loadAliases();
    let mm; try { mm = await monthsFor(rows); } catch (e) { App.toast("No se pudo revisar lo ya importado. Probá de nuevo."); return; }
    const done = new Set(); Object.values(mm).forEach((m) => (m.importedIds || []).forEach((x) => done.add(x)));
    impRows = rows.map((r) => {
      const dup = done.has(impKey(r)), like = !dup && Math.abs(r.amount) >= BIG ? lookalike(r, mm[r.date.slice(0, 7)], r.date.slice(0, 7)) : "";
      return { r, dup, like, on: !dup && !like && !($("imp-skip-yield").checked && isYield(r)) };
    });
    renderImport(); $("imp-overlay").hidden = false;
  }
  function renderImport() {
    const sel = impRows.filter((x) => x.on), inc = sel.filter((x) => x.r.amount > 0), exp = sel.filter((x) => x.r.amount < 0);
    const sum = (a) => a.reduce((s, x) => s + Math.abs(x.r.amount), 0);
    const dups = impRows.filter((x) => x.dup).length, likes = impRows.filter((x) => x.like).length;
    $("imp-sub").textContent = (App.demo ? "EJEMPLO DEL TESTER: en la app real acá elegís el archivo de tu resumen. " : "") + impRows.length + " movimientos" + (dups ? " · " + dups + " ya importados" : "") + ". Destildá los que no quieras sumar." + (likes ? " Los de monto grande que se parecen a algo que ya cargaste quedan destildados: si es lo mismo, dejalos así." : "");
    $("imp-list").innerHTML = impRows.map((x, i) => {
      const r = x.r, pos = r.amount > 0;
      return '<label class="imp-row' + (x.dup ? " dup" : "") + '"><input type="checkbox" data-i="' + i + '"' + (x.on ? " checked" : "") + (x.dup ? " disabled" : "") + ' />'
        + '<span class="imp-main"><span class="imp-desc">' + U.esc(finalName(r)) + '</span><span class="imp-date">' + U.fmtDM(r.date) + (x.dup ? " · ya importado" : "") + '</span>' + (x.like ? '<span class="imp-warn">¿Ya lo cargaste? Se parece a «' + U.esc(x.like) + '»</span>' : "") + '</span>'
        + '<span class="imp-amt ' + (pos ? "in" : "out") + '">' + (pos ? "+" : "−") + "$" + U.fmt(Math.round(Math.abs(r.amount))) + "</span></label>";
    }).join("");
    $("imp-ok").textContent = sel.length ? "Agregar " + sel.length + " (+$" + U.fmt(Math.round(sum(inc))) + " / −$" + U.fmt(Math.round(sum(exp))) + ")" : "Agregar";
    $("imp-ok").disabled = !sel.length;
  }
  async function confirmImport() {
    const sel = impRows.filter((x) => x.on).map((x) => x.r);
    if (!sel.length) return;
    $("imp-ok").disabled = true;
    try {
      const byMonth = {};
      sel.forEach((r) => { (byMonth[r.date.slice(0, 7)] = byMonth[r.date.slice(0, 7)] || []).push(r); });
      for (const mk of Object.keys(byMonth)) {
        const isCur = mk === key();
        const m = isCur ? data : Object.assign(emptyMonth(), (await Backend.get("month-data:" + mk)) || {});
        m.incomes = m.incomes || []; m.expenses = m.expenses || []; m.importedIds = m.importedIds || [];
        byMonth[mk].forEach((r) => {
          const amt = String(Math.max(1, Math.round(Math.abs(r.amount))));
          if (r.amount > 0) m.incomes.push({ id: U.uid(), name: finalName(r), orig: niceDesc(r), amount: amt, done: true, doneDate: r.date, imp: true });
          else m.expenses.push({ id: U.uid(), name: finalName(r), orig: niceDesc(r), amount: amt, paid: true, paidDate: r.date, dueEnabled: false, dueDate: "", imp: true });
          m.importedIds.push(impKey(r));
        });
        if (isCur) monthSaver.schedule(); else await Backend.set("month-data:" + mk, m);
      }
      $("imp-overlay").hidden = true;
      renderAll();
      App.toast("Listo: se agregaron " + sel.length + " movimientos.");
    } catch (e) { App.toast("No se pudo guardar la importación. Probá de nuevo."); }
    $("imp-ok").disabled = false;
  }
  async function onImportFile(file) {
    if (!file) return;
    App.toast("Leyendo el resumen…");
    try { await startImport(await MPImport.readPDF(file)); }
    catch (e) { App.toast("No pude leer ese archivo. Probá con el PDF del resumen de cuenta."); }
  }
  const demoRows = () => {
    const d = (n) => key() + "-" + String(n).padStart(2, "0");
    return [
      { id: "900000000001", date: d(2), desc: "Rendimientos", amount: 5.63 },
      { id: "900000000002", date: d(3), desc: "Pago SUBE", amount: -10000 },
      { id: "900000000003", date: d(5), desc: "Transferencia recibida Cliente Ejemplo", amount: 31450 },
      { id: "900000000004", date: d(6), desc: "Transferencia enviada Consultorio", amount: -60000 },
      { id: "900000000005", date: d(8), desc: "Transferencia recibida Otra Persona", amount: 200000 },
      { id: "900000000006", date: d(9), desc: "Pago con QR Panadería", amount: -5100 },
      { id: "900000000007", date: d(11), desc: "Transferencia enviada Kiosco", amount: -3700 },
    ];
  };

  function act(name, id, el) {
    if (name.indexOf("delete-") === 0 && name !== "delete-goal") {          // "Quitar": pide confirmar con un segundo toque
      if (armDel !== name + id) { armDel = name + id; renderAll(); return; }
      armDel = null;
    } else armDel = null;
    switch (name) {
      case "expand-imp-income": openImpInc = !openImpInc; renderIncomes(); break;
      case "expand-imp-expense": openImpExp = !openImpExp; renderExpenses(); break;
      case "import-pick": if (App.demo) startImport(demoRows()); else $("imp-file").click(); break;
      case "toggle-income": { const i = find(data.incomes, id); i.done = !i.done; if (i.done) i.doneDate = i.doneDate || U.today(); monthSaver.schedule(); renderAll(); break; }
      case "expand-income": openIncome = openIncome === id ? null : id; renderIncomes(); break;
      case "delete-income": data.incomes = data.incomes.filter((i) => i.id !== id); monthSaver.schedule(); renderAll(); break;
      case "note-income": openNote("income", id); break;
      case "note-expense": openNote("expense", id); break;
      case "note-work": openNote("work", id); break;
      case "note-refunds": openNote("refunds", id); break;
      case "edit-pkg": { editPkg = id; renderIncomes(); const pi = root().querySelector(".pkg-input"); if (pi) { pi.focus(); pi.select(); } break; }
      case "edit-amt": { editAmt = { k: el.dataset.k, id }; renderAll(); const inp = root().querySelector(".amount-input"); if (inp) { inp.focus(); inp.select(); } break; }
      case "edit-name": editName = { kind: el.dataset.kind, id }; renderIncomes(); renderExpenses(); { const inp = root().querySelector(".name-edit"); if (inp) { inp.focus(); inp.select(); } } break;
      case "start-add-income": addingIncome = true; renderIncomes(); focusId("eco-new-income-name"); break;
      case "confirm-add-income": {
        const n = $("eco-new-income-name").value.trim(), a = num(U.digits($("eco-new-income-amount").value));
        if (!n) { App.toast("Escribí un nombre para el ingreso."); break; }
        data.incomes.push({ id: U.uid(), name: n, amount: a, done: false, doneDate: "" });
        addingIncome = false; monthSaver.schedule(); renderAll(); break;
      }
      case "expand-work": openWork = openWork === id ? null : id; renderIncomes(); break;
      case "toggle-work": {
        const r = wpRef(id); if (!r) break;
        const o = App.work.summary(r.W).list.find((x) => x.job.id === r.jobId); if (!o) break;
        const all = splitOf(r.wp, o).all;
        r.wp.paid = {}; delete r.wp.done;
        if (!all) { o.sessions.forEach((x) => { r.wp.paid[x.key] = true; }); r.wp.date = r.wp.date || U.today(); }
        saveWork(r); renderAll(); if (!all) movedToast(r); break;
      }
      case "toggle-session": {
        const r = wpRef(id); if (!r) break;
        const o = App.work.summary(r.W).list.find((x) => x.job.id === r.jobId); if (!o) break;
        if (!r.wp.paid) { r.wp.paid = {}; if (r.wp.done) o.sessions.forEach((x) => { r.wp.paid[x.key] = true; }); delete r.wp.done; }
        const k = el.dataset.key; let added = false;
        if (r.wp.paid[k]) delete r.wp.paid[k]; else { r.wp.paid[k] = true; r.wp.date = r.wp.date || U.today(); added = true; }
        saveWork(r); renderAll(); if (added) movedToast(r); break;
      }
      case "expand-refunds": openRefunds = !openRefunds; renderIncomes(); break;
      case "toggle-refunds-all": { const list = data.expenses.filter((e) => e.refundOn), all = list.every((e) => e.refundDone); list.forEach((e) => { e.refundDone = !all; }); monthSaver.schedule(); renderAll(); break; }
      case "toggle-refund-one": { const e = find(data.expenses, id); e.refundDone = !e.refundDone; monthSaver.schedule(); renderAll(); break; }
      case "toggle-expense": { const x = find(data.expenses, id); x.paid = !x.paid; if (x.paid) x.paidDate = x.paidDate || U.today(); monthSaver.schedule(); renderAll(); break; }
      case "expand-expense": openExpense = openExpense === id ? null : id; renderExpenses(); break;
      case "delete-expense": data.expenses = data.expenses.filter((x) => x.id !== id); monthSaver.schedule(); renderAll(); break;
      case "toggle-due": { const x = find(data.expenses, id); x.dueEnabled = !x.dueEnabled; monthSaver.schedule(); renderExpenses(); break; }
      case "toggle-refund": { const x = find(data.expenses, id); x.refundOn = !x.refundOn; if (!x.refundOn) { x.refundDone = false; x.refundAmount = ""; } monthSaver.schedule(); renderAll(); break; }
      case "add-template": data.expenses.push(newExpense(el.dataset.name)); monthSaver.schedule(); renderAll(); break;
      case "start-add-expense": addingExpense = true; renderExpenses(); focusId("eco-new-expense-name"); break;
      case "confirm-add-expense": {
        const n = $("eco-new-expense-name").value.trim();
        if (!n) { App.toast("Escribí un nombre para el gasto."); break; }
        data.expenses.push(newExpense(n)); addingExpense = false; monthSaver.schedule(); renderAll(); break;
      }
      case "copy-expenses": copyExpenses(); break;
      case "edit-rec": renderRec(); $("rec-overlay").hidden = false; $("rec-new").focus(); break;
      case "delete-goal": goals = goals.filter((g) => g.id !== id); goalsSaver.schedule(); renderGoals(); break;
      case "start-contribute": contributingGoal = id; renderGoals(); focusId("eco-contrib-amount"); break;
      case "confirm-contribute": {
        const amt = num(U.digits($("eco-contrib-amount").value));
        if (amt > 0) {
          const g = find(goals, id); g.saved = num(g.saved) + amt;
          data.goalContributions.push({ id: U.uid(), goalId: id, goalName: g.name, amount: amt });
          goalsSaver.schedule(); monthSaver.schedule();
        }
        contributingGoal = null; renderAll(); break;
      }
      case "start-add-goal": addingGoal = true; renderGoals(); focusId("eco-new-goal-name"); break;
      case "confirm-add-goal": {
        const n = $("eco-new-goal-name").value.trim(), target = num(U.digits($("eco-new-goal-target").value));
        if (!n || !target) { App.toast("Completá el nombre y el monto objetivo."); break; }
        goals.push({ id: U.uid(), name: n, target, saved: 0, deadline: "" });
        addingGoal = false; goalsSaver.schedule(); renderGoals(); break;
      }
      case "cancel-add": addingIncome = addingExpense = addingGoal = false; contributingGoal = null; renderAll(); break;
      case "export": exportExcel(); break;
    }
  }
  const focusId = (id) => { const el = $(id); if (el) el.focus(); };

  function bind() {
    const r = root();
    r.addEventListener("click", (e) => {
      const t = e.target.closest("[data-etab]");
      if (t) { setTab(t.dataset.etab); return; }
      if (e.target.tagName === "INPUT") return;
      const el = e.target.closest("[data-act]");
      if (el) act(el.dataset.act, el.dataset.id, el);
    });
    $("eco-view-toggle").addEventListener("click", (e) => {
      const b = e.target.closest(".toggle-btn"); if (!b) return;
      viewMode = b.dataset.mode;
      document.querySelectorAll("#eco-view-toggle .toggle-btn").forEach((x) => x.classList.toggle("active", x === b));
      renderBalance();
    });
    r.addEventListener("focusout", (e) => { if (e.target.classList && e.target.classList.contains("pkg-input") && editPkg) { editPkg = null; setTimeout(renderAll, 0); } });
    r.addEventListener("focusout", (e) => { if (e.target.classList && e.target.classList.contains("amount-input")) { editAmt = null; setTimeout(renderAll, 0); } });
    r.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.classList.contains("pkg-input")) { e.preventDefault(); e.target.blur(); return; }
      if (e.key === "Enter" && e.target.classList.contains("amount-input")) { e.preventDefault(); e.target.blur(); return; }
      if (e.key === "Enter" && e.target.classList.contains("name-edit")) { e.preventDefault(); e.target.blur(); return; }
      if (e.key === "Enter" && e.target.dataset.enter) { e.preventDefault(); act(e.target.dataset.enter, e.target.dataset.id, e.target); }
    });
    r.addEventListener("input", (e) => {
      const kind = e.target.dataset.input;
      if (!kind) return;
      const clean = U.digits(e.target.value); e.target.value = clean;
      if (kind === "income-amount") find(data.incomes, e.target.dataset.id).amount = clean;
      else if (kind === "refund-amount") find(data.expenses, e.target.dataset.id).refundAmount = clean;
      else find(data.expenses, e.target.dataset.id).amount = clean;
      monthSaver.schedule(); renderBalance();
    });
    r.addEventListener("change", (e) => {
      const kind = e.target.dataset.change;
      if (!kind) return;
      const id = e.target.dataset.id, v = e.target.value;
      if (kind === "income-name" || kind === "expense-name") {
        const it = find(kind === "income-name" ? data.incomes : data.expenses, id);
        it.name = v.trim() || it.name; editName = null; if (it.imp) learnAlias(it, it.name);
        const span = document.createElement("span"); span.className = "row-text"; span.textContent = it.name;
        e.target.replaceWith(span);                         // se cambia el campo por el texto sin redibujar la lista
        monthSaver.schedule(); return;
      }
      if (kind === "income-date") { const it = find(data.incomes, id); it.doneDate = v; monthSaver.schedule(); moveToMonth("incomes", it, v).then((m) => { if (!m) renderIncomes(); }); return; }
      if (kind === "expense-due-date") { const it = find(data.expenses, id); it.dueDate = v; monthSaver.schedule(); renderExpenses(); moveToMonth("expenses", it, v); return; }
      if (kind === "expense-paid-date") { find(data.expenses, id).paidDate = v; renderExpenses(); }
      else if (kind === "work-pkg") {
        const r = wpRef(id); editPkg = null;
        if (r) { const n = Math.max(0, parseFloat(String(v).replace(",", ".")) || 0); if (n) r.wp.pkg = n; else delete r.wp.pkg; saveWork(r); }
        renderAll(); return;
      }
      else if (kind === "work-date") { const r = wpRef(id); if (r) { if (v) r.wp.date = v; else delete r.wp.date; saveWork(r); renderAll(); movedToast(r); } return; }
      else if (kind === "refund-date") { find(data.expenses, id).refundDate = v; renderIncomes(); }
      monthSaver.schedule();
    });
    $("rec-list").addEventListener("click", (ev) => { const b = ev.target.closest("[data-recdel]"); if (b) { recurring.splice(Number(b.dataset.recdel), 1); recSaver.schedule(); renderRec(); renderExpenses(); } });
    $("rec-add").addEventListener("click", addRec);
    $("rec-new").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); addRec(); } });
    $("rec-done").addEventListener("click", () => { $("rec-overlay").hidden = true; });
    $("rec-overlay").addEventListener("click", (ev) => { if (ev.target.id === "rec-overlay") $("rec-overlay").hidden = true; });
    $("note-cancel").addEventListener("click", closeNote);
    $("note-save").addEventListener("click", saveNote);
    $("note-overlay").addEventListener("click", (e) => { if (e.target.id === "note-overlay") closeNote(); });
    $("eco-chart-toggle").addEventListener("click", (e) => {
      const b = e.target.closest("[data-chart]"); if (!b) return;
      chartMode = b.dataset.chart;
      document.querySelectorAll("#eco-chart-toggle button").forEach((x) => x.classList.toggle("active", x === b));
      renderChart();
    });
    $("eco-chart").addEventListener("click", (e) => {
      const b = e.target.closest("[data-hi]"); if (!b) return;
      const h = hist[Number(b.dataset.hi)]; if (!h) return;
      $("eco-chart-detail").textContent = U.monthLabel(h.key) + " · Ingresos $" + U.fmt(h.inc) + " · Gastos $" + U.fmt(h.exp);
    });
    $("eco-prev").addEventListener("click", () => changeMonth(-1));
    $("eco-next").addEventListener("click", () => changeMonth(1));
  }
  $("imp-file").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; onImportFile(f); });
  $("imp-cancel").addEventListener("click", () => { $("imp-overlay").hidden = true; });
  $("imp-overlay").addEventListener("click", (e) => { if (e.target.id === "imp-overlay") $("imp-overlay").hidden = true; });
  $("imp-ok").addEventListener("click", confirmImport);
  $("imp-skip-yield").addEventListener("change", (e) => { impRows.forEach((x) => { if (!x.dup && isYield(x.r)) x.on = !e.target.checked; }); renderImport(); });
  $("imp-list").addEventListener("change", (e) => { const i = e.target.dataset.i; if (i !== undefined) { impRows[Number(i)].on = e.target.checked; renderImport(); } });
  bind();

  App.hooks.economia = renderAll;
  App.register("economia", { load, reset });
})();
