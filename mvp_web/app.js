const BASELINE_REQUIRED = 3;
const GAME_MS = 30000;
const DEFAULT_BACKEND_URL =
  window.location.protocol.startsWith("http") && window.location.host
    ? window.location.origin
    : "http://127.0.0.1:8000";

const els = {
  saveProfileBtn: document.getElementById("saveProfileBtn"),
  switchUserBtn: document.getElementById("switchUserBtn"),
  loggedInUser: document.getElementById("loggedInUser"),
  profileStatus: document.getElementById("profileStatus"),
  baselineBanner: document.getElementById("baselineBanner"),
  baselineProgressFill: document.getElementById("baselineProgressFill"),
  baselineProgressText: document.getElementById("baselineProgressText"),
  baselineStatus: document.getElementById("baselineStatus"),
  nextStep: document.getElementById("nextStep"),
  startBtn: document.getElementById("startBtn"),
  gameStatus: document.getElementById("gameStatus"),
  scoreCard: document.getElementById("scoreCard"),
  scoreValue: document.getElementById("scoreValue"),
  scoreContext: document.getElementById("scoreContext"),
  personalBest: document.getElementById("personalBest"),
  leaderboardList: document.getElementById("leaderboardList"),
  adminToken: document.getElementById("adminToken"),
  clearDbBtn: document.getElementById("clearDbBtn"),
  resetDbBtn: document.getElementById("resetDbBtn"),
  downloadUsers: document.getElementById("downloadUsers"),
  downloadAttempts: document.getElementById("downloadAttempts"),
  downloadRaw: document.getElementById("downloadRaw"),
  adminStatus: document.getElementById("adminStatus"),
  adminCard: document.getElementById("adminCard"),
  canvas: document.getElementById("gameCanvas"),
  retryBtn: document.getElementById("retryBtn"),
  flowOverlay: document.getElementById("flowOverlay"),
  modalStep: document.getElementById("modalStep"),
  modalTitle: document.getElementById("modalTitle"),
  modalDescription: document.getElementById("modalDescription"),
  modalProfile: document.getElementById("modalProfile"),
  modalFirstName: document.getElementById("modalFirstName"),
  modalLastName: document.getElementById("modalLastName"),
  modalProfileStatus: document.getElementById("modalProfileStatus"),
  modalBaseline: document.getElementById("modalBaseline"),
  modalBaselineBanner: document.getElementById("modalBaselineBanner"),
  modalLabels: document.getElementById("modalLabels"),
  modalAlcoholStatus: document.getElementById("modalAlcoholStatus"),
  modalSleepHours: document.getElementById("modalSleepHours"),
  modalPrimaryBtn: document.getElementById("modalPrimaryBtn"),
};

const ctx = els.canvas.getContext("2d");

let state = {
  backendUrl: localStorage.getItem("backendUrl") || DEFAULT_BACKEND_URL,
  userId: "",
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
  freePointerId: null,
  modalStage: null,
  alcoholStatus: "no",
  sleepHours: 8,
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
  localStorage.setItem("userId", state.userId);
}

function loadSession() {
  state.userId = localStorage.getItem("userId") || "";
}

function clearSessionForNewUser() {
  state.userId = "";
  state.alcoholStatus = "no";
  state.sleepHours = 8;
  localStorage.removeItem("firstName");
  localStorage.removeItem("lastName");
  persistSession();
  els.modalFirstName.value = "";
  els.modalLastName.value = "";
  els.profileStatus.textContent = "Switched user. Enter new name and save profile.";
  els.baselineStatus.textContent = "Not loaded yet.";
  els.baselineBanner.textContent = "Complete 3 baseline runs first.";
  els.nextStep.textContent = "Next: Save profile, then complete baseline 3 times.";
  updateLoggedInUser();
  updateBaselineProgress();
  updateLabelVisibility();
  showModal("profile");
}

function resetScoreCard() {
  els.scoreCard.classList.add("hidden");
  els.scoreValue.textContent = "0 ms";
  els.scoreContext.textContent = "";
  els.personalBest.textContent = "";
}

function setModalSection(sectionEl) {
  [els.modalProfile, els.modalBaseline, els.modalLabels].forEach((el) => el.classList.add("hidden"));
  if (sectionEl) sectionEl.classList.remove("hidden");
}

