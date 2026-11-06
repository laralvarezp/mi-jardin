/* ============================================================
   Mi Jardín — núcleo de la app
   Acá viven: utilidades, navegación entre pantallas, sesión
   (iniciar sesión / recuperar contraseña) y guardado automático.
   Cada módulo (economia.js, habitos.js, diaadia.js) se registra
   con App.register(...) y se puede editar por separado.
   ============================================================ */

const $ = (id) => document.getElementById(id);

/* ---------- utilidades ---------- */
const U = {
  MESES: ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"],
  DOW: ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"],
  pad: (n) => String(n).padStart(2, "0"),
  // Fechas siempre en hora local (no UTC): "2026-10-15"
  iso(d) { return d.getFullYear() + "-" + U.pad(d.getMonth() + 1) + "-" + U.pad(d.getDate()); },
  parse(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); },
  today() { return U.iso(new Date()); },
  addDays(iso, n) { const d = U.parse(iso); d.setDate(d.getDate() + n); return U.iso(d); },
  dow(iso) { return (U.parse(iso).getDay() + 6) % 7; },          // 0 = lunes
  weekStart(iso) { return U.addDays(iso, -U.dow(iso)); },
  monthKey(d) { return d.getFullYear() + "-" + U.pad(d.getMonth() + 1); },
  monthLabel(key) { const [y, m] = key.split("-").map(Number); return U.MESES[m - 1] + " " + y; },
  fmtDM(iso) { if (!iso) return ""; const p = iso.split("-"); return p[2] + "/" + p[1]; },
  fmt(n) { return (Number(n) || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 }); },
  digits(s) { return String(s).replace(/[^0-9]/g, ""); },
  uid() { return Math.random().toString(36).slice(2, 10); },
  esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  },
  daysUntil(iso) { return Math.round((U.parse(iso) - U.parse(U.today())) / 86400000); },
  hslHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const to = (x) => Math.round(255 * x).toString(16).padStart(2, "0");
    return "#" + to(f(0)) + to(f(8)) + to(f(4));
  },
  hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  },
};

const App = {
  demo: !!Backend.demo,
  user: null,
  modules: {},
  hooks: {},
  savers: [],
  recovering: /type=recovery/.test(Backend.initialHash),
  signupConfirmed: /type=signup/.test(Backend.initialHash),
};

/* ---------- paleta de colores (tonos apagados, todos los matices) ---------- */
const HUES = [6, 28, 46, 72, 112, 168, 208, 254, 316];
const TONES = [[30, 38], [34, 50], [38, 64], [42, 76]];       // [saturación, luminosidad]
const NEUTRALS = ["#4B3B2E", "#6B5645", "#8C7355", "#B39B7C", "#8A8A7A", "#A39F92", "#B7B3A6", "#CBC5B4", "#DDD7C6"];
App.sw = (hue, tone) => U.hslHex(hue, TONES[tone][0], TONES[tone][1]);
App.PALETTE = TONES.flatMap((_, ti) => HUES.map((h) => App.sw(h, ti))).concat(NEUTRALS);
App.NEUTRALS = NEUTRALS;
// HTML de una paleta; cada muestra lleva data-color="#rrggbb"
App.paletteHTML = (current) => {
  const list = App.PALETTE.includes(current) ? App.PALETTE : [current].concat(App.PALETTE);
  return list.map((c) => '<button type="button" class="swatch' + (c === current ? " sel" : "") +
    '" data-color="' + c + '" style="background:' + c + '" aria-label="Color ' + c + '"></button>').join("");
};

