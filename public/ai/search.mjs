// public/ai/search.mjs — Negamax + Alpha-Beta 剪枝 + 置换表 + 迭代加深 + 威胁延伸
import { SIZE, EMPTY, BLACK, WHITE, DIRS, inBoard, candidatePoints, isWinAfter, hasAnyStone } from './board.mjs';
import { evaluateBoard, pointScore, WIN } from './evaluate.mjs';

const TIMEOUT = Symbol('timeout');
const ROOT_BRANCH = 18;   // 根节点每层保留的候选数
const DEEP_BRANCH = 12;   // 内部节点保留的候选数
const MAX_DEPTH = 14;     // 迭代加深上限
const MAX_EXT = 12;       // 威胁延伸链条上限
const TT_MAX = 1000000;   // 置换表上限（防内存膨胀）

// ---------------- Zobrist 哈希 / 置换表 ----------------
let Z1 = null, Z2 = null;
function initZobrist() {
  if (Z1) return;
  const rnd = () => (Math.random() * 0x100000000) >>> 0;
  Z1 = new Array(SIZE); Z2 = new Array(SIZE);
  for (let y = 0; y < SIZE; y++) {
    Z1[y] = new Array(SIZE); Z2[y] = new Array(SIZE);
    for (let x = 0; x < SIZE; x++) {
      Z1[y][x] = [0, rnd(), rnd()];
      Z2[y][x] = [0, rnd(), rnd()];
    }
  }
}
// 双 32 位哈希合成 53 位精确整数键
const keyOf = (h1, h2) => ((h1 & 0x1fffff) * 0x100000000 + h2);

// ---------------- 威胁工具 ----------------
// (x,y) 落下 color 后是否形成“四”（活四/冲四/跳四：下一步即可成五）
function createsFour(b, x, y, color) {
  for (const [dx, dy] of DIRS) {
    let cnt = 1, gap = false;
    for (const s of [1, -1]) {
      let i = s;
      while (Math.abs(i) <= 4) {
        const nx = x + dx * i, ny = y + dy * i;
        if (!inBoard(nx, ny)) break;
        const v = b[ny][nx];
        if (v === color) { cnt++; i += s; }
        else if (v === EMPTY && !gap) { gap = true; i += s; }
        else break;
      }
    }
    if (cnt >= 5) return true;
    if (cnt === 4 && gap) return true; // 跳四或开口冲四：补空/延伸即五
  }
  return false;
}

// 对方刚在 (x,y) 落下形成“四”时，防守方必须抢占的成五威胁点
function fourWinPoints(b, x, y, color) {
  const pts = [];
  for (const [dx, dy] of DIRS) {
    let fw = 1, bw = 1, cnt = 1;
    while (Math.abs(fw) <= 4) {
      const nx = x + dx * fw, ny = y + dy * fw;
      if (!inBoard(nx, ny) || b[ny][nx] !== color) break;
      cnt++; fw++;
    }
    while (Math.abs(bw) <= 4) {
      const nx = x - dx * bw, ny = y - dy * bw;
      if (!inBoard(nx, ny) || b[ny][nx] !== color) break;
      cnt++; bw++;
    }
    if (cnt >= 4) {
      // 连续四：开口端都是威胁点（活四两点，冲四一点）
      const fx = x + dx * fw, fy = y + dy * fw;
      const bx = x - dx * bw, by = y - dy * bw;
      if (inBoard(fx, fy) && b[fy][fx] === EMPTY) pts.push([fx, fy]);
      if (inBoard(bx, by) && b[by][bx] === EMPTY) pts.push([bx, by]);
      continue;
    }
    // 跳四：停止位是空，且空后还有同色子
    if (inBoard(x + dx * fw, y + dy * fw) && b[y + dy * fw][x + dx * fw] === EMPTY) {
      let j = fw + 1, c2 = 0;
      while (Math.abs(j) <= 5) {
        const nx = x + dx * j, ny = y + dy * j;
        if (!inBoard(nx, ny) || b[ny][nx] !== color) break;
        c2++; j++;
      }
      if (cnt + c2 >= 4) pts.push([x + dx * fw, y + dy * fw]);
    } else if (inBoard(x - dx * bw, y - dy * bw) && b[y - dy * bw][x - dx * bw] === EMPTY) {
      let j = bw + 1, c2 = 0;
      while (Math.abs(j) <= 5) {
        const nx = x - dx * j, ny = y - dy * j;
        if (!inBoard(nx, ny) || b[ny][nx] !== color) break;
        c2++; j++;
      }
      if (cnt + c2 >= 4) pts.push([x - dx * bw, y - dy * bw]);
    }
  }
  return pts;
}

// ---------------- 走法排序 ----------------
function sortMoves(board, color, moves, hist, ttMove) {
  const arr = moves.map(([x, y]) => ({ x, y, s: pointScore(board, x, y, color) + hist[y][x] }));
  arr.sort((a, b) => b.s - a.s);
  if (ttMove) {
    const idx = arr.findIndex((m) => m.x === ttMove.x && m.y === ttMove.y);
    if (idx > 0) {
      const mv = arr.splice(idx, 1)[0];
      arr.unshift(mv);
    }
  }
  return arr;
}

