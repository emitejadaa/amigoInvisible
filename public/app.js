const socket = io();

let state = {
  role: null, // 'admin' | 'participant'
  code: null,
};

const views = {
  home: document.getElementById('view-home'),
  admin: document.getElementById('view-admin'),
  participant: document.getElementById('view-participant'),
  message: document.getElementById('view-message'),
};

function showView(name) {
  Object.values(views).forEach((v) => v.classList.remove('active'));
  views[name].classList.add('active');
}

function showMessage(text) {
  document.getElementById('message-text').textContent = text;
  showView('message');
}

// --- Home: crear sala ---
document.getElementById('btn-create').addEventListener('click', () => {
  const adminName = document.getElementById('create-name').value;
  const errorEl = document.getElementById('home-error');
  errorEl.textContent = '';

  socket.emit('create_room', { adminName }, (res) => {
    if (res.error) {
      errorEl.textContent = res.error;
      return;
    }
    state.role = 'admin';
    state.code = res.code;
    document.getElementById('admin-room-code').textContent = res.code;
    showView('admin');
  });
});

// --- Home: unirse a sala ---
document.getElementById('btn-join').addEventListener('click', () => {
  const code = document.getElementById('join-code').value;
  const name = document.getElementById('join-name').value;
  const errorEl = document.getElementById('home-error');
  errorEl.textContent = '';

  socket.emit('join_room', { code, name }, (res) => {
    if (res.error) {
      errorEl.textContent = res.error;
      return;
    }
    state.role = 'participant';
    state.code = res.code;
    document.getElementById('participant-room-code').textContent = res.code;
    showView('participant');
  });
});

// --- Admin: participar toggle ---
document.getElementById('admin-participate').addEventListener('change', (e) => {
  socket.emit('toggle_admin_participate', { participate: e.target.checked });
});

// --- Admin: sortear ---
document.getElementById('btn-draw').addEventListener('click', () => {
  const errorEl = document.getElementById('admin-error');
  errorEl.textContent = '';

  socket.emit('start_draw', {}, (res) => {
    if (res.error) {
      errorEl.textContent = res.error;
      return;
    }
    document.getElementById('admin-result').textContent =
      'Sorteo realizado. Cada participante ya puede ver su resultado en su celular.';
    document.getElementById('btn-draw').disabled = true;
  });
});

// --- Actualización en vivo de participantes ---
socket.on('participants_update', (payload) => {
  const { participants, adminName, adminParticipating, status } = payload;

  if (state.role === 'admin') {
    document.getElementById('participant-count').textContent = participants.length;

    const checkbox = document.getElementById('admin-participate');
    if (checkbox.checked !== adminParticipating) checkbox.checked = adminParticipating;
    checkbox.disabled = status !== 'lobby';

    const list = document.getElementById('participant-list');
    list.innerHTML = '';
    participants.forEach((p) => {
      const li = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.name;
      li.appendChild(nameSpan);

      if (status === 'lobby') {
        const kickBtn = document.createElement('button');
        kickBtn.textContent = 'Echar';
        kickBtn.className = 'kick-btn';
        kickBtn.addEventListener('click', () => {
          socket.emit('kick_participant', { participantId: p.id });
        });
        li.appendChild(kickBtn);
      }
      list.appendChild(li);
    });

    const total = participants.length + (adminParticipating ? 1 : 0);
    const drawBtn = document.getElementById('btn-draw');
    drawBtn.disabled = status !== 'lobby' || total < 2;
  }

  if (state.role === 'participant') {
    const list = document.getElementById('participant-list-view');
    list.innerHTML = '';
    const names = participants.map((p) => p.name);
    if (adminParticipating) names.push(`${adminName} (admin)`);
    names.forEach((n) => {
      const li = document.createElement('li');
      li.textContent = n;
      list.appendChild(li);
    });
  }
});

// --- Resultado privado del sorteo ---
socket.on('draw_result', ({ assignedName }) => {
  if (state.role === 'participant') {
    document.getElementById('waiting-card').classList.add('hidden');
    const resultCard = document.getElementById('result-card');
    resultCard.classList.remove('hidden');
    document.getElementById('assigned-name').textContent = assignedName;
  } else if (state.role === 'admin') {
    document.getElementById('admin-result').textContent =
      `Sorteo realizado. A vos te tocó regalarle a: ${assignedName}`;
  }
});

// --- Expulsión / cierre de sala ---
socket.on('kicked', () => {
  showMessage('Fuiste expulsado de la sala por el admin.');
});

socket.on('room_closed', () => {
  showMessage('El admin cerró la sala.');
});

document.getElementById('btn-back').addEventListener('click', () => {
  window.location.reload();
});
