 strict';

/* ============================================================
   server.js — Express (статика) + WebSocket (комнаты).
   Авторитарный клиент: хост. Сервер только маршрутизирует.
   ============================================================ */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map(); // code -> { host, guest }

function genCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.role = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    if (msg.type === 'create') {
      let code;
      do { code = genCode(); } while (rooms.has(code));
      rooms.set(code, { host: ws, guest: null });
      ws.roomCode = code;
      ws.role = 'host';
      ws.send(JSON.stringify({ type: 'created', code: code }));
      return;
    }

    if (msg.type === 'join') {
      const code = String(msg.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', msg: 'Комната не найдена или уже закрыта.' }));
        return;
      }
      if (room.guest) {
        ws.send(JSON.stringify({ type: 'error', msg: 'В комнате уже есть второй игрок.' }));
        return;
      }
      room.guest = ws;
      ws.roomCode = code;
      ws.role = 'guest';
      ws.send(JSON.stringify({ type: 'joined', code: code }));
      if (room.host.readyState === 1) {
        room.host.send(JSON.stringify({ type: 'guestJoined' }));
      }
      return;
    }

    if (msg.type === 'relay') {
      const room = rooms.get(ws.roomCode);
      if (!room) return;
      const target = ws.role === 'host' ? room.guest : room.host;
      if (target && target.readyState === 1) {
        target.send(JSON.stringify({ type: 'relay', payload: msg.payload }));
      }
      return;
    }
  });

  ws.on('close', () => {
    const code = ws.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (ws.role === 'host') {
      if (room.guest && room.guest.readyState === 1) {
        room.guest.send(JSON.stringify({ type: 'hostLeft' }));
      }
      rooms.delete(code);
    } else if (ws.role === 'guest') {
      room.guest = null;
      if (room.host && room.host.readyState === 1) {
        room.host.send(JSON.stringify({ type: 'guestLeft' }));
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('JoJo Chess server on http://localhost:' + PORT);
});
