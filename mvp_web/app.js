const BASELINE_REQUIRED = 3;
const GAME_MS = 30000;
const DEFAULT_BACKEND_URL =
  window.location.protocol.startsWith("http") && window.location.host
    ? window.location.origin
    : "http://127.0.0.1:8000";

const els = {
  screens: {
    login: document.getElementById("screenLogin"),
    intro: document.getElementById("screenIntro"),
    prompt: document.getElementById("screenPrompt"),
    game: document.getElementById("screenGame"),
    result: document.getElementById("screenResult"),
    leaderboard: document.getElementById("screenLeaderboard"),
  },
  firstName: document.getElementById("firstName"),
  lastName: document.getElementById("lastName"),
  saveProfileBtn: document.getElementById("saveProfileBtn"),
  switchUserBtn: document.getElementById("switchUserBtn"),
  loggedInUser: document.getElementById("loggedInUser"),
  profileStatus: document.getElementById("profileStatus"),
  introTitle: document.getElementById("introTitle"),
  introCopy: document.getElementById("introCopy"),
  baselineBanner: document.getElementById("baselineBanner"),
  baselineProgressWrap: document.getElementById("baselineProgressWrap"),
  baselineProgressFill: document.getElementById("baselineProgressFill"),
  baselineProgressText: document.getElementById("baselineProgressText"),
  baselineStatus: document.getElementById("baselineStatus"),
  nextStep: document.getElementById("nextStep"),
  startBtn: document.getElementById("startBtn"),
  leaderboardBtn: document.getElementById("leaderboardBtn"),
  alcoholStatus: document.getElementById("alcoholStatus"),
  sleepHours: document.getElementById("sleepHours"),
  promptStartBtn: document.getElementById("promptStartBtn"),
  promptBackBtn: document.getElementById("promptBackBtn"),
  promptStatus: document.getElementById("promptStatus"),
  gameRunType: document.getElementById("gameRunType"),
  gameStatus: document.getElementById("gameStatus"),
  gameStartOverlay: document.getElementById("gameStartOverlay"),
  gameStartTitle: document.getElementById("gameStartTitle"),
  gameStartCopy: document.getElementById("gameStartCopy"),
  gameLaunchBtn: document.getElementById("gameLaunchBtn"),
  scoreValue: document.getElementById("scoreValue"),
  scoreContext: document.getElementById("scoreContext"),
  personalBest: document.getElementById("personalBest"),
  resultTitle: document.getElementById("resultTitle"),
  retryBtn: document.getElementById("retryBtn"),
  resultLeaderboardBtn: document.getElementById("resultLeaderboardBtn"),
  resultSwitchUserBtn: document.getElementById("resultSwitchUserBtn"),
  leaderboardCopy: document.getElementById("leaderboardCopy"),
  leaderboardList: document.getElementById("leaderboardList"),
  leaderboardBackBtn: document.getElementById("leaderboardBackBtn"),
  adminCard: document.getElementById("adminCard"),
  adminToken: document.getElementById("adminToken"),
  scoreModeSelect: document.getElementById("scoreModeSelect"),
  saveScoreModeBtn: document.getElementById("saveScoreModeBtn"),
  clearDbBtn: document.getElementById("clearDbBtn"),
  resetDbBtn: document.getElementById("resetDbBtn"),
  downloadUsers: document.getElementById("downloadUsers"),
  downloadAttempts: document.getElementById("downloadAttempts"),
  downloadRaw: document.getElementById("downloadRaw"),
  adminStatus: document.getElementById("adminStatus"),
  coachOverlay: document.getElementById("coachOverlay"),
  coachStep: document.getElementById("coachStep"),
  coachTitle: document.getElementById("coachTitle"),
  coachBody: document.getElementById("coachBody"),
  coachButton: document.getElementById("coachButton"),
  canvas: document.getElementById("gameCanvas"),
};

const ctx = els.canvas.getContext("2d");

const state = {
  backendUrl: localStorage.getItem("backendUrl") || DEFAULT_BACKEND_URL,
  currentScreen: "login",
  pendingRunType: null,
  userId: localStorage.getItem("userId") || "",
  baselineCompleted: 0,
  running: false,
  startTs: 0,
  endTs: 0,
  rafId: null,
  timeoutId: null,
  eventIndex: 0,
  events: [],
  activePointerId: null,
  activeBallId: null,
  freePointerId: null,
  baskets: [],
  balls: [],
  lastFrameTs: 0,
  completionLog: [],
  ballFirstTouchMs: {},
  alcoholStatus: "no",
  sleepHours: 8,
  coachAction: null,
  runArmed: false,
  leaderboardReturnScreen: "intro",
  lastTapAt: 0,
  savingResult: false,
  latestScoreMs: null,
  latestDurationMs: null,
  latestSummary: null,
  latestResultSuccess: null,
  scoreMode: "active_ball_time_ms",
};

