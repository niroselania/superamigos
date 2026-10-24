// Prueba de punta a punta: levanta el servidor, juega partidas completas con clientes simulados
// y verifica que nunca se pierda ni se duplique una carta.
const assert = require('assert');
const WebSocket = require('ws');
const CARDS = require('../data/cards.json');
const { server } = require('../server');

// --- datos ---
const ATTRS = ['altura', 'peso', 'fuerza', 'peleas', 'velocidad'];
assert.strictEqual(CARDS.length, 32, 'deben ser 32 cartas');
assert.strictEqual(new Set(CARDS.map((c) => c.code)).size, 32, 'codigos repetidos');
for (const g of 'ABCDEFGH') for (const n of '1234') assert(CARDS.find((c) => c.code === g + n), `falta ${g}${n}`);
CARDS.forEach((c) => ATTRS.forEach((a) => assert(typeof c[a] === 'number' && c[a] > 0, `${c.name}.${a}`)));

function client(port) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const c = { ws, state: null, errors: [], token: null, listeners: [] };
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'state') { c.state = m; c.listeners.forEach((f) => f(m)); }
      if (m.t === 'error') c.errors.push(m.msg);
      if (m.t === 'joined') { c.token = m.token; c.code = m.code; }
    });
    c.send = (o) => ws.send(JSON.stringify(o));
    ws.on('open', () => resolve(c));
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function playGame(port, nPlayers) {
  const host = await client(port);
  host.send({ t: 'create', name: 'Host' });
  await wait(50);
  const clients = [host];
  for (let i = 1; i < nPlayers; i++) {
    const c = await client(port);
    c.send({ t: 'join', code: host.code, name: 'P' + i });
    clients.push(c);
    await wait(50);
  }
  assert.strictEqual(host.state.players.length, nPlayers);

  // la sala esta llena: un cuarto jugador no entra (solo se prueba en 3)
  if (nPlayers === 3) {
    const extra = await client(port);
    extra.send({ t: 'join', code: host.code, name: 'Extra' });
    await wait(80);
    assert(extra.errors.length, 'el 4to jugador deberia ser rechazado');
    extra.ws.close();
  }

  let rounds = 0, ties = 0, done = null;
  const finished = new Promise((r) => { done = r; });
  clients.forEach((c) => c.listeners.push((s) => {
    const total = s.players.reduce((a, p) => a + p.count, 0) + s.pot;
    assert.strictEqual(total, 32, `se perdieron cartas: ${total}`);
    if (s.phase === 'choose' && s.turn === s.you) {
      assert(s.myCard, 'el jugador de turno debe ver su carta');
      rounds++;
      if (rounds > 20000) throw new Error('la partida no termina');
      c.send({ t: 'pick', attr: ATTRS[Math.floor(Math.random() * 5)] });
    } else if (s.phase === 'choose' && s.turn !== s.you && !c.tried) {
      c.tried = true;
      c.send({ t: 'pick', attr: 'fuerza' }); // intento ilegal (una sola vez): debe ignorarse
    } else if (s.phase === 'reveal' && s.you === host.state.you) {
      if (s.last.tie) ties++;
      c.send({ t: 'next' });
    } else if (s.phase === 'over' && s.you === host.state.you) {
      done(s);
    }
  }));
  host.send({ t: 'start' });
  const final = await Promise.race([finished, wait(60000).then(() => { throw new Error('timeout'); })]);

  const winner = final.players.find((p) => p.id === final.winner);
  assert(winner, 'debe haber ganador');
  assert.strictEqual(winner.count, 32, 'el ganador debe tener las 32 cartas');
  clients.forEach((c) => c.ws.close());
  return { rounds, ties };
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  for (const n of [2, 3, 2, 3]) {
    const r = await playGame(port, n);
    console.log(`OK partida de ${n} jugadores: ${r.rounds} rondas, ${r.ties} empates`);
  }

  // reconexion con token
  const a = await client(port); a.send({ t: 'create', name: 'A' }); await wait(50);
  const b = await client(port); b.send({ t: 'join', code: a.code, name: 'B' }); await wait(50);
  a.send({ t: 'start' }); await wait(50);
  const b2 = await client(port);
  b.ws.close(); await wait(50);
  b2.send({ t: 'join', code: a.code, token: b.token }); await wait(80);
  assert(b2.state && b2.state.you === b.state.you, 'la reconexion debe recuperar al mismo jugador');
  const late = await client(port); late.send({ t: 'join', code: a.code, name: 'Tarde' }); await wait(80);
  assert(late.errors.length, 'no se puede entrar a una partida empezada');
  console.log('OK reconexion y rechazo de ingreso tardio');

  console.log('Todo OK');
  process.exit(0);
})().catch((e) => { console.error('FALLO:', e); process.exit(1); });
