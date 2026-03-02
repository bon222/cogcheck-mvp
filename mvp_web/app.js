const GAME_TYPE = "corner_basket_swipe";
const BASELINE_REQUIRED = 3;
const GAME_MS = 30000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_BACKEND_URL =
  window.location.protocol.startsWith("http") && window.location.host
    ? window.location.origin
    : "http://127.0.0.1:8000";

const els = {
  firstName: document.getElementById("firstName"),
  lastName: document.getElementById("lastName"),
  backendUrl: document.getElementById("backendUrl"),
  saveProfileBtn: document.getElementById("saveProfileBtn"),
  switchUserBtn: document.getElementById("switchUserBtn"),
  profileStatus: document.getElementById("profileStatus"),
  baselineBanner: document.getElementById("baselineBanner"),
  baselineStatus: document.getElementById("baselineStatus"),
  refreshBaselineBtn: document.getElementById("refreshBaselineBtn"),
  labelFields: document.getElementById("labelFields"),
  alcoholStatus: document.getElementById("alcoholStatus"),
  sleepHours: document.getElementById("sleepHours"),
  startBtn: document.getElementById("startBtn"),
  gameStatus: document.getElementById("gameStatus"),
  lastSubmission: document.getElementById("lastSubmission"),
  canvas: document.getElementById("gameCanvas"),
};

const ctx = els.canvas.getContext("2d");

let state = {
  backendUrl: localStorage.getItem("backendUrl") || DEFAULT_BACKEND_URL,
  deviceUserId: localStorage.getItem("deviceUserId") || crypto.randomUUID(),
  userId: "",
  sessionId: "",
  sessionExpiresAt: 0,
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
  baskets: [],
  balls: [],
  lastFrameTs: 0,
  completionLog: [],
  ballFirstTouchMs: {},
};

function resizeCanvas() {
  const cssWidth = Math.min(window.innerWidth - 40, 430);
  const cssHeight = Math.min(Math.floor(window.innerHeight * 0.65), 740);
  els.canvas.style.width = `${cssWidth}px`;
  els.canvas.style.height = `${cssHeight}px`;
  els.canvas.width = Math.max(300, Math.floor(cssWidth));
  els.canvas.height = Math.max(420, Math.floor(cssHeight));
  if (!state.running) {
    setupBaskets();
    draw();
  }
}

function persistSession() {
  localStorage.setItem("backendUrl", state.backendUrl);
  localStorage.setItem("deviceUserId", state.deviceUserId);
  localStorage.setItem("userId", state.userId);
  localStorage.setItem("sessionId", state.sessionId);
  localStorage.setItem("sessionExpiresAt", String(state.sessionExpiresAt));
}

function loadSession() {
  state.userId = localStorage.getItem("userId") || "";
  state.sessionId = localStorage.getItem("sessionId") || "";
  state.sessionExpiresAt = Number(localStorage.getItem("sessionExpiresAt") || "0");
  if (Date.now() > state.sessionExpiresAt) {
    state.userId = "";
    state.sessionId = "";
    state.sessionExpiresAt = 0;
  }
}

function clearSessionForNewUser() {
  state.deviceUserId = crypto.randomUUID();
  state.userId = "";
  state.sessionId = "";
  state.sessionExpiresAt = 0;
  localStorage.removeItem("firstName");
  localStorage.removeItem("lastName");
  persistSession();
  els.firstName.value = "";
  els.lastName.value = "";
  els.profileStatus.textContent = "Switched user. Enter new name and save profile.";
  els.baselineStatus.textContent = "Not loaded yet.";
  els.baselineBanner.textContent = "Complete 3 baseline runs first.";
  updateLabelVisibility();
}

function nowIso(ms) {
  return new Date(ms).toISOString();
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
  state.balls = Array.from({ length: 4 }).map((_, i) => {
    const spawnDelayMs = Math.floor(Math.random() * 6000);
    return {
      id: `ball_${i + 1}`,
      color: colors[i],
      x: 100 + Math.random() * 160,
      y: 140 + Math.random() * 360,
      r: 22,
      vx: (Math.random() * 140 + 50) * (Math.random() > 0.5 ? 1 : -1),
      vy: (Math.random() * 140 + 50) * (Math.random() > 0.5 ? 1 : -1),
      spawnDelayMs,
      spawned: false,
      completed: false,
      assignedCornerId: null,
    };
  });
}

function resetGameState() {
  state.eventIndex = 0;
  state.events = [];
  state.activePointerId = null;
  state.activeBallId = null;
  state.lastFrameTs = 0;
  state.completionLog = [];
  state.ballFirstTouchMs = {};
  setupBaskets();
  buildBalls();
}

function getVisibleBaskets() {
  return state.baskets.filter((b) => b.visible);
}

function getBallById(id) {
  return state.balls.find((b) => b.id === id) || null;
}