function setScreen(name) {
  Object.entries(els.screens).forEach(([key, el]) => {
    el.classList.toggle("hidden", key !== name);
  });
  state.currentScreen = name;
  document.body.classList.toggle("game-mode", name === "game");
}

function showCoach({ step = "", title, body, buttonText = "Continue", onConfirm = null }) {
  state.coachAction = onConfirm;
  els.coachStep.textContent = step;
  els.coachTitle.textContent = title;
  els.coachBody.textContent = body;
  els.coachButton.textContent = buttonText;
  els.coachOverlay.classList.remove("hidden");
}

function hideCoach() {
  state.coachAction = null;
  els.coachOverlay.classList.add("hidden");
}

function getSeenKey(name) {
  return state.userId ? `${name}:${state.userId}` : name;
}

function hasSeen(name) {
  return localStorage.getItem(getSeenKey(name)) === "1";
}

function markSeen(name) {
  localStorage.setItem(getSeenKey(name), "1");
}

function persistSession() {
  localStorage.setItem("backendUrl", state.backendUrl);
  localStorage.setItem("userId", state.userId);
}

function updateLoggedInUser() {
  const first = localStorage.getItem("firstName") || "";
  const last = localStorage.getItem("lastName") || "";
  els.loggedInUser.textContent = state.userId && first && last ? `Logged in as ${first} ${last}` : "Not logged in.";
}

function resizeCanvas() {
  const cssWidth = Math.min(window.innerWidth - 32, 430);
  const cssHeight = Math.min(Math.floor(window.innerHeight * 0.62), 740);
  els.canvas.style.width = `${cssWidth}px`;
  els.canvas.style.height = `${cssHeight}px`;
  els.canvas.width = Math.max(300, Math.floor(cssWidth));
  els.canvas.height = Math.max(420, Math.floor(cssHeight));
  if (!state.running) {
    setupBaskets();
    draw();
  }
}

function updateBaselineProgress() {
  const percent = Math.max(0, Math.min(100, (state.baselineCompleted / BASELINE_REQUIRED) * 100));
  els.baselineProgressFill.style.width = `${percent}%`;
  els.baselineProgressText.textContent = `${state.baselineCompleted} of ${BASELINE_REQUIRED} baseline runs complete`;
}

function setBaselineInfoVisible(visible) {
  els.baselineBanner.classList.toggle("hidden", !visible);
  els.baselineProgressWrap.classList.toggle("hidden", !visible);
  els.baselineProgressText.classList.toggle("hidden", !visible);
  els.baselineStatus.classList.toggle("hidden", !visible);
  els.nextStep.classList.toggle("hidden", !visible);
}

function updateIntroScreen() {
  updateLoggedInUser();
  if (!state.userId) {
    setScreen("login");
    return;
  }

  setBaselineInfoVisible(false);
  els.introTitle.textContent = "Ready";
  els.introCopy.textContent = "";
  els.startBtn.textContent = "Play Game";
  setScreen("intro");
}

function refreshIntroCopyOnly() {
  if (!state.userId) return;
  updateLoggedInUser();
  setBaselineInfoVisible(false);
  els.introTitle.textContent = "Ready";
  els.introCopy.textContent = "";
  els.startBtn.textContent = "Play Game";
}

function openLeaderboard(fromScreen) {
  state.leaderboardReturnScreen = fromScreen;
  setScreen("leaderboard");
}

function returnFromLeaderboard() {
  setScreen(state.leaderboardReturnScreen || "intro");
}

function bindTapAction(el, action) {
  const handler = (evt) => {
    if (state.savingResult) {
      evt.preventDefault();
      return;
    }
    const now = Date.now();
    if (now - state.lastTapAt < 250) {
      evt.preventDefault();
      return;
    }
    state.lastTapAt = now;
    action();
  };
  el.addEventListener("pointerup", handler);
  el.addEventListener("click", (evt) => evt.preventDefault());
}

function setResultActionsDisabled(disabled) {
  state.savingResult = disabled;
  els.retryBtn.disabled = disabled;
  els.resultLeaderboardBtn.disabled = disabled;
  els.resultSwitchUserBtn.disabled = disabled;
}

function getScoreLabel() {
  return state.scoreMode === "duration_ms" ? "completion time" : "active ball time";
}

function updateScoreModeCopy() {
  if (!els.leaderboardCopy) return;
  els.leaderboardCopy.textContent =
    state.scoreMode === "duration_ms"
      ? "Lowest completion-time scores across all players."
      : "Lowest active-ball-time scores across all players.";
}

function getDisplayScoreMs(summary, durationMs) {
  if (state.scoreMode === "duration_ms") return durationMs;
  if (summary && typeof summary.active_ball_time_ms === "number") return summary.active_ball_time_ms;
  return durationMs;
}

