'use strict';

/* ============================================================
   ai.js — ИИ среднего уровня (глубина 3–4 + quiescence).
   Оценка: материал + PST + пешки + безопасность короля.
   Стенды используются, если по поиску они дают больше.
   ============================================================ */

const AI = (function () {

  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

  /* ------------------------------------------------------------
     Piece-Square Tables (Michniewski).
     Индексация [r][c], где r=0 — верх доски (8-я горизонталь).
     Значения даны для БЕЛЫХ. Для чёрных зеркалим строки: 7-r.
     ------------------------------------------------------------ */
  const PST = {
    p: [
      [  0,   0,   0,   0,   0,   0,   0,   0],
      [ 50,  50,  50,  50,  50,  50,  50,  50],
      [ 10,  10,  20,  30,  30,  20,  10,  10],
      [  5,   5,  10,  25,  25,  10,   5,   5],
      [  0,   0,   0,  20,  20,   0,   0,   0],
      [  5,  -5, -10,   0,   0, -10,  -5,   5],
      [  5,  10,  10, -20, -20,  10,  10,   5],
      [  0,   0,   0,   0,   0,   0,   0,   0]
    ],
    n: [
      [-50, -40, -30, -30, -30, -30, -40, -50],
      [-40, -20,   0,   0,   0,   0, -20, -40],
      [-30,   0,  10,  15,  15,  10,   0, -30],
      [-30,   5,  15,  20,  20,  15,   5, -30],
      [-30,   0,  15,  20,  20,  15,   0, -30],
      [-30,   5,  10,  15,  15,  10,   5, -30],
      [-40, -20,   0,   5,   5,   0, -20, -40],
      [-50, -40, -30, -30, -30, -30, -40, -50]
    ],
    b: [
      [-20, -10, -10, -10, -10, -10, -10, -20],
      [-10,   0,   0,   0,   0,   0,   0, -10],
      [-10,   0,   5,  10,  10,   5,   0, -10],
      [-10,   5,   5,  10,  10,   5,   5, -10],
      [-10,   0,  10,  10,  10,  10,   0, -10],
      [-10,  10,  10,  10,  10,  10,  10, -10],
      [-10,   5,   0,   0,   0,   0,   5, -10],
      [-20, -10, -10, -10, -10, -10, -10, -20]
    ],
    r: [
      [  0,   0,   0,   0,   0,   0,   0,   0],
      [  5,  10,  10,  10,  10,  10,  10,   5],
      [ -5,   0,   0,   0,   0,   0,   0,  -5],
      [ -5,   0,   0,   0,   0,   0,   0,  -5],
      [ -5,   0,   0,   0,   0,   0,   0,  -5],
      [ -5,   0,   0,   0,   0,   0,   0,  -5],
      [ -5,   0,   0,   0,   0,   0,   0,  -5],
      [  0,   0,   0,   5,   5,   0,   0,   0]
    ],
    q: [
      [-20, -10, -10,  -5,  -5, -10, -10, -20],
      [-10,   0,   0,   0,   0,   0,   0, -10],
      [-10,   0,   5,   5,   5,   5,   0, -10],
      [ -5,   0,   5,   5,   5,   5,   0,  -5],
      [  0,   0,   5,   5,   5,   5,   0,  -5],
      [-10,   5,   5,   5,   5,   5,   0, -10],
      [-10,   0,   5,   0,   0,   0,   0, -10],
      [-20, -10, -10,  -5,  -5, -10, -10, -20]
    ],
    k: [
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-20, -30, -30, -40, -40, -30, -30, -20],
      [-10, -20, -20, -20, -20, -20, -20, -10],
      [ 20,  20,   0,   0,   0,   0,  20,  20],
      [ 20,  30,  10,   0,   0,  10,  30,  20]
    ],
    kEnd: [
      [-50, -40, -30, -20, -20, -30, -40, -50],
      [-30, -20, -10,   0,   0, -10, -20, -30],
      [-30, -10,  20,  30,  30,  20, -10, -30],
      [-30, -10,  30,  40,  40,  30, -10, -30],
      [-30, -10,  30,  40,  40,  30, -10, -30],
      [-30, -10,  20,  30,  30,  20, -10, -30],
      [-30, -30,   0,   0,   0,   0, -30, -30],
      [-50, -30, -30, -30, -30, -30, -30, -50]
    ]
  };

  function isEndgame(board) {
    let total = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type !== 'k' && p.type !== 'p') total += VAL[p.type];
    }
    return total < 1500;
  }

  /* ---------------- оценка (с точки зрения белых) ---------------- */
  function evaluate(state) {
    const b = state.board;
    const eg = isEndgame(b);
    let score = 0;

    // Материал + PST + штраф за заморозку
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = b[r][c];
      if (!p) continue;
      const sign = p.color === 'w' ? 1 : -1;
      score += sign * VAL[p.type];
      const tbl = p.type === 'k' ? (eg ? PST.kEnd : PST.k) : PST[p.type];
      const pstVal = p.color === 'w' ? tbl[r][c] : tbl[7 - r][c];
      score += sign * pstVal;
      if (p.frozen > 0) score -= sign * 25 * Math.min(p.frozen, 2);
    }

    // Слоновая пара
    let wB = 0, bB = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = b[r][c];
      if (p && p.type === 'b') { if (p.color === 'w') wB++; else bB++; }
    }
    if (wB >= 2) score += 30;
    if (bB >= 2) score -= 30;

    // Пешечная структура: сдвоенные и изолированные
    const wF = [0,0,0,0,0,0,0,0];
    const bF = [0,0,0,0,0,0,0,0];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = b[r][c];
      if (!p || p.type !== 'p') continue;
      if (p.color === 'w') wF[c]++; else bF[c]++;
    }
    for (let f = 0; f < 8; f++) {
      if (wF[f] > 1) score -= (wF[f] - 1) * 15;
      if (bF[f] > 1) score += (bF[f] - 1) * 15;
      if (wF[f] > 0) {
        const isolated = (f === 0 || wF[f-1] === 0) && (f === 7 || wF[f+1] === 0);
        if (isolated) score -= 12;
      }
      if (bF[f] > 0) {
        const isolated = (f === 0 || bF[f-1] === 0) && (f === 7 || bF[f+1] === 0);
        if (isolated) score += 12;
      }
    }

    // Пешечное прикрытие короля (только мидгейм)
    if (!eg) {
      const wk = Chess.findKing(b, 'w');
      const bk = Chess.findKing(b, 'b');
      if (wk) score += kingShield(b, wk.r, wk.c, 'w');
      if (bk) score -= kingShield(b, bk.r, bk.c, 'b');
    }

    return score;
  }

  function kingShield(board, kr, kc, color) {
    const backRow = color === 'w' ? 7 : 0;
    if (kr !== backRow) return 0;
    let bonus = 0;
    const dir = color === 'w' ? -1 : 1;
    for (let dc = -1; dc <= 1; dc++) {
      const c = kc + dc;
      if (c < 0 || c > 7) continue;
      const r = kr + dir;
      if (r < 0 || r > 7) continue;
      const p = board[r][c];
      if (p && p.type === 'p' && p.color === color) bonus += 15;
    }
    return bonus;
  }

  /* ---------------- порядок ходов ---------------- */
  function orderMoves(state, moves) {
    for (const m of moves) {
      let s = 0;
      const victim = state.board[m.to.r][m.to.c];
      if (victim) s += 10 * VAL[victim.type] - VAL[m.piece.type];
      if (m.isEnPassant) s += 100;
      if (m.promotion) s += 800;
      m._order = s;
    }
    moves.sort((a, b) => b._order - a._order);
    for (const m of moves) delete m._order;
  }

  function isQuiet(state, m) {
    if (state.board[m.to.r][m.to.c]) return false;
    if (m.isEnPassant || m.promotion) return false;
    return true;
  }

  function sideEval(state) {
    const e = evaluate(state);
    return state.turn === 'w' ? e : -e;
  }

  /* ---------------- поиск ---------------- */
  let nodes = 0;
  let startTime = 0;
  let timeLimit = 0;
  let searchAborted = false;

  function timeUp() {
    return (Date.now() - startTime) > timeLimit;
  }

  function negamax(state, depth, alpha, beta) {
    if (searchAborted) return alpha;
    nodes++;
    if ((nodes & 511) === 0 && timeUp()) { searchAborted = true; return alpha; }

    if (depth === 0) return quiesce(state, alpha, beta, 0);

    const moves = Chess.legalMoves(state, state.turn);
    if (!moves.length) {
      if (Chess.isInCheck(state.board, state.turn)) return -100000 - depth;
      return 0;
    }
    orderMoves(state, moves);

    let best = -Infinity;
    for (let i = 0; i < moves.length; i++) {
      const ns = Chess.simulate(state, moves[i]);
      const v = -negamax(ns, depth - 1, -beta, -alpha);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  function quiesce(state, alpha, beta, qdepth) {
    if (searchAborted) return alpha;
    nodes++;
    if ((nodes & 511) === 0 && timeUp()) { searchAborted = true; return alpha; }

    const standPat = sideEval(state);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (qdepth >= 4) return alpha;

    const allMoves = Chess.legalMoves(state, state.turn);
    const caps = [];
    for (let i = 0; i < allMoves.length; i++) {
      if (!isQuiet(state, allMoves[i])) caps.push(allMoves[i]);
    }
    if (!caps.length) return alpha;
    orderMoves(state, caps);

    for (let i = 0; i < caps.length; i++) {
      const ns = Chess.simulate(state, caps[i]);
      const v = -quiesce(ns, -beta, -alpha, qdepth + 1);
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  /* ---------------- корневой поиск ---------------- */
  function searchBestMove(state, timeBudgetMs) {
    startTime = Date.now();
    timeLimit = timeBudgetMs;
    nodes = 0;
    searchAborted = false;

    const moves = Chess.legalMoves(state, state.turn);
    if (!moves.length) return null;
    orderMoves(state, moves);

    let bestMove = moves[0];
    let bestScore = -Infinity;

    for (let depth = 1; depth <= 5; depth++) {
      let iterBest = null;
      let iterScore = -Infinity;
      let alpha = -Infinity;

      // Прошлый лучший ход — первым (ускоряет отсечения)
      if (bestMove) {
        const idx = moves.findIndex(function (m) {
          return m.from.r === bestMove.from.r && m.from.c === bestMove.from.c &&
                 m.to.r === bestMove.to.r && m.to.c === bestMove.to.c &&
                 m.promotion === bestMove.promotion;
        });
        if (idx > 0) moves.unshift(moves.splice(idx, 1)[0]);
      }

      for (let i = 0; i < moves.length; i++) {
        if (timeUp()) { searchAborted = true; break; }
        const ns = Chess.simulate(state, moves[i]);
        const v = -negamax(ns, depth - 1, -Infinity, -alpha);
        if (searchAborted) break;
        if (v > iterScore) { iterScore = v; iterBest = moves[i]; }
        if (v > alpha) alpha = v;
      }

      if (searchAborted) break;
      if (iterBest !== null) {
        bestMove = iterBest;
        bestScore = iterScore;
        // Переставим лучший в начало
        const idx = moves.indexOf(bestMove);
        if (idx > 0) moves.unshift(moves.splice(idx, 1)[0]);
      }
      if (bestScore > 90000) break; // мат найден
    }

    return { move: bestMove, score: bestScore };
  }

  /* ---------------- стенды ---------------- */
  function deepCloneState(state) {
    const board = state.board.map(function (row) {
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
      turn: state.turn,
      castling: { wK: state.castling.wK, wQ: state.castling.wQ,
                  bK: state.castling.bK, bQ: state.castling.bQ },
      enPassant: state.enPassant ? { r: state.enPassant.r, c: state.enPassant.c } : null,
      ply: state.ply,
      bigQueue: (state.bigQueue || []).map(function (e) {
        return { piece: e.piece, r: e.r, c: e.c, turnsLeft: e.turnsLeft, color: e.color };
      })
    };
  }

  function applyStandEffect(state, from, target) {
    const ns = deepCloneState(state);
    const p = ns.board[from.r][from.c];
    if (!p || !p.stand) return null;
    const def = Stands.registry[p.stand.key];
    if (!def.active || p.stand.charges <= 0 || p.stand.cooldownLeft > 0) return null;

    if (p.stand.key === 'starPlatinum') {
      const victim = ns.board[target.r][target.c];
      if (!victim || victim.type === 'k' || victim.color === p.color) return null;
      ns.board[target.r][target.c] = null;
    } else if (p.stand.key === 'heavensDoor') {
      const victim = ns.board[target.r][target.c];
      if (!victim || victim.type === 'k' || victim.color === p.color) return null;
      victim.frozen = 2;
      p.stand.usedTargets.add(victim.id);
    } else {
      return null;
    }

    p.stand.charges--;
    p.stand.cooldownLeft = def.cooldown;

    // Отражаем finishTurn из game.js
    Stands.onTurnEnd(ns, ns.turn);
    ns.ply++;
    ns.turn = ns.turn === 'w' ? 'b' : 'w';
    Stands.onTurnStart(ns, ns.turn);

    if (Chess.isInCheck(ns.board, p.color)) return null;
    return ns;
  }

  function tryStands(state) {
    if (Chess.isInCheck(state.board, state.turn)) return null;
    const color = state.turn;
    let best = null;
    let bestScore = -Infinity;

    startTime = Date.now();
    timeLimit = 200;
    nodes = 0;
    searchAborted = false;

    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (!p || p.color !== color || !p.stand || p.frozen > 0) continue;
      const def = Stands.registry[p.stand.key];
      if (!def.active) continue;
      if (p.stand.charges <= 0 || p.stand.cooldownLeft > 0) continue;

      const targets = Stands.validTargets(state, r, c);
      for (let i = 0; i < targets.length; i++) {
        if (timeUp()) break;
        const ns = applyStandEffect(state, { r: r, c: c }, targets[i]);
        if (!ns) continue;
        const v = -negamax(ns, 2, -Infinity, Infinity);
        if (v > bestScore) {
          bestScore = v;
          best = { kind: 'stand', from: { r: r, c: c }, target: targets[i], score: v };
        }
      }
    }
    return best;
  }

  /* ---------------- публичный API ---------------- */
  function pickAction(state) {
    const stand = tryStands(state);
    const moveResult = searchBestMove(state, 500);

    if (stand && (!moveResult || stand.score > moveResult.score + 40)) {
      return stand;
    }
    if (!moveResult) return null;
    return { kind: 'move', move: moveResult.move };
  }

  function pickMove(state) {
    const r = searchBestMove(state, 500);
    return r ? r.move : null;
  }

  function pickStandAction(state) {
    return tryStands(state);
  }

  return {
    evaluate: evaluate,
    pickAction: pickAction,
    pickMove: pickMove,
    pickStandAction: pickStandAction
  };
})();
