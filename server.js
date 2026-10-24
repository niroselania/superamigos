const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const CARDS = require('./data/cards.json');

const PORT = process.env.PORT || 3000;
const ATTRS = ['altura', 'peso', 'fuerza', 'peleas', 'velocidad'];
const MAX_PLAYERS = 3;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O

const rooms = new Map();

// ---------- utilidades ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
const uid = () => crypto.randomBytes(6).toString('hex');
const cleanName = (n) => String(n || '').trim().slice(0, 16) || 'Jugador';
const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

// ---------- estado de sala ----------
function createRoom() {
  const room = {
    code: newCode(),
    players: [],
    hostId: null,
    phase: 'lobby', // lobby | choose | reveal | over
    turnId: null,
    pot: [],
    last: null,
    winnerId: null,
    touched: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}
const byId = (room, id) => room.players.find((p) => p.id === id);
const alivePlayers = (room) => room.players.filter((p) => !p.out);

function addPlayer(room, name, ws) {
  const p = { id: uid(), token: crypto.randomBytes(12).toString('hex'), name: cleanName(name), ws, pile: [], out: false };
  room.players.push(p);
  if (!room.hostId) room.hostId = p.id;
  return p;
}

function startGame(room) {
  const deck = shuffle(CARDS);
  room.players.forEach((p) => { p.pile = []; p.out = false; });
  deck.forEach((card, i) => room.players[i % room.players.length].pile.push(card));
  room.pot = [];
  room.last = null;
  room.winnerId = null;
  room.turnId = room.players[crypto.randomInt(room.players.length)].id;
  room.phase = 'choose';
}

function pick(room, player, attr) {
  if (room.phase !== 'choose' || room.turnId !== player.id || !ATTRS.includes(attr)) return false;
  const participants = alivePlayers(room).filter((p) => p.pile.length > 0);
  const table = participants.map((p) => ({ id: p.id, card: p.pile.shift() }));
  const best = Math.max(...table.map((t) => t.card[attr]));
  const winners = table.filter((t) => t.card[attr] === best);
  if (winners.length > 1) {
    room.pot.push(...table.map((t) => t.card));
    room.last = { attr, cards: table, winnerId: null, tie: true, tiedIds: winners.map((w) => w.id), gained: 0 };
  } else {
    const winner = byId(room, winners[0].id);
    const gain = shuffle([...room.pot, ...table.map((t) => t.card)]);
    winner.pile.push(...gain);
    room.pot = [];
    room.last = { attr, cards: table, winnerId: winner.id, tie: false, tiedIds: [], gained: gain.length };
    room.turnId = winner.id;
  }
  room.phase = 'reveal';
  return true;
}

function advance(room) {
  if (room.phase !== 'reveal') return false;
  room.players.forEach((p) => { if (p.pile.length === 0) p.out = true; });
  let alive = alivePlayers(room);

  if (room.pot.length) {
    if (alive.length === 0) {
      // todos se quedaron sin cartas en un empate: el pozo vuelve a los empatados
      const tied = room.last.tiedIds.map((id) => byId(room, id));
      shuffle(room.pot).forEach((c, i) => tied[i % tied.length].pile.push(c));
      room.pot = [];
      tied.forEach((p) => { p.out = false; });
    } else if (alive.length === 1) {
      alive[0].pile.push(...shuffle(room.pot));
      room.pot = [];
    }
    alive = alivePlayers(room);
  }

  if (alive.length <= 1) {
    room.phase = 'over';
    room.winnerId = alive[0] ? alive[0].id : null;
    return true;
  }
  const turn = byId(room, room.turnId);
  if (!turn || turn.out) {
    const idx = room.players.findIndex((p) => p.id === room.turnId);
    for (let k = 1; k <= room.players.length; k++) {
      const cand = room.players[(idx + k) % room.players.length];
      if (!cand.out) { room.turnId = cand.id; break; }
    }
  }
  room.phase = 'choose';
  return true;
}

// ---------- vista personalizada ----------
function viewFor(room, p) {
  return {
    t: 'state',
    code: room.code,
    you: p.id,
    host: room.hostId,
    phase: room.phase,
    turn: room.turnId,
    players: room.players.map((q) => ({ id: q.id, name: q.name, count: q.pile.length, connected: !!q.ws, out: q.out })),
    myCard: room.phase === 'choose' && p.pile.length ? p.pile[0] : null,
    last: room.phase === 'reveal' || room.phase === 'over' ? room.last : null,
    pot: room.pot.length,
    winner: room.winnerId,
  };
}
function broadcast(room) {
  room.touched = Date.now();
  room.players.forEach((p) => send(p.ws, viewFor(room, p)));
}

// ---------- servidor ----------
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let room = null;
  let me = null;

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'create' && !room) {
      room = createRoom();
      me = addPlayer(room, m.name, ws);
      send(ws, { t: 'joined', code: room.code, token: me.token });
      return broadcast(room);
    }

    if (m.t === 'join' && !room) {
      const r = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!r) return send(ws, { t: 'error', msg: 'No existe esa sala.' });
      const existing = m.token ? r.players.find((p) => p.token === m.token) : null;
      if (existing) {
        if (existing.ws && existing.ws !== ws) existing.ws.close();
        existing.ws = ws;
        room = r; me = existing;
      } else {
        if (r.phase !== 'lobby') return send(ws, { t: 'error', msg: 'La partida ya empezó.' });
        if (r.players.length >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'La sala está llena (máximo 3).' });
        room = r;
        me = addPlayer(r, m.name, ws);
      }
      send(ws, { t: 'joined', code: room.code, token: me.token });
      return broadcast(room);
    }

    if (!room || !me) return;

    let changed = false;
    if (m.t === 'start' && room.phase === 'lobby' && me.id === room.hostId) {
      if (room.players.length < 2) return send(ws, { t: 'error', msg: 'Hacen falta al menos 2 jugadores.' });
      startGame(room);
      changed = true;
    } else if (m.t === 'pick') {
      changed = pick(room, me, m.attr);
    } else if (m.t === 'next') {
      changed = advance(room);
    } else if (m.t === 'again' && room.phase === 'over' && me.id === room.hostId) {
      startGame(room);
      changed = true;
    }
    if (changed) broadcast(room);
  });

  ws.on('close', () => {
    if (!room || !me || me.ws !== ws) return;
    me.ws = null;
    if (room.phase === 'lobby') {
      room.players = room.players.filter((p) => p.id !== me.id);
      if (room.hostId === me.id) room.hostId = room.players[0] ? room.players[0].id : null;
      if (!room.players.length) { rooms.delete(room.code); return; }
    }
    broadcast(room);
  });
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
  const now = Date.now();
  for (const [code, r] of rooms) {
    const connected = r.players.some((p) => p.ws);
    if (!connected && now - r.touched > 60 * 60 * 1000) rooms.delete(code);
  }
}, 30000);

if (require.main === module) {
  server.listen(PORT, () => console.log(`Super Amigos escuchando en el puerto ${PORT}`));
}
module.exports = { server, rooms };