function renderLeaderboard(entries) {
  if (!entries.length) {
    els.leaderboardList.innerHTML = '<div class="leaderboard-row"><span class="leaderboard-rank">-</span><span class="leaderboard-name">No scores yet</span><span class="leaderboard-score">-</span></div>';
    return;
  }
  els.leaderboardList.innerHTML = entries
    .map(
      (entry) => `
        <div class="leaderboard-row">
          <span class="leaderboard-rank">#${entry.rank}</span>
          <span class="leaderboard-name">${entry.first_name} ${entry.last_name}</span>
          <span class="leaderboard-score">${entry.best_score_ms} ms</span>
        </div>
      `
    )
    .join("");
}

async function refreshLeaderboard() {
  try {
    const res = await fetch(`${state.backendUrl}/leaderboard?limit=5`);
    const text = await res.text();
    const body = text ? JSON.parse(text) : [];
    if (!res.ok) throw new Error("Leaderboard fetch failed");
    renderLeaderboard(body);
  } catch {
    renderLeaderboard([]);
  }
}

async function refreshUserStats() {
  if (!state.userId) {
    els.personalBest.textContent = "";
    return;
  }
  try {
    const res = await fetch(`${state.backendUrl}/users/${state.userId}/stats`);
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(body.detail || "Stats fetch failed");
    els.personalBest.textContent =
      body.best_score_ms == null ? "No personal best yet." : `Your best ${getScoreLabel()}: ${body.best_score_ms} ms`;
  } catch {
    els.personalBest.textContent = "";
  }
}

async function refreshScoreMode() {
  try {
    const res = await fetch(`${state.backendUrl}/score-mode`);
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(body.detail || "Score mode fetch failed");
    state.scoreMode = body.score_mode || "active_ball_time_ms";
    if (els.scoreModeSelect) els.scoreModeSelect.value = state.scoreMode;
    updateScoreModeCopy();
  } catch {
    state.scoreMode = "active_ball_time_ms";
    if (els.scoreModeSelect) els.scoreModeSelect.value = state.scoreMode;
    updateScoreModeCopy();
  }
}

async function refreshBaseline(options = {}) {
  const navigate = options.navigate ?? true;
  if (!state.userId) return;
  const res = await fetch(`${state.backendUrl}/baseline/${state.userId}`);
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { detail: text || "Baseline fetch failed" };
  }
  if (!res.ok) throw new Error(body.detail || "Baseline fetch failed");
  state.baselineCompleted = body.baseline_attempts_completed;
  refreshIntroCopyOnly();
  if (navigate) updateIntroScreen();
}

function setupBaskets() {
  const size = 82;
  state.baskets = [
    { id: "topLeft", x: 8, y: 8, w: size, h: size, visible: true },
    { id: "topRight", x: els.canvas.width - size - 8, y: 8, w: size, h: size, visible: true },
    { id: "bottomLeft", x: 8, y: els.canvas.height - size - 8, w: size, h: size, visible: true },
    { id: "bottomRight", x: els.canvas.width - size - 8, y: els.canvas.height - size - 8, w: size, h: size, visible: true },
  ];
}

function buildBalls() {
  const colors = ["#ef4444", "#3b82f6", "#22c55e", "#f97316"];
  const minDistanceFromCorner = 140;
  const minBallDistance = 62;
  const cornerCenters = state.baskets.map((b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 }));

  function validSpawnPoint(x, y, existing) {
    const awayFromCorners = cornerCenters.every((c) => {
      const dx = x - c.x;
      const dy = y - c.y;
      return Math.sqrt(dx * dx + dy * dy) >= minDistanceFromCorner;
    });
    if (!awayFromCorners) return false;
    return existing.every((ball) => {
      const dx = x - ball.x;
      const dy = y - ball.y;
      return Math.sqrt(dx * dx + dy * dy) >= minBallDistance;
    });
  }

  const balls = [];
  for (let i = 0; i < 4; i += 1) {
    let x = 0;
    let y = 0;
    let found = false;
    for (let tries = 0; tries < 60; tries += 1) {
      const candidateX = 85 + Math.random() * (els.canvas.width - 170);
      const candidateY = 120 + Math.random() * (els.canvas.height - 240);
      if (validSpawnPoint(candidateX, candidateY, balls)) {
        x = candidateX;
        y = candidateY;
        found = true;
        break;
      }
    }
    if (!found) {
      x = 120 + i * 34;
      y = 210 + i * 22;
    }
    balls.push({
      id: `ball_${i + 1}`,
      color: colors[i],
      x,
      y,
      r: 25,
      vx: (Math.random() * 170 + 80) * (Math.random() > 0.5 ? 1 : -1),
      vy: (Math.random() * 170 + 80) * (Math.random() > 0.5 ? 1 : -1),
      spawnDelayMs: Math.floor(Math.random() * 4200),
      spawned: false,
      completed: false,
      assignedCornerId: null,
    });
  }
  state.balls = balls;
}