// ---------------- Negamax ----------------
function negamax(board, depth, alpha, beta, color, deadline, ply, h1, h2, ext, forced, lx, ly, tt, hist) {
  if (Date.now() >= deadline) throw TIMEOUT;
  const opp = color === BLACK ? WHITE : BLACK;
  const moves = candidatePoints(board, 2);
  if (moves.length === 0) return 0; // 平局
  if (depth <= 0) return evaluateBoard(board, color);

  const key = keyOf(h1, h2);
  const entry = tt.get(key);
  let ttMove = null;
  if (entry) {
    if (entry.depth >= depth) {
      if (entry.flag === 0) return entry.value;                       // exact
      if (entry.flag === 1 && entry.value >= beta) return entry.value; // lower bound
      if (entry.flag === 2 && entry.value <= alpha) return entry.value; // upper bound
    }
    ttMove = entry.move;
  }

  // 强制节点：上一手刚形成“四”，只考虑挡四与己方直接成五（其余走法必输）
  let cand;
  if (forced && ext < MAX_EXT) {
    cand = [];
    for (const [wx, wy] of fourWinPoints(board, lx, ly, opp)) {
      if (board[wy][wx] === EMPTY) cand.push([wx, wy]);
    }
    for (const [x, y] of moves) {
      if (isWinAfter(board, x, y, color)) cand.push([x, y]);
    }
    if (cand.length > 1) {
      const seen = new Set();
      cand = cand.filter(([x, y]) => {
        const k = y * SIZE + x;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
  } else {
    cand = moves;
  }

  const ordered = sortMoves(board, color, cand, hist, ttMove).slice(0, DEEP_BRANCH);
  if (ordered.length === 0) return evaluateBoard(board, color);

  let best = -Infinity, bestMove = null, flag = 2; // 2 = upper bound（全部走法都低于 alpha）
  for (const m of ordered) {
    const x = m.x, y = m.y;
    board[y][x] = color;
    let v;
    try {
      if (isWinAfter(board, x, y, color)) {
        v = WIN - ply;
      } else {
        const nh1 = h1 ^ Z1[y][x][color], nh2 = h2 ^ Z2[y][x][color];
        let cd = depth - 1, cf = false, ce = ext, clx = -1, cly = -1;
        if (createsFour(board, x, y, color) && ext < MAX_EXT) {
          cd = depth; cf = true; ce = ext + 1; clx = x; cly = y; // 成四延伸：对方必须应对
        }
        v = -negamax(board, cd, -beta, -alpha, opp, deadline, ply + 1, nh1, nh2, ce, cf, clx, cly, tt, hist);
      }
    } finally {
      board[y][x] = EMPTY; // 超时等异常也保证棋盘复原
    }
    if (v > best) { best = v; bestMove = { x, y }; }
    if (v > alpha) { alpha = v; flag = 0; }                              // 0 = exact
    if (alpha >= beta) { flag = 1; hist[y][x] += depth * depth; break; } // 1 = lower bound
  }

  if (bestMove) {
    if (tt.size > TT_MAX) tt.clear();
    tt.set(key, { depth, flag, value: best, move: bestMove });
  }
  return best;
}

// ---------------- 入口 ----------------
export function bestMove(board, color, opts) {
  const timeLimit = (opts && opts.timeLimit) || 1200;
  const deadline = Date.now() + timeLimit;
  const opp = color === BLACK ? WHITE : BLACK;
  initZobrist();
  const tt = new Map();
  const hist = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));

  if (!hasAnyStone(board)) return { x: 7, y: 7, score: 0 }; // 开局下天元

  // 初始哈希
  let h1 = 0, h2 = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = board[y][x];
      if (v !== EMPTY) { h1 ^= Z1[y][x][v]; h2 ^= Z2[y][x][v]; }
    }
  }

  const rawMoves = candidatePoints(board, 2);
  if (rawMoves.length === 0) return null;
  const moves = sortMoves(board, color, rawMoves, hist, null);

  // 我方直接成五
  for (const m of moves) {
    if (isWinAfter(board, m.x, m.y, color)) return { x: m.x, y: m.y, score: WIN };
  }

  // 对方下一手成五：威胁点唯一则必须挡
  const oppWin = [];
  for (const m of moves) {
    if (isWinAfter(board, m.x, m.y, opp)) oppWin.push(m);
  }
  if (oppWin.length === 1) return { x: oppWin[0].x, y: oppWin[0].y, score: WIN - 1 };

  let best = moves[0], bestScore = -Infinity, pv = null;
  try {
    for (let depth = 2; depth <= MAX_DEPTH; depth++) {
      const ordered = sortMoves(board, color, rawMoves, hist, pv).slice(0, ROOT_BRANCH);
      let curBest = null, curScore = -Infinity, alpha = -Infinity;
      for (const m of ordered) {
        const x = m.x, y = m.y;
        board[y][x] = color;
        let v;
        try {
          if (isWinAfter(board, x, y, color)) {
            v = WIN;
          } else {
            const nh1 = h1 ^ Z1[y][x][color], nh2 = h2 ^ Z2[y][x][color];
            let cd = depth - 1, cf = false, clx = -1, cly = -1, ce = 0;
            if (createsFour(board, x, y, color)) { cd = depth; cf = true; clx = x; cly = y; ce = 1; }
            v = -negamax(board, cd, -Infinity, -alpha, opp, deadline, 1, nh1, nh2, ce, cf, clx, cly, tt, hist);
          }
        } finally {
          board[y][x] = EMPTY; // 超时等异常也保证棋盘复原
        }
        if (v > curScore) { curScore = v; curBest = m; }
        if (v > alpha) alpha = v;
      }
      if (curBest) { best = curBest; bestScore = curScore; pv = curBest; }
      if (bestScore >= WIN - 1000) break; // 已找到必胜，提前结束
      if (Date.now() + 60 > deadline) break;
    }
  } catch (e) {
    if (e !== TIMEOUT) throw e;
  }

  return { x: best.x, y: best.y, score: bestScore };
}
