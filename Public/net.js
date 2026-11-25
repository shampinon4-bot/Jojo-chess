'use strict';

/* ============================================================
   net.js — WebSocket-обёртка с событиями.
   События: created, joined, guestJoined, guestLeft, hostLeft,
            relay, error.
   ============================================================ */

const Net = (function () {
  let ws = null;
  const handlers = {};

  function on(event, cb) { handlers[event] = cb; }
  function emit(event, data) { if (handlers[event]) handlers[event](data); }

  function connect(url) {
    return new Promise(function (resolve, reject) {
      try { ws = new WebSocket(url); }
      catch (e) { reject(e); return; }

      let settled = false;
      const timer = setTimeout(function () {
        if (!settled) { settled = true; try { ws.close(); } catch (e) {} reject(new Error('Таймаут подключения')); }
      }, 8000);

      ws.onopen = function () {
        if (settled) return;
        settled = true; clearTimeout(timer); resolve();
      };
      ws.onerror = function () {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(new Error('Ошибка соединения'));
      };
      ws.onmessage = function (e) {
        let msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (msg.type === 'relay') emit('relay', msg.payload);
        else if (msg.type === 'error') emit('error', msg.msg);
        else emit(msg.type, msg);
      };
      ws.onclose = function () {
        // соединение закрыто сервером
      };
    });
  }

  function createRoom() {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'create' }));
  }

  function joinRoom(code) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'join', code: code }));
  }

  function send(payload) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'relay', payload: payload }));
  }

  function disconnect() {
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
  }

  return {
    connect: connect,
    createRoom: createRoom,
    joinRoom: joinRoom,
    send: send,
    disconnect: disconnect,
    on: on
  };
})();