function resetGameState() {
  state.eventIndex = 0;
  state.events = [];
  state.activePointerId = null;
  state.activeBallId = null;
  state.freePointerId = null;
  state.lastFrameTs = 0;
  state.completionLog = [];
  state.ballFirstTouchMs = {};
  setupBaskets();
  buildBalls();
}

function getVisibleBaskets() {
  return state.baskets.filter((basket) => basket.visible);
}

function getBallById(id) {
  return state.balls.find((ball) => ball.id === id) || null;
}

function getActiveBall() {
  return getBallById(state.activeBallId);
}

function drawBasket(basket) {
  const radius = 14;
  const x = basket.x;
  const y = basket.y;
  const w = basket.w;
  const h = basket.h;

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();

  ctx.fillStyle = "rgba(254, 244, 199, 0.96)";
  ctx.fill();
  ctx.strokeStyle = "#8a5a00";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const labels = { topLeft: "TL", topRight: "TR", bottomLeft: "BL", bottomRight: "BR" };
  ctx.fillStyle = "#7c3f00";
  ctx.font = "700 11px sans-serif";
  ctx.fillText(labels[basket.id] || basket.id, x + 8, y + 16);
}

function draw() {
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);

  for (const basket of state.baskets) {
    if (basket.visible) drawBasket(basket);
  }

  for (const ball of state.balls) {
    if (!ball.spawned || ball.completed) continue;
    ctx.beginPath();
    ctx.fillStyle = ball.color;
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
  }

  const elapsed = state.running ? Math.floor(performance.now() - state.startTs) : 0;
  const remainingSec = Math.max(0, Math.ceil((GAME_MS - elapsed) / 1000));
  const completedCount = state.balls.filter((ball) => ball.completed).length;

  ctx.fillStyle = "#0f172a";
  ctx.font = "700 14px sans-serif";
  ctx.fillText(`Time: ${remainingSec}s`, 132, 26);
  ctx.fillText(`Done: ${completedCount}/4`, 132, 46);
}

function appendEvent(eventType, x = null, y = null, payload = null) {
  if (!state.running) return;
  state.events.push({
    event_index: state.eventIndex++,
    t_ms: Math.max(0, Math.floor(performance.now() - state.startTs)),
    event_type: eventType,
    x,
    y,
    force: null,
    radius: null,
    payload,
  });
}

function spawnBallsByElapsed(elapsedMs) {
  for (const ball of state.balls) {
    if (!ball.spawned && elapsedMs >= ball.spawnDelayMs) {
      ball.spawned = true;
      appendEvent("ball_spawned", null, null, {
        ball_id: ball.id,
        spawn_delay_ms: ball.spawnDelayMs,
        x: ball.x,
        y: ball.y,
        vx: ball.vx,
        vy: ball.vy,
      });
    }
  }
}

function updateBallMotion(deltaSec) {
  for (const ball of state.balls) {
    if (!ball.spawned || ball.completed) continue;
    if (state.activeBallId === ball.id && state.activePointerId !== null) continue;
    ball.x += ball.vx * deltaSec;
    ball.y += ball.vy * deltaSec;

    if (ball.x < ball.r || ball.x > els.canvas.width - ball.r) {
      ball.vx *= -1;
      ball.x = Math.max(ball.r, Math.min(els.canvas.width - ball.r, ball.x));
    }
    if (ball.y < ball.r || ball.y > els.canvas.height - ball.r) {
      ball.vy *= -1;
      ball.y = Math.max(ball.r, Math.min(els.canvas.height - ball.r, ball.y));
    }
  }
}

function findBasketForBall(ball) {
  const margin = 14;
  return getVisibleBaskets().find(
    (basket) =>
      ball.x >= basket.x - margin &&
      ball.x <= basket.x + basket.w + margin &&
      ball.y >= basket.y - margin &&
      ball.y <= basket.y + basket.h + margin
  );
}

function completeBall(ball, basket) {
  if (ball.completed || !basket.visible) return;
  ball.completed = true;
  ball.assignedCornerId = basket.id;
  basket.visible = false;
  state.activePointerId = null;
  state.activeBallId = null;

  const tMs = Math.max(0, Math.floor(performance.now() - state.startTs));
  const order = state.completionLog.length + 1;
  state.completionLog.push({
    order,
    ball_id: ball.id,
    corner_id: basket.id,
    t_ms: tMs,
  });

  appendEvent("ball_completed", null, null, {
    order,
    ball_id: ball.id,
    corner_id: basket.id,
    t_ms: tMs,
  });

  draw();
  if (state.balls.every((candidate) => candidate.completed)) {
    finishGame(true);
  }
}

