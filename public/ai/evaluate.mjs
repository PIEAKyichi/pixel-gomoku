// public/ai/evaluate.mjs — 局面评估与单点启发式（棋型识别 + 威胁判定）
import { SIZE, EMPTY, BLACK, WHITE, DIRS, inBoard } from './board.mjs';

export const WIN = 10000000;

// 基础棋型分值（仅用于无必胜威胁时的常规局面分）
const LIVE_FOUR = 1000000;
const RUSH_FOUR = 100000;
const LIVE_THREE = 80000;
const SLEEP_THREE = 8000;
const LIVE_TWO = 6000;
const SLEEP_TWO = 600;

// 预计算所有有效线（行 + 列 + 两条对角线，长度 >= 5）
export const LINES = (() => {
  const lines = [];
  for (let y = 0; y < SIZE; y++) { const l = []; for (let x = 0; x < SIZE; x++) l.push([x, y]); lines.push(l); }
  for (let x = 0; x < SIZE; x++) { const l = []; for (let y = 0; y < SIZE; y++) l.push([x, y]); lines.push(l); }
  for (let d = -(SIZE - 1); d <= SIZE - 1; d++) {
    const l = [];
    for (let x = 0; x < SIZE; x++) { const y = x - d; if (inBoard(x, y)) l.push([x, y]); }
    if (l.length >= 5) lines.push(l);
  }
  for (let s = 0; s <= 2 * (SIZE - 1); s++) {
    const l = [];
    for (let x = 0; x < SIZE; x++) { const y = s - x; if (inBoard(x, y)) l.push([x, y]); }
    if (l.length >= 5) lines.push(l);
  }
  return lines;
})();

const ZERO = () => ({ five: 0, l4: 0, r4: 0, l3: 0, s3: 0, l2: 0, s2: 0 });

// 单线棋型统计（color 视角，结果累加到 acc），无重复计数：
// 先数连续段；段长 < 5 时尝试合并“空 + 段”的跳棋型（跳四/跳三）；
// 合并后不足四子时再尝试“空 + 段 + 空 + 段”双跳棋型（眠三强度）。
function analyzeLine(b, line, color, acc) {
  const n = line.length;
  const isE = (k) => k >= 0 && k < n && b[line[k][1]][line[k][0]] === EMPTY;
  const isC = (k) => k >= 0 && k < n && b[line[k][1]][line[k][0]] === color;
  let i = 0;
  while (i < n) {
    if (!isC(i)) { i++; continue; }
    let j = i;
    while (j < n && isC(j)) j++;
    const L = j - i;
    if (L >= 5) { acc.five++; i = j; continue; }
    if (isE(j)) {
      let j2 = j + 1;
      while (j2 < n && isC(j2)) j2++;
      const L2 = j2 - (j + 1);
      if (L2 > 0) {
        const T = L + L2;
        const opens = (isE(i - 1) ? 1 : 0) + (isE(j2) ? 1 : 0);
        // 双跳棋型（两个单格空）
        if (T < 4 && isE(j2)) {
          let j3 = j2 + 1;
          while (j3 < n && isC(j3)) j3++;
          const L3 = j3 - (j2 + 1);
          if (L3 > 0) {
            const opens2 = (isE(i - 1) ? 1 : 0) + (isE(j3) ? 1 : 0);
            if (opens2 >= 1) acc.s3++;
            i = j3;
            continue;
          }
        }
        if (T >= 4) acc.r4++;                                        // 跳四：补空即五
        else if (T === 3) { if (opens === 2) acc.l3++; else if (opens === 1) acc.s3++; }
        else { if (opens === 2) acc.l2++; else if (opens === 1) acc.s2++; }
        i = j2;
        continue;
      }
    }
    // 无合并：单独段
    const opens = (isE(i - 1) ? 1 : 0) + (isE(j) ? 1 : 0);
    if (L === 4) { if (opens === 2) acc.l4++; else if (opens === 1) acc.r4++; }
    else if (L === 3) { if (opens === 2) acc.l3++; else if (opens === 1) acc.s3++; }
    else if (L === 2) { if (opens === 2) acc.l2++; else if (opens === 1) acc.s2++; }
    i = j;
  }
}