/* ---------- avisos ---------- */
let toastTimer = null;
App.toast = (msg) => {
  const el = $("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
};

/* ---------- guardado automático ---------- */
// canSave() evita pisar datos si la carga inicial falló.
App.makeSaver = (getKey, getValue, canSave) => {
  let timer = null, dirty = false;
  const saver = {
    async flush() {
      clearTimeout(timer); timer = null;
      if (!dirty) return;
      if (canSave && !canSave()) { dirty = false; return; }
      dirty = false;
      try { await Backend.set(getKey(), getValue()); }
      catch (e) { dirty = true; App.toast("No se pudo guardar. Revisá tu conexión."); }
    },
    schedule() { dirty = true; clearTimeout(timer); timer = setTimeout(saver.flush, 400); },
  };
  App.savers.push(saver);
  return saver;
};
App.flushAll = () => Promise.all(App.savers.map((s) => s.flush()));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") App.flushAll(); });
window.addEventListener("pagehide", () => { App.flushAll(); });

/* ---------- módulos y navegación ---------- */
App.register = (name, mod) => { App.modules[name] = mod; };

App.go = (name) => {
  App.flushAll();
  App.screen = name;
  document.querySelectorAll("[data-screen]").forEach((s) => { s.hidden = s.dataset.screen !== name; });
  if (App.hooks[name]) App.hooks[name]();
  if (name === "home") App.renderHome();
  window.scrollTo(0, 0);
};

// Los módulos lo llaman cuando algo cambia, para que "Hoy" se actualice si está a la vista.
App.refreshHome = () => { if (App.screen === "home") App.renderHome(); };

App.renderHome = () => {
  $("home-date").textContent = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  Object.keys(App.modules).forEach((n) => {
    const el = $("teaser-" + n), m = App.modules[n];
    if (el && m.teaser) el.textContent = m.teaser();
  });
  $("user-email").textContent = App.user ? App.user.email : "";
  $("demo-note").hidden = !App.demo;
  if (App.renderToday) App.renderToday();
};

document.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) App.go(go.dataset.go);
});

/* ---------- acceso ---------- */
const AUTH_SUB = {
  login: "Ingresá con tu email para guardar tus datos.",
  forgot: "Te mandamos un enlace para crear una contraseña nueva.",
  recovery: "Elegí tu contraseña nueva.",
};
function authMsg(text, ok) {
  const el = $("auth-msg");
  el.textContent = text || "";
  el.classList.toggle("ok", !!ok);
}
function showAuth(mode) {
  $("app").hidden = true;
  $("auth-screen").hidden = false;
  $("auth-form-login").hidden = mode !== "login";
  $("auth-form-forgot").hidden = mode !== "forgot";
  $("auth-form-recovery").hidden = mode !== "recovery";
  $("auth-sub").textContent = AUTH_SUB[mode];
}
function translateAuthError(msg) {
  const m = String(msg || "").toLowerCase();
  if (m.includes("invalid login")) return "El email o la contraseña no coinciden.";
  if (m.includes("not confirmed")) return "Falta confirmar el email. Revisá tu bandeja de entrada.";
  if (m.includes("rate limit")) return "Se enviaron muchos mails seguidos. Probá de nuevo en un rato.";
  if (m.includes("at least 6")) return "La contraseña tiene que tener al menos 6 caracteres.";
  if (m.includes("already registered")) return "Ese email ya tiene una cuenta. Probá iniciar sesión.";
  if (m.includes("same password") || m.includes("different from the old")) return "La contraseña nueva tiene que ser distinta de la anterior.";
  if (m.includes("valid email") || m.includes("invalid format")) return "Escribí un email válido.";
  return msg || "Algo salió mal. Probá de nuevo.";
}

