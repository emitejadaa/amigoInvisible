const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.AMIGO_CONFIG;
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SESSION_KEY = "amigo_session";

let state = {
  role: null, // 'admin' | 'participant'
  code: null,
  adminToken: null, // admin
  participantId: null, // participant
  token: null, // participant token
  name: null,
};
let channel = null;

const views = {
  home: document.getElementById("view-home"),
  admin: document.getElementById("view-admin"),
  participant: document.getElementById("view-participant"),
  message: document.getElementById("view-message"),
};

function showView(name) {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  views[name].classList.add("active");
}

function showMessage(text) {
  document.getElementById("message-text").textContent = text;
  showView("message");
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify(state));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// Llamada a la Edge Function
async function fn(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("amigo", {
    body: { action, ...payload },
  });
  if (error) {
    // El cuerpo de error de la función (4xx) viene en error.context
    try {
      const body = await error.context.json();
      if (body && body.error) return { error: body.error };
    } catch (_) { /* noop */ }
    return { error: "No se pudo conectar con el servidor." };
  }
  return data;
}

// ---------- Crear sala ----------
document.getElementById("btn-create").addEventListener("click", async () => {
  const adminName = document.getElementById("create-name").value.trim();
  const errorEl = document.getElementById("home-error");
  errorEl.textContent = "";
  if (!adminName) { errorEl.textContent = "Ingresá tu nombre."; return; }

  const res = await fn("create_room", { adminName });
  if (res.error) { errorEl.textContent = res.error; return; }

  state = {
    role: "admin",
    code: res.code,
    adminToken: res.adminToken,
    participantId: null,
    token: res.adminToken, // el admin usa su adminToken para my_result
    name: adminName,
  };
  saveSession();
  enterAdmin();
});

// ---------- Unirse a sala ----------
document.getElementById("btn-join").addEventListener("click", async () => {
  const code = document.getElementById("join-code").value.trim().toUpperCase();
  const name = document.getElementById("join-name").value.trim();
  const errorEl = document.getElementById("home-error");
  errorEl.textContent = "";
  if (!code || !name) { errorEl.textContent = "Completá el código y tu nombre."; return; }

  const res = await fn("join_room", { code, name });
  if (res.error) { errorEl.textContent = res.error; return; }

  state = {
    role: "participant",
    code: res.code,
    adminToken: null,
    participantId: res.participantId,
    token: res.token,
    name: res.name,
  };
  saveSession();
  enterParticipant();
});

// ---------- Entrar a la vista de admin ----------
async function enterAdmin() {
  document.getElementById("admin-room-code").textContent = state.code;
  showView("admin");
  subscribe();
  await refreshRoom();
  await refreshRoster();
}

// ---------- Entrar a la vista de participante ----------
async function enterParticipant() {
  document.getElementById("participant-room-code").textContent = state.code;
  showView("participant");
  subscribe();
  await refreshRoom();
  await refreshRoster();
}

// ---------- Realtime ----------
function subscribe() {
  if (channel) supabase.removeChannel(channel);
  channel = supabase
    .channel("room:" + state.code)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "participants", filter: "code=eq." + state.code },
      (payload) => {
        if (
          state.role === "participant" &&
          payload.eventType === "DELETE" &&
          payload.old &&
          payload.old.id === state.participantId
        ) {
          onKicked();
          return;
        }
        refreshRoster();
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "rooms", filter: "code=eq." + state.code },
      (payload) => { applyRoom(payload.new); },
    )
    .subscribe();
}

// ---------- Estado de sala ----------
async function refreshRoom() {
  const { data } = await supabase
    .from("rooms")
    .select("admin_name, admin_participating, status")
    .eq("code", state.code)
    .maybeSingle();
  if (data) applyRoom(data);
}

let lastStatus = "lobby";

function applyRoom(room) {
  if (!room) return;

  if (state.role === "admin") {
    const checkbox = document.getElementById("admin-participate");
    if (checkbox.checked !== room.admin_participating) {
      checkbox.checked = room.admin_participating;
    }
    checkbox.disabled = room.status !== "lobby";
    updateDrawButton(room.status);
  }

  if (state.role === "participant") {
    state._adminName = room.admin_name;
    state._adminParticipating = room.admin_participating;
    refreshRoster();
    if (room.status === "drawn" && lastStatus !== "drawn") {
      fetchResult();
    }
  }

  lastStatus = room.status;
}

