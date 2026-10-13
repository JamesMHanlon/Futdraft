"use strict";
// ---------- Setup ----------
const PL = Object.create(null);
PLAYER_DATA.forEach(([name, pos, nat, club, ovr, pac, sho, pas, dri, def, phy], i) => {
  const id = "p" + i;
  PL[id] = { id, name, pos: pos.split(","), nat, club, ovr, pac, sho, pas, dri, def, phy, gk: pos === "GK" };
});
const ALL_IDS = Object.keys(PL);

const rand = a => a[Math.floor(Math.random() * a.length)];
const ri = n => Math.floor(Math.random() * n);
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function wpick(pairs) {
  const tot = pairs.reduce((s, p) => s + p[1], 0);
  let r = Math.random() * tot;
  for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; }
  return pairs[pairs.length - 1][0];
}

// ---------- Positions & chemistry ----------
const fitIn = (p, slotPos) => Math.max(0, ...p.pos.map((q, i) => (POS_FIT[slotPos][q] || 0) * (i === 0 ? 1 : 0.98)));
const slotsOf = f => FORMATIONS[f].slots.map(([id, pos, x, y]) => ({ id, pos, x, y }));

// Chemistry per player: 0-3, from links to neighbours (same club +2, same nation +1) and playing in position.
function chemistry(formation, lineup) {
  const per = {};
  for (const s of slotsOf(formation)) per[s.id] = 0;
  for (const [a, b] of FORMATIONS[formation].links) {
    const pa = PL[lineup[a]], pb = PL[lineup[b]];
    if (!pa || !pb) continue;
    const v = (pa.club === pb.club ? 2 : 0) + (pa.nat === pb.nat ? 1 : 0);
    per[a] += v; per[b] += v;
  }
  for (const s of slotsOf(formation)) {
    const p = PL[lineup[s.id]];
    per[s.id] = p ? Math.min(3, Math.floor(per[s.id] / 2) + (fitIn(p, s.pos) >= 1 ? 1 : 0)) : 0;
  }
  const total = Object.values(per).reduce((a, b) => a + b, 0);
  return { per, total, max: 33 };
}

// What a player is actually worth in a slot.
const effRating = (p, slotPos, chem) => p.ovr * (0.6 + 0.4 * fitIn(p, slotPos)) + chem * 0.8;

// ---------- Team profile ----------
const ROLE_W = {
  GK:  { gk: 1 },
  CB:  { def: 1 },
  LB:  { def: 0.6, mid: 0.15, atk: 0.25 }, RB: { def: 0.6, mid: 0.15, atk: 0.25 },
  CDM: { def: 0.5, mid: 0.5 },
  CM:  { mid: 0.7, atk: 0.15, def: 0.15 },
  CAM: { mid: 0.5, atk: 0.5 },
  LM:  { mid: 0.4, atk: 0.5, def: 0.1 }, RM: { mid: 0.4, atk: 0.5, def: 0.1 },
  LW:  { atk: 0.85, mid: 0.15 }, RW: { atk: 0.85, mid: 0.15 },
  ST:  { atk: 1 },
};
function teamProfile(T) {
  const chem = chemistry(T.formation, T.lineup);
  const acc = { atk: [0, 0], mid: [0, 0], def: [0, 0] };
  let gk = 60, sum = 0;
  const tac = Object.fromEntries(TACTIC_ORDER.map(t => [t, 0]));
  for (const s of slotsOf(T.formation)) {
    const p = PL[T.lineup[s.id]], fit = fitIn(p, s.pos), e = effRating(p, s.pos, chem.per[s.id]);
    sum += e;
    if (s.pos === "GK") { gk = e; continue; }
    const m = 0.6 + 0.4 * fit;
    const val = {
      atk: 0.5 * e + 0.5 * m * (p.sho * 0.45 + p.dri * 0.3 + p.pac * 0.25),
      mid: 0.5 * e + 0.5 * m * (p.pas * 0.6 + p.dri * 0.4),
      def: 0.5 * e + 0.5 * m * (p.def * 0.75 + p.phy * 0.25),
    };
    for (const [k, w] of Object.entries(ROLE_W[s.pos])) { acc[k][0] += val[k] * w; acc[k][1] += w; }
    for (const t of TACTIC_ORDER) tac[t] += p[TACTICS[t].stat];
  }
  const avg = k => acc[k][0] / Math.max(acc[k][1], 0.01);
  const def = avg("def") * 0.75 + gk * 0.25;
  for (const t of TACTIC_ORDER) tac[t] = tac[t] / 10 / 100;
  return { atk: avg("atk"), mid: avg("mid"), def, gk, ovr: sum / 11, chem, tacFit: tac };
}
const bestTactic = prof => TACTIC_ORDER.slice().sort((a, b) => prof.tacFit[b] - prof.tacFit[a])[0];
const grade = o => (o >= 87 ? "S" : o >= 84 ? "A" : o >= 81 ? "B" : o >= 78 ? "C" : "D");

