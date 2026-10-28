// Health of Trees: live server.
// Serves the page, relays what visitors do (water, fire, help) to everyone connected,
// and keeps the memory of the website in memory.txt.
//
// memory.txt: one line per visitor, in the order they joined:  <visitor id><TAB><their ring of text>
// - a new visitor adds a line of wildfire statistics about where they are (GWIS / EFFIS, Copernicus)
// - words that burn on the website are deleted from the file
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const PAGE = path.join(__dirname, 'burning-memory.html');
// on a host with a persistent disk, point MEMORY_FILE at it so the memory survives restarts
const MEMORY = process.env.MEMORY_FILE || path.join(__dirname, 'memory.txt');
const GWIS = 'https://maps.effis.emergency.copernicus.eu/gwis';
const TYPES = new Set(['water', 'fire', 'help']);
const ID = /^[a-z0-9]{6,32}$/;

// Used when a visitor doesn't share their location. Approximate public figures.
const RECORDS = [
  'Portugal 2017 — about 540,000 hectares burned and 117 lives lost.',
  'California 2018 — the Camp Fire destroyed the town of Paradise, 85 dead.',
  'Australia 2019–20 — the Black Summer burned about 24 million hectares.',
  'Canada 2023 — about 18 million hectares burned in more than 6,000 fires.',
  'Hawaii 2023 — Lahaina burned, 102 dead and thousands left homeless.',
  'Greece, Evros 2023 — about 94,000 hectares, the largest fire on EU record.',
  'Brazil 2024 — about 30 million hectares of forest and savanna burned.',
  'Los Angeles 2025 — the Eaton and Palisades fires destroyed more than 16,000 homes and buildings.',
];

// ---- memory.txt ----------------------------------------------------------------
if (!fs.existsSync(MEMORY)) fs.writeFileSync(MEMORY, ''); // starts blank
let memory = fs.readFileSync(MEMORY, 'utf8').split('\n').filter(Boolean).map(line => {
  const tab = line.indexOf('\t');
  return { id: line.slice(0, tab), text: line.slice(tab + 1) };
}).filter(l => ID.test(l.id));

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(MEMORY, memory.map(l => `${l.id}\t${l.text}\n`).join(''), () => {}), 500);
}

// ---- wildfire statistics for a place ---------------------------------------
const fmt = n => Math.round(n).toLocaleString('en-US');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DANGER = [['very low', -Infinity], ['low', 5.2], ['moderate', 11.2], ['high', 21.3], ['very high', 38], ['extreme', 50]];

async function gwis(query, as = 'json') {
  const res = await fetch(`${GWIS}?${query}`, { signal: AbortSignal.timeout(15000) });
  return as === 'json' ? res.json() : res.text();
}
// a box about 100 km wide around the visitor (WFS 1.1.0 with EPSG:4326 is lat,lon order)
function box(lat, lon) {
  const dLon = 0.45 / Math.max(0.2, Math.cos(lat * Math.PI / 180));
  return `${lat - 0.45},${lon - dLon},${lat + 0.45},${lon + dLon},EPSG:4326`;
}
async function burntAreas(lat, lon) {
  const d = await gwis(`service=WFS&version=1.1.0&request=GetFeature&typename=ms:nrt.ba.query&srsName=EPSG:4326&outputFormat=geojson&BBOX=${box(lat, lon)}`);
  return (d.features || []).map(f => ({ ha: +f.properties.area_ha || 0, date: String(f.properties.initialdate || '') }));
}
async function hotspots(lat, lon) {
  const d = await gwis(`service=WFS&version=1.1.0&request=GetFeature&typename=ms:all.hs.week.points&srsName=EPSG:4326&outputFormat=geojson&BBOX=${box(lat, lon)}`);
  return (d.features || []).length;
}
async function fireDanger(lat, lon) {
  const day = new Date().toISOString().slice(0, 10);
  const html = await gwis(`service=WMS&version=1.3.0&request=GetFeatureInfo&layers=ecmwf.query&query_layers=ecmwf.query&styles=` +
    `&crs=EPSG:4326&width=3&height=3&i=1&j=1&info_format=text/html&time=${day}&bbox=${lat - 0.1},${lon - 0.1},${lat + 0.1},${lon + 0.1}`, 'text');
  const m = html.match(/\(FWI\)<\/td><td>([-\d.]+)/);
  return m ? DANGER.reduce((name, [n, min]) => +m[1] >= min ? n : name, DANGER[0][0]) : null;
}

