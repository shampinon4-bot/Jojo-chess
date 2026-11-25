'use strict';

/* ============================================================
   chess.js — чистая шахматная логика (без стендов и без UI).
   Доска: board[r][c], где r=0 — верхний ряд (чёрные), r=7 — нижний (белые).
   Фигура: { id, type, color, stand, frozen, homeR, homeC }
   ============================================================ */

const Chess = (function () {

  const KNIGHT_D = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  const KING_D   = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const BISHOP_D = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const ROOK_D   = [[-1,0],[1,0],[0,-1],[0,1]];

  function inB(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

  function cloneBoard(b) { return b.map(function (row) { return row.slice(); }); }

  /* ---------------- начальная позиция ---------------- */
  function createInitialState() {
    const back = ['r','n','b','q','k','b','n','r'];
    const board = [];
    for (let r = 0; r < 8; r++) board.push(new Array(8).fill(null));

    let idCounter = 1;
    function mk(type, color, r, c) {
      return {
        id: idCounter++,
        type: type,
        color: color,
        stand: null,
        frozen: 0,
        homeR: r,
        homeC: c
      };
    }

    for (let c = 0; c < 8; c++) {
      board[0][c] = mk(back[c], 'b', 0, c);
      board[1][c] = mk('p', 'b', 1, c);
      board[6][c] = mk('p', 'w', 6, c);
      board[7][c] = mk(back[c], 'w', 7, c);
    }

    return {
      board: board,
      turn: 'w',
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      enPassant: null,
      ply: 0,
      bigQueue: []
    };
  }

  /* ---------------- атака клетки ---------------- */
  function isAttacked(board, r, c, byColor) {
    // пешки
    const pd = byColor === 'w' ? 1 : -1; // смещение от цели к атакующей пешке
    for (let i = 0; i < 2; i++) {
      const pc = c + (i === 0 ? -1 : 1);
      const pr = r + pd;
      if (inB(pr, pc)) {
        const p = board[pr][pc];
        if (p && p.color === byColor && p.type === 'p') return true;
      }
    }
    // кони
    for (let i = 0; i < KNIGHT_D.length; i++) {
      const rr = r + KNIGHT_D[i][0], cc = c + KNIGHT_D[i][1];
      if (!inB(rr, cc)) continue;
      const p = board[rr][cc];
      if (p && p.color === byColor && p.type === 'n') return true;
    }
    // король
    for (let i = 0; i < KING_D.length; i++) {
      const rr = r + KING_D[i][0], cc = c + KING_D[i][1];
      if (!inB(rr, cc)) continue;
      const p = board[rr][cc];
      if (p && p.color === byColor && p.type === 'k') return true;
    }
    // слон / ферзь
    for (let i = 0; i < BISHOP_D.length; i++) {
      let rr = r + BISHOP_D[i][0], cc = c + BISHOP_D[i][1];
      while (inB(rr, cc)) {
        const p = board[rr][cc];
        if (p) {
          if (p.color === byColor && (p.type === 'b' || p.type === 'q')) return true;
          break;
        }
        rr += BISHOP_D[i][0]; cc += BISHOP_D[i][1];
      }
    }
    // ладья / ферзь
    for (let i = 0; i < ROOK_D.length; i++) {
      let rr = r + ROOK_D[i][0], cc = c + ROOK_D[i][1];
      while (inB(rr, cc)) {
        const p = board[rr][cc];
        if (p) {
          if (p.color === byColor && (p.type === 'r' || p.type === 'q')) return true;
          break;
        }
        rr += ROOK_D[i][0]; cc += ROOK_D[i][1];
      }
    }
    return false;
  }

  function findKing(board, color) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.type === 'k' && p.color === color) return { r: r, c: c };
      }
    }
    return null;
  }

  function isInCheck(board, color) {
    const k = findKing(board, color);
    if (!k) return false;
    return isAttacked(board, k.r, k.c, color === 'w' ? 'b' : 'w');
  }

  /* ---------------- генерация псевдо-ходов ---------------- */
  function genPseudo(state, color) {
    const b = state.board;
    const moves = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = b[r][c];
        if (!p || p.color !== color) continue;
        if (p.frozen > 0) continue; // замороженная фигура не ходит
        switch (p.type) {
          case 'p': pawnMoves(state, moves, r, c, p); break;
          case 'n': stepMoves(state, moves, r, c, p, KNIGHT_D); break;
          case 'k': kingMoves(state, moves, r, c, p); break;
          case 'b': slideMoves(state, moves, r, c, p, BISHOP_D); break;
          case 'r': slideMoves(state, moves, r, c, p, ROOK_D); break;
          case 'q': slideMoves(state, moves, r, c, p, BISHOP_D.concat(ROOK_D)); break;
        }
      }
    }
    return moves;
  }

  function pushPawnMove(moves, r, c, rr, cc, p, promoRow, extra) {
    if (rr === promoRow) {
      const types = ['q','r','b','n'];
      for (let i = 0; i < types.length; i++) {
        const m = { from:{r:r,c:c}, to:{r:rr,c:cc}, piece:p, promotion:types[i] };
        if (extra) Object.assign(m, extra);
        moves.push(m);
      }
    } else {
      const m = { from:{r:r,c:c}, to:{r:rr,c:cc}, piece:p };
      if (extra) Object.assign(m, extra);
      moves.push(m);
    }
  }

  function pawnMoves(state, moves, r, c, p) {
    const b = state.board;
    const dir = p.color === 'w' ? -1 : 1;
    const startRow = p.color === 'w' ? 6 : 1;
    const promoRow = p.color === 'w' ? 0 : 7;

    const r1 = r + dir;
    if (inB(r1, c) && !b[r1][c]) {
      pushPawnMove(moves, r, c, r1, c, p, promoRow);
      const r2 = r + 2 * dir;
      if (r === startRow && inB(r2, c) && !b[r2][c]) {
        moves.push({ from:{r:r,c:c}, to:{r:r2,c:c}, piece:p });
      }
    }

    for (let i = 0; i < 2; i++) {
      const cc = c + (i === 0 ? -1 : 1);
      const rr = r + dir;
      if (!inB(rr, cc)) continue;
      const t = b[rr][cc];
      if (t && t.color !== p.color) {
        pushPawnMove(moves, r, c, rr, cc, p, promoRow);
      } else if (!t && state.enPassant && state.enPassant.r === rr && state.enPassant.c === cc) {
        const victim = b[r][cc];
        if (victim && victim.color !== p.color && victim.type === 'p') {
          moves.push({
            from:{r:r,c:c}, to:{r:rr,c:cc}, piece:p,
            isEnPassant:true, captured:victim
          });
        }
      }
    }
  }

  function stepMoves(state, moves, r, c, p, deltas) {
    const b = state.board;
    for (let i = 0; i < deltas.length; i++) {
      const rr = r + deltas[i][0], cc = c + deltas[i][1];
      if (!inB(rr, cc)) continue;
      const t = b[rr][cc];
      if (t && t.color === p.color) continue;
      moves.push({ from:{r:r,c:c}, to:{r:rr,c:cc}, piece:p });
    }
  }

  function slideMoves(state, moves, r, c, p, deltas) {
    const b = state.board;
    for (let i = 0; i < deltas.length; i++) {
      let rr = r + deltas[i][0], cc = c + deltas[i][1];
      while (inB(rr, cc)) {
        const t = b[rr][cc];
        if (t) {
          if (t.color !== p.color) moves.push({ from:{r:r,c:c}, to:{r:rr,c:cc}, piece:p });
          break;
        }
        moves.push({ from:{r:r,c:c}, to:{r:rr,c:cc}, piece:p });
        rr += deltas[i][0]; cc += deltas[i][1];
      }
    }
  }

  function kingMoves(state, moves, r, c, p) {
    const b = state.board;
    const opp = p.color === 'w' ? 'b' : 'w';
    stepMoves(state, moves, r, c, p, KING_D);

    const row = p.color === 'w' ? 7 : 0;
    if (r !== row || c !== 4) return;
    if (isAttacked(b, r, c, opp)) return;

    const kSide = p.color === 'w' ? state.castling.wK : state.castling.bK;
    const qSide = p.color === 'w' ? state.castling.wQ : state.castling.bQ;

    if (kSide) {
      const rook = b[row][7];
      if (rook && rook.type === 'r' && rook.color === p.color && rook.frozen === 0 &&
          !b[row][5] && !b[row][6] &&
          !isAttacked(b, row, 5, opp) && !isAttacked(b, row, 6, opp)) {
        moves.push({ from:{r:r,c:c}, to:{r:row,c:6}, piece:p, isCastle:true });
      }
    }
    if (qSide) {
      const rook = b[row][0];
      if (rook && rook.type === 'r' && rook.color === p.color && rook.frozen === 0 &&
          !b[row][1] && !b[row][2] && !b[row][3] &&
          !isAttacked(b, row, 3, opp) && !isAttacked(b, row, 2, opp)) {
        moves.push({ from:{r:r,c:c}, to:{r:row,c:2}, piece:p, isCastle:true });
      }
    }
  }

  /* ---------------- применение хода к доске ---------------- */
  function applyToBoard(b, m) {
    const p = b[m.from.r][m.from.c];
    if (!p) return;
    b[m.from.r][m.from.c] = null;

    if (m.isEnPassant) b[m.from.r][m.to.c] = null;

    if (m.isCastle) {
      const row = m.from.r;
      if (m.to.c === 6) { b[row][5] = b[row][7]; b[row][7] = null; }
      else              { b[row][3] = b[row][0]; b[row][0] = null; }
    }

    if (m.promotion) {
      b[m.to.r][m.to.c] = {
        id: p.id,
        type: m.promotion,
        color: p.color,
        stand: p.stand,     // стенд сохраняется при превращении
        frozen: 0,
        homeR: p.homeR,
        homeC: p.homeC
      };
    } else {
      b[m.to.r][m.to.c] = p;
    }
  }

  /* ---------------- обновление прав на рокировку ---------------- */
  function updateCastling(C, from, movingType, capturedSq) {
    if (movingType === 'k') {
      if (from.r === 7) { C.wK = false; C.wQ = false; }
      if (from.r === 0) { C.bK = false; C.bQ = false; }
    }
    if (movingType === 'r') {
      if (from.r === 7 && from.c === 0) C.wQ = false;
      if (from.r === 7 && from.c === 7) C.wK = false;
      if (from.r === 0 && from.c === 0) C.bQ = false;
      if (from.r === 0 && from.c === 7) C.bK = false;
    }
    if (capturedSq) {
      if (capturedSq.r === 7 && capturedSq.c === 0) C.wQ = false;
      if (capturedSq.r === 7 && capturedSq.c === 7) C.wK = false;
      if (capturedSq.r === 0 && capturedSq.c === 0) C.bQ = false;
      if (capturedSq.r === 0 && capturedSq.c === 7) C.bK = false;
    }
  }

  /* ---------------- легальные ходы ---------------- */
  function legalMoves(state, color) {
    const pseudo = genPseudo(state, color);
    const res = [];
    for (let i = 0; i < pseudo.length; i++) {
      const m = pseudo[i];
      const b = cloneBoard(state.board);
      applyToBoard(b, m);
      if (!isInCheck(b, color)) res.push(m);
    }
    return res;
  }

  /* ---------------- симуляция хода (для ИИ) ---------------- */
  function simulate(state, m) {
    const b = cloneBoard(state.board);
    const piece = b[m.from.r][m.from.c];
    if (!piece) return state;

    const movingType = piece.type;
    const capSq = m.isEnPassant ? { r: m.from.r, c: m.to.c } : { r: m.to.r, c: m.to.c };
    const hasCap = !!b[capSq.r][capSq.c];

    applyToBoard(b, m);

    const castling = { wK: state.castling.wK, wQ: state.castling.wQ, bK: state.castling.bK, bQ: state.castling.bQ };
    updateCastling(castling, m.from, movingType, hasCap ? capSq : null);

    const enPassant = (movingType === 'p' && Math.abs(m.to.r - m.from.r) === 2)
      ? { r: (m.from.r + m.to.r) / 2, c: m.from.c }
      : null;

    return {
      board: b,
      turn: state.turn === 'w' ? 'b' : 'w',
      castling: castling,
      enPassant: enPassant,
      ply: state.ply + 1,
      bigQueue: []
    };
  }

  return {
    createInitialState: createInitialState,
    legalMoves: legalMoves,
    genPseudo: genPseudo,
    isInCheck: isInCheck,
    isAttacked: isAttacked,
    findKing: findKing,
    simulate: simulate,
    applyToBoard: applyToBoard,
    updateCastling: updateCastling,
    cloneBoard: cloneBoard,
    inB: inB
  };
})();