async function enterApp(session) {
  if (App.user && App.user.id === session.user.id) return;   // evita recargar en cada refresco de sesión
  App.user = session.user;
  $("auth-screen").hidden = true;
  $("app").hidden = false;
  authMsg("");
  await Promise.all(Object.keys(App.modules).map((n) => App.modules[n].load && App.modules[n].load()));
  App.go("home");
  // enlaces directos (los usa el widget del iPhone): ?go=diaadia, ?go=habitos, ?go=economia
  const ALIAS = { agenda: "diaadia", diaadia: "diaadia", dia: "diaadia", habitos: "habitos", habito: "habitos", economia: "economia", plata: "economia", trabajos: "trabajos" };
  const goTo = ALIAS[String(new URLSearchParams(window.location.search).get("go") || "").toLowerCase().trim()];
  if (goTo) {
    App.go(goTo);
    try { window.history.replaceState(null, "", window.location.pathname + window.location.hash); } catch (e) { /* sin historial */ }
  }
  if (App.signupConfirmed) {
    App.signupConfirmed = false;
    $("welcome-banner").hidden = false;
    setTimeout(() => { $("welcome-banner").hidden = true; }, 5000);
  }
}
function leaveApp() {
  App.user = null;
  Object.keys(App.modules).forEach((n) => App.modules[n].reset && App.modules[n].reset());
}

function handleAuth(event, session) {
  if (event === "PASSWORD_RECOVERY") App.recovering = true;
  if (session && App.recovering) { showAuth("recovery"); return; }
  if (session) { enterApp(session); return; }
  if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
    leaveApp();
    showAuth("login");
    if (/error=|error_code=/.test(Backend.initialHash)) {
      authMsg("El enlace no es válido o venció. Pedí uno nuevo con «¿Olvidaste tu contraseña?».");
    }
  }
}

function bindAuth() {
  $("auth-form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("auth-email").value.trim(), pw = $("auth-password").value;
    if (!email || !pw) { authMsg("Completá el email y la contraseña."); return; }
    authMsg("Ingresando…", true);
    const { error } = await Backend.signIn(email, pw);
    if (error) authMsg(translateAuthError(error.message));
  });
  $("auth-signup-btn").addEventListener("click", async () => {
    const email = $("auth-email").value.trim(), pw = $("auth-password").value;
    if (!email || !pw) { authMsg("Completá el email y la contraseña."); return; }
    authMsg("Creando tu cuenta…", true);
    const { error } = await Backend.signUp(email, pw);
    if (error) authMsg(translateAuthError(error.message));
    else authMsg("Cuenta creada. Revisá tu email para confirmarla.", true);
  });
  $("auth-forgot-link").addEventListener("click", () => {
    $("auth-forgot-email").value = $("auth-email").value;
    authMsg(""); showAuth("forgot");
  });
  $("auth-back-link").addEventListener("click", () => { authMsg(""); showAuth("login"); });
  $("auth-form-forgot").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("auth-forgot-email").value.trim();
    if (!email) { authMsg("Escribí tu email."); return; }
    authMsg("Enviando…", true);
    const { error } = await Backend.resetPassword(email);
    if (error) authMsg(translateAuthError(error.message));
    else authMsg("Listo. Si ese email tiene cuenta, te llegó un enlace para crear la contraseña nueva.", true);
  });
  $("auth-form-recovery").addEventListener("submit", async (e) => {
    e.preventDefault();
    const a = $("auth-new-password").value, b = $("auth-new-password2").value;
    if (a.length < 6) { authMsg("La contraseña tiene que tener al menos 6 caracteres."); return; }
    if (a !== b) { authMsg("Las dos contraseñas tienen que ser iguales."); return; }
    authMsg("Guardando…", true);
    const { error } = await Backend.updatePassword(a);
    if (error) { authMsg(translateAuthError(error.message)); return; }
    App.recovering = false;
    $("auth-new-password").value = ""; $("auth-new-password2").value = "";
    try { history.replaceState(null, "", window.location.pathname); } catch (err) { /* sin historial */ }
    const session = await Backend.getSession();
    if (session) { await enterApp(session); App.toast("Contraseña actualizada."); }
    else { showAuth("login"); authMsg("Contraseña actualizada. Ya podés iniciar sesión.", true); }
  });
  $("logout-btn").addEventListener("click", async () => {
    await App.flushAll();
    await Backend.signOut();
  });
}

App.start = () => {
  bindAuth();
  Backend.onAuth(handleAuth);
  Backend.getSession().then((s) => handleAuth("INITIAL_SESSION", s));
};