// 整局面评估：color 的相对分（color 为当前轮走方）
export function evaluateBoard(board, color) {
  const opp = color === BLACK ? WHITE : BLACK;
  const my = ZERO(), op = ZERO();
  for (const line of LINES) {
    analyzeLine(board, line, color, my);
    analyzeLine(board, line, opp, op);
  }

  // —— 威胁判定（轮到 color 走）——
  if (my.five) return WIN;
  if (op.five) return -WIN;
  const myFour = my.l4 + my.r4;
  const opFour = op.l4 + op.r4;
  if (myFour > 0) return WIN - 2;                 // 我方有四，下一步成五
  if (op.l4 > 0) return -(WIN - 2);               // 对方活四，挡不住
  if (opFour >= 2) return -(WIN - 4);             // 对方双四，只能挡一个
  if (opFour === 1 && op.l3 >= 1) return -(WIN - 6); // 对方冲四 + 活三
  if (my.l3 >= 1 && opFour === 0) return WIN - 10;   // 我方活三（对方无四）→ 必胜

  const myScore = my.l4 * LIVE_FOUR + my.r4 * RUSH_FOUR + my.l3 * LIVE_THREE
    + my.s3 * SLEEP_THREE + my.l2 * LIVE_TWO + my.s2 * SLEEP_TWO;
  const opScore = op.l4 * LIVE_FOUR + op.r4 * RUSH_FOUR + op.l3 * LIVE_THREE
    + op.s3 * SLEEP_THREE + op.l2 * LIVE_TWO + op.s2 * SLEEP_TWO;
  return myScore - opScore;
}

// —— 单点启发式（候选排序用，快速）——
function shapeScore(count, open) {
  if (count >= 5) return WIN;
  if (count === 4) return open >= 2 ? LIVE_FOUR : (open === 1 ? RUSH_FOUR : 0);
  if (count === 3) return open >= 2 ? LIVE_THREE : (open === 1 ? SLEEP_THREE : 0);
  if (count === 2) return open >= 2 ? LIVE_TWO : (open === 1 ? SLEEP_TWO : 0);
  if (count === 1) return open >= 2 ? 50 : 5;
  return 0;
}

function quickDirScore(board, x, y, color) {
  let total = 0;
  for (const [dx, dy] of DIRS) {
    let count = 1;
    let i = 1;
    while (inBoard(x + dx * i, y + dy * i) && board[y + dy * i][x + dx * i] === color) { count++; i++; }
    const o1 = inBoard(x + dx * i, y + dy * i) && board[y + dy * i][x + dx * i] === EMPTY;
    let jump = 0;
    if (o1) {
      let j = i + 1;
      while (inBoard(x + dx * j, y + dy * j) && board[y + dy * j][x + dx * j] === color) { jump++; j++; }
    }
    i = 1;
    while (inBoard(x - dx * i, y - dy * i) && board[y - dy * i][x - dx * i] === color) { count++; i++; }
    const o2 = inBoard(x - dx * i, y - dy * i) && board[y - dy * i][x - dx * i] === EMPTY;
    if (o2) {
      let j = i + 1;
      while (inBoard(x - dx * j, y - dy * j) && board[y - dy * j][x - dx * j] === color) { jump++; j++; }
    }
    const eff = Math.min(count + jump, 5); // 跳子粗略折入排序分
    total += shapeScore(eff, (o1 ? 1 : 0) + (o2 ? 1 : 0));
  }
  return total;
}

export function pointScore(board, x, y, color) {
  const opp = color === BLACK ? WHITE : BLACK;
  return quickDirScore(board, x, y, color) + quickDirScore(board, x, y, opp) * 0.9;
}
