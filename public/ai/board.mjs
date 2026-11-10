// public/ai/board.mjs — 棋盘常量与工具
export const SIZE = 15;
export const EMPTY = 0, BLACK = 1, WHITE = 2;
export const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

export function inBoard(x, y) { return x >= 0 && x < SIZE && y >= 0 && y < SIZE; }

export function hasAnyStone(board) {
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (board[y][x] !== EMPTY) return true;
  return false;
}

// 候选点：已有棋子周围 radius 格内的空点
export function candidatePoints(board, radius = 2) {
  const set = new Set();
  const key = (x, y) => y * SIZE + x;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y][x] === EMPTY) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (inBoard(nx, ny) && board[ny][nx] === EMPTY) set.add(key(nx, ny));
        }
      }
    }
  }
  return [...set].map(k => [k % SIZE, Math.floor(k / SIZE)]);
}

// (x,y) 落下 color 后是否立即成五
export function isWinAfter(board, x, y, color) {
  for (const [dx, dy] of DIRS) {
    let c = 1;
    for (const s of [1, -1]) {
      let nx = x + dx * s, ny = y + dy * s;
      while (inBoard(nx, ny) && board[ny][nx] === color) { c++; nx += dx * s; ny += dy * s; }
    }
    if (c >= 5) return true;
  }
  return false;
}