function showModal(stage) {
  state.modalStage = stage;
  els.flowOverlay.classList.remove("hidden");

  if (stage === "profile") {
    els.modalStep.textContent = "Step 1";
    els.modalTitle.textContent = "Sign in to continue";
    els.modalDescription.textContent = "Enter your name so we can keep your baseline and best score.";
    els.modalPrimaryBtn.textContent = "Save Profile";
    els.modalFirstName.value = localStorage.getItem("firstName") || "";
    els.modalLastName.value = localStorage.getItem("lastName") || "";
    els.modalProfileStatus.textContent = "";
    setModalSection(els.modalProfile);
    return;
  }

  if (stage === "baseline") {
    const left = Math.max(0, BASELINE_REQUIRED - state.baselineCompleted);
    els.modalStep.textContent = "Step 2";
    els.modalTitle.textContent = "Baseline required";
    els.modalDescription.textContent = "Do this at your best cognitive level. We use these runs to compare future performance.";
    els.modalBaselineBanner.textContent = `You need ${left} more baseline run${left === 1 ? "" : "s"} before normal play.`;
    els.modalPrimaryBtn.textContent = "Start Baseline Run";
    setModalSection(els.modalBaseline);
    return;
  }

  if (stage === "labels") {
    els.modalStep.textContent = "Step 2";
    els.modalTitle.textContent = "Before you play";
    els.modalDescription.textContent = "Log current drinking and sleep levels for this attempt.";
    els.modalAlcoholStatus.value = state.alcoholStatus;
    els.modalSleepHours.value = state.sleepHours;
    els.modalPrimaryBtn.textContent = "Start Normal Run";
    setModalSection(els.modalLabels);
  }
}

function hideModal() {
  state.modalStage = null;
  els.flowOverlay.classList.add("hidden");
}

function startRunNow() {
  hideModal();
  runGame();
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

function updateLoggedInUser() {
  const first = localStorage.getItem("firstName") || "";
  const last = localStorage.getItem("lastName") || "";
  if (state.userId && first && last) {
    els.loggedInUser.textContent = `Logged in as: ${first} ${last}`;
    return;
  }
  els.loggedInUser.textContent = "Not logged in.";
}

function updateBaselineProgress() {
  const percent = Math.max(0, Math.min(100, (state.baselineCompleted / BASELINE_REQUIRED) * 100));
  els.baselineProgressFill.style.width = `${percent}%`;
  els.baselineProgressText.textContent = `${state.baselineCompleted} of ${BASELINE_REQUIRED} baseline runs complete`;
}

function updateStartButtonLabel() {
  els.startBtn.textContent = state.baselineCompleted < BASELINE_REQUIRED ? "Start Baseline Run" : "Start Normal Run";
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
          <span class="leaderboard-score">${entry.best_duration_ms} ms</span>
        </div>
      `
    )
    .join("");
}

async function refreshLeaderboard() {
  try {
    const res = await fetch(`${state.backendUrl}/leaderboard?limit=5`);
    const rawText = await res.text();
    const body = rawText ? JSON.parse(rawText) : [];
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
    const rawText = await res.text();
    const body = rawText ? JSON.parse(rawText) : {};
    if (!res.ok) throw new Error(body.detail || "Stats fetch failed");
    if (body.best_duration_ms == null) {
      els.personalBest.textContent = "No personal best yet.";
      return;
    }
    els.personalBest.textContent = `Your best score: ${body.best_duration_ms} ms`;
  } catch {
    els.personalBest.textContent = "";
  }
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
  const cornerCenters = state.baskets.map((b) => ({
    x: b.x + b.w / 2,
    y: b.y + b.h / 2,
  }));

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
    const spawnDelayMs = Math.floor(Math.random() * 4200);
    balls.push({
      id: `ball_${i + 1}`,
      color: colors[i],
      x,
      y,
      r: 25,
      vx: (Math.random() * 170 + 80) * (Math.random() > 0.5 ? 1 : -1),
      vy: (Math.random() * 170 + 80) * (Math.random() > 0.5 ? 1 : -1),
      spawnDelayMs,
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
    ctx.fillText(basket.id, basket.x + 5, basket.y + 15);
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
  if (!ball) {
    state.freePointerId = evt.pointerId;
    appendEvent("touch_down", x, y, { ball_id: null, hit: false });
    return;
  }

  state.activePointerId = evt.pointerId;
  state.activeBallId = ball.id;
  if (els.canvas.setPointerCapture) {
    els.canvas.setPointerCapture(evt.pointerId);
  }
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
    if (basket) {
      completeBall(ball, basket);
    }
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
    const activeBall = getActiveBall();
    appendEvent("touch_up", x, y, { ball_id: activeBall ? activeBall.id : null, hit: true });
    if (els.canvas.releasePointerCapture) {
      els.canvas.releasePointerCapture(evt.pointerId);
    }
    state.activePointerId = null;
    state.activeBallId = null;
    return;
  }

  if (state.freePointerId === evt.pointerId) {
    appendEvent("touch_up", x, y, { ball_id: null, hit: false });
    state.freePointerId = null;
  }
}

async function refreshBaseline() {
  if (!state.userId) {
    els.baselineStatus.textContent = "Save profile first.";
    return;
  }
  const res = await fetch(`${state.backendUrl}/baseline/${state.userId}`);
  const rawText = await res.text();
  let body = {};
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    body = { detail: rawText || "Baseline fetch failed" };
  }
  if (!res.ok) throw new Error(body.detail || "Baseline fetch failed");
  state.baselineCompleted = body.baseline_attempts_completed;
  els.baselineStatus.textContent = `Baseline attempts: ${body.baseline_attempts_completed}/${body.required_attempts}`;
  updateBaselineProgress();
  updateStartButtonLabel();
  if (body.baseline_complete) {
    els.baselineBanner.textContent = "Baseline complete. You can now play normal runs. Before each run, enter drinking and sleep levels.";
    els.nextStep.textContent = "Next: Enter drinking + sleep, then press Start Game.";
  } else {
    const left = body.required_attempts - body.baseline_attempts_completed;
    els.baselineBanner.textContent = `Baseline required: complete ${left} more run(s) while you are at your best cognitive state.`;
    els.nextStep.textContent = `Next: Press Start Game and finish ${left} more baseline run(s).`;
  }
  updateLabelVisibility();
}

function updateLabelVisibility() {
  if (state.baselineCompleted >= BASELINE_REQUIRED) {
    state.alcoholStatus = els.modalAlcoholStatus.value;
    state.sleepHours = Number(els.modalSleepHours.value) || 8;
  }
}

async function saveProfile() {
  const firstName = els.modalFirstName.value.trim();
  const lastName = els.modalLastName.value.trim();
  if (!firstName || !lastName) {
    els.modalProfileStatus.textContent = "Enter first and last name.";
    return;
  }
  els.modalProfileStatus.textContent = "Saving profile...";
  const res = await fetch(`${state.backendUrl}/users/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      first_name: firstName,
      last_name: lastName,
    }),
  });
  const rawText = await res.text();
  let body = {};
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    body = { detail: rawText || "Profile save failed" };
  }
  if (!res.ok) {
    throw new Error(body.detail || "Profile save failed");
  }

  state.userId = body.id;
  localStorage.setItem("firstName", firstName);
  localStorage.setItem("lastName", lastName);
  persistSession();
  updateLoggedInUser();
  els.profileStatus.textContent = `Profile saved for ${body.first_name} ${body.last_name}`;
  try {
    await refreshBaseline();
    await refreshUserStats();
    await refreshLeaderboard();
    if (state.baselineCompleted < BASELINE_REQUIRED) {
      showModal("baseline");
    } else {
      hideModal();
    }
  } catch (err) {
    els.profileStatus.textContent = `Profile saved. Baseline status error: ${err.message}`;
  }
}

