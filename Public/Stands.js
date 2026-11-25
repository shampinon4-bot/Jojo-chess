'use strict';

/* ============================================================
   stands.js — реестр стендов и вся их механика.
   Чтобы добавить новый стенд — достаточно добавить объект в registry
   и (если нужна особая логика) ветку в activate / validTargets / хуках.
   ============================================================ */

const Stands = (function () {

  const CHANCE = 0.06; // шанс получить стенд для каждой фигуры

  function cheb(r1, c1, r2, c2) {
    return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
  }

  function aligned(r1, c1, r2, c2) {
    const dr = r2 - r1, dc = c2 - c1;
    return dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc);
  }

  const NAMES = { k: 'король', q: 'ферзь', r: 'ладья', b: 'слон', n: 'конь', p: 'пешка' };

  function pieceName(p) {
    if (!p) return 'фигура';
    return NAMES[p.type] + (p.color === 'w' ? ' (белые)' : ' (чёрные)');
  }

  /* ---------------- РЕЕСТР СТЕНДОВ ---------------- */
  const registry = {

    starPlatinum: {
      key: 'starPlatinum',
      name: 'Star Platinum',
      letter: 'S',
      color: '#8b5cf6',
      active: true,
      needsTarget: true,
      charges: 2,
      cooldown: 3,
      short: 'Уничтожает вражескую фигуру в радиусе 2 по прямой/диагонали.',
      tutorial:
        'Star Platinum даёт 2 заряда «Ора-Ора!». Тапните свою фигуру со стендом → кнопка «Стенд» → выберите вражескую фигуру ' +
        'в радиусе 2 клеток по горизонтали, вертикали или диагонали. Она будет уничтожена. Активация заменяет ваш ход, ' +
        'после неё стенд перезаряжается 3 хода.'
    },

    wonderOfU: {
      key: 'wonderOfU',
      name: 'Wonder of U',
      letter: 'W',
      color: '#ef4444',
      active: false,
      needsTarget: false,
      charges: 1,
      cooldown: 0,
      short: 'Пассивно отменяет взятие и карает атакующего.',
      tutorial:
        'Wonder of U — пассивный стенд «Катастрофа». Когда враг попытается взять эту фигуру, взятие отменится, ' +
        'а у врага случайно погибнет одна его фигура (кроме короля). Срабатывает один раз за партию — ничего нажимать не нужно.'
    },

    notoriousBIG: {
      key: 'notoriousBIG',
      name: 'Notorious B.I.G.',
      letter: 'B',
      color: '#22c55e',
      active: false,
      needsTarget: false,
      charges: 1,
      cooldown: 0,
      short: 'Пассивно: фигура возвращается на стартовую клетку через 3 хода.',
      tutorial:
        'Notorious B.I.G. — пассивное «Бессмертие». Если эту фигуру возьмут, она вернётся на доску через 3 ваших хода: ' +
        'на свою стартовую клетку, а если та занята — на ближайшую свободную по часовой стрелке. Срабатывает один раз за партию.'
    },

    heavensDoor: {
      key: 'heavensDoor',
      name: "Heaven's Door",
      letter: 'H',
      color: '#eab308',
      active: true,
      needsTarget: true,
      charges: 2,
      cooldown: 2,
      short: 'Замораживает вражескую фигуру на 2 её хода.',
      tutorial:
        "Heaven's Door даёт 2 заряда «Чтения». Тапните свою фигуру → «Стенд» → выберите вражескую фигуру в радиусе 3 клеток " +
        '(кроме короля). Она не сможет ходить 2 своих хода. Каждую цель можно «прочитать» только один раз. ' +
        'Активация заменяет ваш ход.'
    },

    d4c: {
      key: 'd4c',
      name: 'D4C Love Train',
      letter: 'D',
      color: '#06b6d4',
      active: false,
      needsTarget: false,
      charges: 1,
      cooldown: 0,
      short: 'Пассивно отменяет взятие и возвращает атакующего домой.',
      tutorial:
        'D4C Love Train — пассивный «Перенос несчастья». Когда эту фигуру попытаются взять, взятие отменится, ' +
        'а атакующая фигура вернётся на свою стартовую клетку (если она занята — атакующий погибнет). Один раз за партию.'
    }
  };

  const KEYS = Object.keys(registry);

  /* ---------------- раздача стендов ---------------- */
  function assignStands(state) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = state.board[r][c];
        if (!p) continue;
        if (Math.random() < CHANCE) {
          const key = KEYS[Math.floor(Math.random() * KEYS.length)];
          const def = registry[key];
          p.stand = {
            key: key,
            charges: def.charges,
            cooldownLeft: 0,
            usedTargets: new Set()
          };
        }
      }
    }
  }

  /* ---------------- допустимые цели ---------------- */
  function validTargets(state, r, c) {
    const p = state.board[r][c];
    if (!p || !p.stand) return [];
    const s = p.stand;
    const opp = p.color === 'w' ? 'b' : 'w';
    const res = [];

    for (let rr = 0; rr < 8; rr++) {
      for (let cc = 0; cc < 8; cc++) {
        if (rr === r && cc === c) continue;
        const t = state.board[rr][cc];
        if (!t || t.color !== opp) continue;

        if (s.key === 'starPlatinum') {
          if (t.type === 'k') continue;                       // короля напрямую нельзя
          if (cheb(r, c, rr, cc) <= 2 && aligned(r, c, rr, cc)) res.push({ r: rr, c: cc });
        } else if (s.key === 'heavensDoor') {
          if (t.type === 'k') continue;                       // короля не замораживаем
          if (s.usedTargets.has(t.id)) continue;              // каждую цель — один раз
          if (cheb(r, c, rr, cc) <= 3) res.push({ r: rr, c: cc });
        }
      }
    }
    return res;
  }

  /* ---------------- активация (активные стенды) ---------------- */
  function activate(state, from, target) {
    const p = state.board[from.r][from.c];
    if (!p || !p.stand) return { ok: false, msg: 'У этой фигуры нет стенда.' };

    const s = p.stand;
    const def = registry[s.key];

    if (!def.active) return { ok: false, msg: 'Этот стенд пассивный — он сработает сам.' };
    if (p.frozen > 0) return { ok: false, msg: 'Фигура заморожена и не может использовать стенд.' };
    if (s.charges <= 0) return { ok: false, msg: 'Заряды стенда закончились.' };
    if (s.cooldownLeft > 0) return { ok: false, msg: 'Стенд ещё перезаряжается: ' + s.cooldownLeft + ' х.' };

    if (def.needsTarget) {
      if (!target) return { ok: false, msg: 'Нужно выбрать цель.' };
      const ok = validTargets(state, from.r, from.c).some(function (t) {
        return t.r === target.r && t.c === target.c;
      });
      if (!ok) return { ok: false, msg: 'Недопустимая цель.' };
    }

    const log = [];

    if (s.key === 'starPlatinum') {
      const victim = state.board[target.r][target.c];
      state.board[target.r][target.c] = null;
      log.push('Star Platinum: «ОРА-ОРА-ОРА!» — ' + pieceName(victim) + ' уничтожена.');
    } else if (s.key === 'heavensDoor') {
      const victim = state.board[target.r][target.c];
      victim.frozen = 2;
      s.usedTargets.add(victim.id);
      log.push("Heaven's Door: «Прочту тебя всего!» — " + pieceName(victim) + ' заморожена на 2 хода.');
    } else {
      return { ok: false, msg: 'Неизвестный стенд.' };
    }

    s.charges--;
    s.cooldownLeft = def.cooldown;
    return { ok: true, log: log };
  }

  /* ---------------- пассивные хуки ---------------- */

  // Попытка взятия. Возвращает { intercepted:true, text } или { intercepted:false }
  function onCaptureAttempt(state, attacker, victim, move) {
    const vs = victim.stand;
    if (!vs || vs.charges <= 0) return { intercepted: false };

    // --- D4C Love Train ---
    if (vs.key === 'd4c') {
      vs.charges--;
      state.board[move.from.r][move.from.c] = null;

      const hr = attacker.homeR, hc = attacker.homeC;
      let text = 'D4C Love Train: «Перенос несчастья»! Взятие отменено. ';

      if (state.board[hr][hc]) {
        text += 'Стартовая клетка атакующего занята — ' + pieceName(attacker) + ' уничтожена.';
      } else {
        state.board[hr][hc] = attacker;
        text += pieceName(attacker) + ' отброшена на свою стартовую клетку.';
      }
      return { intercepted: true, text: text };
    }

    // --- Wonder of U ---
    if (vs.key === 'wonderOfU') {
      vs.charges--;

      const pool = [];
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const q = state.board[r][c];
          if (q && q.color === attacker.color && q.type !== 'k') pool.push({ r: r, c: c, q: q });
        }
      }

      let text = 'Wonder of U: «Катастрофа»! Взятие отменено. ';
      if (pool.length) {
        const pick = pool[Math.floor(Math.random() * pool.length)];
        state.board[pick.r][pick.c] = null;
        text += 'Несчастье настигло ' + pieceName(pick.q) + '.';
      } else {
        text += 'Но у соперника не осталось фигур, кроме короля.';
      }
      return { intercepted: true, text: text };
    }

    return { intercepted: false };
  }

  // Фигура реально взята — проверяем Notorious B.I.G.
  function onPieceCaptured(state, victim) {
    const vs = victim.stand;
    if (!vs || vs.charges <= 0) return null;
    if (vs.key !== 'notoriousBIG') return null;

    vs.charges--;
    victim.frozen = 0;

    state.bigQueue.push({
      piece: victim,
      r: victim.homeR,
      c: victim.homeC,
      turnsLeft: 3,
      color: victim.color
    });

    return 'Notorious B.I.G.: «Бессмертие» — ' + pieceName(victim) + ' вернётся через 3 хода.';
  }

  /* ---------------- возврат B.I.G. ---------------- */

  // Поиск ближайшей свободной клетки по часовой стрелке
  function nearestFree(board, r0, c0) {
    if (!board[r0][c0]) return { r: r0, c: c0 };

    for (let rad = 1; rad <= 7; rad++) {
      const ring = [];
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
          const rr = r0 + dr, cc = c0 + dc;
          if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
          ring.push({ r: rr, c: cc, ang: Math.atan2(dr, dc) });
        }
      }
      ring.sort(function (a, b) { return a.ang - b.ang; }); // по часовой стрелке
      for (let i = 0; i < ring.length; i++) {
        if (!board[ring[i].r][ring[i].c]) return { r: ring[i].r, c: ring[i].c };
      }
    }
    return null;
  }

  /* ---------------- тики ---------------- */

  // Начало хода цвета color
  function onTurnStart(state, color) {
    const msgs = [];
    if (!state.bigQueue || !state.bigQueue.length) return msgs;

    const keep = [];
    for (let i = 0; i < state.bigQueue.length; i++) {
      const e = state.bigQueue[i];
      if (e.color !== color) { keep.push(e); continue; }

      e.turnsLeft--;
      if (e.turnsLeft > 0) { keep.push(e); continue; }

      const sq = nearestFree(state.board, e.r, e.c);
      if (!sq) continue; // крайне маловероятно

      e.piece.frozen = 0;
      state.board[sq.r][sq.c] = e.piece;
      msgs.push('Notorious B.I.G. вернулся на доску: ' + pieceName(e.piece) + '.');
    }
    state.bigQueue = keep;
    return msgs;
  }

  // Конец хода цвета color: тикают кулдауны и заморозка
  function onTurnEnd(state, color) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = state.board[r][c];
        if (!p || p.color !== color) continue;
        if (p.frozen > 0) p.frozen--;
        if (p.stand && p.stand.cooldownLeft > 0) p.stand.cooldownLeft--;
      }
    }
  }

  return {
    CHANCE: CHANCE,
    registry: registry,
    assignStands: assignStands,
    validTargets: validTargets,
    activate: activate,
    onCaptureAttempt: onCaptureAttempt,
    onPieceCaptured: onPieceCaptured,
    onTurnStart: onTurnStart,
    onTurnEnd: onTurnEnd,
    pieceName: pieceName
  };
})();
