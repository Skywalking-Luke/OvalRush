import { boot, G, car, mkBot, scatterPicks, style, addScore, stat, lv, note, showBanner, popText, bar, audio, gameOver, rnd, clamp, hash, burst, PLAYER_Y, botX, W, H, ctx, SW, OG, type Bot, type Game, type Obs } from "./engine";

const LAP = 3600, FIELD = 24;
const lapPos = (s: number) => ((s % LAP) + LAP) % LAP;
const inTurn = (s: number) => { const q = lapPos(s); return q >= 1100 && q < 1900 ? (q - 1100) / 800 : q >= 2800 ? (q - 2800) / 800 : -1; };
const inPitZone = (s: number) => { const q = lapPos(s); return q >= 200 && q < 1150; };
const base = (L: number) => 300 * Math.pow(1.06, Math.min(L, 9) - 1);
const stageLaps = (L: number) => Math.min(9, 3 + L);
const cutLine = (L: number) => Math.max(5, 20 - 2 * L);

const COLS: [string, string][] = [["#d23b3b", "#ffd23f"], ["#f0c419", "#222"], ["#3b7bd2", "#fff"], ["#e8e8e8", "#d23b3b"], ["#38a84a", "#ffd23f"], ["#ff7a1a", "#3b7bd2"], ["#9b4fd2", "#ffd23f"], ["#222", "#ff3b3b"], ["#1aa7a7", "#fff"], ["#ff5fa8", "#222"], ["#7a4a1a", "#ffd23f"], ["#5ad23b", "#222"]];
const PLAYER = car("stock", "#0a3fd0", "#ffd23f", 7);
const BOTSPR = Array.from({ length: FIELD - 1 }, (_, i) => car("stock", COLS[i % COLS.length][0], COLS[i % COLS.length][1], (i * 3 + 1) % 10));

let fuel = 100, tyre = 100, dmg = 0, draft = 0, drafting = false, wasDraft = false, inPit = false, pitT = 0, serviced = false;
let yellowT = 0, bigOneAt = 0, bigOneDone = false, bigOneWatch: Bot[] = [], incidentCD = 0, lastLap = 0, pos = FIELD, bestPos = FIELD, finishPos = FIELD, laps = 3;
let field: Bot[] = [], cautionReason = "";
const spd = () => base(G.level);

function placeField(startPos: number) {
  field = BOTSPR.map((spr, i) => { const b = mkBot(0, 0, 0, spr); b.data = { sk: rnd(0.94, 1.0) + Math.min(0.03, 0.006 * G.level), num: i }; return b; });
  field.sort(() => Math.random() - 0.5);
  const order: (Bot | null)[] = [...field]; order.splice(startPos - 1, 0, null);
  const prow = Math.floor((startPos - 1) / 2);
  order.forEach((b, i) => {
    const row = Math.floor(i / 2), lane = i % 2 ? 0.45 : -0.45;
    if (!b) { G.px = G.camX = centerF(G.levelStart) + lane * (widthF(0) / 2 - 7); return; }
    b.s = G.levelStart + (prow - row) * 34; b.off = b.tOff = lane; b.v = spd() * 0.55; b.ahead = b.s > G.pS; b.kind = Math.random() < 0.25 + 0.05 * G.level ? 1 : Math.random() < 0.1 ? 3 : 0;
  });
  G.bots = field;
}
function centerF(s: number) { const t = inTurn(s); let c = 4 * Math.sin(s / 300); if (t >= 0) c -= 44 * Math.sin(Math.PI * t); const q = lapPos(s); if (q > 400 && q < 900) c += 12 * Math.sin(Math.PI * (q - 400) / 500); return c; }
function widthF(s: number) { return inTurn(s) >= 0 ? 116 : 120; }
function startCaution(why: string) { if (yellowT > 0) return; yellowT = 9 + G.level; cautionReason = why; note("⚑ CAUTION ⚑<br><small>" + why + " · hold position</small>", "#ffd23f", 2600); audio.beep(660, 0.3); }
function triggerBigOne() {
  bigOneDone = true;
  const near = G.bots.filter((b) => !b.dead && b.s - G.pS > 140 && b.s - G.pS < 520).sort((a, c) => a.s - c.s);
  const n = Math.min(near.length, 4 + G.level);
  bigOneWatch = near.slice(0, n);
  bigOneWatch.forEach((b, i) => { b.wreck = rnd(1.6, 3.2); b.vx = (Math.random() < 0.5 ? -1 : 1) * rnd(0.3, 0.9); b.data.out = true; b.spin = i; });
  for (let i = 0; i < 3 + G.level; i++) G.obs.push({ s: G.pS + rnd(220, 560), off: rnd(-0.8, 0.8), w: 6, h: 4, kind: "debris", hit: false });
  note("💥 THE BIG ONE! 💥<br><small>find a gap</small>", "#ff5a5a", 2600); audio.crash(); audio.start();
  stat("big1"); setTimeout(() => startCaution("multi-car wreck"), 1800);
}

