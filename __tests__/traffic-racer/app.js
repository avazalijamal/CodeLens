(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const coinsEl = document.getElementById("coins");
  const btn = document.getElementById("btn");

  // --- Utility
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);

  // --- Game constants
  const W = canvas.width,
    H = canvas.height;
  const lanes = 3;
  const road = { x: 46, y: 18, w: W - 92, h: H - 36 };
  const laneW = road.w / lanes;

  // --- State
  let running = false;
  let lastT = 0;

  let score = 0;
  let coins = 0;
  let best = Number(localStorage.getItem("traffic_best") || 0);
  bestEl.textContent = best;

  const player = { w: laneW * 0.56, h: 82, x: 0, y: 0, vx: 0 };

  const enemies = [];
  const sparkles = []; // small particles for style
  const pickups = []; // coins

  let spawnTimer = 0;
  let coinTimer = 0;

  // difficulty
  let speed = 230; // px/s
  let spawnEvery = 0.88; // seconds

  let flash = 0; // collision flash overlay (0..1)

  function laneCenterX(lane) {
    return road.x + laneW * (lane + 0.5);
  }

  function reset() {
    score = 0;
    coins = 0;
    scoreEl.textContent = score;
    coinsEl.textContent = coins;

    speed = 230;
    spawnEvery = 0.88;

    enemies.length = 0;
    pickups.length = 0;
    sparkles.length = 0;

    spawnTimer = 0;
    coinTimer = 0;
    flash = 0;

    player.x = laneCenterX(1) - player.w / 2;
    player.y = road.y + road.h - player.h - 18;
    player.vx = 0;
  }

  function rectsOverlap(a, b) {
    return (
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    );
  }

  function spawnEnemy() {
    const lane = Math.floor(rand(0, lanes));
    const w = laneW * rand(0.48, 0.63);
    const h = rand(70, 98);
    const x = laneCenterX(lane) - w / 2;
    const y = road.y - h - 12;

    // brighter palette
    const palette = ["#fb7185", "#fbbf24", "#34d399", "#60a5fa", "#a78bfa"];
    enemies.push({
      x,
      y,
      w,
      h,
      color: palette[Math.floor(rand(0, palette.length))],
      passed: false,
    });
  }

  function spawnCoin() {
    const lane = Math.floor(rand(0, lanes));
    const r = 10;
    const x = laneCenterX(lane);
    const y = road.y - 20;
    pickups.push({ x, y, r, t: 0 });
  }

  // Input
  const keys = new Set();

  window.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "a", "d", "A", "D", " "].includes(e.key))
      e.preventDefault();
    keys.add(e.key);
    if (e.key === " " && !running) start();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key));

  // touch / pointer drag
  let dragging = false;
  let lastPX = 0;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    lastPX = e.clientX;
  });
  canvas.addEventListener("pointerup", () => (dragging = false));
  canvas.addEventListener("pointercancel", () => (dragging = false));
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastPX;
    lastPX = e.clientX;
    player.x += dx * (W / canvas.getBoundingClientRect().width);
    player.x = clamp(player.x, road.x + 8, road.x + road.w - player.w - 8);
  });

  // Start / stop
  btn.addEventListener("click", () => (running ? stop("Paused") : start()));

  function start() {
    reset();
    running = true;
    btn.textContent = "Pause";
    lastT = performance.now();
    requestAnimationFrame(loop);
  }

  function stop(reason = "Game Over") {
    running = false;
    btn.textContent = "Start";

    if (score > best) {
      best = score;
      localStorage.setItem("traffic_best", String(best));
      bestEl.textContent = best;
    }

    draw(); // last frame
    // overlay card
    ctx.save();
    ctx.fillStyle = "rgba(2,6,23,.62)";
    ctx.fillRect(0, 0, W, H);

    // neon frame
    ctx.strokeStyle = "rgba(168,85,247,.65)";
    ctx.lineWidth = 2;
    roundRect(48, 220, W - 96, 160, 18);
    ctx.stroke();

    ctx.fillStyle = "#e5e7eb";
    ctx.font = "800 30px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(reason, W / 2, 280);
    ctx.font = "600 14px system-ui";
    ctx.fillStyle = "#cbd5e1";
    ctx.fillText("Start üçün düyməni bas (və ya SPACE).", W / 2, 310);
    ctx.fillStyle = "#a5b4fc";
    ctx.fillText(`Score: ${score}   •   Coins: ${coins}`, W / 2, 336);
    ctx.restore();
  }

  function addSparkle(x, y, color) {
    for (let i = 0; i < 6; i++) {
      sparkles.push({
        x,
        y,
        vx: rand(-60, 60),
        vy: rand(-120, -20),
        life: rand(0.35, 0.7),
        t: 0,
        r: rand(1.5, 2.6),
        color,
      });
    }
  }

  function update(dt) {
    // keyboard steering
    const left = keys.has("ArrowLeft") || keys.has("a") || keys.has("A");
    const right = keys.has("ArrowRight") || keys.has("d") || keys.has("D");

    const ax = 1250;
    if (left) player.vx -= ax * dt;
    if (right) player.vx += ax * dt;
    player.vx *= Math.pow(0.0018, dt);

    player.x += player.vx * dt;
    player.x = clamp(player.x, road.x + 8, road.x + road.w - player.w - 8);

    // spawn enemies
    spawnTimer += dt;
    if (spawnTimer >= spawnEvery) {
      spawnTimer = 0;
      spawnEnemy();
    }

    // spawn coins
    coinTimer += dt;
    if (coinTimer >= 1.35) {
      coinTimer = 0;
      spawnCoin();
    }

    // ramp difficulty
    speed += 7 * dt;
    spawnEvery = Math.max(0.44, spawnEvery - 0.012 * dt);

    // move enemies
    for (const en of enemies) {
      en.y += speed * dt;

      // particles trail (subtle)
      if (Math.random() < 0.12)
        addSparkle(en.x + en.w / 2, en.y + en.h, en.color);

      if (!en.passed && en.y > player.y + player.h) {
        en.passed = true;
        score += 1;
        scoreEl.textContent = score;
      }
      if (rectsOverlap(player, en)) {
        flash = 1;
        stop("Game Over");
        return;
      }
    }

    // move coins + pickup
    for (const c of pickups) {
      c.y += speed * dt * 0.92;
      c.t += dt;
      // collision (circle vs rect approx)
      const coinRect = { x: c.x - c.r, y: c.y - c.r, w: c.r * 2, h: c.r * 2 };
      if (rectsOverlap(player, coinRect)) {
        c.dead = true;
        coins += 1;
        coinsEl.textContent = coins;
        addSparkle(c.x, c.y, "#fbbf24");
      }
    }

    // particles
    for (const p of sparkles) {
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt;
    }

    flash = Math.max(0, flash - 2.2 * dt);

    // cleanup
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i].y > road.y + road.h + 140) enemies.splice(i, 1);
    }
    for (let i = pickups.length - 1; i >= 0; i--) {
      if (pickups[i].dead || pickups[i].y > road.y + road.h + 80)
        pickups.splice(i, 1);
    }
    for (let i = sparkles.length - 1; i >= 0; i--) {
      if (sparkles[i].t > sparkles[i].life) sparkles.splice(i, 1);
    }
  }

  // --- Drawing helpers
  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function glowCircle(x, y, r, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawRoad() {
    // neon background behind road
    ctx.save();
    ctx.fillStyle = "#070b12";
    ctx.fillRect(0, 0, W, H);

    // glowing side lights
    const t = performance.now() / 1000;
    for (let i = 0; i < 12; i++) {
      const y =
        road.y + (road.h / 12) * i + ((t * speed * 0.12) % (road.h / 12));
      glowCircle(road.x - 10, y, 3.6, "#a855f7", 0.7);
      glowCircle(road.x + road.w + 10, y, 3.6, "#60a5fa", 0.7);
    }

    // road gradient
    const g = ctx.createLinearGradient(0, road.y, 0, road.y + road.h);
    g.addColorStop(0, "#0b1220");
    g.addColorStop(1, "#070a12");
    ctx.fillStyle = g;
    roundRect(road.x, road.y, road.w, road.h, 18);
    ctx.fill();

    // border glow
    ctx.shadowColor = "rgba(96,165,250,.35)";
    ctx.shadowBlur = 18;
    ctx.strokeStyle = "rgba(148,163,184,.35)";
    ctx.lineWidth = 2.2;
    roundRect(road.x, road.y, road.w, road.h, 18);
    ctx.stroke();

    // lane lines (neon dashed)
    const dashH = 26,
      gap = 18;
    const offset = (t * speed * 0.35) % (dashH + gap);

    for (let i = 1; i < lanes; i++) {
      const x = road.x + laneW * i;
      ctx.beginPath();
      for (
        let y = road.y - (dashH + gap);
        y < road.y + road.h + (dashH + gap);
        y += dashH + gap
      ) {
        ctx.moveTo(x, y + offset);
        ctx.lineTo(x, y + offset + dashH);
      }
      ctx.shadowColor = "rgba(34,197,94,.35)";
      ctx.shadowBlur = 14;
      ctx.strokeStyle = "rgba(34,197,94,.55)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCar(x, y, w, h, color, isPlayer = false) {
    ctx.save();
    // glow
    ctx.shadowColor = color;
    ctx.shadowBlur = isPlayer ? 22 : 16;

    // body
    const body = ctx.createLinearGradient(x, y, x + w, y + h);
    body.addColorStop(0, color);
    body.addColorStop(1, "rgba(255,255,255,.08)");
    ctx.fillStyle = body;
    roundRect(x, y, w, h, 14);
    ctx.fill();

    // stripes
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,.22)";
    roundRect(x + w * 0.18, y + h * 0.12, w * 0.18, h * 0.76, 8);
    ctx.fill();
    roundRect(x + w * 0.64, y + h * 0.12, w * 0.18, h * 0.76, 8);
    ctx.fill();

    // windshield
    ctx.fillStyle = "rgba(0,0,0,.26)";
    roundRect(x + w * 0.22, y + h * 0.1, w * 0.56, h * 0.2, 10);
    ctx.fill();

    // wheels
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(x - 6, y + 10, 8, 18);
    ctx.fillRect(x - 6, y + h - 28, 8, 18);
    ctx.fillRect(x + w - 2, y + 10, 8, 18);
    ctx.fillRect(x + w - 2, y + h - 28, 8, 18);

    // player headlights
    if (isPlayer) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "rgba(255,255,255,.9)";
      ctx.beginPath();
      ctx.ellipse(x + w * 0.25, y + 10, 9, 16, 0, 0, Math.PI * 2);
      ctx.ellipse(x + w * 0.75, y + 10, 9, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function drawCoin(c) {
    const pulse = 0.5 + 0.5 * Math.sin(c.t * 8);
    // glow
    glowCircle(c.x, c.y, c.r + 2 + pulse * 2, "rgba(251,191,36,.9)", 0.22);
    // core
    ctx.save();
    ctx.shadowColor = "#fbbf24";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSparkles() {
    for (const p of sparkles) {
      const a = 1 - p.t / p.life;
      glowCircle(p.x, p.y, p.r, p.color, a * 0.8);
    }
  }

  function draw() {
    drawRoad();

    // enemies
    for (const en of enemies) drawCar(en.x, en.y, en.w, en.h, en.color, false);

    // coins
    for (const c of pickups) drawCoin(c);

    // player
    drawCar(player.x, player.y, player.w, player.h, "#38bdf8", true);

    // sparkles on top
    drawSparkles();

    // collision flash overlay
    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = flash * 0.35;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(0.033, (t - lastT) / 1000);
    lastT = t;

    update(dt);
    if (running) {
      draw();
      requestAnimationFrame(loop);
    }
  }

  // initial screen
  reset();
  stop("Traffic Racer");
})();