// ---------- Draft ----------
// Four options for a slot. Mostly natural fits, now and then someone who can cover it.
function slotOptions(slotPos, taken, exclude = []) {
  const avoid = new Set([...taken, ...exclude]);
  const natural = shuffle(ALL_IDS.filter(id => !avoid.has(id) && PL[id].pos.includes(slotPos)));
  const cover = shuffle(ALL_IDS.filter(id => !avoid.has(id) && !PL[id].pos.includes(slotPos) && fitIn(PL[id], slotPos) >= 0.88));
  const out = [];
  while (out.length < 4 && (natural.length || cover.length)) {
    const src = (Math.random() < 0.8 && natural.length) || !cover.length ? natural : cover;
    out.push(src.pop());
  }
  return out;
}

function botTeam(name, diff, taken = new Set()) {
  const formation = rand(Object.keys(FORMATIONS));
  const lineup = {};
  const skill = { easy: 0.25, normal: 0.6, hard: 0.95 }[diff];
  for (const s of shuffle(slotsOf(formation))) {
    const opts = slotOptions(s.pos, [...Object.values(lineup), ...taken]);
    const best = opts.slice().sort((a, b) => scoreFor(b) - scoreFor(a))[0];
    function scoreFor(id) {
      const p = PL[id];
      const links = FORMATIONS[formation].links.filter(l => l.includes(s.id)).map(l => PL[lineup[l[0] === s.id ? l[1] : l[0]]]).filter(Boolean);
      return effRating(p, s.pos, 0) + links.reduce((a, q) => a + (q.club === p.club ? 1.5 : 0) + (q.nat === p.nat ? 0.7 : 0), 0);
    }
    lineup[s.id] = Math.random() < skill ? best : rand(opts);
  }
  const T = { name, formation, lineup, bot: true };
  T.prof = teamProfile(T);
  return T;
}
function botTactic(me, opp, diff) {
  if (diff === "easy" || Math.random() < 0.3) return rand(TACTIC_ORDER);
  // Smarter bots try to counter what your team looks like it wants to play.
  const lean = bestTactic(opp.prof);
  const counters = TACTIC_ORDER.filter(t => TACTICS[t].beats.includes(lean));
  if (diff === "hard" || Math.random() < 0.5) return counters.sort((a, b) => me.prof.tacFit[b] - me.prof.tacFit[a])[0];
  return bestTactic(me.prof);
}

// ---------- Match simulation ----------
const tacticEdge = (ta, fa, tb, fb) => (TACTICS[ta].beats.includes(tb) ? 0.12 + 0.25 * (fa - 0.7) : 0) - (TACTICS[tb].beats.includes(ta) ? 0.12 + 0.25 * (fb - 0.7) : 0) + (fa - 0.75) * 0.5;

