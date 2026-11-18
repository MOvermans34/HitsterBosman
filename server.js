// Bosman Jukebox — server voor het spelen op afstand.
// Serveert de webpagina en houdt kamers + spelstatus bij via WebSockets.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
// Pagina's staan in /public; staan ze (bijv. na uploaden via GitHub) in de hoofdmap, dan werkt dat ook.
const PUB = fs.existsSync(path.join(__dirname, 'public', 'index.html')) ? path.join(__dirname, 'public') : __dirname;
console.log('Pagina\'s worden geserveerd uit:', PUB);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

/* ---------------- HTTP ---------------- */
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/config') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ clientId: process.env.SPOTIFY_CLIENT_ID || '' }));
  }
  if (u.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
  let p = decodeURIComponent(u.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.join(PUB, path.normalize(p));
  if (!file.startsWith(PUB + path.sep) || !/\.(html|js|css|svg|png|ico)$/.test(file) || file === __filename || file.includes('node_modules')) { res.writeHead(404); return res.end('Niet gevonden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Niet gevonden'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

/* ---------------- Kamers ---------------- */
const rooms = new Map();
const newId = () => crypto.randomBytes(9).toString('base64url');
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let c;
  do { c = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(c));
  return c;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const str = (s, n) => String(s ?? '').slice(0, n);
const cleanName = s => str(s, 24).trim() || 'Speler';

function createRoom(clientId) {
  const room = {
    code: newCode(), hostId: null, clientId: str(clientId, 64), players: [],
    settings: { target: 10, tokens: 2, skipIntro: true },
    phase: 'lobby', deck: [], turn: 0, current: null, slot: null, correct: null,
    guessed: false, guess: null, guessResult: null, winner: null, playing: false, touched: Date.now()
  };
  rooms.set(room.code, room);
  return room;
}

function addPlayer(room, name) {
  const p = { id: newId(), token: newId(), name: cleanName(name), ws: null, spotify: false, cards: [], tokens: 0 };
  if (room.phase !== 'lobby' && room.deck.length) { p.cards = [room.deck.pop()]; p.tokens = room.settings.tokens; }
  room.players.push(p);
  return p;
}

function view(room, me) {
  const showCard = room.phase === 'reveal' || room.phase === 'over';
  return {
    type: 'state', code: room.code, you: me.id, host: room.hostId, clientId: room.clientId,
    settings: room.settings, phase: room.phase, turn: room.turn, slot: room.slot,
    correct: room.correct, guessed: room.guessed, winner: room.winner, playing: room.playing,
    deckCount: room.deck.length, current: showCard ? room.current : null,
    guess: room.guess, guessResult: showCard ? room.guessResult : null,
    players: room.players.map(p => ({ id: p.id, name: p.name, online: !!p.ws, spotify: p.spotify, cards: p.cards, tokens: p.tokens }))
  };
}

function sendTo(p, msg) { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); }
function broadcast(room) { room.touched = Date.now(); for (const p of room.players) sendTo(p, view(room, p)); }
function toastAll(room, msg, except) { for (const p of room.players) if (p !== except) sendTo(p, { type: 'toast', msg }); }

/* ---------------- Spellogica ---------------- */
const active = room => room.players[room.turn];

// Antwoord nakijken: hoofdletters, accenten, 'The', '(Remastered)', 'feat.' en kleine typfouten tellen niet mee
function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s+-\s+.*$/, ' ')
    .replace(/\b(feat|ft|featuring)\b.*$/, ' ')
    .replace(/&|\+/g, ' and ').replace(/\ben\b/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^the /, '').replace(/^de /, '');
}
function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}
function similar(guess, answer) {
  const g = norm(guess), a = norm(answer);
  if (!g || !a) return false;
  if (g === a || g.replace(/ /g, '') === a.replace(/ /g, '')) return true;
  const short = Math.min(g.length, a.length), long = Math.max(g.length, a.length);
  if (short >= 4 && (a.includes(g) || g.includes(a)) && short / long >= 0.6) return true;
  return 1 - lev(g, a) / long >= 0.75;
}
function gradeGuess(room) {
  const g = room.guess || {}, c = room.current;
  const artists = [c.artists, ...String(c.artists).split(/,\s*/)];
  const artist = !!g.artist && artists.some(a => similar(g.artist, a));
  const title = !!g.title && similar(g.title, c.name);
  room.guessResult = { artist, title };
  if (artist && title && !room.guessed) { room.guessed = true; active(room).tokens++; }
}

function evaluate(room) {
  const cards = active(room).cards, i = room.slot, y = room.current.year;
  const left = i > 0 ? cards[i - 1].year : -Infinity;
  const right = i < cards.length ? cards[i].year : Infinity;
  room.correct = left <= y && y <= right;
}