function runGame() {
  resetGameState();
  resetScoreCard();
  state.running = true;
  state.startTs = performance.now();
  els.gameStatus.textContent = "Game running (4 random moving balls, max 30s)...";
  state.timeoutId = setTimeout(() => finishGame(false), GAME_MS);
  state.rafId = requestAnimationFrame(loop);
}

function startGame() {
  if (!state.userId) {
    showModal("profile");
    return;
  }
  if (state.baselineCompleted < BASELINE_REQUIRED) {
    showModal("baseline");
    return;
  }
  showModal("labels");
}

async function submitLabelIfNeeded() {
  if (state.baselineCompleted < BASELINE_REQUIRED) return;
  const sleepValue = Number(state.sleepHours);
  if (Number.isNaN(sleepValue) || sleepValue < 0 || sleepValue > 24) {
    throw new Error("Sleep hours must be between 0 and 24.");
  }

  return {
    alcohol_status: state.alcoholStatus,
    sleep_hours: sleepValue,
  };
}

function buildSummary(durationMs) {
  const ballsCompleted = state.balls.filter((b) => b.completed).length;
  const emptyTaps = state.events.filter(
    (evt) => evt.event_type === "touch_down" && evt.payload && evt.payload.hit === false
  ).length;
  const totalTaps = state.events.filter((evt) => evt.event_type === "touch_down").length;
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
    total_taps: totalTaps,
    empty_taps: emptyTaps,
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

  try {
    const labelPayload = await submitLabelIfNeeded();
    const payload = {
      user_id: state.userId,
      baseline_flag: baselineFlag,
      duration_ms: durationMs,
      success,
      summary: buildSummary(durationMs),
      raw_events: state.events,
      alcohol_status: labelPayload?.alcohol_status ?? null,
      sleep_hours: labelPayload?.sleep_hours ?? null,
    };

    const res = await fetch(`${state.backendUrl}/attempts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.detail || "Attempt submit failed");

    await refreshBaseline();
    await refreshUserStats();
    await refreshLeaderboard();
    els.scoreCard.classList.remove("hidden");
    els.scoreValue.textContent = `${durationMs} ms`;
    els.scoreContext.textContent = success
      ? `Completed successfully in ${durationMs} ms.`
      : `Round ended before all corners were filled. Time recorded: ${durationMs} ms.`;
    els.gameStatus.textContent = baselineFlag
      ? `Baseline run submitted (${durationMs}ms).`
      : `Normal run submitted (${durationMs}ms).`;
  } catch (err) {
    els.gameStatus.textContent = `Submit error: ${err.message}`;
  }
}

function bindEvents() {
  els.saveProfileBtn.addEventListener("click", () => showModal("profile"));
  els.switchUserBtn.addEventListener("click", clearSessionForNewUser);
  els.startBtn.addEventListener("click", startGame);
  els.retryBtn.addEventListener("click", startGame);
  els.modalPrimaryBtn.addEventListener("click", () => {
    if (state.modalStage === "profile") {
      saveProfile().catch((err) => {
        els.modalProfileStatus.textContent = `Error: ${err.message}`;
      });
      return;
    }
    if (state.modalStage === "labels") {
      state.alcoholStatus = els.modalAlcoholStatus.value;
      state.sleepHours = Number(els.modalSleepHours.value) || 8;
    }
    startRunNow();
  });
  els.canvas.addEventListener("pointerdown", pointerDown);
  els.canvas.addEventListener("pointermove", pointerMove);
  els.canvas.addEventListener("pointerup", pointerUp);
  els.canvas.addEventListener("pointercancel", pointerUp);
  els.clearDbBtn.addEventListener("click", clearDatabase);
  els.resetDbBtn.addEventListener("click", resetDatabase);
  els.downloadUsers.addEventListener("click", () => downloadCsv("users"));
  els.downloadAttempts.addEventListener("click", () => downloadCsv("attempts"));
  els.downloadRaw.addEventListener("click", () => downloadCsv("raw_events"));
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
    const rawText = await res.text();
    let body = {};
    try {
      body = rawText ? JSON.parse(rawText) : {};
    } catch {
      body = { detail: rawText || "Reset failed" };
    }
    if (!res.ok) throw new Error(body.detail || "Reset failed");
    els.adminStatus.textContent = "Schema reset complete.";
    state.baselineCompleted = 0;
    updateBaselineProgress();
    updateStartButtonLabel();
    resetScoreCard();
    renderLeaderboard([]);
  } catch (err) {
    els.adminStatus.textContent = `Reset error (v3): ${err.message}`;
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
    const rawText = await res.text();
    let body = {};
    try {
      body = rawText ? JSON.parse(rawText) : {};
    } catch {
      body = { detail: rawText || "Clear failed" };
    }
    if (!res.ok) throw new Error(body.detail || "Clear failed");
    els.adminStatus.textContent = "Database cleared.";
    state.baselineCompleted = 0;
    updateBaselineProgress();
    updateStartButtonLabel();
    resetScoreCard();
    renderLeaderboard([]);
  } catch (err) {
    els.adminStatus.textContent = `Clear error (v3): ${err.message}`;
  }
}

function downloadCsv(table) {
  const token = els.adminToken.value.trim();
  if (!token) {
    els.adminStatus.textContent = "Enter admin token first.";
    return;
  }
  const url = `${state.backendUrl}/admin/export/${table}?token=${encodeURIComponent(token)}`;
  fetch(url)
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
      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = `${table}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      els.adminStatus.textContent = `Downloaded ${table}.csv`;
    })
    .catch((err) => {
      els.adminStatus.textContent = `Download error (v3): ${err.message}`;
    });
}

function init() {
  loadSession();
  els.modalFirstName.value = localStorage.getItem("firstName") || "";
  els.modalLastName.value = localStorage.getItem("lastName") || "";
  updateLoggedInUser();
  persistSession();
  bindEvents();
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();
  setupBaskets();
  draw();
  const params = new URLSearchParams(window.location.search);
  if (params.get("admin") === "1") {
    els.adminCard.classList.remove("hidden");
  }
  if (state.userId) {
    refreshBaseline().catch((err) => {
      els.baselineStatus.textContent = `Error: ${err.message}`;
    });
    refreshUserStats();
    els.profileStatus.textContent = "Session resumed for this device.";
  } else {
    updateLabelVisibility();
    els.baselineBanner.textContent = "Complete 3 baseline runs first.";
    els.nextStep.textContent = "Next: Save profile, then complete 3 baseline runs.";
    updateBaselineProgress();
    updateStartButtonLabel();
    showModal("profile");
  }
  refreshLeaderboard();
}

init();
