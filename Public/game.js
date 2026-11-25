'use strict';

/* ============================================================
   game.js — UI, оркестрация партии, звук, туториал, онлайн.
   Режимы: 'ai' | 'online-host' | 'online-guest'.
   ============================================================ */

(function () {

  /* ---------------- DOM ---------------- */
  const boardEl      = document.getElementById('board');
  const wrapEl       = document.getElementById('boardWrap');
  const cellsEl      = document.getElementById('cells');
  const piecesEl     = document.getElementById('pieces');
  const statusMain   = document.getElementById('statusMain');
  const statusSub    = document.getElementById('statusSub');
  const btnStand     = document.getElementById('btnStand');
  const btnHint      = document.getElementById('btnHint');
  const btnNew       = document.getElementById('btnNew');
  const logEl        = document.getElementById('log');
  const modal        = document.getElementById('modal');
  const modalTitle   = document.getElementById('modalTitle');
  const modalBody    = document.getElementById('modalBody');
  const modalActions = document.getElementById('modalActions');
  const toastEl      = document.getElementById('toast');

  /* ---------------- глифы фигур ---------------- */
  const GLYPH = {
    w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
    b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
  };

  /* ---------------- состояние UI ---------------- */
  let state = null;
  let selected = null;
  let selectedMoves = [];
  let standMode = null;
  let gameOver = false;
  let lastMove = null;
  let hintMove = null;
  let hintTimer = null;
  let pieceEls = new Map();
  let cellEls = [];
  let hintQueue = [];
  let hintOpen = false;
  const shownTutorials = new Set();

  /* ---------------- режим и сеть ---------------- */
  let gameMode = 'ai';        // 'ai' | 'online-host' | 'online-guest'
  let myColor = 'w';          // 'w' у ИИ/хоста, 'b' у гостя
  let netConnected = false;

  /* ============================================================
     ЗВУК
     ============================================================ */
  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) audioCtx = new Ctx();
      } catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function () {});
    }
  }

  function tone(freq, dur, type, vol, delay) {
    if (!audioCtx) return;
    try {
      const t0 = audioCtx.currentTime + (delay || 0);
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(vol || 0.05, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) {}
  }

  function playSound(kind) {
    if (!audioCtx) return;
    if (kind === 'move') {
      tone(430, 0.07, 'triangle', 0.055, 0);
    } else if (kind === 'capture') {
      tone(210, 0.10, 'square', 0.05, 0);
      tone(150, 0.13, 'square', 0.04, 0.055);
    } else if (kind === 'stand') {
      tone(520, 0.09, 'sawtooth', 0.045, 0);
      tone(780, 0.11, 'sawtooth', 0.045, 0.085);
      tone(1040, 0.18, 'sine', 0.05, 0.19);
    }
  }

  /* ============================================================
     ОНЛАЙН
     ============================================================ */

  function getWsUrl() {
    if (location.protocol === 'file:') return null;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host;
  }

  function serializeState(s) {
    return {
      board: s.board.map(function (row) {
        return row.map(function (p) {
          return p ? {
            id: p.id, type: p.type, color: p.color, frozen: p.frozen,
            homeR: p.homeR, homeC: p.homeC,
            stand: p.stand ? {
              key: p.stand.key, charges: p.stand.charges,
              cooldownLeft: p.stand.cooldownLeft,
              usedTargets: Array.from(p.stand.usedTargets)
            } : null
          } : null;
        });
      }),
      turn: s.turn,
      castling: { wK: s.castling.wK, wQ: s.castling.wQ, bK: s.castling.bK, bQ: s.castling.bQ },
      enPassant: s.enPassant ? { r: s.enPassant.r, c: s.enPassant.c } : null,
      ply: s.ply,
      bigQueue: (s.bigQueue || []).map(function (e) {
        return {
          piece: {
            id: e.piece.id, type: e.piece.type, color: e.piece.color,
            frozen: e.piece.frozen, homeR: e.piece.homeR, homeC: e.piece.homeC,
            stand: e.piece.stand ? {
              key: e.piece.stand.key, charges: e.piece.stand.charges,
              cooldownLeft: e.piece.stand.cooldownLeft,
              usedTargets: Array.from(e.piece.stand.usedTargets)
            } : null
          },
          r: e.r, c: e.c, turnsLeft: e.turnsLeft, color: e.color
        };
      })
    };
  }

  function deserializeState(d) {
    return {
      board: d.board.map(function (row) {
        return row.map(function (p) {
          return p ? {
            id: p.id, type: p.type, color: p.color, frozen: p.frozen || 0,
            homeR: p.homeR, homeC: p.homeC,
            stand: p.stand ? {
              key: p.stand.key, charges: p.stand.charges,
              cooldownLeft: p.stand.cooldownLeft,
              usedTargets: new Set(p.stand.usedTargets)
            } : null
          } : null;
        });
      }),
      turn: d.turn,
      castling: d.castling,
      enPassant: d.enPassant,
      ply: d.ply,
      bigQueue: (d.bigQueue || []).map(function (e) {
        return {
          piece: {
            id: e.piece.id, type: e.piece.type, color: e.piece.color,
            frozen: e.piece.frozen || 0, homeR: e.piece.homeR, homeC: e.piece.homeC,
            stand: e.piece.stand ? {
              key: e.piece.stand.key, charges: e.piece.stand.charges,
              cooldownLeft: e.piece.stand.cooldownLeft,
              usedTargets: new Set(e.piece.stand.usedTargets)
            } : null
          },
          r: e.r, c: e.c, turnsLeft: e.turnsLeft, color: e.color
        };
      })
    };
  }

  function broadcastState() {
    if (gameMode === 'online-host' && netConnected && state) {
      Net.send({ type: 'state', state: serializeState(state) });
    }
  }

  function startOnlineHost() {
    const url = getWsUrl();
    if (!url) {
      showModal('Онлайн недоступен',
        '<p>Для игры по сети страницу нужно открыть с сервера (http:// или https://), а не с локального файла.</p>',
        [{ label: 'Понятно', primary: true, action: function () { closeModal(); showMenu(); } }]);
      return;
    }
    gameMode = 'online-host';
    myColor = 'w';
    Net.connect(url).then(function () { Net.createRoom(); })
      .catch(function (err) {
        showModal('Ошибка', '<p>Не удалось подключиться к серверу: ' + err.message + '</p>',
          [{ label: 'OK', primary: true, action: function () { closeModal(); showMenu(); } }]);
      });
  }

  function startOnlineJoin(code) {
    const url = getWsUrl();
    if (!url) {
      showModal('Онлайн недоступен',
        '<p>Для игры по сети страницу нужно открыть с сервера.</p>',
        [{ label: 'Понятно', primary: true, action: function () { closeModal(); showMenu(); } }]);
      return;
    }
    gameMode = 'online-guest';
    myColor = 'b';
    showModal('Подключение…', '<p>Соединяемся с комнатой <b>' + code + '</b>…</p>', []);
    Net.connect(url).then(function () { Net.joinRoom(code); })
      .catch(function (err) {
        showModal('Ошибка', '<p>Не удалось подключиться: ' + err.message + '</p>',
          [{ label: 'OK', primary: true, action: function () { closeModal(); showMenu(); } }]);
      });
  }

  function setupNetHandlers() {
    Net.on('created', function (msg) {
      netConnected = true;
      const link = location.origin + location.pathname + '?room=' + msg.code;
      showModal('Ожидание соперника',
        '<p>Отправьте другу ссылку или код:</p>' +
        '<p style="word-break:break-all;background:#0f1117;padding:10px;border-radius:8px;' +
        'font-size:12px;font-family:monospace">' + link + '</p>' +
        '<p style="text-align:center;font-size:22px;letter-spacing:4px;font-weight:700">' + msg.code + '</p>',
        [{ label: 'Отмена', action: function () { closeModal(); Net.disconnect(); netConnected = false; showMenu(); } }]);
    });

    Net.on('guestJoined', function () {
      closeModal();
      newGame('online-host');
      toast('Соперник подключился. Ваш ход!');
    });

    Net.on('joined', function () {
      netConnected = true;
      showModal('Подключено', '<p>Ожидание первого хода хоста…</p>', []);
    });

    Net.on('relay', function (payload) {
      if (!payload) return;

      if (payload.type === 'state') {
        if (gameMode !== 'online-guest') return;
        state = deserializeState(payload.state);
        gameOver = false;
        selected = null;
        selectedMoves = [];
        standMode = null;
        closeModal();
        render();
        queueStandHints();
        const gs = checkGameState();
        if (gs.over) endGame(gs);
        return;
      }

      if (payload.type === 'moveIntent') {
        handleGuestMoveIntent(payload);
        return;
      }

      if (payload.type === 'standIntent') {
        handleGuestStandIntent(payload);
        return;
      }
    });

    Net.on('guestLeft', function () {
      netConnected = false;
      gameOver = true;
      toast('Соперник отключился');
      setTimeout(function () {
        showModal('Соперник отключился', '<p>Партия завершена.</p>',
          [{ label: 'В меню', primary: true, action: function () { closeModal(); showMenu(); } }]);
      }, 600);
    });

    Net.on('hostLeft', function () {
      netConnected = false;
      gameOver = true;
      toast('Хост отключился');
      setTimeout(function () {
        showModal('Хост отключился', '<p>Партия завершена.</p>',
          [{ label: 'В меню', primary: true, action: function () { closeModal(); showMenu(); } }]);
      }, 600);
    });

    Net.on('error', function (msg) {
      showModal('Ошибка', '<p>' + msg + '</p>',
        [{ label: 'OK', primary: true, action: function () { closeModal(); showMenu(); } }]);
    });
  }

  function handleGuestMoveIntent(intent) {
    if (gameMode !== 'online-host') return;
    if (state.turn !== 'b') return;

    const moves = Chess.legalMoves(state, 'b');
    const matching = moves.find(function (m) {
      return m.from.r === intent.from.r && m.from.c === intent.from.c &&
             m.to.r === intent.to.r && m.to.c === intent.to.c &&
             (m.promotion || null) === (intent.promotion || null);
    });
    if (!matching) return;
    performMove(matching);
  }

  function handleGuestStandIntent(intent) {
    if (gameMode !== 'online-host') return;
    if (state.turn !== 'b') return;

    const snapshot = cloneState(state);
    const res = Stands.activate(state, intent.from, intent.target);
    if (!res.ok) { state = snapshot; return; }
    if (Chess.isInCheck(state.board, 'b')) { state = snapshot; broadcastState(); return; }

    playSound('stand');
    finishTurn(res.log);
    broadcastState();
  }

  /* ============================================================
     МОДАЛКИ / ТОСТЫ / ЛОГ
     ============================================================ */
  function showModal(title, html, actions) {
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modalActions.innerHTML = '';
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      const b = document.createElement('button');
      b.className = 'btn' + (a.primary ? ' primary' : '');
      b.textContent = a.label;
      b.onclick = a.action;
      modalActions.appendChild(b);
    }
    modal.classList.remove('hidden');
  }

  function closeModal() {
    modal.classList.add('hidden');
  }

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.add('hidden'); }, 1900);
  }

  function pushLog(lines) {
    if (!lines || !lines.length) return;
    for (let i = 0; i < lines.length; i++) {
      const d = document.createElement('div');
      d.className = 'log-line';
      d.textContent = lines[i];
      logEl.prepend(d);
    }
    while (logEl.children.length > 5) logEl.removeChild(logEl.lastChild);
  }

  /* ============================================================
     РАСКЛАДКА
     ============================================================ */
  function layout() {
    const w = wrapEl.clientWidth;
    const h = wrapEl.clientHeight;
    if (!w || !h) return;
    const size = Math.max(180, Math.min(w, h));
    boardEl.style.width = size + 'px';
    boardEl.style.height = size + 'px';
    boardEl.style.setProperty('--cell', (size / 8) + 'px');
  }

  /* ============================================================
     ДОСКА
     ============================================================ */
  function buildCells() {
    cellsEl.innerHTML = '';
    cellEls = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const d = document.createElement('div');
        d.className = 'cell ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
        d.dataset.r = r;
        d.dataset.c = c;
        cellsEl.appendChild(d);
        cellEls.push(d);
      }
    }
  }

  /* ============================================================
     РЕНДЕР
     ============================================================ */
  function render() {
    if (!state) return;

    /* --- фигуры --- */
    const seen = new Set();

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = state.board[r][c];
        if (!p) continue;
        seen.add(p.id);

        let el = pieceEls.get(p.id);
        if (!el) {
          el = document.createElement('div');
          el.className = 'piece';
          el.innerHTML = '<span class="glyph"></span><span class="badge"></span>';
          el.style.left = (c * 12.5) + '%';
          el.style.top = (r * 12.5) + '%';
          piecesEl.appendChild(el);
          pieceEls.set(p.id, el);
        }

        el.style.left = (c * 12.5) + '%';
        el.style.top = (r * 12.5) + '%';

        el.classList.toggle('white', p.color === 'w');
        el.classList.toggle('black', p.color === 'b');
        el.classList.toggle('frozen', p.frozen > 0);

        const glyph = el.firstChild;
        glyph.textContent = GLYPH[p.color][p.type];

        const badge = el.lastChild;
        if (p.stand) {
          const def = Stands.registry[p.stand.key];
          badge.textContent = def.letter + p.stand.charges;
          badge.style.background = def.color;
          badge.style.display = 'flex';
        } else {
          badge.style.display = 'none';
        }
      }
    }

    const toRemove = [];
    pieceEls.forEach(function (el, id) {
      if (!seen.has(id)) toRemove.push(id);
    });
    for (let i = 0; i < toRemove.length; i++) {
      const el = pieceEls.get(toRemove[i]);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      pieceEls.delete(toRemove[i]);
    }

    /* --- подсветка клеток --- */
    for (let i = 0; i < 64; i++) {
      const r = Math.floor(i / 8), c = i % 8;
      cellEls[i].className = 'cell ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
    }

    if (lastMove) {
      cellEls[lastMove.from.r * 8 + lastMove.from.c].classList.add('lastmove');
      cellEls[lastMove.to.r * 8 + lastMove.to.c].classList.add('lastmove');
    }

    if (hintMove) {
      cellEls[hintMove.from.r * 8 + hintMove.from.c].classList.add('hint');
      cellEls[hintMove.to.r * 8 + hintMove.to.c].classList.add('hint');
    }

    if (selected) {
      cellEls[selected.r * 8 + selected.c].classList.add('sel');
    }

    for (let i = 0; i < selectedMoves.length; i++) {
      const m = selectedMoves[i];
      if (m.promotion && m.promotion !== 'q') continue;
      const el = cellEls[m.to.r * 8 + m.to.c];
      const isCap = !!state.board[m.to.r][m.to.c] || m.isEnPassant;
      el.classList.add(isCap ? 'capture' : 'move');
    }

    if (standMode) {
      cellEls[standMode.from.r * 8 + standMode.from.c].classList.add('sel');
      for (let i = 0; i < standMode.targets.length; i++) {
        const t = standMode.targets[i];
        cellEls[t.r * 8 + t.c].classList.add('target');
      }
    }

    /* --- шах --- */
    if (!gameOver && Chess.isInCheck(state.board, state.turn)) {
      const k = Chess.findKing(state.board, state.turn);
      if (k) cellEls[k.r * 8 + k.c].classList.add('check');
    }

    /* --- статус --- */
    if (gameOver) {
      statusMain.textContent = 'Партия окончена';
    } else if (gameMode === 'ai') {
      if (state.turn === 'w') {
        statusMain.textContent = 'Ваш ход (белые)' + (Chess.isInCheck(state.board, 'w') ? ' — ШАХ!' : '');
      } else {
        statusMain.textContent = 'Ход ИИ (чёрные)' + (Chess.isInCheck(state.board, 'b') ? ' — ШАХ!' : '');
      }
    } else {
      if (state.turn === myColor) {
        statusMain.textContent = 'Ваш ход' + (Chess.isInCheck(state.board, myColor) ? ' — ШАХ!' : '');
      } else {
        statusMain.textContent = 'Ход соперника' + (Chess.isInCheck(state.board, state.turn) ? ' — ШАХ!' : '');
      }
    }

    let myStands = 0, hisStands = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = state.board[r][c];
        if (!p || !p.stand) continue;
        if (p.color === myColor) myStands++; else hisStands++;
      }
    }
    statusSub.textContent = 'Ваши стенды: ' + myStands + ' · Стенды соперника: ' + hisStands;

    /* --- кнопка «Стенд» --- */
    const sel = selected ? state.board[selected.r][selected.c] : null;
    if (sel && sel.stand && Stands.registry[sel.stand.key].active && state.turn === myColor && !gameOver) {
      const def = Stands.registry[sel.stand.key];
      const s = sel.stand;
      btnStand.classList.remove('hidden');
      btnStand.disabled = (s.charges <= 0 || s.cooldownLeft > 0);
      if (s.cooldownLeft > 0) {
        btnStand.textContent = def.name + ' · перезарядка ' + s.cooldownLeft;
      } else {
        btnStand.textContent = def.name + ' · ' + s.charges + ' зар.';
      }
    } else {
      btnStand.classList.add('hidden');
    }
  }

  /* ============================================================
     ИГРОВОЙ ЦИКЛ
     ============================================================ */

  function cloneState(s) {
    const board = s.board.map(function (row) {
      return row.map(function (p) {
        if (!p) return null;
        return {
          id: p.id, type: p.type, color: p.color,
          frozen: p.frozen, homeR: p.homeR, homeC: p.homeC,
          stand: p.stand ? {
            key: p.stand.key,
            charges: p.stand.charges,
            cooldownLeft: p.stand.cooldownLeft,
            usedTargets: new Set(p.stand.usedTargets)
          } : null
        };
      });
    });

    return {
      board: board,
      turn: s.turn,
      castling: { wK: s.castling.wK, wQ: s.castling.wQ, bK: s.castling.bK, bQ: s.castling.bQ },
      enPassant: s.enPassant ? { r: s.enPassant.r, c: s.enPassant.c } : null,
      ply: s.ply,
      bigQueue: (s.bigQueue || []).map(function (e) {
        return { piece: e.piece, r: e.r, c: e.c, turnsLeft: e.turnsLeft, color: e.color };
      })
    };
  }

  function checkGameState() {
    const moves = Chess.legalMoves(state, state.turn);
    const inCheck = Chess.isInCheck(state.board, state.turn);
    if (moves.length === 0) {
      if (inCheck) return { over: true, winner: state.turn === 'w' ? 'b' : 'w', reason: 'мат' };
      return { over: true, winner: null, reason: 'пат' };
    }
    return { over: false, check: inCheck };
  }

  function endGame(gs) {
    gameOver = true;
    render();

    let title, text;
    if (gs.winner === 'w') {
      title = 'Победа!';
      text = 'Белые поставили мат чёрным. Йо-йо!';
    } else if (gs.winner === 'b') {
      title = 'Поражение';
      text = 'Чёрные поставили мат белым. Стенды не спасли.';
    } else {
      title = 'Ничья';
      text = 'Пат: ходов нет, но и шаха тоже нет.';
    }

    if (gameMode !== 'ai') {
      if (gs.winner === myColor) { title = 'Победа!'; text = 'Вы поставили мат сопернику.'; }
      else if (gs.winner && gs.winner !== myColor) { title = 'Поражение'; text = 'Соперник поставил мат.'; }
    }

    showModal(title, '<p>' + text + '</p>', [{
      label: gameMode === 'online-guest' ? 'В меню' : 'Новая партия',
      primary: true,
      action: function () {
        closeModal();
        if (gameMode === 'online-guest') showMenu();
        else newGame(gameMode);
      }
    }]);
  }

  function finishTurn(logs) {
    const msgs = (logs || []).slice();

    Stands.onTurnEnd(state, state.turn);
    state.ply++;
    state.turn = state.turn === 'w' ? 'b' : 'w';

    const startMsgs = Stands.onTurnStart(state, state.turn);
    for (let i = 0; i < startMsgs.length; i++) msgs.push(startMsgs[i]);

    selected = null;
    selectedMoves = [];
    standMode = null;

    render();
    pushLog(msgs);

    const gs = checkGameState();
    if (gs.over) { endGame(gs); return; }

    if (state.turn === 'b' && gameMode === 'ai') {
      setTimeout(aiTurn, 280);
    }
  }

  function performMove(move) {
    const b = state.board;
    const piece = b[move.from.r][move.from.c];
    if (!piece) return;

    const capSq = move.isEnPassant
      ? { r: move.from.r, c: move.to.c }
      : { r: move.to.r, c: move.to.c };
    const victim = b[capSq.r][capSq.c];

    if (victim) {
      const res = Stands.onCaptureAttempt(state, piece, victim, move);
      if (res.intercepted) {
        state.enPassant = null;
        playSound('capture');
        finishTurn([res.text]);
        if (gameMode === 'online-host') broadcastState();
        return;
      }
    }

    const movingType = piece.type;

    b[move.from.r][move.from.c] = null;
    if (move.isEnPassant) b[move.from.r][move.to.c] = null;

    if (move.isCastle) {
      const row = move.from.r;
      if (move.to.c === 6) { b[row][5] = b[row][7]; b[row][7] = null; }
      else                { b[row][3] = b[row][0]; b[row][0] = null; }
    }

    if (move.promotion) {
      piece.type = move.promotion;
    }
    b[move.to.r][move.to.c] = piece;

    Chess.updateCastling(state.castling, move.from, movingType, victim ? capSq : null);

    state.enPassant = (movingType === 'p' && Math.abs(move.to.r - move.from.r) === 2)
      ? { r: (move.from.r + move.to.r) / 2, c: move.from.c }
      : null;

    const logs = [];

    if (victim) {
      const msg = Stands.onPieceCaptured(state, victim);
      if (msg) logs.push(msg);
      playSound('capture');
    } else {
      playSound('move');
    }

    lastMove = { from: { r: move.from.r, c: move.from.c }, to: { r: move.to.r, c: move.to.c } };

    finishTurn(logs);
    if (gameMode === 'online-host') broadcastState();
  }

  /* ---------------- ход ИИ ---------------- */
  function aiTurn() {
    if (gameMode !== 'ai') return;
    if (gameOver) return;
    if (state.turn !== 'b') return;

    const action = AI.pickAction(state);
    if (!action) { finishTurn([]); return; }

    if (action.kind === 'stand') {
      const snapshot = cloneState(state);
      const res = Stands.activate(state, action.from, action.target);
      if (res.ok && !Chess.isInCheck(state.board, 'b')) {
        playSound('stand');
        finishTurn(res.log);
        return;
      }
      state = snapshot;
      const move = AI.pickMove(state);
      if (move) { performMove(move); return; }
      finishTurn([]);
      return;
    }

    performMove(action.move);
  }

  /* ---------------- ход человека ---------------- */
  function doHumanMove(move) {
    selected = null;
    selectedMoves = [];
    hintMove = null;
    if (gameMode === 'online-guest') {
      Net.send({
        type: 'moveIntent',
        from: move.from, to: move.to,
        promotion: move.promotion || null
      });
      toast('Ход отправлен…');
      render();
      return;
    }
    performMove(move);
  }

  function activateStandHuman(from, target) {
    const snapshot = cloneState(state);
    const res = Stands.activate(state, from, target);
    if (!res.ok) { toast(res.msg || 'Не получилось.'); return; }
    if (Chess.isInCheck(state.board, myColor)) {
      state = snapshot;
      standMode = null;
      render();
      toast('Нельзя оставить короля под шахом.');
      return;
    }
    playSound('stand');
    finishTurn(res.log);
    if (gameMode === 'online-host') broadcastState();
  }

  /* ============================================================
     ВВОД
     ============================================================ */
  function onCellClick(r, c) {
    if (gameOver || !state) return;
    ensureAudio();
    if (state.turn !== myColor) return;

    if (gameMode === 'online-guest') {
      handleGuestClick(r, c);
    } else {
      handleLocalClick(r, c);
    }
  }

  function handleLocalClick(r, c) {
    if (standMode) {
      let hit = false;
      for (let i = 0; i < standMode.targets.length; i++) {
        const t = standMode.targets[i];
        if (t.r === r && t.c === c) { hit = true; break; }
      }
      if (hit) {
        const from = standMode.from;
        standMode = null;
        activateStandHuman(from, { r: r, c: c });
      } else {
        standMode = null;
        render();
      }
      return;
    }

    const piece = state.board[r][c];

    if (selected) {
      let target = null;
      let hasPromo = false;
      for (let i = 0; i < selectedMoves.length; i++) {
        const m = selectedMoves[i];
        if (m.to.r === r && m.to.c === c) {
          if (m.promotion) hasPromo = true;
          else target = m;
        }
      }
      if (hasPromo) { askPromotion(r, c); return; }
      if (target) { doHumanMove(target); return; }
    }

    if (piece && piece.color === myColor) {
      selected = { r: r, c: c };
      selectedMoves = Chess.legalMoves(state, myColor).filter(function (m) {
        return m.from.r === r && m.from.c === c;
      });
      hintMove = null;
    } else {
      selected = null;
      selectedMoves = [];
    }
    render();
  }

  function handleGuestClick(r, c) {
    if (standMode) {
      let hit = false;
      for (let i = 0; i < standMode.targets.length; i++) {
        const t = standMode.targets[i];
        if (t.r === r && t.c === c) { hit = true; break; }
      }
      if (hit) {
        const from = standMode.from;
        standMode = null;
        Net.send({ type: 'standIntent', from: from, target: { r: r, c: c } });
        selected = null;
        selectedMoves = [];
        toast('Стенд активирован…');
        render();
      } else {
        standMode = null;
        render();
      }
      return;
    }

    const piece = state.board[r][c];

    if (selected) {
      let target = null;
      let hasPromo = false;
      for (let i = 0; i < selectedMoves.length; i++) {
        const m = selectedMoves[i];
        if (m.to.r === r && m.to.c === c) {
          if (m.promotion) hasPromo = true;
          else target = m;
        }
      }
      if (hasPromo) { askPromotion(r, c); return; }
      if (target) { doHumanMove(target); return; }
    }

    if (piece && piece.color === myColor) {
      selected = { r: r, c: c };
      selectedMoves = Chess.legalMoves(state, myColor).filter(function (m) {
        return m.from.r === r && m.from.c === c;
      });
      hintMove = null;
    } else {
      selected = null;
      selectedMoves = [];
    }
    render();
  }

  function askPromotion(r, c) {
    showModal('Превращение пешки', '<div class="promo-row" id="promoRow"></div>', []);
    const row = document.getElementById('promoRow');
    const types = ['q', 'r', 'b', 'n'];

    for (let i = 0; i < types.length; i++) {
      (function (type) {
        const b = document.createElement('button');
        b.className = 'btn promo-btn';
        b.textContent = GLYPH[myColor][type];
        b.onclick = function () {
          closeModal();
          let chosen = null;
          for (let k = 0; k < selectedMoves.length; k++) {
            const m = selectedMoves[k];
            if (m.to.r === r && m.to.c === c && m.promotion === type) { chosen = m; break; }
          }
          if (chosen) doHumanMove(chosen);
        };
        row.appendChild(b);
      })(types[i]);
    }
  }

  boardEl.addEventListener('click', function (e) {
    const cell = e.target.closest ? e.target.closest('.cell') : null;
    if (!cell) return;
    onCellClick(parseInt(cell.dataset.r, 10), parseInt(cell.dataset.c, 10));
  });

  /* ============================================================
     КНОПКИ
     ============================================================ */
  btnStand.addEventListener('click', function () {
    if (gameOver || !state || state.turn !== myColor || !selected) return;
    const p = state.board[selected.r][selected.c];
    if (!p || !p.stand) return;

    const def = Stands.registry[p.stand.key];
    if (!def.active) { toast('Этот стенд пассивный — он сработает сам.'); return; }
    if (p.stand.charges <= 0) { toast('Заряды закончились.'); return; }
    if (p.stand.cooldownLeft > 0) { toast('Стенд ещё перезаряжается.'); return; }

    const targets = Stands.validTargets(state, selected.r, selected.c);
    if (!targets.length) { toast('Нет подходящих целей.'); return; }

    standMode = { from: { r: selected.r, c: selected.c }, targets: targets };
    selected = null;
    selectedMoves = [];
    render();
  });

  btnHint.addEventListener('click', function () {
    if (gameOver || !state || state.turn !== myColor) return;
    ensureAudio();

    const moves = Chess.legalMoves(state, myColor);
    if (!moves.length) return;

    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < moves.length; i++) {
      const ns = Chess.simulate(state, moves[i]);
      const v = AI.evaluate(ns, myColor) + (Math.random() * 8 - 4);
      if (v > bestScore) { bestScore = v; best = moves[i]; }
    }

    hintMove = best;
    render();

    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      hintMove = null;
      render();
    }, 2200);
  });

  btnNew.addEventListener('click', function () {
    ensureAudio();
    closeModal();
    if (gameMode === 'online-guest') {
      toast('Новую партию может начать только хост.');
      return;
    }
    if (gameMode === 'online-host') {
      newGame('online-host');
      return;
    }
    newGame('ai');
  });

  /* ============================================================
     ТУТОРИАЛ ПО СТЕНДАМ
     ============================================================ */
  function collectStandKeys() {
    const set = new Set();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = state.board[r][c];
        if (p && p.stand) set.add(p.stand.key);
      }
    }
    return Array.from(set);
  }

  function queueStandHints() {
    const keys = collectStandKeys();
    for (let i = 0; i < keys.length; i++) {
      if (!shownTutorials.has(keys[i])) {
        shownTutorials.add(keys[i]);
        hintQueue.push(keys[i]);
      }
    }
    showNextHint();
  }

  function showNextHint() {
    if (hintOpen || !hintQueue.length) return;
    hintOpen = true;

    const key = hintQueue.shift();
    const def = Stands.registry[key];

    showModal(def.name, '<p>' + def.tutorial + '</p>', [{
      label: 'Понятно',
      primary: true,
      action: function () {
        closeModal();
        hintOpen = false;
        setTimeout(showNextHint, 140);
      }
    }]);
  }

  /* ============================================================
     МЕНЮ
     ============================================================ */
  function showMenu() {
    gameMode = 'ai';
    myColor = 'w';
    netConnected = false;
    gameOver = true;
    state = null;
    selected = null;
    selectedMoves = [];
    standMode = null;
    lastMove = null;
    hintMove = null;
    piecesEl.innerHTML = '';
    pieceEls.clear();
    logEl.innerHTML = '';
    statusMain.textContent = 'Готов к игре';
    statusSub.textContent = '';
    btnStand.classList.add('hidden');
    Net.disconnect();

    showModal('Шахматы со стендами',
      '<p>Выберите режим игры.</p>',
      [
        { label: 'Против ИИ', primary: true, action: function () { closeModal(); gameMode = 'ai'; myColor = 'w'; newGame('ai'); } },
        { label: 'Создать онлайн', action: function () { closeModal(); startOnlineHost(); } },
        { label: 'Присоединиться', action: function () { closeModal(); askJoinCode(); } }
      ]);
  }

  function askJoinCode() {
    showModal('Присоединиться',
      '<p>Введите код комнаты:</p>' +
      '<input id="joinCodeInput" type="text" maxlength="6" ' +
      'style="width:100%;padding:12px;font-size:18px;text-transform:uppercase;' +
      'background:#0f1117;border:1px solid #262c3c;border-radius:10px;' +
      'color:#e9e9f2;font-family:inherit;letter-spacing:3px;text-align:center" ' +
      'placeholder="ABC123">',
      [
        { label: 'Назад', action: function () { closeModal(); showMenu(); } },
        { label: 'Войти', primary: true, action: function () {
            const el = document.getElementById('joinCodeInput');
            const v = el ? el.value.trim().toUpperCase() : '';
            if (v.length !== 6) { toast('Код должен быть 6 символов'); return; }
            closeModal();
            startOnlineJoin(v);
          }
        }
      ]);
  }

  /* ============================================================
     НОВАЯ ПАРТИЯ
     ============================================================ */
  function newGame(mode) {
    mode = mode || 'ai';
    gameMode = mode;
    closeModal();

    gameOver = false;
    selected = null;
    selectedMoves = [];
    standMode = null;
    lastMove = null;
    hintMove = null;
    hintQueue = [];
    hintOpen = false;
    clearTimeout(hintTimer);

    state = Chess.createInitialState();
    Stands.assignStands(state);

    piecesEl.innerHTML = '';
    pieceEls.clear();
    logEl.innerHTML = '';

    layout();
    render();
    queueStandHints();

    if (gameMode === 'online-host') {
      setTimeout(broadcastState, 80);
    }

    if (gameMode === 'ai' && state.turn === 'b') {
      setTimeout(aiTurn, 350);
    }
  }

  /* ============================================================
     СТАРТ
     ============================================================ */
  buildCells();
  layout();

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(function () { layout(); });
    ro.observe(wrapEl);
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () {
    setTimeout(layout, 250);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) layout();
  });

  setupNetHandlers();

  const urlParams = new URLSearchParams(location.search);
  const autoRoom = urlParams.get('room');
  if (autoRoom) {
    startOnlineJoin(autoRoom.toUpperCase());
  } else {
    showMenu();
  }

})();
