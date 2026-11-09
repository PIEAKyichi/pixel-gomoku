// server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const SIZE = 15;
const EMPTY = 0, BLACK = 1, WHITE = 2;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); res.end('Bad Request'); return; }
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  const rel = path.relative(PUBLIC_DIR, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('404 Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

const emptyBoard = () => Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY));

function makeRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do { id = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (rooms.has(id));
  return id;
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj, exceptWs) {
  const data = JSON.stringify(obj);
  for (const p of room.players) {
    if (p.ws === exceptWs) continue;
    if (p.ws.readyState === 1) p.ws.send(data);
  }
}

function checkWin(board, x, y, color) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (const [dx, dy] of dirs) {
    const line = [[x, y]];
    for (const s of [1, -1]) {
      let nx = x + dx * s, ny = y + dy * s;
      while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && board[ny][nx] === color) {
        if (s === 1) line.push([nx, ny]); else line.unshift([nx, ny]);
        nx += dx * s; ny += dy * s;
      }
    }
    if (line.length >= 5) return line;
  }
  return null;
}

wss.on('connection', (ws) => {
  ws.roomId = null; ws.name = '玩家'; ws.color = 0; ws.playerId = null; ws.avatar = '';

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    try { handle(ws, msg); } catch (e) { console.error(e); }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomId);
    if (!room) return;
    rooms.delete(room.id);
    for (const p of room.players) {
      if (p.ws !== ws) { p.ws.roomId = null; send(p.ws, { type: 'opponentLeft' }); }
    }
  });
});