function getActiveBall() {
  return getBallById(state.activeBallId);
}

function draw() {
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);

  for (const basket of state.baskets) {
    if (!basket.visible) continue;
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 2;
    ctx.strokeRect(basket.x, basket.y, basket.w, basket.h);
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#111";
    ctx.fillText(basket.id, basket.x + 4, basket.y + 14);
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
  const completedCount = state.balls.filter((b) => b.completed).length;
  ctx.fillStyle = "#111";
  ctx.font = "14px sans-serif";
  ctx.fillText(`Time: ${remainingSec}s`, 140, 24);
  ctx.fillText(`Done: ${completedCount}/4`, 140, 42);
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

    const r = ball.r;
    if (ball.x < r || ball.x > els.canvas.width - r) {
      ball.vx *= -1;
      ball.x = Math.max(r, Math.min(els.canvas.width - r, ball.x));
    }
    if (ball.y < r || ball.y > els.canvas.height - r) {
      ball.vy *= -1;
      ball.y = Math.max(r, Math.min(els.canvas.height - r, ball.y));
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
  ball.completed = true;
  ball.assignedCornerId = basket.id;
  basket.visible = false;
  state.activeBallId = null;
  state.activePointerId = null;

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

  const doneCount = state.balls.filter((b) => b.completed).length;
  if (doneCount === 4 || getVisibleBaskets().length === 0) {
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
  const candidates = state.balls.filter((b) => b.spawned && !b.completed);
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
  if (!ball) return;

  state.activePointerId = evt.pointerId;
  state.activeBallId = ball.id;
  if (state.ballFirstTouchMs[ball.id] === undefined) {
    state.ballFirstTouchMs[ball.id] = Math.max(0, Math.floor(performance.now() - state.startTs));
  }
  appendEvent("touch_down", x, y, { ball_id: ball.id });
}

function pointerMove(evt) {
  if (!state.running) return;
  if (state.activePointerId !== evt.pointerId) return;
  const ball = getActiveBall();
  if (!ball || ball.completed) return;

  const { x, y } = canvasPos(evt);
  ball.x = x;
  ball.y = y;
  appendEvent("touch_move", x, y, { ball_id: ball.id });

  const basket = findBasketForBall(ball);
  if (basket) {
    completeBall(ball, basket);
  }
}

function pointerUp(evt) {
  if (!state.running) return;
  if (state.activePointerId !== evt.pointerId) return;
  const { x, y } = canvasPos(evt);
  const activeBall = getActiveBall();
  appendEvent("touch_up", x, y, { ball_id: activeBall ? activeBall.id : null });
  state.activePointerId = null;
  state.activeBallId = null;
}

async function createSession() {
  const res = await fetch(`${state.backendUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: state.userId, baseline_mode: state.baselineCompleted < BASELINE_REQUIRED }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.detail || "Session create failed");
  state.sessionId = body.id;
  state.sessionExpiresAt = Date.now() + SESSION_TTL_MS;
  persistSession();
}

async function refreshBaseline() {
  if (!state.userId) {
    els.baselineStatus.textContent = "Save profile first.";
    return;
  }
  const res = await fetch(`${state.backendUrl}/baseline/${state.userId}/${GAME_TYPE}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.detail || "Baseline fetch failed");
  state.baselineCompleted = body.baseline_attempts_completed;
  els.baselineStatus.textContent = `Baseline attempts: ${body.baseline_attempts_completed}/${body.required_attempts}`;
  if (body.baseline_complete) {
    els.baselineBanner.textContent = "Baseline complete. You can now play normal runs. Before each run, enter drinking and sleep levels.";
  } else {
    const left = body.required_attempts - body.baseline_attempts_completed;
    els.baselineBanner.textContent = `Baseline required: complete ${left} more run(s) while you are at your best cognitive state.`;
  }
  updateLabelVisibility();
}

function updateLabelVisibility() {
  const needsBaseline = state.baselineCompleted < BASELINE_REQUIRED;
  els.labelFields.style.display = needsBaseline ? "none" : "block";
}

async function saveProfile() {
  const firstName = els.firstName.value.trim();
  const lastName = els.lastName.value.trim();
  state.backendUrl = els.backendUrl.value.trim().replace(/\/$/, "");
  if (!firstName || !lastName) {
    els.profileStatus.textContent = "Enter first and last name.";
    return;
  }
  const res = await fetch(`${state.backendUrl}/users/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      device_user_id: state.deviceUserId,
      first_name: firstName,
      last_name: lastName,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.detail || "Profile save failed");

  state.userId = body.id;
  state.sessionId = "";
  state.sessionExpiresAt = 0;
  localStorage.setItem("firstName", firstName);
  localStorage.setItem("lastName", lastName);
  persistSession();
  els.profileStatus.textContent = `Profile saved for ${body.first_name} ${body.last_name}`;
  await refreshBaseline();
}

function runGame() {
  resetGameState();
  state.running = true;
  state.startTs = performance.now();
  els.gameStatus.textContent = "Game running (4 random moving balls, max 30s)...";
  state.timeoutId = setTimeout(() => finishGame(false), GAME_MS);
  state.rafId = requestAnimationFrame(loop);
}

function startGame() {
  if (!state.userId) {
    els.gameStatus.textContent = "Save profile first.";
    return;
  }
  if (Date.now() > state.sessionExpiresAt || !state.sessionId) {
    createSession()
      .then(() => runGame())
      .catch((err) => {
        els.gameStatus.textContent = `Session error: ${err.message}`;
      });
    return;
  }
  runGame();
}

async function submitLabelIfNeeded(attemptId) {
  if (state.baselineCompleted < BASELINE_REQUIRED) return;
  const sleepValue = Number(els.sleepHours.value);
  if (Number.isNaN(sleepValue) || sleepValue < 0 || sleepValue > 24) {
    throw new Error("Sleep hours must be between 0 and 24.");
  }

  const res = await fetch(`${state.backendUrl}/labels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: state.userId,
      session_id: state.sessionId || null,
      attempt_id: attemptId || null,
      alcohol_status: els.alcoholStatus.value,
      sleep_hours: sleepValue,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.detail || "Label submit failed");
}

function buildSummary(durationMs) {
  const ballsCompleted = state.balls.filter((b) => b.completed).length;
  const perBall = {};
  for (const ball of state.balls) {
    const completion = state.completionLog.find((x) => x.ball_id === ball.id) || null;
    perBall[ball.id] = {
      spawn_delay_ms: ball.spawnDelayMs,
      first_touch_ms: state.ballFirstTouchMs[ball.id] ?? null,
      completion_t_ms: completion ? completion.t_ms : null,
      completion_order: completion ? completion.order : null,
      corner_id: completion ? completion.corner_id : null,
    };
  }
  return {
    balls_completed: ballsCompleted,
    completion_ratio: ballsCompleted / 4,
    total_events: state.events.length,
    duration_ms: durationMs,
    completion_order: state.completionLog,
    per_ball: perBall,
  };
}

async function finishGame(success) {
  if (!state.running) return;
  state.running = false;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  if (state.timeoutId) clearTimeout(state.timeoutId);
  state.endTs = performance.now();
  state.activePointerId = null;
  state.activeBallId = null;

  const durationMs = Math.max(1, Math.floor(state.endTs - state.startTs));
  const baselineFlag = state.baselineCompleted < BASELINE_REQUIRED;

  const payload = {
    user_id: state.userId,
    session_id: state.sessionId || null,
    game_type: GAME_TYPE,
    baseline_flag: baselineFlag,
    started_at: nowIso(Date.now() - durationMs),
    ended_at: nowIso(Date.now()),
    duration_ms: durationMs,
    success,
    summary: buildSummary(durationMs),
    raw_events: state.events,
  };

  try {
    const res = await fetch(`${state.backendUrl}/attempts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.detail || "Attempt submit failed");

    await submitLabelIfNeeded(body.id);
    await refreshBaseline();
    els.lastSubmission.textContent = JSON.stringify(body, null, 2);
    els.gameStatus.textContent = baselineFlag
      ? `Baseline run submitted (${durationMs}ms).`
      : `Normal run + labels submitted (${durationMs}ms).`;
  } catch (err) {
    els.gameStatus.textContent = `Submit error: ${err.message}`;
  }
}

function bindEvents() {
  els.saveProfileBtn.addEventListener("click", () => {
    saveProfile().catch((err) => (els.profileStatus.textContent = `Error: ${err.message}`));
  });
  els.switchUserBtn.addEventListener("click", clearSessionForNewUser);
  els.refreshBaselineBtn.addEventListener("click", () => {
    refreshBaseline().catch((err) => (els.baselineStatus.textContent = `Error: ${err.message}`));
  });
  els.startBtn.addEventListener("click", startGame);
  els.canvas.addEventListener("pointerdown", pointerDown);
  els.canvas.addEventListener("pointermove", pointerMove);
  els.canvas.addEventListener("pointerup", pointerUp);
  els.canvas.addEventListener("pointercancel", pointerUp);
}

function init() {
  loadSession();
  els.backendUrl.value = state.backendUrl;
  els.firstName.value = localStorage.getItem("firstName") || "";
  els.lastName.value = localStorage.getItem("lastName") || "";
  persistSession();
  bindEvents();
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
  setupBaskets();
  draw();
  if (state.userId) {
    refreshBaseline().catch((err) => {
      els.baselineStatus.textContent = `Error: ${err.message}`;
    });
    els.profileStatus.textContent = "Session resumed for this device.";
  } else {
    updateLabelVisibility();
    els.baselineBanner.textContent = "Complete 3 baseline runs first.";
  }
}

init();
