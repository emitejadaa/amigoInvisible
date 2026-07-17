const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { customAlphabet } = require('nanoid');

const PORT = process.env.PORT || 3000;
const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // sin 0/O/1/I para evitar confusiones
const generateRoomCode = customAlphabet(ROOM_CODE_ALPHABET, 5);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

/**
 * rooms: Map<code, {
 *   adminSocketId: string,
 *   adminName: string,
 *   adminParticipating: boolean,
 *   status: 'lobby' | 'drawn',
 *   participants: Map<socketId, { id, name }>
 * }>
 */
const rooms = new Map();

function publicParticipantList(room) {
  return Array.from(room.participants.values()).map((p) => ({ id: p.id, name: p.name }));
}

function broadcastParticipants(code) {
  const room = rooms.get(code);
  if (!room) return;
  const payload = {
    participants: publicParticipantList(room),
    adminName: room.adminName,
    adminParticipating: room.adminParticipating,
    status: room.status,
  };
  io.to(code).emit('participants_update', payload);
}

function normalizedName(name) {
  return String(name || '').trim();
}

function nameTaken(room, name, excludeSocketId) {
  const target = name.toLowerCase();
  if (room.adminName.toLowerCase() === target) return true;
  for (const [socketId, p] of room.participants) {
    if (socketId === excludeSocketId) continue;
    if (p.name.toLowerCase() === target) return true;
  }
  return false;
}

// Fisher-Yates derangement: baraja hasta que nadie quede asignado a si mismo.
function computeAssignments(entries) {
  const n = entries.length;
  const indices = entries.map((_, i) => i);
  let shuffled;
  let attempts = 0;
  do {
    shuffled = [...indices];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    attempts++;
  } while (shuffled.some((v, i) => v === i) && attempts < 200);

  if (shuffled.some((v, i) => v === i)) {
    // fallback determinista: rotar en 1, siempre valido para n >= 2
    shuffled = indices.map((_, i) => (i + 1) % n);
  }

  const assignments = new Map();
  entries.forEach((giver, i) => {
    assignments.set(giver.socketId, entries[shuffled[i]]);
  });
  return assignments;
}

io.on('connection', (socket) => {
  socket.data.roomCode = null;
  socket.data.isAdmin = false;

  socket.on('create_room', ({ adminName }, callback) => {
    const name = normalizedName(adminName);
    if (!name) return callback({ error: 'Ingresá tu nombre.' });

    let code;
    do {
      code = generateRoomCode();
    } while (rooms.has(code));

    rooms.set(code, {
      adminSocketId: socket.id,
      adminName: name,
      adminParticipating: false,
      status: 'lobby',
      participants: new Map(),
    });

    socket.data.roomCode = code;
    socket.data.isAdmin = true;
    socket.join(code);

    callback({ code, adminName: name });
    broadcastParticipants(code);
  });

  socket.on('join_room', ({ code, name }, callback) => {
    const roomCode = String(code || '').trim().toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return callback({ error: 'La sala no existe.' });
    if (room.status !== 'lobby') return callback({ error: 'El sorteo ya se realizó, no se puede unir.' });

    const cleanName = normalizedName(name);
    if (!cleanName) return callback({ error: 'Ingresá tu nombre.' });
    if (nameTaken(room, cleanName)) return callback({ error: 'Ese nombre ya está en uso en la sala.' });

    room.participants.set(socket.id, { id: socket.id, name: cleanName });
    socket.data.roomCode = roomCode;
    socket.data.isAdmin = false;
    socket.join(roomCode);

    callback({ code: roomCode, name: cleanName });
    broadcastParticipants(roomCode);
  });

  socket.on('toggle_admin_participate', ({ participate }) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || !socket.data.isAdmin) return;
    if (room.status !== 'lobby') return;
    room.adminParticipating = Boolean(participate);
    broadcastParticipants(code);
  });

  socket.on('kick_participant', ({ participantId }) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || !socket.data.isAdmin) return;
    if (!room.participants.has(participantId)) return;

    room.participants.delete(participantId);
    const kickedSocket = io.sockets.sockets.get(participantId);
    if (kickedSocket) {
      kickedSocket.emit('kicked');
      kickedSocket.leave(code);
      kickedSocket.data.roomCode = null;
    }
    broadcastParticipants(code);
  });

  socket.on('start_draw', (_payload, callback) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || !socket.data.isAdmin) return callback({ error: 'No autorizado.' });
    if (room.status !== 'lobby') return callback({ error: 'El sorteo ya se realizó.' });

    const entries = Array.from(room.participants.values()).map((p) => ({
      socketId: p.id,
      name: p.name,
    }));
    if (room.adminParticipating) {
      entries.push({ socketId: room.adminSocketId, name: room.adminName });
    }

    if (entries.length < 2) {
      return callback({ error: 'Se necesitan al menos 2 participantes para sortear.' });
    }

    const assignments = computeAssignments(entries);
    room.status = 'drawn';

    for (const [socketId, assigned] of assignments) {
      io.to(socketId).emit('draw_result', { assignedName: assigned.name });
    }

    callback({ ok: true });
    broadcastParticipants(code);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (socket.data.isAdmin) {
      io.to(code).emit('room_closed');
      rooms.delete(code);
      return;
    }

    if (room.participants.delete(socket.id)) {
      broadcastParticipants(code);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Amigo Invisible corriendo en http://localhost:${PORT}`);
});