function expectedGoals(A, B, ta, tb) {
  const pa = A.prof, pb = B.prof;
  const mid = (pa.mid - pb.mid) * 0.035;
  const ea = tacticEdge(ta, pa.tacFit[ta], tb, pb.tacFit[tb]);
  const eb = tacticEdge(tb, pb.tacFit[tb], ta, pa.tacFit[ta]);
  const shape = t => (t === "bus" ? 0.75 : t === "press" || t === "wings" ? 1.1 : 1);
  const xa = 1.35 * Math.exp((pa.atk - pb.def) * 0.075 + mid + ea) * shape(ta) * (tb === "bus" ? 0.8 : 1) * (tb === "press" ? 1.08 : 1);
  const xb = 1.35 * Math.exp((pb.atk - pa.def) * 0.075 - mid + eb) * shape(tb) * (ta === "bus" ? 0.8 : 1) * (ta === "press" ? 1.08 : 1);
  return [clamp(xa, 0.2, 4.5), clamp(xb, 0.2, 4.5)];
}

function poisson(l) { const out = []; let p = Math.exp(-l); for (let k = 0; k < 12; k++) { out.push(p); p *= l / (k + 1); } return out; }
// Probability A wins from here, with a draw split by the knockout coin (weighted slightly by strength).
function winProb(ga, gb, la, lb, drawSplit = 0.5) {
  const pa = poisson(la), pb = poisson(lb);
  let w = 0, d = 0;
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    const p = pa[i] * pb[j];
    if (ga + i > gb + j) w += p; else if (ga + i === gb + j) d += p;
  }
  return clamp(w + d * drawSplit, 0.01, 0.99);
}

const ATTACK_W = { ST: 10, LW: 6, RW: 6, CAM: 5, LM: 3, RM: 3, CM: 2, CDM: 0.7, LB: 0.8, RB: 0.8, CB: 0.6, GK: 0 };
const ASSIST_W = { CAM: 6, LW: 5, RW: 5, CM: 4, LM: 4, RM: 4, ST: 3, LB: 2.5, RB: 2.5, CDM: 1.5, CB: 0.5, GK: 0.1 };
function pickShooter(T, weights, except) {
  return wpick(slotsOf(T.formation).filter(s => s.id !== except).map(s => {
    const p = PL[T.lineup[s.id]];
    return [s.id, weights[s.pos] * (weights === ATTACK_W ? p.sho / 80 : p.pas / 80) ** 3];
  }));
}

const GOAL_LINES = [
  "{s} picks out the bottom corner from the edge of the box!", "{s} rises highest and powers a header home!",
  "{s} rounds the keeper and slots it in!", "{s} smashes it into the roof of the net!", "{s} curls one beyond the dive of {k}!",
  "a scramble in the six-yard box and {s} pokes it over the line!", "{s} is through one-on-one and makes no mistake!",
  "{s} with a stunning volley! What a hit!", "{s} taps in at the back post!",
];
const ASSIST_LINES = ["Lovely ball from {a}.", "{a} with the assist.", "Great vision from {a} to set it up.", "{a} did all the hard work there."];
const SAVE_LINES = ["{k} gets down well to keep out {s}.", "Brilliant save! {k} tips {s}'s effort over the bar.", "{s} forces a sharp stop from {k}.", "{k} stands tall and blocks {s} at point-blank range."];
const MISS_LINES = ["{s} drags it wide.", "{s} blazes over from a good position.", "Off the post! {s} so close.", "{s} heads just past the upright.", "{s} skies it. The fans can't believe it."];
const TACTIC_LINES = {
  possession: "{t} are passing it round in their sleep. The opposition can't get near it.",
  counter: "{t} win it back and break at pace. Three on two!",
  press: "{t} press high and force another turnover.",
  wings: "{t} are getting joy down the flanks, cross after cross coming in.",
  bus: "{t} have ten men behind the ball. This is a wall.",
};

