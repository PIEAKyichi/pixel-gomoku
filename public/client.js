// public/client.js
(() => {
  'use strict';

  const SIZE = 15;
  const EMPTY = 0, BLACK = 1, WHITE = 2;
  const $ = (id) => document.getElementById(id);

  const lobbyEl = $('lobby'), gameEl = $('game');
  const nameInput = $('nameInput'), roomInput = $('roomInput'), createRoomInput = $('createRoomInput'), lobbyMsg = $('lobbyMsg');
  const roomLabel = $('roomLabel'), restartBtn = $('restartBtn'), leaveBtn = $('leaveBtn');
  const messagesEl = $('messages'), chatForm = $('chatForm'), chatInput = $('chatInput'), quickMenu = $('quick-menu');
  const canvas = $('board'), ctx = canvas.getContext('2d');
  const avatarInput = $('avatarInput'), avatarPreview = $('avatarPreview'), avatarPlaceholder = $('avatarPlaceholder');
  const modal = $('modal'), modalText = $('modalText'), modalAccept = $('modalAccept'), modalReject = $('modalReject');
  const gameoverModal = $('gameoverModal'), resultTitle = $('resultTitle'), resultDesc = $('resultDesc'), resultBtn = $('resultBtn');

  let myAvatarData = '';
  const state = {
    myId: null, myColor: 0, roomId: '', players: [], board: [], turn: 0,
    status: 'idle', winner: 0, winLine: null, pendingMove: null, lastMove: null,
    myTime: 0, oppTime: 0, urgeCount: 0
  };

  let cssSize = 0;
  let ws = null;
  let timerInterval = null;
  let oppBubbleTimer = null, myBubbleTimer = null;

  // 初始化本地存储的用户信息
  function initLocalUser() {
    const savedName = localStorage.getItem('gomoku_name');
    const savedAvatar = localStorage.getItem('gomoku_avatar');
    if (savedName) nameInput.value = savedName;
    if (savedAvatar) {
      myAvatarData = savedAvatar;
      avatarPreview.src = myAvatarData;
      avatarPreview.style.display = 'block';
      avatarPlaceholder.style.display = 'none';
    }
  }
  initLocalUser();

  // 音效
  function playSound() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const actx = new AudioContext();
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(600, actx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, actx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.2, actx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, actx.currentTime + 0.1);
      osc.connect(gain); gain.connect(actx.destination);
      osc.start(); osc.stop(actx.currentTime + 0.1);
    } catch (e) {}
  }

  // 像素化头像并保存
  avatarInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const cx = c.getContext('2d');
        cx.imageSmoothingEnabled = false;
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2, sy = (img.height - size) / 2;
        cx.drawImage(img, sx, sy, size, size, 0, 0, 32, 32);
        myAvatarData = c.toDataURL('image/png');
        localStorage.setItem('gomoku_avatar', myAvatarData);
        avatarPreview.src = myAvatarData;
        avatarPreview.style.display = 'block';
        avatarPlaceholder.style.display = 'none';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);
    ws.onmessage = (ev) => { try { handleMessage(JSON.parse(ev.data)); } catch {} };
  }

  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  function updateBjTime() {
    const now = new Date();
    const str = `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
    $('lobbyTime').textContent = str;
    $('gameTime').textContent = str;
  }

  function formatSec(sec) {
    return `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;
  }

  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (state.status === 'playing') {
        if (state.turn === state.myColor) state.myTime++;
        else state.oppTime++;
        $('myTime').textContent = formatSec(state.myTime);
        $('oppTime').textContent = formatSec(state.oppTime);
      }
    }, 1000);
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'created': case 'start': case 'restart':
        state.roomId = msg.roomId || state.roomId;
        state.myId = msg.playerId || state.myId;
        state.myColor = msg.color;
        state.board = msg.board;
        state.turn = msg.turn;
        state.players = msg.players;
        state.status = (msg.type === 'created') ? 'waiting' : 'playing';
        state.winLine = null; state.pendingMove = null; state.lastMove = null;
        state.urgeCount = 0;
        if (msg.type !== 'restart') { state.myTime = 0; state.oppTime = 0; }
        if (msg.type === 'created') {
          lobbyEl.classList.remove('active'); gameEl.classList.add('active');
          addSystemMessage(`房间已创建，ID: ${msg.roomId}`);
        } else if (msg.type === 'start') {
          lobbyEl.classList.remove('active'); gameEl.classList.add('active');
          addSystemMessage('对手已加入，对局开始！');
        } else if (msg.type === 'restart') {
          gameoverModal.classList.add('hidden');
          addSystemMessage('新对局开始，双方交换黑白');
        }
        restartBtn.classList.add('hidden');
        refreshUI(); requestAnimationFrame(resizeCanvas);
        break;
      case 'move':
        state.board[msg.y][msg.x] = msg.color;
        state.turn = msg.turn;
        state.lastMove = { x: msg.x, y: msg.y };
        state.urgeCount = 0;
        playSound();
        refreshUI();
        break;
      case 'undo_done':
        state.board = msg.board; state.turn = msg.turn; state.pendingMove = null; state.lastMove = null;
        state.urgeCount = 0;
        refreshUI(); addSystemMessage('悔棋成功');
        break;
      case 'gameover': {
        state.status = 'over'; state.winner = msg.winner; state.winLine = msg.line || null;
        refreshUI();
        showGameOver(msg);
        restartBtn.classList.remove('hidden');
        break;
      }
      case 'chat': 
        addChatMessage(msg); 
        showBubble(msg.from === state.myId, msg.text);
        break;
      case 'info': addSystemMessage(msg.msg); break;
      case 'opponentLeft':
        addSystemMessage('对手离开了房间');
        setTimeout(() => backToLobby('对手已离开'), 1200);
        break;
      case 'left': backToLobby('已离开'); break;
      case 'undo_req': showModal('对方申请悔棋', () => send({type:'undo_resp', accept:true}), () => send({type:'undo_resp', accept:false})); break;
      case 'draw_req': showModal('对方申请求和', () => send({type:'draw_resp', accept:true}), () => send({type:'draw_resp', accept:false})); break;
      case 'error': addSystemMessage(msg.msg); break;
    }
  }

  function showBubble(isMe, text) {
    const bubble = isMe ? $('myBubble') : $('oppBubble');
    bubble.textContent = text;
    bubble.classList.remove('hidden');
    if (isMe) {
      clearTimeout(myBubbleTimer);
      myBubbleTimer = setTimeout(() => bubble.classList.add('hidden'), 4000);
    } else {
      clearTimeout(oppBubbleTimer);
      oppBubbleTimer = setTimeout(() => bubble.classList.add('hidden'), 4000);
    }
  }

  function showGameOver(msg) {
    gameoverModal.classList.remove('hidden');
    if (msg.winner === 0) {
      resultTitle.textContent = '平局';
      resultDesc.textContent = '势均力敌，再战一局吧！';
    } else if (msg.winner === state.myColor) {
      resultTitle.textContent = '🎉 胜利！';
      const taunts = ["轻松拿下！", "这波操作太秀了！", "你太强了，对手已崩溃。"];
      resultDesc.textContent = taunts[Math.floor(Math.random() * taunts.length)];
    } else {
      resultTitle.textContent = '💀 失败';
      const taunts = ["太菜了，建议多练练！", "就这？我还没发力呢！", "回家洗洗睡吧！"];
      resultDesc.textContent = taunts[Math.floor(Math.random() * taunts.length)];
    }
  }

  function showModal(text, onAccept, onReject) {
    modalText.textContent = text;
    modal.classList.remove('hidden');
    modalAccept.onclick = () => { modal.classList.add('hidden'); onAccept(); };
    modalReject.onclick = () => { modal.classList.add('hidden'); onReject(); };
  }

  function backToLobby(msg) {
    clearInterval(timerInterval);
    state.status = 'idle'; state.board = []; state.winLine = null; state.myColor = 0; state.roomId = ''; state.myId = null; state.players = [];
    gameEl.classList.remove('active'); lobbyEl.classList.add('active');
    messagesEl.innerHTML = ''; restartBtn.classList.add('hidden'); gameoverModal.classList.add('hidden'); modal.classList.add('hidden');
    lobbyMsg.textContent = msg || '';
  }

  function refreshUI() {
    const me = state.players.find(p => p.color === state.myColor) || { name: '我', avatar: '' };
    const opp = state.players.find(p => p.color !== state.myColor) || { name: '等待加入...', avatar: '' };

    $('myName').textContent = me.name;
    $('oppName').textContent = opp.name;
    if (me.avatar) $('myAvatar').src = me.avatar;
    if (opp.avatar) $('oppAvatar').src = opp.avatar;
    
    $('myAvatar').style.borderColor = state.myColor === BLACK ? '#1a1c2c' : '#f4f4f4';
    $('oppAvatar').style.borderColor = state.myColor === BLACK ? '#f4f4f4' : '#1a1c2c';

    if (state.status === 'playing') {
      if (state.turn === state.myColor) {
        $('myInfo').style.borderColor = 'var(--green)';
        $('oppInfo').style.borderColor = 'var(--ink)';
      } else {
        $('oppInfo').style.borderColor = 'var(--green)';
        $('myInfo').style.borderColor = 'var(--ink)';
      }
    } else {
      $('myInfo').style.borderColor = 'var(--ink)';
      $('oppInfo').style.borderColor = 'var(--ink)';
    }

    $('myTime').textContent = formatSec(state.myTime);
    $('oppTime').textContent = formatSec(state.oppTime);
    draw();
  }

  // ================= Canvas 渲染与尺寸计算 =================
  function resizeCanvas() {
    const container = document.querySelector('.board-container');
    if (!container) return;
    
    // 获取容器真实渲染大小
    const rect = container.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;

    // 找最小边长作为正方形棋盘尺寸
    let size = Math.min(rect.width, rect.height);
    size = size - 10; // 留出一点安全边距
    if (size < 100) size = 100; 

    // 强制设置大小和居中定位
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.style.left = '50%';
    canvas.style.top = '50%';
    canvas.style.transform = 'translate(-50%, -50%)';

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    cssSize = size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  const PAD_RATIO = 0.055;
  function geom() { const pad = cssSize * PAD_RATIO; return { pad, gap: (cssSize - pad * 2) / (SIZE - 1) }; }

  function draw() {
    if (!cssSize || !state.board.length) return;
    const { pad, gap } = geom();
    ctx.fillStyle = '#c8a26a'; ctx.fillRect(0, 0, cssSize, cssSize);
    
    ctx.strokeStyle = '#8a6a3b'; ctx.lineWidth = Math.max(1, cssSize / 420); ctx.beginPath();
    const end = pad + gap * (SIZE - 1);
    for (let i = 0; i < SIZE; i++) {
      const p = pad + i * gap;
      ctx.moveTo(p, pad); ctx.lineTo(p, end); ctx.moveTo(pad, p); ctx.lineTo(end, p);
    }
    ctx.stroke();

    ctx.fillStyle = '#6b4a2b';
    [[3,3],[11,3],[3,11],[11,11],[7,7]].forEach(([sx,sy]) => {
      const cx = pad + sx * gap, cy = pad + sy * gap, r = Math.max(2, gap * 0.11);
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    });

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const v = state.board[y]?.[x] ?? EMPTY;
        if (v) drawStone(x, y, v);
      }
    }

    if (state.pendingMove && state.status === 'playing' && state.turn === state.myColor) {
      if ((state.board[state.pendingMove.y]?.[state.pendingMove.x] ?? BLACK) === EMPTY) {
        ctx.globalAlpha = 0.5; drawStone(state.pendingMove.x, state.pendingMove.y, state.myColor); ctx.globalAlpha = 1;
      }
    }

    if (state.lastMove) {
      const { x, y } = state.lastMove;
      if ((state.board[y]?.[x] ?? EMPTY) !== EMPTY) {
        ctx.strokeStyle = '#ef7d57'; ctx.lineWidth = Math.max(2, gap * 0.1);
        const cx = pad + x * gap, cy = pad + y * gap, r = gap * 0.2;
        ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
      }
    }

    if (state.winLine && state.winLine.length > 1) {
      const [x0, y0] = state.winLine[0]; const [x1, y1] = state.winLine[state.winLine.length - 1];
      ctx.strokeStyle = '#ef7d57'; ctx.lineWidth = Math.max(3, gap * 0.16); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pad + x0 * gap, pad + y0 * gap); ctx.lineTo(pad + x1 * gap, pad + y1 * gap); ctx.stroke();
    }
  }

  function drawStone(x, y, color) {
    const { pad, gap } = geom(); const cx = pad + x * gap, cy = pad + y * gap, r = gap * 0.42;
    if (color === BLACK) {
      ctx.fillStyle = '#1a1c2c'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a5470'; ctx.beginPath(); ctx.arc(cx - r * 0.28, cy - r * 0.28, r * 0.32, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#f4f4f4'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#8a7a5e'; ctx.lineWidth = Math.max(1.5, gap * 0.06); ctx.stroke();
    }
  }

  function toBoardCoords(clientX, clientY) {
    if (!cssSize) return null;
    const rect = canvas.getBoundingClientRect(); const { pad, gap } = geom();
    const px = clientX - rect.left, py = clientY - rect.top;
    const x = Math.round((px - pad) / gap), y = Math.round((py - pad) / gap);
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return null;
    if (Math.hypot(px - (pad + x * gap), py - (pad + y * gap)) > gap * 0.62) return null;
    return [x, y];
  }

  canvas.addEventListener('click', (e) => {
    if (state.status !== 'playing' || state.turn !== state.myColor) return;
    const p = toBoardCoords(e.clientX, e.clientY);
    if (!p) return;
    const [x, y] = p;
    if ((state.board[y]?.[x] ?? BLACK) !== EMPTY) return;

    if (state.pendingMove && state.pendingMove.x === x && state.pendingMove.y === y) {
      send({ type: 'move', x, y });
      state.pendingMove = null;
    } else {
      state.pendingMove = { x, y };
      draw();
    }
  });

  function addChatMessage(msg) {
    const row = document.createElement('div'); row.className = 'msg';
    const name = document.createElement('span'); name.className = 'msg-name';
    name.textContent = (msg.from === state.myId ? '我' : msg.name) + '：';
    name.style.color = msg.color === BLACK ? '#8fb8ff' : '#ffb08f';
    const txt = document.createElement('span'); txt.textContent = msg.text;
    row.appendChild(name); row.appendChild(txt);
    messagesEl.appendChild(row); messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function addSystemMessage(text) {
    const row = document.createElement('div'); row.className = 'msg system'; row.textContent = '· ' + text;
    messagesEl.appendChild(row); messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  chatForm.addEventListener('submit', (e) => {
    e.preventDefault(); const text = chatInput.value.trim(); if (!text) return;
    send({ type: 'chat', text }); chatInput.value = '';
    quickMenu.classList.add('hidden');
  });

  chatInput.addEventListener('focus', () => quickMenu.classList.remove('hidden'));
  chatInput.addEventListener('click', () => quickMenu.classList.remove('hidden'));
  document.addEventListener('click', (e) => {
    if (!chatInput.contains(e.target) && !quickMenu.contains(e.target)) {
      quickMenu.classList.add('hidden');
    }
  });

  document.querySelectorAll('.quick-item').forEach(item => {
    item.onclick = () => {
      let text = item.dataset.text;
      if (text === '快点儿，我等到花都谢了') {
        state.urgeCount++;
        if (state.urgeCount === 3) {
          send({ type: 'chat', text: '【系统提示】：再催直接认输！' });
          quickMenu.classList.add('hidden');
          return;
        } else if (state.urgeCount >= 4) {
          send({ type: 'chat', text: '【系统提示】：由于你催促次数过多，已自动判负！' });
          send({ type: 'resign' });
          quickMenu.classList.add('hidden');
          return;
        }
      }
      send({ type: 'chat', text });
      quickMenu.classList.add('hidden');
    };
  });

  $('createBtn').onclick = () => {
    const name = nameInput.value.trim() || '玩家';
    localStorage.setItem('gomoku_name', name);
    const customId = createRoomInput.value.trim().toUpperCase();
    send({ type: 'create', name, avatar: myAvatarData, roomId: customId });
  };
  $('joinBtn').onclick = () => {
    const name = nameInput.value.trim() || '玩家';
    localStorage.setItem('gomoku_name', name);
    const rid = roomInput.value.trim().toUpperCase();
    if (!rid) return lobbyMsg.textContent = '请输入房间号';
    send({ type: 'join', name, roomId: rid, avatar: myAvatarData });
  };
  restartBtn.onclick = () => send({ type: 'restart' });
  leaveBtn.onclick = () => send({ type: 'leave' });
  $('undoBtn').onclick = () => { if (state.status === 'playing') { send({ type: 'undo_req' }); addSystemMessage('已发送悔棋请求'); } };
  $('drawBtn').onclick = () => { if (state.status === 'playing') { send({ type: 'draw_req' }); addSystemMessage('已发送求和请求'); } };
  $('resignBtn').onclick = () => { if (state.status === 'playing') { if (confirm('确定认输吗？')) send({ type: 'resign' }); } };
  resultBtn.onclick = () => gameoverModal.classList.add('hidden');

  // 启动
  updateBjTime(); setInterval(updateBjTime, 1000); startTimer();
  
  // 监听容器大小变化来重绘
  new ResizeObserver(resizeCanvas).observe(document.querySelector('.board-container'));
  connect();
})();