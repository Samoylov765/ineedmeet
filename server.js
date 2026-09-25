const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PER_ROOM = 2; // v0.1: только двое
const PUBLIC = path.join(__dirname, 'public');

const rooms = new Map(); // roomId -> Set<ws>

function serveFile(res, file, type) {
  fs.readFile(path.join(PUBLIC, file), (err, data) => {
    if (err) { res.writeHead(500); return res.end('error'); }
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/') return serveFile(res, 'index.html', 'text/html; charset=utf-8');
  if (/^\/r\/[A-Za-z0-9]{4,32}$/.test(url)) return serveFile(res, 'room.html', 'text/html; charset=utf-8');
  if (url === '/new') {
    const id = crypto.randomBytes(5).toString('hex');
    res.writeHead(302, { Location: '/r/' + id });
    return res.end();
  }
  if (url === '/health') { res.writeHead(200); return res.end('ok'); }
  res.writeHead(404); res.end('not found');
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const room = new URL(req.url, 'http://x').searchParams.get('room') || '';
  if (!/^[A-Za-z0-9]{4,32}$/.test(room)) return ws.close();

  const peers = rooms.get(room) || new Set();
  if (peers.size >= MAX_PER_ROOM) {
    ws.send(JSON.stringify({ type: 'full' }));
    return ws.close();
  }
  peers.add(ws);
  rooms.set(room, peers);
  ws.room = room;

  // Сообщаем новичку, есть ли уже кто-то (тогда он инициатор звонка)
  ws.send(JSON.stringify({ type: 'joined', initiator: peers.size === 2 }));
  for (const p of peers) if (p !== ws && p.readyState === 1) p.send(JSON.stringify({ type: 'peer-joined' }));

  ws.on('message', (data) => {
    // Просто пересылаем служебные сообщения второму участнику
    for (const p of peers) if (p !== ws && p.readyState === 1) p.send(data.toString());
  });

  ws.on('close', () => {
    peers.delete(ws);
    for (const p of peers) if (p.readyState === 1) p.send(JSON.stringify({ type: 'peer-left' }));
    if (peers.size === 0) rooms.delete(room);
  });
});

// Пинг, чтобы бесплатный хостинг не рвал соединения
setInterval(() => wss.clients.forEach((c) => c.readyState === 1 && c.ping()), 25000);

server.listen(PORT, () => console.log('ineedmeet on :' + PORT));