function simulate(A, B, ta, tb, knockout = true) {
  const [xa, xb] = expectedGoals(A, B, ta, tb);
  const T = [A, B], X = [xa, xb], tac = [ta, tb];
  const events = [], g = [0, 0], shots = [0, 0], onT = [0, 0];
  const rating = [{}, {}];
  for (let s = 0; s < 2; s++) for (const sl of slotsOf(T[s].formation)) rating[s][sl.id] = 6.4 + Math.random() * 0.4;
  const scorers = [[], []], yellow = [{}, {}];
  const nm = (s, slot) => PL[T[s].lineup[slot]].name;
  const gkSlot = "GK";
  const conv = 0.32;
  let minute = 0, phase = "reg";
  const split = knockout ? clamp(0.5 + (xa - xb) * 0.06, 0.3, 0.7) : 0.5;
  const wpNow = (min, total) => {
    const left = Math.max(0, total - min) / 90;
    return winProb(g[0], g[1], xa * left, xb * left, split);
  };
  const push = (text, side, extra = {}) => events.push({ min: minute, text, side, score: [...g], wp: wpNow(minute, phase === "et" ? 120 : 90), ...extra });

  push(`Kick-off! ${A.name} (${TACTICS[ta].name}) against ${B.name} (${TACTICS[tb].name}).`, null);
  const possA = clamp(50 + (A.prof.mid - B.prof.mid) * 1.2 + (ta === "possession" ? 8 : 0) - (tb === "possession" ? 8 : 0)
    + (ta === "bus" || ta === "counter" ? -6 : 0) - (tb === "bus" || tb === "counter" ? -6 : 0) + (Math.random() * 6 - 3), 28, 72);

  function playMinutes(from, to, rateScale) {
    for (minute = from; minute <= to; minute++) {
      for (let s = 0; s < 2; s++) {
        const chanceRate = (X[s] / conv / 90) * rateScale;
        if (Math.random() < chanceRate) {
          const o = 1 - s, shooter = pickShooter(T[s], ATTACK_W), p = PL[T[s].lineup[shooter]], k = nm(o, gkSlot);
          const pGoal = clamp(conv * Math.exp((p.sho - T[o].prof.gk) * 0.03), 0.12, 0.6);
          shots[s]++;
          const roll = Math.random();
          if (roll < pGoal) {
            g[s]++; onT[s]++;
            const assister = Math.random() < 0.78 ? pickShooter(T[s], ASSIST_W, shooter) : null;
            rating[s][shooter] += 1.1;
            if (assister) rating[s][assister] += 0.6;
            rating[o][gkSlot] -= 0.35;
            for (const sl of slotsOf(T[o].formation)) if (["CB", "LB", "RB", "CDM"].includes(sl.pos)) rating[o][sl.id] -= 0.15;
            scorers[s].push({ slot: shooter, min: minute });
            const line = rand(GOAL_LINES).replace("{s}", `<b>${p.name}</b>`).replace("{k}", k);
            push(`GOAL! ${line}${assister ? " " + rand(ASSIST_LINES).replace("{a}", nm(s, assister)) : ""}`, s ? "b" : "a", { goal: true });
          } else if (roll < pGoal + 0.4) {
            onT[s]++;
            rating[o][gkSlot] += 0.3;
            if (Math.random() < 0.55) push(rand(SAVE_LINES).replace("{k}", k).replace("{s}", p.name), s ? "b" : "a");
          } else {
            rating[s][shooter] -= 0.1;
            if (Math.random() < 0.4) push(rand(MISS_LINES).replace("{s}", p.name), s ? "b" : "a");
          }
        }
      }
      // Bookings and colour.
      if (Math.random() < 0.035) {
        const s = ri(2), sl = rand(slotsOf(T[s].formation).filter(x => x.pos !== "GK")).id;
        if (yellow[s][sl]) { /* keep it simple: no second yellows */ }
        else { yellow[s][sl] = true; rating[s][sl] -= 0.2; push(`Yellow card for ${nm(s, sl)} after a cynical foul.`, s ? "b" : "a", { card: true }); }
      }
      if (Math.random() < 0.012) { const s = ri(2); push(TACTIC_LINES[tac[s]].replace("{t}", T[s].name), s ? "b" : "a"); }
      if (minute === 45 && phase === "reg") push(`Half-time. ${A.name} ${g[0]}–${g[1]} ${B.name}.`, null, { ht: true });
    }
  }
  playMinutes(1, 90, 1);
  minute = 90;
  let pens = null;
  if (knockout && g[0] === g[1]) {
    push(`Full-time: ${g[0]}–${g[1]}. We're going to extra time!`, null, { ht: true });
    phase = "et";
    playMinutes(91, 120, 0.85);
    minute = 120;
    if (g[0] === g[1]) {
      push("Still level after 120 minutes. It's going to penalties!", null, { ht: true });
      pens = shootout();
    }
  }
  function shootout() {
    const order = [0, 1].map(s => slotsOf(T[s].formation).filter(x => x.pos !== "GK")
      .sort((a, b) => PL[T[s].lineup[b.id]].sho - PL[T[s].lineup[a.id]].sho).map(x => x.id));
    const sc = [0, 0];
    for (let r = 0; r < 20; r++) {
      for (let s = 0; s < 2; s++) {
        const sl = order[s][r % 10], p = PL[T[s].lineup[sl]];
        const ok = Math.random() < clamp(0.76 + (p.sho - T[1 - s].prof.gk) * 0.006, 0.6, 0.9);
        if (ok) sc[s]++;
        events.push({ min: 120, pen: true, side: s ? "b" : "a", score: [...g], pens: [...sc],
          text: ok ? `${p.name} scores. (${sc[0]}–${sc[1]})` : `${p.name} ${rand(["misses", "is saved by " + nm(1 - s, gkSlot), "hits the bar"])}! (${sc[0]}–${sc[1]})`,
          wp: 0.5 + (sc[0] - sc[1]) * 0.15 });
        if (r < 5) {
          // Stop once one side can't catch up with the kicks they have left.
          const remA = 4 - r, remB = 5 - (s === 1 ? r + 1 : r);
          if (sc[0] + remA < sc[1] || sc[1] + remB < sc[0]) return finishPens(sc);
        } else if (s === 1 && sc[0] !== sc[1]) return finishPens(sc);
      }
    }
    return finishPens(sc);
  }
  function finishPens(sc) {
    const w = sc[0] > sc[1] ? 0 : 1;
    rating[w][gkSlot] += 0.6;
    return sc;
  }
  const winner = g[0] > g[1] ? "a" : g[1] > g[0] ? "b" : pens ? (pens[0] > pens[1] ? "a" : "b") : null;
  for (let s = 0; s < 2; s++) for (const k in rating[s]) {
    if (winner === (s ? "b" : "a")) rating[s][k] += 0.3;
    if (g[1 - s] === 0) for (const sl of slotsOf(T[s].formation)) if (sl.id === k && ["GK", "CB", "LB", "RB"].includes(sl.pos)) rating[s][k] += 0.5;
    rating[s][k] = clamp(Math.round(rating[s][k] * 10) / 10, 3, 10);
  }
  let mvp = { side: 0, slot: "GK", r: 0 };
  for (let s = 0; s < 2; s++) for (const k in rating[s]) if (rating[s][k] > mvp.r) mvp = { side: s, slot: k, r: rating[s][k] };
  const last = events[events.length - 1];
  const ft = pens ? `${winner === "a" ? A.name : B.name} win ${Math.max(...pens)}–${Math.min(...pens)} on penalties!`
    : `Full-time${phase === "et" ? " after extra time" : ""}: ${A.name} ${g[0]}–${g[1]} ${B.name}.`;
  events.push({ min: last.min, text: ft, side: null, score: [...g], pens: pens || undefined, wp: winner === "a" ? 1 : winner === "b" ? 0 : 0.5, ft: true });
  return {
    score: g, pens, winner, events, pre: winProb(0, 0, xa, xb, split), xg: [xa, xb], shots, onT, poss: [Math.round(possA), 100 - Math.round(possA)],
    rating, mvp, scorers, tactics: [ta, tb], et: phase === "et",
  };
}