function loop(ts) {
  if (!state.running) return;
  if (state.lastFrameTs === 0) state.lastFrameTs = ts;
  const deltaSec = Math.min(0.05, (ts - state.lastFrameTs) / 1000);
  state.lastFrameTs = ts;

  const elapsedMs = Math.max(0, Math.floor(performance.now() - state.startTs));
  spawnBallsByElapsed(elapsedMs);
  updateBallMotion(deltaSec);
  draw();
  state.rafId = requestAnimationFrame(loop);
}

function canvasPos(evt) {
  const rect = els.canvas.getBoundingClientRect();
  return {
    x: ((evt.clientX - rect.left) / rect.width) * els.canvas.width,
    y: ((evt.clientY - rect.top) / rect.height) * els.canvas.height,
  };
}

function pickBallAt(x, y) {
  const candidates = state.balls.filter((ball) => ball.spawned && !ball.completed);
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const ball = candidates[i];
    const dx = x - ball.x;
    const dy = y - ball.y;
    if (Math.sqrt(dx * dx + dy * dy) <= ball.r + 6) return ball;
  }
  return null;
}

function pointerDown(evt) {
  if (!state.running) return;
  const { x, y } = canvasPos(evt);
  const ball = pickBallAt(x, y);
  if (!ball) {
    state.freePointerId = evt.pointerId;
    appendEvent("touch_down", x, y, { ball_id: null, hit: false });
    return;
  }

  state.activePointerId = evt.pointerId;
  state.activeBallId = ball.id;
  if (els.canvas.setPointerCapture) els.canvas.setPointerCapture(evt.pointerId);
  if (state.ballFirstTouchMs[ball.id] === undefined) {
    state.ballFirstTouchMs[ball.id] = Math.max(0, Math.floor(performance.now() - state.startTs));
  }
  appendEvent("touch_down", x, y, { ball_id: ball.id, hit: true });
}

function pointerMove(evt) {
  if (!state.running) return;
  const { x, y } = canvasPos(evt);
  if (state.activePointerId === evt.pointerId) {
    const ball = getActiveBall();
    if (!ball || ball.completed) return;
    ball.x = Math.max(ball.r, Math.min(els.canvas.width - ball.r, x));
    ball.y = Math.max(ball.r, Math.min(els.canvas.height - ball.r, y));
    appendEvent("touch_move", x, y, { ball_id: ball.id, hit: true });
    const basket = findBasketForBall(ball);
    if (basket) completeBall(ball, basket);
    return;
  }

  if (state.freePointerId === evt.pointerId) {
    appendEvent("touch_move", x, y, { ball_id: null, hit: false });
  }
}

function pointerUp(evt) {
  if (!state.running) return;
  const { x, y } = canvasPos(evt);
  if (state.activePointerId === evt.pointerId) {
    const ball = getActiveBall();
    if (ball && !ball.completed) {
      ball.x = Math.max(ball.r, Math.min(els.canvas.width - ball.r, x));
      ball.y = Math.max(ball.r, Math.min(els.canvas.height - ball.r, y));
      const basket = findBasketForBall(ball);
      if (basket) completeBall(ball, basket);
    }
    appendEvent("touch_up", x, y, { ball_id: ball ? ball.id : null, hit: true });
    if (els.canvas.releasePointerCapture) els.canvas.releasePointerCapture(evt.pointerId);
    state.activePointerId = null;
    state.activeBallId = null;
    return;
  }

  if (state.freePointerId === evt.pointerId) {
    appendEvent("touch_up", x, y, { ball_id: null, hit: false });
    state.freePointerId = null;
  }
}

function buildSummary(durationMs) {
  const ballsCompleted = state.balls.filter((ball) => ball.completed).length;
  const totalTaps = state.events.filter((event) => event.event_type === "touch_down").length;
  const emptyTaps = state.events.filter(
    (event) => event.event_type === "touch_down" && event.payload && event.payload.hit === false
  ).length;

  const perBall = {};
  for (const ball of state.balls) {
    const completion = state.completionLog.find((item) => item.ball_id === ball.id) || null;
    const unresolvedTimeMs =
      Math.max(
        0,
        (completion ? completion.t_ms : durationMs) - ball.spawnDelayMs
      );
    perBall[ball.id] = {
      spawn_delay_ms: ball.spawnDelayMs,
      first_touch_ms: state.ballFirstTouchMs[ball.id] ?? null,
      completion_t_ms: completion ? completion.t_ms : null,
      completion_order: completion ? completion.order : null,
      corner_id: completion ? completion.corner_id : null,
      unresolved_time_ms: unresolvedTimeMs,
    };
  }

  const activeBallTimeMs = Object.values(perBall).reduce(
    (total, ball) => total + (ball.unresolved_time_ms || 0),
    0
  );

  return {
    balls_completed: ballsCompleted,
    completion_ratio: ballsCompleted / 4,
    total_events: state.events.length,
    duration_ms: durationMs,
    active_ball_time_ms: activeBallTimeMs,
    total_taps: totalTaps,
    empty_taps: emptyTaps,
    completion_order: state.completionLog,
    per_ball: perBall,
  };
}

