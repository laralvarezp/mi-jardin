/* ============================================================
   Conexión con Supabase (login + guardado de datos).
   Es el ÚNICO archivo que habla con Supabase: el resto de la app
   usa el objeto Backend. Guarda todo en la tabla jardin_data
   (una fila por "clave": month-data:2026-10, goals, habits...).
   ============================================================ */

// Se lee ANTES de crear el cliente, que borra el hash de la URL.
const INITIAL_HASH = window.location.hash || "";

// Nombre "sb" para no chocar con window.supabase de la librería.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const TABLE = "jardin_data";

const Backend = {
  demo: false,
  initialHash: INITIAL_HASH,

  // Avisa cada vez que cambia la sesión. Va con setTimeout para no
  // trabar la librería si el callback hace pedidos a Supabase.
  onAuth(callback) {
    sb.auth.onAuthStateChange((event, session) => {
      setTimeout(() => callback(event, session), 0);
    });
  },
  async getSession() {
    const { data } = await sb.auth.getSession();
    return data.session;
  },
  signIn(email, password) {
    return sb.auth.signInWithPassword({ email, password });
  },
  // El enlace del mail vuelve a esta misma página (por eso hay que agregarla en Supabase > Redirect URLs).
  signUp(email, password) {
    return sb.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
  },
  signOut() {
    return sb.auth.signOut();
  },
  resetPassword(email) {
    return sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  },
  updatePassword(password) {
    return sb.auth.updateUser({ password });
  },

  async get(key) {
    const { data, error } = await sb
      .from(TABLE)
      .select("data_value")
      .eq("data_key", key)
      .maybeSingle();
    if (error) throw error;
    return data ? data.data_value : null;
  },
  async set(key, value) {
    const { data } = await sb.auth.getSession();
    if (!data.session) throw new Error("Sin sesión");
    const { error } = await sb.from(TABLE).upsert(
      {
        user_id: data.session.user.id,
        data_key: key,
        data_value: value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,data_key" }
    );
    if (error) throw error;
  },
};
