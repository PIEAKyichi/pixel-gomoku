// public/ai/worker.mjs — AI 计算 Worker:搜索在后台线程运行,主线程不再冻结
import { bestMove } from './search.mjs';

self.onmessage = (e) => {
  const { board, color, timeLimit } = e.data || {};
  // postMessage 传入的 board 是结构化克隆副本,搜索中对其落子/复原不影响游戏状态
  const mv = bestMove(board, color, { timeLimit });
  self.postMessage(mv);
};