const game: Game = {
  id: "ovalrush", title: "OVAL RUSH", base: "/OvalRush/", unit: "STAGE", color: "#ffd23f", shadow: "#0a3fd0",
  ogSub: "DRAFT · SLINGSHOT · BIG ONE",
  blurb: "Stock-car pack racing on a 2.5-mile superspeedway. Tuck into the draft, slingshot past, pit for fuel and tyres, and survive the Big One. Make the cut line each stage.",
  controls: "◀ ▶ hold left/right · arrows or A/D<br>BRAKE pad · ↓/S · Esc pause · R retry · M mute<br>Sit 1 car behind to DRAFT, pull out to SLINGSHOT.<br>PIT: dive left onto pit road (grey lane) on the frontstretch.",
  player: PLAYER, roster: BOTSPR.slice(0, 10),
  boardX: { h: "BEST", fmt: (x) => (x ? "P" + x : "-") },
  picks: {
    T: { name: "FRESH TYRES", good: true, col: "#e8e8e8", desc: "", apply: () => { tyre = 100; showBanner("FRESH TYRES", "grip restored"); } },
    F: { name: "FUEL CAN", good: true, col: "#38a84a", desc: "", apply: () => { fuel = Math.min(100, fuel + 40); showBanner("FUEL +40"); } },
    S: { name: "BUMPER", good: true, col: "#4fd2ff", desc: "", apply: () => { G.shield = true; showBanner("STEEL BUMPER", "absorbs one hit"); } },
    M: { name: "DRAFT MAGNET", good: true, col: "#ff7ad9", desc: "", apply: () => { G.fx.mag = 7; showBanner("DRAFT MAGNET", "double draft range · 7 s"); } },
    X: { name: "x2 PTS", good: true, col: "#ffd23f", desc: "", apply: () => { G.fx.x2 = 7; showBanner("DOUBLE POINTS", "7 s"); } },
    N: { name: "PUSH-TO-PASS", good: true, col: "#ff3b3b", desc: "", apply: () => { G.fx.p2p = 3; showBanner("PUSH-TO-PASS", "+15% speed · 3 s"); audio.boost(); } },
    O: { name: "OIL", good: false, col: "#6a3fa8", desc: "", apply: () => { G.fx.oil = 2.5; showBanner("⚠ OIL DOWN", "grip lost"); } },
    W: { name: "LOOSE WHEEL", good: false, col: "#999", desc: "", apply: () => { G.fx.wheel = 5; wheelDir = Math.random() < 0.5 ? -1 : 1; showBanner("⚠ LOOSE WHEEL", "pulling · slower"); } },
    D: { name: "DEBRIS", good: false, col: "#aaa", desc: "", apply: () => { tyre = Math.max(0, tyre - 30); showBanner("⚠ DEBRIS", "tyres -30%"); } },
    H: { name: "GRILLE TAPE", good: false, col: "#ff7a1a", desc: "", apply: () => { G.fx.hot = 6; showBanner("⚠ OVERHEATING", "too much grille tape · -15% power"); } },
  },
  center: centerF, width: widthF,
  limit: (s) => (inTurn(s) >= 0.12 && inTurn(s) <= 0.88 ? spd() * 1.1 : 1e9),
  levelLen: (L) => stageLaps(L) * LAP,
  vmax() {
    if (pitT > 0) return 0;
    if (inPit) return 120;
    if (fuel <= 0) return 60;
    let v = spd() * 1.04;
    v *= 1 + 0.12 * (drafting ? draftF : 0);
    if ((G.fx.sling || 0) > 0) v *= 1.16;
    if ((G.fx.p2p || 0) > 0) v *= 1.15;
    if ((G.fx.hot || 0) > 0) v *= 0.85;
    if ((G.fx.wheel || 0) > 0) v *= 0.9;
    v *= 0.9 + 0.1 * (tyre / 100); v *= 1 - 0.18 * (dmg / 100);
    if (yellowT > 0) v = Math.min(v, 190);
    if (G.off < 0) v *= 0.9;
    return v;
  },
  accel: () => 170 + 10 * G.level, brakeDecel: 320,
  steer: () => 105 * (0.75 + 0.25 * tyre / 100) * ((G.fx.wheel || 0) > 0 ? 0.7 : 1),
  grip: () => ((G.fx.oil || 0) > 0 ? 2 : 6 + 30 * (tyre / 100)),
  kmh: (v) => v * 0.9,
  start() { fuel = 100; tyre = 100; dmg = 0; bestPos = FIELD; finishPos = FIELD; G.pack = true; G.edge = 36; G.dust = "#2f6b2a"; },
  startLevel() {
    laps = stageLaps(G.level); yellowT = 0; inPit = false; pitT = 0; serviced = false; draft = 0; lastLap = 0; incidentCD = 6;
    if (G.level > 1) { fuel = Math.min(100, fuel + 50); tyre = Math.min(100, tyre + 50); dmg = Math.max(0, dmg - 20); }
    const sp = G.level === 1 ? FIELD : Math.min(FIELD, finishPos + 6);
    placeField(sp); G.v = spd() * 0.55;
    bigOneDone = G.level < 2; bigOneAt = G.levelStart + G.levelLen * rnd(0.3, 0.75); bigOneWatch = [];
    const ups = ["T", "F", "S", "M", "X", "N"], dns = ["O", "W", "D", "H"];
    scatterPicks(ups, 4 + G.level, dns, Math.round(3 * Math.pow(1.4, G.level - 1)), 500);
    const cut = cutLine(G.level);
    G.objs = [
      { label: `MAKE THE CUT: TOP ${cut}`, cur: () => pos, goal: cut, le: true, atEnd: true, bonus: 0, show: () => `(P${pos})` },
      { label: `TOP ${Math.max(1, cut - 6)} FINISH`, cur: () => pos, goal: Math.max(1, cut - 6), le: true, atEnd: true, bonus: 1500 * G.level },
      { label: `DRAFT ${6 + 2 * G.level} S`, cur: () => lv("draft"), goal: 6 + 2 * G.level, bonus: 600 + 200 * G.level, show: () => `(${Math.floor(lv("draft"))})` },
      { label: `${1 + Math.floor(G.level / 2)} SLINGSHOT PASS`, cur: () => lv("sling"), goal: 1 + Math.floor(G.level / 2), bonus: 800 + 200 * G.level, show: () => `(${lv("sling")})` },
      G.level >= 2 ? { label: "SURVIVE THE BIG ONE", cur: () => lv("survive"), goal: 1, bonus: 2500 } : { label: "NO WALL CONTACT", cur: () => lv("wall"), goal: 0, le: true, atEnd: true, bonus: 1000 },
    ];
    showBanner(`STAGE ${G.level} · GREEN FLAG`, `${laps} laps · start P${sp} · cut line P${cut}`, 2400); audio.voice("Green flag");
  },
  tick(dt) {
    const q = lapPos(G.pS);
    // position + laps
    pos = 1 + G.bots.filter((b) => !b.dead && !b.data.out && b.s > G.pS).length;
    if (pos < bestPos) bestPos = pos;
    const lap = Math.floor((G.pS - G.levelStart) / LAP);
    if (lap > lastLap) { lastLap = lap; if (pos === 1) { const g = addScore(500, "style"); popText(`LED A LAP +${g}`); } if (lap === laps - 1) note("WHITE FLAG · final lap of the stage", "#fff", 1800); }
    // fuel / tyres
    fuel = Math.max(0, fuel - dt * (yellowT > 0 ? 0.7 : 1.6) * (inPit ? 0 : 1));
    tyre = Math.max(0, tyre - dt * (yellowT > 0 ? 0.3 : 1.15 + 0.1 * G.level) * (G.off ? 2 : 1));
    if (fuel <= 0 && G.v < 70 && !inPit) { gameOver("OUT OF FUEL"); return; }
    if (fuel < 18 && Math.floor(G.t * 2) % 6 === 0 && !inPit) note("BOX BOX · low fuel", "#ffd23f", 600);
    // pit road
    const c = centerF(G.pS), hw = widthF(G.pS) / 2;
    const left = G.px < c - hw - 12;
    if (left && inPitZone(G.pS) && !inPit) { inPit = true; serviced = false; note("PIT ROAD · speed limit", "#7ff0ff", 1500); }
    if (inPit) {
      if (!inPitZone(G.pS)) { inPit = false; G.px = Math.max(G.px, c - hw + 6); }
      else if (!left && q < 600) inPit = false; // aborted before box
      else {
        G.px = clamp(G.px, c - hw - 34, c - hw - 10);
        if (!serviced && q > 700) { serviced = true; pitT = 2.2; stat("pit"); G.br.pits = (G.br.pits || 0) + 1; audio.beep(440, 0.4); }
      }
    }
    if (pitT > 0) {
      G.v = 0; pitT -= dt;
      if (pitT <= 0) { fuel = 100; tyre = 100; dmg = Math.max(0, dmg - 30); const yb = yellowT > 0; const g = addScore(yb ? 1200 : 300, "style"); note(yb ? `PIT UNDER YELLOW +${g}` : `4 TYRES + FUEL +${g}`, "#7dff9a", 1600); audio.jingle(); }
    }
    // draft
    const dRange = 85 * ((G.fx.mag || 0) > 0 ? 2 : 1);
    let lead: Bot | null = null, ld = 1e9;
    for (const b of G.bots) { if (b.dead || b.wreck > 0) continue; const dy = b.s - G.pS; if (dy > 18 && dy < dRange && Math.abs(botX(b) - G.px) < 9 && dy < ld) { ld = dy; lead = b; } }
    wasDraft = drafting; drafting = !!lead && !inPit && yellowT <= 0;
    draftF = lead ? 1 - (ld - 18) / dRange : 0;
    if (drafting) { draft = Math.min(1, draft + dt * 0.45); stat("draft", dt); addScore(12 * dt * (1 + draftF), "style"); }
    else if (wasDraft && draft >= 0.4) {
      // pulled out of the tow: slingshot
      G.fx.sling = 0.8 + draft * 1.2; G.speedFx = G.fx.sling; draft = 0; audio.boost(); popText("SLINGSHOT!");
    } else draft = Math.max(0, draft - dt * 0.15);
    // caution & incidents
    if (yellowT > 0) {
      yellowT -= dt;
      if (yellowT <= 0) { note("GREEN GREEN GREEN", "#7dff9a", 1400); audio.voice("Green, green"); G.bots.forEach((b) => { if (b.data.out) b.dead = true; }); G.obs = G.obs.filter((o) => o.kind !== "debris"); }
    } else {
      incidentCD -= dt;
      if (incidentCD <= 0) {
        incidentCD = rnd(8, 16) / (1 + 0.15 * G.level);
        if (Math.random() < 0.35 + 0.08 * G.level) {
          const cand = G.bots.filter((b) => !b.dead && !b.data.out && b.s - G.pS > 200 && b.s - G.pS < 420);
          if (cand.length) { const b = cand[Math.floor(Math.random() * cand.length)]; b.wreck = 2.4; b.vx = (Math.random() < 0.5 ? -1 : 1) * 0.6; b.data.out = true; note(`⚠ #${b.data.num} SPINS AHEAD`, "#ff7a1a", 1500); setTimeout(() => G.st === "play" && startCaution(`#${b.data.num} spun`), 1500); }
        }
      }
    }
    if (!bigOneDone && G.pS > bigOneAt && yellowT <= 0) triggerBigOne();
    if (bigOneWatch.length && bigOneWatch.every((b) => b.s < G.pS - 40)) { bigOneWatch = []; stat("survive"); style("BIG ONE SURVIVOR", 1500); }
    // downs
    if ((G.fx.wheel || 0) > 0) G.lat += wheelDir * 22;
    if ((G.fx.oil || 0) > 0) G.lat += Math.sin(G.t * 9) * 45;
    G.speedFx = Math.max(G.speedFx, (G.fx.p2p || 0));
  },
  botTick(b) {
    if (b.data.out) { b.v = 0; b.tOff = b.off; if (b.s < G.pS - 400) b.dead = true; return; }
    let v = spd() * b.data.sk;
    if (inTurn(b.s) >= 0) v *= 0.99;
    if (G.bots.some((o) => o !== b && !o.dead && o.s - b.s > 15 && o.s - b.s < 70 && Math.abs(o.off - b.off) < 0.3)) v *= 1.05; // bots draft too
    if (b.s < G.pS - 500) v *= 1.06; // rubber-band so packs stay together
    if (yellowT > 0) { v = Math.min(v, 175); b.tOff = b.off > 0 ? 0.45 : -0.45; }
    b.v += (v - b.v) * 0.05;
  },
  onPass(b) {
    if (yellowT > 0 && !b.data.out) { G.score = Math.max(0, G.score - 300); note("⚠ PASSING UNDER YELLOW -300", "#ff5a5a", 1400); stat("pen"); return; }
    if ((G.fx.sling || 0) > 0) { stat("sling"); style("SLINGSHOT PASS", 300); }
    else if (drafting || wasDraft) style("DRAFT PASS", 120);
  },
  onHit(b) {
    if (b.wreck > 0 || b.data.out) { dmg += 45; }
    else {
      const dy = b.s - G.pS, dx = Math.abs(botX(b) - G.px);
      if (dy > 0 && dx < 5 && G.v - b.v < 60) { b.v += 25; G.v *= 0.98; style("BUMP DRAFT", 150); return true; }
      dmg += dx > 7 ? 10 : 22; G.v *= 0.9;
      if (dx > 7) popText("RUBBIN' IS RACIN'");
    }
    if (dmg >= 100) { gameOver("WRECKED!"); return true; }
    return true;
  },
  onObs(o: Obs) { tyre = Math.max(0, tyre - 25); dmg += 15; if (dmg >= 100) { gameOver("WRECKED!"); } return true; },
  offroad(side, dt) {
    const c = centerF(G.pS), hw = widthF(G.pS) / 2;
    if (side > 0 && G.px > c + hw - 3) {
      G.px = c + hw - 3; G.vxL = -30; G.v *= 1 - 0.8 * dt; dmg += 14 * dt; stat("wall", dt); G.shake = 0.1;
      if (Math.random() < 0.8) G.parts.push({ x: G.px - G.camX + W / 2 + 5, y: PLAYER_Y() + rnd(-8, 8), vx: rnd(-40, 0), vy: rnd(40, 120), life: 0.3, c: Math.random() < 0.5 ? "#ffd23f" : "#fff" });
      if (dmg >= 100) gameOver("INTO THE WALL");
    } else if (side < 0 && !inPit && !inPitZone(G.pS) && G.px < c - hw - 8) { G.v *= 1 - 0.6 * dt; }
  },
  levelEnd() {
    finishPos = pos;
    const cut = cutLine(G.level);
    if (pos > cut) return { bonus: 0, fail: `ELIMINATED · P${pos}` };
    return { bonus: (FIELD + 1 - pos) * 100 * G.level, msg: `finished P${pos}` };
  },
  hud() {
    const fx: string[] = [], up = (t: string) => fx.push(`<span class="u">${t}</span>`), dn = (t: string) => fx.push(`<span class="d">⚠ ${t}</span>`);
    if (yellowT > 0) dn("CAUTION " + yellowT.toFixed(0));
    if (drafting) up("IN THE DRAFT"); if ((G.fx.sling || 0) > 0) up("SLINGSHOT"); if ((G.fx.p2p || 0) > 0) up("PUSH-TO-PASS"); if ((G.fx.mag || 0) > 0) up("DRAFT MAGNET");
    if ((G.fx.oil || 0) > 0) dn("OIL"); if ((G.fx.wheel || 0) > 0) dn("LOOSE WHEEL"); if ((G.fx.hot || 0) > 0) dn("OVERHEAT");
    if (inPit) up(pitT > 0 ? "PIT STOP " + pitT.toFixed(1) : "PIT ROAD 60");
    const lap = Math.min(laps, Math.floor((G.pS - G.levelStart) / LAP) + 1);
    return { info: `<b style="font-size:13px">P${pos}</b>/${FIELD} · LAP ${lap}/${laps} · CUT P${cutLine(G.level)}`, fx, panel: bar("FUEL", fuel / 100, fuel < 20 ? "#ff3b3b" : "#38a84a") + bar("TYRES", tyre / 100, "#e8e8e8") + bar("DAMAGE", dmg / 100, "#ff7a1a") + bar("DRAFT", draft, "#4fd2ff") };
  },
  row(y, s, L, R, c, hw) {
    const q = lapPos(s), band = Math.floor(s / 8), t = inTurn(s);
    // infield / grandstands
    ctx.fillStyle = "#2f7a2a"; ctx.fillRect(0, y, L, 1);
    ctx.fillStyle = "#30303a"; ctx.fillRect(R, y, W - R, 1);
    for (let x = R + 10; x < W; x += 2) { const h = hash(Math.floor(x / 2) * 13 + Math.floor(s / 3)); ctx.fillStyle = h > 0.8 ? "#ffd23f" : h > 0.6 ? "#d23b3b" : h > 0.4 ? "#3b7bd2" : h > 0.25 ? "#ddd" : "#555"; ctx.fillRect(x, y, 1, 1); }
    ctx.fillStyle = "#bbb"; ctx.fillRect(R + 6, y, 1, 1); ctx.fillStyle = (band & 3) === 0 ? "#888" : "#444"; ctx.fillRect(R + 8, y, 1, 1);
    // pit road
    if (inPitZone(s)) {
      ctx.fillStyle = "#57575e"; ctx.fillRect(L - 36, y, 28, 1);
      ctx.fillStyle = "#ddd"; ctx.fillRect(L - 38, y, 2, 1);
      if (q > 650 && q < 820) { ctx.fillStyle = (Math.floor(q / 12) & 1) ? "#ffd23f" : "#57575e"; ctx.fillRect(L - 34, y, 2, 1); ctx.fillRect(L - 12, y, 2, 1); }
      if (q < 230 || q > 1120) { ctx.fillStyle = "#fff"; ctx.fillRect(L - 36, y, 28, 1); }
      ctx.fillStyle = "#ffd23f"; if ((band & 1) === 0) ctx.fillRect(L - 8, y, 1, 1);
    }
    // apron + surface w/ banking shade
    ctx.fillStyle = "#6d6d74"; ctx.fillRect(L - 8, y, 8, 1);
    const tt = t >= 0 ? Math.sin(Math.PI * t) : 0;
    for (let x = L; x < R; x += 4) { const f = (x - L) / (R - L); const g = Math.round(66 + 22 * f * tt + ((Math.floor(s / 4) & 1) ? 0 : 3)); ctx.fillStyle = `rgb(${g},${g},${g + 5})`; ctx.fillRect(x, y, Math.min(4, R - x), 1); }
    ctx.fillStyle = "#3d3d42"; ctx.fillRect(Math.round(c - hw * 0.35), y, 3, 1); // rubber groove
    ctx.fillStyle = "#ffd23f"; ctx.fillRect(L, y, 1, 1); ctx.fillRect(L + 2, y, 1, 1);
    ctx.fillStyle = (band & 1) ? "#e8e8e8" : "#3b7bd2"; ctx.fillRect(R - 2, y, 3, 1);
    if (q < 6 || q > LAP - 6) { for (let x = L; x < R; x += 2) { ctx.fillStyle = ((x >> 1) + Math.floor(q / 2)) & 1 ? "#fff" : "#111"; ctx.fillRect(x, y, 2, 1); } }
    if (s - G.levelStart + G.levelLen < 6 && s - G.levelStart + G.levelLen > 0) { /* noop */ }
    if (Math.abs(s - (G.levelStart + G.levelLen)) < 3) { ctx.fillStyle = "#7dff9a"; ctx.fillRect(L, y, R - L, 1); }
  },
  under(pY, sx) {
    // draft wake behind the car you're tucked into
    if (!drafting) return;
    const x = Math.round(G.px + sx);
    for (let i = 0; i < 5; i++) { const yy = pY - 12 - ((G.t * 120 + i * 13) % 60); ctx.fillStyle = "rgba(160,220,255,.5)"; ctx.fillRect(x - 3 + (i % 3) * 3, Math.round(yy), 1, 5); }
  },
  overlay() {
    if (yellowT > 0) { ctx.fillStyle = "rgba(255,210,63,.1)"; ctx.fillRect(0, 0, W, H); if (Math.floor(G.t * 3) & 1) { ctx.fillStyle = "#ffd23f"; ctx.fillRect(0, 0, W, 2); ctx.fillRect(0, H - 2, W, 2); } }
    if ((G.fx.oil || 0) > 0) { ctx.fillStyle = "rgba(40,0,60,.12)"; ctx.fillRect(0, 0, W, H); }
  },
  drawObs(o, x, y) { ctx.fillStyle = "#aaa"; ctx.fillRect(x - 3, y - 2, 3, 2); ctx.fillStyle = "#ddd"; ctx.fillRect(x, y, 3, 1); ctx.fillStyle = "#555"; ctx.fillRect(x - 1, y + 1, 2, 1); },
  pads: [{ id: "bbrake", label: "BRAKE", cls: "brk", down: () => (G.brakePad = true), up: () => (G.brakePad = false) }],
  overLines: () => [["Finish / best", `P${pos} / P${bestPos}`], ["Pit stops", "" + (G.br.pits || 0)]],
  boardVal: () => bestPos,
  og() {
    G.level = 2; G.levelStart = -1e9; G.levelLen = 1e12; G.pS = 5000; G.px = centerF(G.pS) - 18; G.camX = centerF(G.pS); drafting = true;
    G.bots = [-0.45, 0.45, -0.45, 0.45, 0.05].map((o, i) => { const b = mkBot(G.pS + 30 + Math.floor(i / 2) * 34 + (i === 4 ? 70 : 0), o, 0, BOTSPR[i * 3]); return b; });
    G.speedFx = 1;
  },
};
let draftF = 0, wheelDir = 1;
void SW; void OG; void burst; void clamp;
boot(game);