async function placeLine(place) {
  const pick = () => RECORDS[Math.floor(Math.random() * RECORDS.length)];
  if (!place.lat && place.lat !== 0) return `${place.city ? `A visitor from ${place.city}` : 'A visitor'} kept their location to themselves. ${pick()}`;
  const where = place.city ? `Around ${place.city}` : 'Around this visitor';
  const [ba, hs, danger] = await Promise.allSettled([burntAreas(place.lat, place.lon), hotspots(place.lat, place.lon), fireDanger(place.lat, place.lon)]);
  const parts = [];
  if (ba.status === 'fulfilled') {
    const fires = ba.value;
    if (fires.length) {
      const total = fires.reduce((s, f) => s + f.ha, 0);
      const big = fires.reduce((a, b) => b.ha > a.ha ? b : a);
      const year = String(new Date().getFullYear());
      const thisYear = fires.filter(f => f.date.startsWith(year)).length;
      parts.push(`${where}, satellites mapped ${fmt(fires.length)} wildfire${fires.length === 1 ? '' : 's'} within 50 km since 2012 and ${fmt(total)} hectares burned.`);
      parts.push(`The largest burned ${fmt(big.ha)} hectares in ${MONTHS[+big.date.slice(5, 7) - 1] || ''} ${big.date.slice(0, 4)}.`.replace('  ', ' '));
      if (thisYear) parts.push(`${fmt(thisYear)} of them in ${year}.`);
    } else parts.push(`${where}, no wildfire was mapped within 50 km since 2012.`);
  }
  if (hs.status === 'fulfilled') parts.push(hs.value ? `This week satellites saw ${fmt(hs.value)} fire hotspot${hs.value === 1 ? '' : 's'} nearby.` : 'No fire hotspot nearby this week.');
  if (danger.status === 'fulfilled' && danger.value) parts.push(`Fire danger today: ${danger.value}.`);
  return parts.length ? parts.join(' ') : `${where}. ${pick()}`;
}

// ---- server --------------------------------------------------------------------
const events = []; // the last few actions, for people who arrive later

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html' || url === '/burning-memory.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    fs.createReadStream(PAGE).pipe(res);
  } else if (url === '/memory.txt') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(memory.map(l => `${l.id}\t${l.text}\n`).join(''));
  } else {
    res.writeHead(404); res.end();
  }
});

// any origin may connect, so the page can also live on GitHub Pages
const io = new Server(server, { cors: { origin: '*' } });

// a few per second at most, per visitor and per kind of message
function allowed(socket, kind, perSecond) {
  const now = Date.now(), key = 'recent_' + kind;
  socket.data[key] = (socket.data[key] || []).filter(at => now - at < 1000);
  if (socket.data[key].length >= perSecond) return false;
  socket.data[key].push(now);
  return true;
}

io.on('connection', socket => {
  socket.on('hello', id => {
    if (typeof id !== 'string' || !ID.test(id) || socket.data.id) return;
    socket.data.id = id;
    socket.emit('init', { memory, events, hasLine: memory.some(l => l.id === id) });
  });

  // a new visitor says where they are (rounded), or null; their line of memory is written once
  socket.on('place', async p => {
    const id = socket.data.id;
    if (!id || socket.data.placed || memory.some(l => l.id === id)) return;
    socket.data.placed = true;
    const place = {};
    if (p && typeof p.city === 'string' && /^[\p{L} .'-]{1,40}$/u.test(p.city)) place.city = p.city;
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180) {
      place.lat = Math.round(p.lat * 100) / 100; place.lon = Math.round(p.lon * 100) / 100;
    }
    const text = (await placeLine(place)).replace(/[\t\n\r]/g, ' ');
    if (memory.some(l => l.id === id)) return;
    const line = { id, text };
    memory.push(line); save();
    io.emit('line', line);
  });

  // a word burned away on someone's screen: it leaves the memory
  socket.on('burn', b => {
    if (!socket.data.id || !b || typeof b.owner !== 'string' || typeof b.word !== 'string' || b.word.length > 60) return;
    if (!allowed(socket, 'burn', 15)) return;
    const line = memory.find(l => l.id === b.owner);
    if (!line) return;
    const words = line.text.split(' ');
    const at = words.indexOf(b.word);
    if (at < 0) return;
    words.splice(at, 1);
    line.text = words.join(' ');
    save();
  });

  socket.on('action', type => {
    if (!socket.data.id || !TYPES.has(type) || !allowed(socket, 'action', 5)) return;
    const ev = { type, by: socket.data.id, at: Date.now() };
    events.push(ev);
    if (events.length > 8) events.shift();
    socket.broadcast.emit('action', ev);
  });
});

server.listen(PORT, () => console.log(`Health of Trees on http://localhost:${PORT}`));