function handle(ws, msg) {
  switch (msg.type) {
    case 'create': {
      if (ws.roomId) return;
      const name = String(msg.name || '').trim().slice(0, 12) || '玩家';
      let customId = String(msg.roomId || '').trim().toUpperCase();
      
      if (customId) {
        if (!/^[A-Z0-9]{4}$/.test(customId)) return send(ws, { type: 'error', msg: '房间号必须为4位字母或数字' });
        if (rooms.has(customId)) return send(ws, { type: 'error', msg: '该房间号已被占用' });
      } else {
        customId = makeRoomId();
      }

      const room = { id: customId, players: [], board: emptyBoard(), turn: BLACK, status: 'waiting', winner: 0, winLine: null, history: [] };
      rooms.set(customId, room);

      const playerId = Math.random().toString(36).slice(2, 10);
      ws.roomId = customId; ws.name = name; ws.color = BLACK; ws.playerId = playerId; ws.avatar = msg.avatar || '';
      room.players.push({ ws, name, color: BLACK, id: playerId, avatar: ws.avatar });

      send(ws, { type: 'created', roomId: customId, color: BLACK, playerId, board: room.board, turn: room.turn, status: room.status, players: room.players.map(p=>({name:p.name,color:p.color,avatar:p.avatar})) });
      break;
    }
    case 'join': {
      if (ws.roomId) return;
      const id = String(msg.roomId || '').trim().toUpperCase();
      const room = rooms.get(id);
      if (!room) return send(ws, { type: 'error', msg: '房间不存在' });
      if (room.players.length >= 2) return send(ws, { type: 'error', msg: '房间已满' });

      const name = String(msg.name || '').trim().slice(0, 12) || '玩家';
      const playerId = Math.random().toString(36).slice(2, 10);
      ws.roomId = id; ws.name = name; ws.color = WHITE; ws.playerId = playerId; ws.avatar = msg.avatar || '';
      room.players.push({ ws, name, color: WHITE, id: playerId, avatar: ws.avatar });

      room.status = 'playing'; room.turn = BLACK;
      const pData = room.players.map(p => ({ name: p.name, color: p.color, avatar: p.avatar }));
      for (const p of room.players) {
        send(p.ws, { type: 'start', roomId: id, color: p.color, playerId: p.id, board: room.board, turn: room.turn, players: pData });
      }
      break;
    }
    case 'move': {
      const room = rooms.get(ws.roomId);
      if (!room || room.status !== 'playing' || ws.color !== room.turn) return;
      const x = msg.x | 0, y = msg.y | 0;
      if (x < 0 || x >= SIZE || y < 0 || y >= SIZE || room.board[y][x] !== EMPTY) return;

      room.board[y][x] = ws.color;
      room.history.push({ x, y, color: ws.color });
      const line = checkWin(room.board, x, y, ws.color);
      room.turn = ws.color === BLACK ? WHITE : BLACK;

      broadcast(room, { type: 'move', x, y, color: ws.color, turn: room.turn });

      if (line) {
        room.status = 'over'; room.winner = ws.color; room.winLine = line;
        broadcast(room, { type: 'gameover', winner: ws.color, line, winnerName: ws.name });
      } else if (room.board.every(row => row.every(c => c !== EMPTY))) {
        room.status = 'over'; room.winner = 0;
        broadcast(room, { type: 'gameover', winner: 0, line: null });
      }
      break;
    }
    case 'resign': {
      const room = rooms.get(ws.roomId);
      if (!room || room.status !== 'playing') return;
      room.status = 'over'; room.winner = ws.color === BLACK ? WHITE : BLACK;
      const wp = room.players.find(p => p.color === room.winner);
      broadcast(room, { type: 'gameover', winner: room.winner, line: null, reason: 'resign', winnerName: wp ? wp.name : '' });
      break;
    }
    case 'undo_req': {
      const room = rooms.get(ws.roomId);
      if (!room || room.status !== 'playing') return;
      const op = room.players.find(p => p.ws !== ws);
      if (op) send(op.ws, { type: 'undo_req' });
      break;
    }
    case 'undo_resp': {
      const room = rooms.get(ws.roomId);
      if (!room || room.status !== 'playing') return;
      const requester = room.players.find(p => p.ws !== ws);
      if (msg.accept) {
        if (room.history.length > 0) {
          const last = room.history.pop();
          room.board[last.y][last.x] = EMPTY;
          if (room.history.length > 0 && room.history[room.history.length - 1].color === last.color) {
            const prev = room.history.pop();
            room.board[prev.y][prev.x] = EMPTY;
          }
          room.turn = room.history.length > 0 ? (room.history[room.history.length - 1].color === BLACK ? WHITE : BLACK) : BLACK;
          broadcast(room, { type: 'undo_done', board: room.board, turn: room.turn });
        }
      } else {
        send(requester.ws, { type: 'info', msg: '对方拒绝了你的悔棋请求' });
      }
      break;
    }
    case 'draw_req': {
      const room = rooms.get(ws.roomId);
      if (!room || room.status !== 'playing') return;
      const op = room.players.find(p => p.ws !== ws);
      if (op) send(op.ws, { type: 'draw_req' });
      break;
    }
    case 'draw_resp': {
      const room = rooms.get(ws.roomId);
      if (!room || room.status !== 'playing') return;
      const requester = room.players.find(p => p.ws !== ws);
      if (msg.accept) {
        room.status = 'over'; room.winner = 0;
        broadcast(room, { type: 'gameover', winner: 0, line: null, reason: 'draw' });
      } else {
        send(requester.ws, { type: 'info', msg: '对方拒绝了你的求和请求' });
      }
      break;
    }
    case 'restart': {
      const room = rooms.get(ws.roomId);
      if (!room || room.status !== 'over') return;
      room.board = emptyBoard(); room.status = 'playing'; room.winner = 0; room.winLine = null; room.history = [];
      for (const p of room.players) { p.color = p.color === BLACK ? WHITE : BLACK; p.ws.color = p.color; }
      room.turn = BLACK;
      const pData = room.players.map(p => ({ name: p.name, color: p.color, avatar: p.avatar }));
      for (const p of room.players) send(p.ws, { type: 'restart', board: room.board, turn: room.turn, color: p.color, players: pData });
      break;
    }
    case 'chat': {
      const room = rooms.get(ws.roomId);
      if (!room) return;
      const text = String(msg.text || '').trim().slice(0, 200);
      if (!text) return;
      broadcast(room, { type: 'chat', from: ws.playerId, name: ws.name, color: ws.color, text, ts: Date.now() });
      break;
    }
    case 'leave': {
      const room = rooms.get(ws.roomId);
      if (room) {
        rooms.delete(room.id);
        for (const p of room.players) if (p.ws !== ws) { p.ws.roomId = null; send(p.ws, { type: 'opponentLeft' }); }
      }
      ws.roomId = null; ws.color = 0; ws.playerId = null;
      send(ws, { type: 'left' });
      break;
    }
  }
}

server.listen(PORT, () => console.log(`🎮 像素五子棋已启动: http://localhost:${PORT}`));