function beginRun(runType) {
  state.pendingRunType = runType;
  resetGameState();
  state.runArmed = true;
  els.gameRunType.textContent = runType === "baseline" ? "Baseline Run" : "Normal Run";
  els.gameStatus.textContent = "Press start when ready.";
  els.gameStartTitle.textContent = runType === "baseline" ? "Baseline Run" : "Normal Run";
  els.gameStartCopy.textContent =
    "Drag each moving ball into any open corner as fast as you can. The order does not matter.";
  els.gameStartOverlay.classList.remove("hidden");
  setScreen("game");
  draw();
}

function launchArmedRun() {
  if (!state.runArmed) return;
  state.runArmed = false;
  els.gameStartOverlay.classList.add("hidden");
  els.gameLaunchBtn.blur();
  state.running = true;
  state.startTs = performance.now();
  els.gameStatus.textContent = "Round live. Drag all four balls into open corners.";
  draw();
  state.timeoutId = setTimeout(() => finishGame(false), GAME_MS);
  state.rafId = requestAnimationFrame(loop);
}

function showResult(durationMs, success, saving = true) {
  const scoreMs = state.latestScoreMs ?? durationMs;
  setResultActionsDisabled(saving);
  els.resultTitle.textContent = success ? "Run Complete" : "Run Timed Out";
  els.scoreValue.textContent = `${scoreMs} ms`;
  els.scoreContext.textContent = saving
    ? success
      ? `Round complete. Saving ${getScoreLabel()}...`
      : `Time ran out. Saving recorded ${getScoreLabel()}...`
    : success
      ? `${getScoreLabel()} saved. Lower is better.`
      : `${getScoreLabel()} recorded. Lower is better.`;
  setScreen("result");
}

function refreshVisibleResultScore() {
  if (state.currentScreen !== "result" || !state.latestSummary || state.latestDurationMs == null) return;
  state.latestScoreMs = getDisplayScoreMs(state.latestSummary, state.latestDurationMs);
  showResult(state.latestDurationMs, Boolean(state.latestResultSuccess), state.savingResult);
}

async function finishGame(success) {
  if (!state.running) return;
  state.running = false;
  state.runArmed = false;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  if (state.timeoutId) clearTimeout(state.timeoutId);
  state.endTs = performance.now();
  state.activePointerId = null;
  state.activeBallId = null;
  state.freePointerId = null;

  const durationMs = Math.max(1, Math.floor(state.endTs - state.startTs));
  const baselineFlag = state.pendingRunType === "baseline";
  const summary = buildSummary(durationMs);
  state.latestDurationMs = durationMs;
  state.latestSummary = summary;
  state.latestResultSuccess = success;
  state.latestScoreMs = getDisplayScoreMs(summary, durationMs);
  draw();
  showResult(durationMs, success, true);

  try {
    const sleepValue = baselineFlag ? null : Number(state.sleepHours);
    if (!baselineFlag && (Number.isNaN(sleepValue) || sleepValue < 0 || sleepValue > 24)) {
      throw new Error("Sleep hours must be between 0 and 24.");
    }

    const payload = {
      user_id: state.userId,
      baseline_flag: baselineFlag,
      duration_ms: durationMs,
      success,
      summary,
      raw_events: state.events,
      alcohol_status: baselineFlag ? null : state.alcoholStatus,
      sleep_hours: baselineFlag ? null : sleepValue,
    };

    const res = await fetch(`${state.backendUrl}/attempts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(body.detail || "Attempt submit failed");

    await refreshBaseline({ navigate: false });
    await refreshUserStats();
    await refreshLeaderboard();
    showResult(durationMs, success, false);
  } catch (err) {
    els.scoreContext.textContent = success
      ? `Score ${state.latestScoreMs} ms, but saving failed.`
      : `Score ${state.latestScoreMs} ms, but saving failed.`;
    els.gameStatus.textContent = `Submit error: ${err.message}`;
  }
}

async function saveProfile() {
  const firstName = els.firstName.value.trim();
  const lastName = els.lastName.value.trim();
  if (!firstName || !lastName) {
    els.profileStatus.textContent = "Enter first and last name.";
    return;
  }

  els.profileStatus.textContent = "Saving profile...";
  const res = await fetch(`${state.backendUrl}/users/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ first_name: firstName, last_name: lastName }),
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { detail: text || "Profile save failed" };
  }
  if (!res.ok) throw new Error(body.detail || "Profile save failed");

  state.userId = body.id;
  localStorage.setItem("firstName", firstName);
  localStorage.setItem("lastName", lastName);
  persistSession();
  els.profileStatus.textContent = `Profile saved for ${body.first_name} ${body.last_name}`;

  await refreshBaseline();
  await refreshUserStats();
  await refreshLeaderboard();

  if (!hasSeen("welcome")) {
    showCoach({
      step: "How It Works",
      title: "First build your baseline",
      body:
        "Complete 3 baseline runs while fully alert. After that, each run starts with drinking and sleep questions, then the game begins immediately and your score appears on its own result screen.",
      buttonText: "Start",
      onConfirm: () => {
        markSeen("welcome");
        hideCoach();
        updateIntroScreen();
      },
    });
    return;
  }

  updateIntroScreen();
}