function insertSorted(cards, card) {
  const i = cards.findIndex(c => c.year > card.year);
  cards.splice(i < 0 ? cards.length : i, 0, card);
}

function endGame(room, winnerName) {
  if (!winnerName) {
    const max = Math.max(...room.players.map(p => p.cards.length));
    winnerName = room.players.filter(p => p.cards.length === max).map(p => p.name).join(' & ');
  }
  room.winner = winnerName; room.phase = 'over'; stopMusic(room);
}

function drawNext(room) {
  if (!room.deck.length) { endGame(room); return false; }
  room.current = room.deck.pop(); return true;
}

function startMusic(room) {
  if (!room.current) return;
  const c = room.current;
  const pos = room.settings.skipIntro ? Math.min(30000, Math.floor((c.dur || 120000) * 0.25)) : 0;
  room.playing = true;
  for (const p of room.players) if (p.spotify) sendTo(p, { type: 'play', uri: c.uri, pos });
}

function stopMusic(room) {
  if (!room.playing) return;
  room.playing = false;
  for (const p of room.players) if (p.spotify) sendTo(p, { type: 'pause' });
}

function cleanCard(c) {
  const year = parseInt(c?.year, 10);
  if (!c || typeof c.uri !== 'string' || !/^spotify:track:[A-Za-z0-9]+$/.test(c.uri) || !(year > 1800 && year < 2200)) return null;
  return { id: str(c.id, 40), uri: c.uri, name: str(c.name, 200), artists: str(c.artists, 200), year,
    album: str(c.album, 200), img: /^https:\/\//.test(c.img || '') ? str(c.img, 300) : '', dur: Number(c.dur) || 0 };
}

/* ---------------- Berichten ---------------- */
function handle(ws, msg) {
  // Aanmaken / meedoen
  if (msg.type === 'create') {
    const room = createRoom(msg.clientId);
    const p = addPlayer(room, msg.name);
    room.hostId = p.id;
    return attach(ws, room, p);
  }
  if (msg.type === 'join') {
    const room = rooms.get(str(msg.code, 8).toUpperCase().trim());
    if (!room) return ws.send(JSON.stringify({ type: 'error', msg: 'Kamer niet gevonden. Klopt de code?' }));
    if (room.players.length >= 12) return ws.send(JSON.stringify({ type: 'error', msg: 'Deze kamer is vol.' }));
    const p = addPlayer(room, msg.name);
    toastAll(room, `${p.name} doet mee`, p);
    return attach(ws, room, p);
  }
  if (msg.type === 'rejoin') {
    const room = rooms.get(str(msg.code, 8));
    const p = room?.players.find(x => x.token === msg.token);
    if (!p) return ws.send(JSON.stringify({ type: 'error', fatal: true, msg: 'Je vorige kamer bestaat niet meer.' }));
    return attach(ws, room, p);
  }

  const room = ws.room, me = ws.player;
  if (!room || !me || !room.players.includes(me)) return;
  const isHost = me.id === room.hostId;
  const cur = room.phase === 'listen' || room.phase === 'reveal' ? active(room) : null;
  const canAct = cur && (cur === me || isHost);   // spelleider mag namens een (offline) speler handelen
  const err = m => sendTo(me, { type: 'error', msg: m });

  switch (msg.type) {
    case 'setSpotify': me.spotify = !!msg.on; break;
    case 'rename': me.name = cleanName(msg.name); break;
    case 'setSettings':
      if (!isHost || room.phase !== 'lobby') return;
      room.settings = {
        target: Math.max(3, Math.min(30, parseInt(msg.settings?.target, 10) || 10)),
        tokens: Math.max(0, Math.min(10, parseInt(msg.settings?.tokens, 10) || 0)),
        skipIntro: !!msg.settings?.skipIntro
      };
      break;
    case 'setClientId': if (isHost) room.clientId = str(msg.clientId, 64); break;
    case 'kick': {
      if (!isHost || room.phase !== 'lobby' || msg.id === me.id) return;
      const k = room.players.find(p => p.id === msg.id);
      if (!k) return;
      sendTo(k, { type: 'error', fatal: true, msg: 'Je bent uit de kamer verwijderd.' });
      room.players = room.players.filter(p => p !== k);
      break;
    }
    case 'start': {
      if (!isHost || room.phase === 'listen' || room.phase === 'reveal') return;
      const deck = shuffle((Array.isArray(msg.deck) ? msg.deck.slice(0, 6000) : []).map(cleanCard).filter(Boolean));
      if (deck.length < room.players.length * 2 + 3) return err(`Te weinig nummers (${deck.length}). Kies meer playlists.`);
      room.deck = deck;
      for (const p of room.players) { p.cards = [deck.pop()]; p.tokens = room.settings.tokens; }
      room.turn = crypto.randomInt(room.players.length);
      Object.assign(room, { phase: 'listen', current: deck.pop(), slot: null, correct: null, guessed: false, guess: null, guessResult: null, winner: null, playing: false });
      break;
    }
    case 'play': if (!canAct) return; startMusic(room); break;
    case 'pause': if (!canAct) return; stopMusic(room); break;
    case 'guess':
      if (!canAct || room.phase !== 'listen' || room.guess) return;
      room.guess = { artist: str(msg.artist, 80).trim(), title: str(msg.title, 120).trim() };
      break;
    case 'slot': {
      if (!canAct || room.phase !== 'listen' || !room.guess) return;
      const i = parseInt(msg.i, 10);
      if (i >= 0 && i <= cur.cards.length) room.slot = i;
      break;
    }
    case 'confirm':
      if (!canAct || room.phase !== 'listen' || room.slot == null || !room.guess) return;
      evaluate(room); gradeGuess(room); room.phase = 'reveal';
      break;
    case 'guessed':
      if (room.phase !== 'reveal' || room.guessed) return;
      if (cur === me && room.players.length > 1 && !isHost) return err('De andere spelers moeten dit bevestigen 😉');
      room.guessed = true; cur.tokens++;
      toastAll(room, `${me.name} rekent het antwoord van ${cur.name} toch goed: +1 munt`);
      break;
    case 'fixYear': {
      if (!isHost || room.phase !== 'reveal') return;
      const y = parseInt(msg.year, 10);
      if (!(y > 1800 && y < 2200)) return;
      room.current.year = y; evaluate(room);
      break;
    }
    case 'skip': {
      if (!canAct || room.phase !== 'listen' || cur.tokens < 1) return;
      cur.tokens--; room.slot = null; room.guess = null;
      const was = room.playing; room.playing = false;
      if (drawNext(room) && was) startMusic(room);
      toastAll(room, `${cur.name} ruilt het nummer in (1 munt)`);
      break;
    }
    case 'buy': {
      if (!canAct || room.phase !== 'listen' || cur.tokens < 3 || !room.deck.length) return;
      cur.tokens -= 3;
      const c = room.deck.pop(); insertSorted(cur.cards, c);
      const at = cur.cards.indexOf(c);
      if (room.slot != null && room.slot > at) room.slot++;
      toastAll(room, `${cur.name} koopt een kaart: ${c.year} — ${c.artists}`);
      if (cur.cards.length >= room.settings.target) endGame(room, cur.name);
      break;
    }
    case 'next': {
      if (!canAct || room.phase !== 'reveal') return;
      if (room.correct) insertSorted(cur.cards, room.current);
      stopMusic(room);
      if (cur.cards.length >= room.settings.target) { endGame(room, cur.name); break; }
      room.turn = (room.turn + 1) % room.players.length;
      Object.assign(room, { slot: null, correct: null, guessed: false, guess: null, guessResult: null, phase: 'listen' });
      drawNext(room);
      break;
    }
    case 'newGame':
      if (!isHost) return;
      stopMusic(room);
      Object.assign(room, { phase: 'lobby', deck: [], current: null, slot: null, correct: null, winner: null });
      for (const p of room.players) { p.cards = []; p.tokens = 0; }
      break;
    case 'leave':
      if (room.phase !== 'lobby') { me.ws = null; ws.room = null; break; }
      room.players = room.players.filter(p => p !== me);
      if (isHost && room.players[0]) room.hostId = room.players[0].id;
      ws.room = null;
      break;
    default: return;
  }
  broadcast(room);
}

function attach(ws, room, p) {
  if (p.ws && p.ws !== ws) { try { p.ws.close(4000, 'elders geopend'); } catch {} }
  p.ws = ws; ws.room = room; ws.player = p;
  sendTo(p, { type: 'joined', code: room.code, token: p.token, id: p.id });
  broadcast(room);
}

/* ---------------- WebSocket ---------------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 * 1024 });
wss.on('connection', ws => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', data => {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    try { handle(ws, msg); } catch (e) { console.error(e); }
  });
  ws.on('close', () => {
    const p = ws.player, room = ws.room;
    if (p && p.ws === ws) { p.ws = null; if (room) broadcast(room); }
  });
});

// Verbindingen levend houden + oude kamers opruimen
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); }
}, 25000);
setInterval(() => {
  const cutoff = Date.now() - 8 * 3600 * 1000;
  for (const [code, room] of rooms) if (room.touched < cutoff && !room.players.some(p => p.ws)) rooms.delete(code);
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log(`Bosman Jukebox draait op http://127.0.0.1:${PORT}`));