// ---------- Roster ----------
async function refreshRoster() {
  const { data } = await supabase
    .from("participants")
    .select("id, name")
    .eq("code", state.code)
    .order("created_at", { ascending: true });
  const participants = data || [];

  if (state.role === "admin") {
    document.getElementById("participant-count").textContent = participants.length;
    const list = document.getElementById("participant-list");
    list.innerHTML = "";
    participants.forEach((p) => {
      const li = document.createElement("li");
      const nameSpan = document.createElement("span");
      nameSpan.textContent = p.name;
      li.appendChild(nameSpan);
      if (lastStatus === "lobby") {
        const kickBtn = document.createElement("button");
        kickBtn.textContent = "Echar";
        kickBtn.className = "kick-btn";
        kickBtn.addEventListener("click", () => kickParticipant(p.id));
        li.appendChild(kickBtn);
      }
      list.appendChild(li);
    });
    updateDrawButton(lastStatus, participants.length);
  }

  if (state.role === "participant") {
    const list = document.getElementById("participant-list-view");
    list.innerHTML = "";
    const names = participants.map((p) => p.name);
    if (state._adminParticipating && state._adminName) {
      names.push(state._adminName + " (admin)");
    }
    names.forEach((n) => {
      const li = document.createElement("li");
      li.textContent = n;
      list.appendChild(li);
    });
  }
}

function updateDrawButton(status, count) {
  const drawBtn = document.getElementById("btn-draw");
  const checkbox = document.getElementById("admin-participate");
  const roster = typeof count === "number"
    ? count
    : parseInt(document.getElementById("participant-count").textContent, 10) || 0;
  const total = roster + (checkbox.checked ? 1 : 0);
  drawBtn.disabled = status !== "lobby" || total < 2;
}

// ---------- Acciones de admin ----------
document.getElementById("admin-participate").addEventListener("change", async (e) => {
  await fn("toggle_participate", {
    code: state.code,
    adminToken: state.adminToken,
    participate: e.target.checked,
  });
  updateDrawButton(lastStatus);
});

async function kickParticipant(participantId) {
  await fn("kick", { code: state.code, adminToken: state.adminToken, participantId });
}

document.getElementById("btn-draw").addEventListener("click", async () => {
  const errorEl = document.getElementById("admin-error");
  errorEl.textContent = "";
  document.getElementById("btn-draw").disabled = true;

  const res = await fn("start_draw", { code: state.code, adminToken: state.adminToken });
  if (res.error) {
    errorEl.textContent = res.error;
    document.getElementById("btn-draw").disabled = false;
    return;
  }

  // Si el admin participa, mostrarle a quién le tocó
  const result = await fn("my_result", { code: state.code, token: state.adminToken });
  if (result.receiverName) {
    document.getElementById("admin-result").textContent =
      "Sorteo realizado. A vos te tocó regalarle a: " + result.receiverName;
  } else {
    document.getElementById("admin-result").textContent =
      "Sorteo realizado. Cada participante ya puede ver su resultado en su celular.";
  }
});

// ---------- Resultado del participante ----------
async function fetchResult() {
  const res = await fn("my_result", { code: state.code, token: state.token });
  if (res.receiverName) {
    document.getElementById("waiting-card").classList.add("hidden");
    const resultCard = document.getElementById("result-card");
    resultCard.classList.remove("hidden");
    document.getElementById("assigned-name").textContent = res.receiverName;
  }
}

// ---------- Expulsado ----------
function onKicked() {
  clearSession();
  if (channel) supabase.removeChannel(channel);
  showMessage("Fuiste expulsado de la sala por el admin.");
}

document.getElementById("btn-back").addEventListener("click", () => {
  clearSession();
  window.location.reload();
});

// ---------- Restaurar sesión (refresh de página) ----------
async function restoreSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return;
  try {
    state = JSON.parse(raw);
  } catch {
    clearSession();
    return;
  }

  // Verificar que la sala siga existiendo
  const { data: room } = await supabase
    .from("rooms")
    .select("status")
    .eq("code", state.code)
    .maybeSingle();
  if (!room) { clearSession(); return; }

  if (state.role === "admin") {
    await enterAdmin();
  } else {
    // Verificar que el participante no haya sido expulsado
    const { data: me } = await supabase
      .from("participants")
      .select("id")
      .eq("id", state.participantId)
      .maybeSingle();
    if (!me && room.status === "lobby") { onKicked(); return; }
    await enterParticipant();
    if (room.status === "drawn") await fetchResult();
  }
}

restoreSession();