function clearSessionForNewUser() {
  hideCoach();
  state.userId = "";
  state.baselineCompleted = 0;
  state.pendingRunType = null;
  state.alcoholStatus = "no";
  state.sleepHours = 8;
  state.runArmed = false;
  localStorage.removeItem("userId");
  localStorage.removeItem("firstName");
  localStorage.removeItem("lastName");
  els.firstName.value = "";
  els.lastName.value = "";
  els.profileStatus.textContent = "";
  els.promptStatus.textContent = "";
  els.personalBest.textContent = "";
  els.scoreValue.textContent = "0 ms";
  els.scoreContext.textContent = "";
  state.latestScoreMs = null;
  state.latestDurationMs = null;
  state.latestSummary = null;
  state.latestResultSuccess = null;
  els.gameStartOverlay.classList.add("hidden");
  setResultActionsDisabled(false);
  updateLoggedInUser();
  updateIntroScreen();
}

function handleStartFromIntro() {
  if (!state.userId) {
    setScreen("login");
    return;
  }

  if (state.baselineCompleted < BASELINE_REQUIRED) {
    if (!hasSeen("baseline_guide")) {
      showCoach({
        step: "Baseline",
        title: "Peak cognitive function only",
        body:
          "We need you to be at peak cognitive function with no drinking and good sleep 3 times when first playing the game. These runs become your personal reference point.",
        buttonText: "Continue",
        onConfirm: () => {
          markSeen("baseline_guide");
          showCoach({
            step: "How to play",
            title: "Corner Ball Checkpoint",
            body:
              "You will see four moving balls and four open corners. Drag each ball into any corner as fast as you can. The order does not matter, but each corner can only be used once.",
            buttonText: "Start Baseline Run",
            onConfirm: () => {
              hideCoach();
              beginRun("baseline");
            },
          });
        },
      });
      return;
    }
    showCoach({
      step: "How to play",
      title: "Corner Ball Checkpoint",
      body:
        "You will see four moving balls and four open corners. Drag each ball into any corner as fast as you can. The order does not matter, but each corner can only be used once.",
      buttonText: "Start Baseline Run",
      onConfirm: () => {
        hideCoach();
        beginRun("baseline");
      },
    });
    return;
  }

  els.promptStatus.textContent = "";
  els.alcoholStatus.value = state.alcoholStatus;
  els.sleepHours.value = state.sleepHours;
  setScreen("prompt");
}

function startPromptedRun() {
  const sleepValue = Number(els.sleepHours.value);
  if (Number.isNaN(sleepValue) || sleepValue < 0 || sleepValue > 24) {
    els.promptStatus.textContent = "Sleep hours must be between 0 and 24.";
    return;
  }
  state.alcoholStatus = els.alcoholStatus.value;
  state.sleepHours = sleepValue;
  beginRun("normal");
}

async function resetDatabase() {
  const token = els.adminToken.value.trim();
  if (!token) {
    els.adminStatus.textContent = "Enter admin token first.";
    return;
  }
  if (!confirm("This will drop and recreate the schema. All data will be lost. Continue?")) return;

  try {
    const res = await fetch(`${state.backendUrl}/admin/reset?token=${encodeURIComponent(token)}`, {
      method: "POST",
    });
    const text = await res.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { detail: text || "Reset failed" };
    }
    if (!res.ok) throw new Error(body.detail || "Reset failed");
    els.adminStatus.textContent = "Schema reset complete.";
    state.baselineCompleted = 0;
    renderLeaderboard([]);
    updateIntroScreen();
  } catch (err) {
    els.adminStatus.textContent = `Reset error: ${err.message}`;
  }
}

