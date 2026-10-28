// Health of Trees: live server.
// Serves the page and relays what visitors do (water, fire, help) to everyone connected.
// Visitors are kept in visitors.json so the tree keeps its rings after a restart.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const PAGE = path.join(__dirname, 'burning-memory.html');
const STORE = path.join(__dirname, 'visitors.json');
const TYPES = new Set(['water', 'fire', 'help']);
const ID = /^[a-z0-9]{6,32}$/;

let visitors = [];
try { visitors = JSON.parse(fs.readFileSync(STORE, 'utf8')).filter(v => ID.test(v)); } catch {}
const save = () => fs.writeFile(STORE, JSON.stringify(visitors), () => {});
const events = []; // the last few actions, for people who arrive later

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html' || url === '/burning-memory.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    fs.createReadStream(PAGE).pipe(res);
  } else {
    res.writeHead(404); res.end();
  }
});

// any origin may connect, so the page can also live on GitHub Pages
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', socket => {
  socket.on('hello', id => {
    if (typeof id !== 'string' || !ID.test(id) || socket.data.id) return;
    socket.data.id = id;
    const isNew = !visitors.includes(id);
    if (isNew) { visitors.push(id); save(); }
    socket.emit('init', { visitors, events, isNew });
    if (isNew) { socket.broadcast.emit('joined', id); socket.broadcast.emit('visitors', visitors); }
  });

  socket.on('action', type => {
    if (!socket.data.id || !TYPES.has(type)) return;
    const now = Date.now();
    socket.data.recent = (socket.data.recent || []).filter(at => now - at < 1000);
    if (socket.data.recent.length >= 5) return; // five actions a second at most
    socket.data.recent.push(now);
    const ev = { type, by: socket.data.id, at: now };
    events.push(ev);
    if (events.length > 8) events.shift();
    socket.broadcast.emit('action', ev);
  });
});

server.listen(PORT, () => console.log(`Health of Trees on http://localhost:${PORT}`));
