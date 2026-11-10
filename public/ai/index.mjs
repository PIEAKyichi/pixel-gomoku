// public/ai/index.mjs — AI 入口，暴露全局 GomokuAI
import { bestMove } from './search.mjs';

export { bestMove };

if (typeof window !== 'undefined') {
  window.GomokuAI = window.GomokuAI || {};
  window.GomokuAI.bestMove = bestMove;
}