async function clearDatabase() {
  const token = els.adminToken.value.trim();
  if (!token) {
    els.adminStatus.textContent = "Enter admin token first.";
    return;
  }
  if (!confirm("This will delete all data. Are you sure?")) return;

  try {
    const res = await fetch(`${state.backendUrl}/admin/clear?token=${encodeURIComponent(token)}`, {
      method: "POST",
    });
    const text = await res.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { detail: text || "Clear failed" };
    }
    if (!res.ok) throw new Error(body.detail || "Clear failed");
    els.adminStatus.textContent = "Database cleared.";
    state.baselineCompleted = 0;
    renderLeaderboard([]);
    updateIntroScreen();
  } catch (err) {
    els.adminStatus.textContent = `Clear error: ${err.message}`;
  }
}

function downloadCsv(table) {
  const token = els.adminToken.value.trim();
  if (!token) {
    els.adminStatus.textContent = "Enter admin token first.";
    return;
  }
  fetch(`${state.backendUrl}/admin/export/${table}?token=${encodeURIComponent(token)}`)
    .then((res) => {
      if (!res.ok) {
        return res.text().then((text) => {
          try {
            const body = text ? JSON.parse(text) : {};
            throw new Error(body.detail || "Download failed");
          } catch {
            throw new Error(text || "Download failed");
          }
        });
      }
      return res.blob();
    })
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${table}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      els.adminStatus.textContent = `Downloaded ${table}.csv`;
    })
    .catch((err) => {
      els.adminStatus.textContent = `Download error: ${err.message}`;
    });
}

async function saveScoreMode() {
  const token = els.adminToken.value.trim();
  if (!token) {
    els.adminStatus.textContent = "Enter admin token first.";
    return;
  }
  try {
    const mode = els.scoreModeSelect.value;
    const res = await fetch(`${state.backendUrl}/admin/score-mode?token=${encodeURIComponent(token)}&score_mode=${encodeURIComponent(mode)}`, {
      method: "POST",
    });
    const text = await res.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { detail: text || "Save score mode failed" };
    }
    if (!res.ok) throw new Error(body.detail || "Save score mode failed");
    state.scoreMode = body.score_mode;
    els.scoreModeSelect.value = state.scoreMode;
    updateScoreModeCopy();
    els.adminStatus.textContent = `Score mode saved: ${state.scoreMode}`;
    refreshVisibleResultScore();
    await refreshUserStats();
    await refreshLeaderboard();
  } catch (err) {
    els.adminStatus.textContent = `Score mode error: ${err.message}`;
  }
}

function bindEvents() {
  els.saveProfileBtn.addEventListener("click", () => {
    saveProfile().catch((err) => {
      els.profileStatus.textContent = `Error: ${err.message}`;
    });
  });
  els.switchUserBtn.addEventListener("click", clearSessionForNewUser);
  els.startBtn.addEventListener("click", handleStartFromIntro);
  bindTapAction(els.leaderboardBtn, () => openLeaderboard("intro"));
  els.promptStartBtn.addEventListener("click", startPromptedRun);
  els.promptBackBtn.addEventListener("click", updateIntroScreen);
  bindTapAction(els.retryBtn, handleStartFromIntro);
  bindTapAction(els.resultLeaderboardBtn, () => openLeaderboard("result"));
  bindTapAction(els.resultSwitchUserBtn, clearSessionForNewUser);
  bindTapAction(els.leaderboardBackBtn, returnFromLeaderboard);
  els.gameLaunchBtn.addEventListener("click", launchArmedRun);
  els.coachButton.addEventListener("click", () => {
    if (typeof state.coachAction === "function") {
      state.coachAction();
    } else {
      hideCoach();
    }
  });

  els.canvas.addEventListener("pointerdown", pointerDown);
  els.canvas.addEventListener("pointermove", pointerMove);
  els.canvas.addEventListener("pointerup", pointerUp);
  els.canvas.addEventListener("pointercancel", pointerUp);

  els.clearDbBtn.addEventListener("click", clearDatabase);
  els.resetDbBtn.addEventListener("click", resetDatabase);
  els.saveScoreModeBtn.addEventListener("click", saveScoreMode);
  els.downloadUsers.addEventListener("click", () => downloadCsv("users"));
  els.downloadAttempts.addEventListener("click", () => downloadCsv("attempts"));
  els.downloadRaw.addEventListener("click", () => downloadCsv("raw_events"));
}

async function init() {
  setResultActionsDisabled(false);
  bindEvents();
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  setupBaskets();
  draw();

  if (new URLSearchParams(window.location.search).get("admin") === "1") {
    els.adminCard.classList.remove("hidden");
  }

  els.firstName.value = localStorage.getItem("firstName") || "";
  els.lastName.value = localStorage.getItem("lastName") || "";
  updateLoggedInUser();
  await refreshScoreMode();

  if (!state.userId) {
    setScreen("login");
    await refreshLeaderboard();
    return;
  }

  try {
    await refreshBaseline();
    await refreshUserStats();
    await refreshLeaderboard();
  } catch (err) {
    els.profileStatus.textContent = `Session restore error: ${err.message}`;
    setScreen("login");
    return;
  }
}

init();
