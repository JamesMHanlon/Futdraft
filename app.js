"use strict";
// ---------- Helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const pct = x => Math.round(x * 100) + "%";
const cleanName = s => String(s || "").replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 22) || "My XI";
const DIFF_LABEL = { easy: "Sunday League", normal: "Championship", hard: "Champions League" };
const ROUND_NAME = n => ({ 2: "Final", 4: "Semi-final", 8: "Quarter-final", 16: "Round of 16" }[n] || `Round of ${n}`);
const hue = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const initials = n => n.split(/[\s-]+/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();
const tier = o => (o >= 88 ? "elite" : o >= 84 ? "gold" : "silver");
const POS_NAME = { GK: "goalkeeper", CB: "centre-back", LB: "left-back", RB: "right-back", CDM: "defensive midfielder", CM: "central midfielder",
  CAM: "attacking midfielder", LM: "left midfielder", RM: "right midfielder", LW: "left winger", RW: "right winger", ST: "striker" };
const slotPos = (f, id) => slotsOf(f).find(s => s.id === id).pos;
const openSlots = T => slotsOf(T.formation).filter(s => !T.lineup[s.id]).sort((a, b) => b.y - a.y);
const withProf = T => ({ ...T, prof: teamProfile(T) });

const App = {
  view: "home", mode: null,
  name: store.get("fd_name", ""),
  settings: { diff: store.get("fd_diff", "normal"), size: store.get("fd_size", 8) },
  joinCode: new URLSearchParams(location.search).get("room") || "",
  draft: null, team: null, tour: null, plan: null, watch: null, picking: false,
  net: null, lobby: null, G: null, V: null, seen: 0, myTactic: null,
};
const isDuel = () => App.mode === "host" || App.mode === "guest";

const VIEWS = { home: vHome, formation: vFormation, draft: vDraft, plan: vPlan, bracket: vBracket, match: vMatch, end: vEnd, lobby: vLobby, duel: vDuel };
let feedTimer = null;
function render() {
  document.body.dataset.view = App.view;
  $("#app").innerHTML = VIEWS[App.view]();
  if (App.view === "match") startFeed();
}
function go(v) { stopFeed(); App.view = v; render(); window.scrollTo(0, 0); }
function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.classList.add("out"), 3200);
  setTimeout(() => el.remove(), 3700);
}
function seg(key, opts) {
  return `<div class="seg">${opts.map(([v, l]) => `<button class="${App.settings[key] === v ? "on" : ""}" onclick="setSetting('${key}', ${JSON.stringify(v).replace(/"/g, "'")})">${l}</button>`).join("")}</div>`;
}
function setSetting(k, v) { App.settings[k] = v; store.set("fd_" + k, v); render(); }
function setName(v) { App.name = v; store.set("fd_name", v); }

// ---------- Background: drifting rows of player tiles ----------
function initBg() {
  const ids = shuffle(ALL_IDS.filter(id => PL[id].ovr >= 84));
  const row = (list, r) => `<div class="bg-row r${r}">${[...list, ...list].map(id => {
    const p = PL[id];
    return `<div class="bg-card ${tier(p.ovr)}"><b>${p.ovr}</b>${avatar(p)}<span>${esc(p.name)}</span><em>${p.pos[0]} · ${esc(p.club)}</em></div>`;
  }).join("")}</div>`;
  const n = Math.ceil(ids.length / 3);
  $("#bg").innerHTML = [0, 1, 2].map(r => row(ids.slice(r * n, r * n + n), r)).join("");
}

// ---------- Player visuals ----------
function avatar(p, cls = "") { return `<span class="av ${cls}" style="--h:${hue(p.club)}">${esc(initials(p.name))}</span>`; }
function statBar(l, v) { return `<div class="st"><span>${l}</span><i><b style="width:${v}%"></b></i><em>${v}</em></div>`; }
function playerCard(id, i, T, cur) {
  const pos = slotPos(T.formation, cur), p = PL[id], fit = fitIn(p, pos);
  const stats = p.gk ? statBar("OVR", p.ovr) : ["pac", "sho", "pas", "dri", "def", "phy"].map(k => statBar(k.toUpperCase(), p[k])).join("");
  const links = linkInfo(id, T, cur);
  return `<button class="pcard ${tier(p.ovr)}" style="--d:${i * 80}ms" onclick="pickPlayer(${i})">
    <span class="key">${i + 1}</span>
    <div class="pc-top"><div class="pc-ovr"><b>${p.ovr}</b><span>${p.pos[0]}</span></div>${avatar(p, "big")}</div>
    <h3>${esc(p.name)}</h3>
    <div class="pc-meta"><span class="chip">${esc(p.nat)}</span><span class="chip">${esc(p.club)}</span></div>
    <div class="pc-pos">${p.pos.map(q => `<span class="${q === pos ? "match" : ""}">${q}</span>`).join("")}
      ${fit < 1 ? `<span class="warn">Out of position · ${Math.round(fit * 100)}%</span>` : ""}</div>
    ${links ? `<div class="pc-links">${links}</div>` : ""}
    <div class="stats">${stats}</div>
  </button>`;
}
// Which neighbours this player would link with in the current slot.
function linkInfo(id, T, cur) {
  const p = PL[id], out = [];
  for (const [a, b] of FORMATIONS[T.formation].links) {
    if (a !== cur && b !== cur) continue;
    const q = PL[T.lineup[a === cur ? b : a]];
    if (!q) continue;
    if (q.club === p.club) out.push(`<span class="lk club">⚭ ${esc(q.name)} · club</span>`);
    else if (q.nat === p.nat) out.push(`<span class="lk nat">⚭ ${esc(q.name)} · nation</span>`);
  }
  return out.join("");
}

// ---------- Home ----------
function vHome() {
  return `<section class="home">
    <div class="hero">
      <div class="kicker"><span></span>Draft · Tactics · Glory<span></span></div>
      <h1 class="logo">FUT<em>DRAFT</em></h1>
      <p class="tagline">Pick one of four players for every spot on the pitch. Build chemistry, outthink the other manager, and lift the cup.</p>
      <label class="field name-field"><span>Manager / team name</span><input maxlength="22" placeholder="My XI" value="${esc(App.name)}" oninput="setName(this.value)"></label>
    </div>
    <div class="modes">
      <div class="mode featured">
        <div class="feat-art">${miniPitchArt()}</div>
        <div class="feat-body">
          <span class="badge">Solo</span>
          <h3>The Cup</h3>
          <p>Draft your XI, then fight through a knockout bracket of bot teams. Draws go to extra time and penalties.</p>
          <div class="feat-set">${seg("diff", [["easy", "Sunday League"], ["normal", "Championship"], ["hard", "Champions League"]])}${seg("size", [[4, "4 teams"], [8, "8 teams"], [16, "16 teams"]])}</div>
          <button class="btn primary big" onclick="startSolo()">Start the cup ▸</button>
        </div>
      </div>
      <div class="mode-stack">
        <button class="mode" onclick="hostOnline()">
          <span class="mode-ic">${ICON.host}</span>
          <div><h3>Host an online duel</h3><p>Get a room code and send it to a friend. Take turns drafting from the same pool, then play best of three.</p></div>
        </button>
        <div class="mode join-mode ${App.joinCode ? "invited" : ""}">
          <span class="mode-ic">${ICON.join}</span>
          <div class="grow"><h3>${App.joinCode ? "You've been invited" : "Join a duel"}</h3><p>Enter the room code your friend sent you.</p>
            <div class="join-row"><input id="code" maxlength="5" placeholder="CODE" value="${esc(App.joinCode)}" onkeydown="if(event.key==='Enter')joinOnline()"><button class="btn primary" onclick="joinOnline()">Join</button></div></div>
        </div>
      </div>
    </div>
    <div class="steps">
      <div class="step"><b>I</b><h4>Draft</h4><p>Choose a formation, then fill all 11 spots from four options each. Click any empty spot to draft it next.</p></div>
      <div class="step"><b>II</b><h4>Chemistry</h4><p>Neighbours from the same club or nation link up. Out-of-position players play worse.</p></div>
      <div class="step"><b>III</b><h4>Tactics</h4><p>Each tactic beats two others. Read the scouting report and counter your opponent.</p></div>
    </div>
    <footer>Fut Draft is a fan project. Player ratings are illustrative.</footer>
  </section>`;
}
const ICON = {
  host: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7"/></svg>`,
  join: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 17l5-5-5-5M15 12H3M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/></svg>`,
};
function miniPitchArt() {
  return `<div class="art-pitch">${slotsOf("4-3-3").map(s => `<i style="left:${s.x}%;top:${s.y}%"></i>`).join("")}<span class="ap-c"></span><span class="ap-h"></span></div>`;
}

// ---------- Formation ----------
function miniPitch(f) { return `<div class="mini">${slotsOf(f).map(s => `<i style="left:${s.x}%;top:${s.y}%"></i>`).join("")}</div>`; }
function formationPicker(onclick, chosen) {
  return `<div class="forms">${Object.keys(FORMATIONS).map(f => `<button class="form-card ${chosen === f ? "on" : ""}" onclick="${onclick}('${f}')">${miniPitch(f)}<b>${f}</b></button>`).join("")}</div>`;
}
function startSolo() { leaveNet(); App.mode = "solo"; go("formation"); }
function vFormation() {
  return `<section class="page">
    <div class="page-head"><div class="kicker">Step one</div><h2>Pick a formation</h2><p class="muted">It decides which positions you draft and who links with whom.</p></div>
    ${formationPicker("startDraft")}
    <div class="btn-row"><button class="btn ghost" onclick="go('home')">← Back</button></div>
  </section>`;
}
function startDraft(f) {
  App.draft = { formation: f, lineup: {}, opts: {}, cur: null, rerolls: 2 };
  soloNextSlot();
  go("draft");
}
function soloNextSlot() {
  const d = App.draft, open = openSlots(d);
  d.cur = open.length ? open[0].id : null;
  if (d.cur && !d.opts[d.cur]) d.opts[d.cur] = slotOptions(slotPos(d.formation, d.cur), Object.values(d.lineup));
}

// ---------- Draft (shared) ----------
function pitchHtml(T, opts = {}) {
  const chem = chemistry(T.formation, T.lineup), slots = slotsOf(T.formation);
  const lines = FORMATIONS[T.formation].links.map(([a, b]) => {
    const A = slots.find(s => s.id === a), B = slots.find(s => s.id === b);
    const pa = PL[T.lineup[a]], pb = PL[T.lineup[b]];
    const cls = pa && pb ? (pa.club === pb.club ? "club" : pa.nat === pb.nat ? "nat" : "none") : "empty";
    return `<line class="${cls}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>`;
  }).join("");
  return `<div class="pitch ${opts.small ? "small" : ""}">
    <div class="pm"><i class="half"></i><i class="circle"></i><i class="box b1"></i><i class="box b2"></i></div>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>
    ${slots.map(s => {
      const p = PL[T.lineup[s.id]], r = opts.ratings ? opts.ratings[s.id] : null;
      if (!p) return `<button class="slot empty ${opts.cur === s.id ? "cur" : ""}" style="left:${s.x}%;top:${s.y}%" ${opts.click ? `onclick="selectSlot('${s.id}')"` : "tabindex='-1'"}><span>${s.pos}</span></button>`;
      const fit = fitIn(p, s.pos);
      return `<div class="slot filled ${tier(p.ovr)} ${opts.fresh === s.id ? "fresh" : ""}" style="left:${s.x}%;top:${s.y}%" title="${esc(p.name)} · ${esc(p.club)} · ${p.nat}">
        ${avatar(p)}<span class="sl-ovr">${p.ovr}</span>
        <span class="sl-name">${esc(p.name)}</span>
        <span class="sl-sub">${r != null ? `<em class="rt ${r >= 7.5 ? "hi" : r < 6 ? "lo" : ""}">${r.toFixed(1)}</em>` : `${s.pos}${fit < 1 ? " ⚠" : ""} <span class="chem">${"◆".repeat(chem.per[s.id])}${"◇".repeat(3 - chem.per[s.id])}</span>`}</span>
      </div>`;
    }).join("")}
  </div>`;
}
function teamMeters(T) {
  const ids = Object.values(T.lineup), chem = chemistry(T.formation, T.lineup);
  const avg = ids.length ? Math.round(ids.reduce((a, id) => a + PL[id].ovr, 0) / ids.length) : "–";
  return `<div class="meters"><div class="meter"><span>Rating</span><b>${avg}</b></div><div class="meter"><span>Chemistry</span><b>${chem.total}<small>/33</small></b></div></div>`;
}
function draftSide(T, cur, opts, rerolls, canAct) {
  if (!cur) return `<div class="draft-side"><h3>Squad complete</h3></div>`;
  return `<div class="draft-side">
    <div class="row-between"><h3>Choose your ${POS_NAME[slotPos(T.formation, cur)]}</h3>
      <button class="btn tiny" ${rerolls && canAct ? "" : "disabled"} onclick="reroll()">↻ Reroll (${rerolls})</button></div>
    <div class="pcards">${(opts || []).map((id, i) => playerCard(id, i, T, cur)).join("")}</div>
  </div>`;
}
function vDraft() {
  const d = App.draft, filled = Object.keys(d.lineup).length;
  return `<section class="page draft">
    <div class="draft-top">
      <div><div class="kicker">${d.formation} · Champion select</div><h2>Pick ${Math.min(filled + 1, 11)} <span class="muted">of 11</span></h2></div>
      ${teamMeters(d)}
    </div>
    <div class="draft-grid">
      <div>${pitchHtml(d, { cur: d.cur, click: true })}<p class="muted small center">Click any empty spot to draft it next.</p></div>
      ${draftSide(d, d.cur, d.opts[d.cur], d.rerolls, true)}
    </div>
  </section>`;
}
function selectSlot(id) {
  if (isDuel()) return act({ t: "slot", id });
  const d = App.draft;
  if (d.lineup[id]) return;
  d.cur = id;
  if (!d.opts[id]) d.opts[id] = slotOptions(slotPos(d.formation, id), Object.values(d.lineup));
  render();
}
function pickPlayer(i) {
  if (App.picking) return;
  App.picking = true;
  document.querySelectorAll(".pcard").forEach((el, j) => el.classList.add(j === i ? "chosen" : "faded"));
  setTimeout(() => {
    App.picking = false;
    if (isDuel()) return act({ t: "pick", i });
    const d = App.draft;
    if (!d.cur) return;
    d.lineup[d.cur] = d.opts[d.cur][i];
    delete d.opts[d.cur];
    pruneOpts(d.opts, Object.values(d.lineup));
    soloNextSlot();
    if (!d.cur) return finishDraft();
    render();
  }, 380);
}
// Drop already-taken players from cached option sets; refill sets that get too small.
function pruneOpts(cache, taken) {
  for (const k in cache) if (cache[k].some(id => taken.includes(id))) delete cache[k];
}
function reroll() {
  if (isDuel()) return act({ t: "reroll" });
  const d = App.draft;
  if (!d.rerolls || !d.cur) return;
  d.rerolls--;
  d.opts[d.cur] = slotOptions(slotPos(d.formation, d.cur), Object.values(d.lineup), d.opts[d.cur]);
  render();
}
document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT" || !["1", "2", "3", "4"].includes(e.key)) return;
  if (document.querySelector(".pcard") && !App.picking) pickPlayer(+e.key - 1);
});

// ---------- Solo cup ----------
function finishDraft() {
  const d = App.draft;
  App.team = withProf({ name: cleanName(App.name), formation: d.formation, lineup: { ...d.lineup }, me: true });
  const names = shuffle(BOT_NAMES), teams = [App.team];
  for (let i = 1; i < App.settings.size; i++) teams.push(botTeam(names[i - 1], App.settings.diff));
  App.tour = { rounds: [pairUp(shuffle(teams))], r: 0, done: false, out: false, champion: null };
  go("bracket");
}
function pairUp(list) {
  const out = [];
  for (let i = 0; i < list.length; i += 2) out.push({ a: list[i], b: list[i + 1], res: null });
  return out;
}
const myMatch = () => App.tour.rounds[App.tour.r].find(m => m.a.me || m.b.me);
const teamLine = T => `Rating ${Math.round(T.prof.ovr)} · Grade ${grade(T.prof.ovr)} · Chem ${T.prof.chem.total}/33`;
function vBracket() {
  const t = App.tour, size = App.settings.size, total = Math.log2(size);
  const cols = [];
  for (let r = 0; r < total; r++) {
    const ms = t.rounds[r] || Array.from({ length: size / 2 ** (r + 1) }, () => null);
    cols.push(`<div class="bcol"><div class="kicker">${ROUND_NAME(size / 2 ** r)}</div>${ms.map(m => bMatch(m, r)).join("")}</div>`);
  }
  const m = !t.done && !t.out ? myMatch() : null, opp = m ? (m.a.me ? m.b : m.a) : null;
  return `<section class="page">
    <div class="page-head row-between"><div><div class="kicker">${DIFF_LABEL[App.settings.diff]} Cup</div><h2>${t.done ? "Tournament over" : ROUND_NAME(size / 2 ** t.r)}</h2></div>
      <div class="btn-row">${m ? `<button class="btn primary big" onclick="openPlan()">Next: vs ${esc(opp.name)} ▸</button>` : `<button class="btn primary big" onclick="go('end')">See result ▸</button>`}</div></div>
    <div class="bracket">${cols.join("")}</div>
    <div class="squad-row">
      <div class="panel"><div class="panel-h">Your XI · ${App.team.formation} · ${teamLine(App.team)}</div>${pitchHtml(App.team, { small: true })}</div>
      ${opp ? `<div class="panel"><div class="panel-h">Next: ${esc(opp.name)} · ${opp.formation} · ${teamLine(opp)}</div>${pitchHtml(opp, { small: true })}</div>` : ""}
    </div>
  </section>`;
}
function bMatch(m, r) {
  if (!m) return `<div class="bm tbd"><div>TBD</div><div>TBD</div></div>`;
  const row = (T, s) => {
    const won = m.res && m.res.winner === s, lost = m.res && m.res.winner !== s, k = s === "a" ? 0 : 1;
    const sc = m.res ? m.res.score[k] + (m.res.pens ? ` <small>(${m.res.pens[k]})</small>` : "") : "";
    return `<div class="${T.me ? "me" : ""} ${won ? "won" : ""} ${lost ? "lost" : ""}"><span>${esc(T.name)}</span><b>${sc}</b></div>`;
  };
  const i = App.tour.rounds[r].indexOf(m);
  return `<div class="bm ${m.res ? "played" : ""}" ${m.res ? `onclick="watchSolo(${r}, ${i})" title="Watch replay"` : ""}>${row(m.a, "a")}${row(m.b, "b")}</div>`;
}
function openPlan() {
  const m = myMatch(), opp = m.a.me ? m.b : m.a;
  App.plan = { tactic: bestTactic(App.team.prof), opp, oppTactic: botTactic(opp, App.team, App.settings.diff) };
  go("plan");
}
function tacticCards(myProf, chosen, oppProf, onclick, locked) {
  const lean = oppProf ? bestTactic(oppProf) : null;
  return `<div class="tactics">${TACTIC_ORDER.map(t => {
    const T = TACTICS[t], fit = myProf.tacFit[t], loses = TACTIC_ORDER.filter(x => TACTICS[x].beats.includes(t));
    return `<button class="tac ${chosen === t ? "on" : ""}" ${locked ? "disabled" : ""} onclick="${onclick}('${t}')">
      ${t === lean ? `<span class="badge red">Their style</span>` : ""}
      <h3>${T.name}</h3><p>${T.desc}</p>
      <div class="fit"><span>Squad fit</span><i><b style="width:${clamp((fit - 0.6) / 0.3, 0, 1) * 100}%"></b></i><em>${pct(fit)}</em></div>
      <div class="small"><span class="good">Beats ${T.beats.map(x => TACTICS[x].name).join(", ")}</span><br><span class="bad">Weak to ${loses.map(x => TACTICS[x].name).join(", ")}</span></div>
    </button>`;
  }).join("")}</div>`;
}
function setSoloTactic(t) { App.plan.tactic = t; render(); }
function vPlan() {
  const P = App.plan, lean = bestTactic(P.opp.prof);
  return `<section class="page">
    <div class="page-head"><div class="kicker">Team talk</div><h2>Choose your tactics</h2>
      <p class="muted">Each tactic beats two others and loses to two. A tactic works better when your players have the stat it needs.</p></div>
    <div class="scout panel"><b>Scouting report:</b> ${esc(P.opp.name)} (${P.opp.formation}, rating ${Math.round(P.opp.prof.ovr)}) look built for
      <b>${TACTICS[lean].name}</b>. Their manager might have something else planned.</div>
    ${tacticCards(App.team.prof, P.tactic, P.opp.prof, "setSoloTactic")}
    <div class="btn-row center"><button class="btn ghost" onclick="go('bracket')">← Bracket</button><button class="btn primary big" onclick="kickOff()">Kick off ▸</button></div>
  </section>`;
}
function kickOff() {
  const t = App.tour, P = App.plan, round = t.rounds[t.r], diff = App.settings.diff;
  for (const m of round) {
    if (m.a.me || m.b.me) m.res = simulate(m.a, m.b, m.a.me ? P.tactic : P.oppTactic, m.b.me ? P.tactic : P.oppTactic);
    else m.res = simulate(m.a, m.b, botTactic(m.a, m.b, diff), botTactic(m.b, m.a, diff));
  }
  const m = myMatch(), final = App.settings.size / 2 ** t.r === 2;
  App.watch = { match: m, label: ROUND_NAME(App.settings.size / 2 ** t.r), live: true,
    banner: won => (won ? (final ? "Champions!" : "Through!") : "Knocked out"), after: advance,
    back: () => go(App.tour.done || App.tour.out ? "end" : "bracket") };
  go("match");
}
function watchSolo(r, i) {
  App.watch = { match: App.tour.rounds[r][i], label: ROUND_NAME(App.settings.size / 2 ** r) + " · Replay", live: false, back: () => go("bracket") };
  go("match");
}
function advance() {
  const t = App.tour, winners = t.rounds[t.r].map(m => (m.res.winner === "a" ? m.a : m.b));
  if (!t.out && !winners.includes(App.team)) { t.out = true; t.lostAt = t.r; }
  if (winners.length === 1) { t.done = true; t.champion = winners[0]; return; }
  t.rounds.push(pairUp(winners));
  t.r++;
  if (t.out) {
    for (const m of t.rounds[t.r]) m.res = simulate(m.a, m.b, botTactic(m.a, m.b, App.settings.diff), botTactic(m.b, m.a, App.settings.diff));
    advance();
  }
}
function vEnd() {
  const t = App.tour, won = t.champion === App.team;
  return `<section class="page end center">
    ${won ? `<div class="trophy">🏆</div>` : ""}
    <div class="kicker">${DIFF_LABEL[App.settings.diff]} Cup</div>
    <h2 class="big">${won ? `${esc(App.team.name)} win the cup` : `Out in the ${ROUND_NAME(App.settings.size / 2 ** (t.lostAt || 0))}`}</h2>
    <p class="muted">${won ? "Unbeaten. Legends." : `${esc(t.champion.name)} went on to lift the trophy.`}</p>
    <div class="btn-row center"><button class="btn primary big" onclick="go('formation')">Draft again</button><button class="btn" onclick="go('bracket')">View bracket</button><button class="btn ghost" onclick="go('home')">Home</button></div>
    <div class="panel end-pitch">${pitchHtml(App.team, { small: true })}</div>
  </section>`;
}

// ---------- Match (shared) ----------
function vMatch() {
  const w = App.watch, m = w.match, res = m.res;
  return `<section class="page match">
    <div class="kicker center">${esc(w.label)}</div>
    <div class="scoreboard">
      <div class="sb-team a ${m.a.me ? "me" : ""}"><span class="sb-side">Home${m.a.me ? " · You" : ""}</span><h3>${esc(m.a.name)}</h3><span class="tchip">${TACTICS[res.tactics[0]].name}</span></div>
      <div class="sb-mid"><div class="sb-score"><span id="ga">0</span><i>:</i><span id="gb">0</span></div><div class="sb-pens" id="pens"></div><div class="sb-clock" id="clk">0'</div></div>
      <div class="sb-team b ${m.b.me ? "me" : ""}"><span class="sb-side">${m.b.me ? "You · " : ""}Away</span><h3>${esc(m.b.name)}</h3><span class="tchip">${TACTICS[res.tactics[1]].name}</span></div>
    </div>
    <div class="wp"><div class="wp-bar"><i id="wpbar" style="width:${res.pre * 100}%"></i></div>
      <div class="wp-l"><span id="wpa">${pct(res.pre)}</span><span class="muted">Win probability</span><span id="wpb">${pct(1 - res.pre)}</span></div></div>
    <div class="match-grid">
      <div class="panel" id="pa">${pitchHtml(m.a, { small: true })}</div>
      <div class="panel feed-wrap"><div class="panel-h row-between"><span>Live commentary</span><button class="btn tiny" id="skip" onclick="skipFeed()">Skip ▸▸</button></div>
        <div class="feed" id="feed"><div class="feed-empty">The teams are walking out…</div></div></div>
      <div class="panel" id="pb">${pitchHtml(m.b, { small: true })}</div>
    </div>
    <div id="after"></div>
    <div class="match-actions"><button class="btn primary big" id="cont" disabled onclick="App.watch.back()">Continue</button></div>
    <div id="banner"></div>
  </section>`;
}
function startFeed() {
  App.feed = { m: App.watch.match, i: 0 };
  feedTimer = setInterval(feedStep, 900);
  setTimeout(feedStep, 300);
}
function stopFeed() { clearInterval(feedTimer); feedTimer = null; }
function feedStep() {
  if (!feedTimer) return;
  const ev = App.feed.m.res.events;
  if (App.feed.i >= ev.length) return finishFeed();
  showEvent(ev[App.feed.i++]);
}
function showEvent(e) {
  const feed = $("#feed");
  if (!feed) return;
  const empty = feed.querySelector(".feed-empty");
  if (empty) empty.remove();
  const cls = [e.side ? "s-" + e.side : "", e.goal ? "goal" : "", e.card ? "card" : "", e.ht || e.ft ? "ht" : "", e.pen ? "pen" : ""].join(" ");
  feed.insertAdjacentHTML("beforeend", `<div class="fe ${cls}"><span class="fe-t">${e.pen ? "PEN" : e.min + "'"}</span><p>${e.goal ? "⚽ " : e.card ? "🟨 " : ""}${e.text}</p></div>`);
  feed.scrollTop = feed.scrollHeight;
  $("#ga").textContent = e.score[0];
  $("#gb").textContent = e.score[1];
  $("#clk").textContent = e.ft ? "FT" : e.pen ? "Pens" : e.min + "'";
  if (e.pens) $("#pens").textContent = `(${e.pens[0]}–${e.pens[1]} pens)`;
  $("#wpbar").style.width = e.wp * 100 + "%";
  $("#wpa").textContent = pct(e.wp);
  $("#wpb").textContent = pct(1 - e.wp);
  if (e.goal) { const el = $(e.side === "a" ? "#ga" : "#gb"); el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop"); }
}
function skipFeed() {
  if (!feedTimer) return;
  const ev = App.feed.m.res.events;
  while (App.feed.i < ev.length) showEvent(ev[App.feed.i++]);
  finishFeed();
}
function finishFeed() {
  stopFeed();
  const w = App.watch, m = w.match, res = m.res;
  const cont = $("#cont"), skip = $("#skip");
  if (cont) cont.disabled = false;
  if (skip) skip.remove();
  $("#pa").innerHTML = pitchHtml(m.a, { small: true, ratings: res.rating[0] });
  $("#pb").innerHTML = pitchHtml(m.b, { small: true, ratings: res.rating[1] });
  const mvpT = res.mvp.side ? m.b : m.a, mvp = PL[mvpT.lineup[res.mvp.slot]];
  const row = (l, a, b, fmt = x => x) => `<div class="srow"><b>${fmt(a)}</b><span>${l}</span><b>${fmt(b)}</b></div>`;
  const goals = s => res.scorers[s].map(g => `${esc(PL[(s ? m.b : m.a).lineup[g.slot]].name)} ${g.min}'`).join(", ") || "–";
  $("#after").innerHTML = `<div class="panel stats-panel">
    <div class="panel-h">Match stats</div>
    ${row("Possession", res.poss[0], res.poss[1], x => x + "%")}${row("Shots", res.shots[0], res.shots[1])}${row("On target", res.onT[0], res.onT[1])}
    ${row("Expected goals", res.xg[0], res.xg[1], x => x.toFixed(2))}
    <div class="srow scorers"><small>${goals(0)}</small><span>Goals</span><small>${goals(1)}</small></div>
    <div class="mvp">${avatar(mvp)}<div><span class="kicker">Player of the match</span><br><b>${esc(mvp.name)}</b> <span class="muted">${esc(mvpT.name)} · ${res.mvp.r.toFixed(1)}</span></div></div>
  </div>`;
  if (!w.live) return;
  w.live = false;
  const mine = m.a.me ? "a" : m.b.me ? "b" : null;
  if (w.after) w.after();
  if (!mine || !w.banner) return;
  const won = res.winner === mine;
  setTimeout(() => {
    const b = $("#banner");
    if (!b) return;
    b.innerHTML = `<div class="banner ${won ? "victory" : "defeat"}" onclick="this.remove()"><div class="banner-in">
      <h2>${w.banner(won)}</h2><div class="line"></div>
      <p>${res.score[0]} – ${res.score[1]}${res.pens ? ` (${res.pens[0]}–${res.pens[1]} pens)` : res.et ? " aet" : ""}</p><small>Click anywhere to continue</small></div></div>`;
    setTimeout(() => { const el = b.querySelector(".banner"); if (el) el.classList.add("out"); }, 2800);
    setTimeout(() => { const el = b.querySelector(".banner"); if (el) el.remove(); }, 3300);
  }, 300);
}

// ================= Online duel =================
// The host's browser runs the game (App.G) and sends each player their own view of it.
// Both drafts share one pool: no player can be on both teams. Picks snake 1-2-2-2…, then best of three.
const PICK_ORDER = Array.from({ length: 22 }, (_, i) => (Math.floor((i + 1) / 2) % 2 ? 1 : 0));

function leaveNet() {
  if (App.net) { try { App.net.close(); } catch { /* already closed */ } }
  App.net = null; App.lobby = null; App.G = null; App.V = null; App.seen = 0; App.mode = null;
}
function leave() { leaveNet(); go("home"); }

async function hostOnline() {
  leaveNet();
  App.mode = "host";
  App.lobby = { code: null, guest: null, busy: true };
  go("lobby");
  try {
    const net = await Net.create();
    if (App.mode !== "host") return net.close();
    App.net = net;
    App.lobby = { code: net.code, guest: null };
    net.on("join", id => { if (App.lobby && !App.lobby.guest) App.lobby.pending = id; });
    net.on("message", hostHandle);
    net.on("leave", hostLeave);
    if (App.view === "lobby") render();
  } catch (e) { toast(e.message || "Could not open a room"); leave(); }
}
async function joinOnline() {
  const code = ($("#code") || {}).value || App.joinCode;
  if (!code) return toast("Enter a room code first");
  leaveNet();
  App.mode = "guest";
  App.lobby = { code: code.toUpperCase(), busy: true };
  go("lobby");
  try {
    const net = await Net.join(code);
    if (App.mode !== "guest") return net.close();
    App.net = net;
    net.on("message", (from, m) => guestHandle(m));
    net.on("close", reason => { toast(reason); leave(); });
    net.toHost({ t: "hello", name: cleanName(App.name) });
    App.lobby = { code: net.code, busy: false, host: null };
    if (App.view === "lobby") render();
  } catch (e) { toast(e.message || "Could not join"); leave(); }
}
function hostHandle(from, m) {
  if (!m || typeof m !== "object") return;
  const L = App.lobby;
  if (m.t === "hello") {
    if (L.guest && L.guest.id !== from) return App.net.send(from, { t: "full" });
    L.guest = { id: from, name: cleanName(m.name) };
    syncLobby();
    toast(`${L.guest.name} joined`);
    return;
  }
  if (L.guest && from === L.guest.id) duelAct(1, m);
}
function hostLeave(id) {
  const L = App.lobby;
  if (!L || !L.guest || L.guest.id !== id) return;
  toast(`${L.guest.name} left the game`);
  L.guest = null;
  App.G = null; App.V = null; App.seen = 0;
  go("lobby");
}
function syncLobby() {
  const L = App.lobby;
  if (L.guest) App.net.send(L.guest.id, { t: "lobby", host: cleanName(App.name) });
  if (App.view === "lobby") render();
}
function guestHandle(m) {
  if (!m || typeof m !== "object") return;
  if (m.t === "full") { toast("That room is already full"); return leave(); }
  if (m.t === "lobby") { App.lobby.host = m.host; App.V = null; App.seen = 0; if (App.view !== "lobby") go("lobby"); else render(); return; }
  if (m.t === "state") onState(m.v);
}
function inviteLink() {
  const u = new URL(location.href);
  u.search = "?room=" + App.lobby.code;
  u.hash = "";
  return u.toString();
}
function copyInvite() {
  const link = inviteLink();
  (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast("Invite link copied"), () => prompt("Copy this link:", link));
}
function vLobby() {
  const L = App.lobby || {}, host = App.mode === "host";
  const me = cleanName(App.name);
  const players = host ? [me + " (you)", L.guest ? L.guest.name : null] : [L.host, me + " (you)"];
  return `<section class="page">
    <div class="page-head center"><div class="kicker">Online duel · Best of three</div><h2>${host ? "Your room" : "Joining room"}</h2></div>
    <div class="panel lobby-card">
      ${L.code ? `<div class="code-row"><span class="muted small">Room code</span><div class="code-big">${esc(L.code)}</div>${host ? `<button class="btn" onclick="copyInvite()">Copy invite link</button>` : ""}</div>`
        : `<p class="waiting"><span class="spinner"></span>${host ? "Opening a room…" : "Connecting…"}</p>`}
      <div class="lobby-players">${players.map((n, i) => `<div class="lp ${n ? "" : "empty"}"><span class="lp-side">${i ? "Away" : "Home · Host"}</span><b>${n ? esc(n) : "Waiting for a friend…"}</b></div>`).join(`<span class="vs">VS</span>`)}</div>
      <p class="note">Take turns drafting from the same pool of players. Home picks first, then picks go 2-2-2. Then each game you both choose tactics in secret. First to two wins.</p>
      <div class="btn-row center">
        <button class="btn ghost" onclick="leave()">Leave</button>
        ${host ? `<button class="btn primary big" ${L.guest ? "" : "disabled"} onclick="duelStart()">Start draft ▸</button>` : `<p class="waiting"><span class="spinner"></span>Waiting for the host to start</p>`}
      </div>
    </div>
  </section>`;
}

// ----- Host: game state -----
function duelStart() {
  const L = App.lobby;
  if (!L || !L.guest) return;
  App.G = {
    phase: "formation", names: [cleanName(App.name), L.guest.name],
    teams: [0, 1].map(() => ({ formation: null, lineup: {} })),
    turn: 0, cur: [null, null], cache: [{}, {}], rerolls: [2, 2], tactics: [null, null], games: [], wins: [0, 0], winner: null, last: null,
  };
  App.seen = 0;
  publish();
}
const taken = G => G.teams.flatMap(t => Object.values(t.lineup));
function prepTurn() {
  const G = App.G;
  if (G.turn >= 22) { G.phase = "tactics"; return; }
  const p = PICK_ORDER[G.turn], T = G.teams[p];
  if (!G.cur[p] || T.lineup[G.cur[p]]) G.cur[p] = openSlots(T)[0].id;
  ensureCache(p);
}
function ensureCache(p) {
  const G = App.G, T = G.teams[p], id = G.cur[p];
  if (!G.cache[p][id]) G.cache[p][id] = slotOptions(slotPos(T.formation, id), taken(G));
}
function duelAct(p, m) {
  const G = App.G;
  if (!G || !m) return;
  const myTurn = G.phase === "draft" && PICK_ORDER[G.turn] === p;
  if (m.t === "formation" && G.phase === "formation" && !G.teams[p].formation && m.f in FORMATIONS) {
    G.teams[p].formation = m.f;
    if (G.teams.every(t => t.formation)) { G.phase = "draft"; prepTurn(); }
  } else if (m.t === "slot" && myTurn && typeof m.id === "string") {
    const T = G.teams[p];
    if (!slotsOf(T.formation).some(s => s.id === m.id) || T.lineup[m.id]) return;
    G.cur[p] = m.id;
    ensureCache(p);
  } else if (m.t === "pick" && myTurn && Number.isInteger(m.i)) {
    const T = G.teams[p], slot = G.cur[p], opts = G.cache[p][slot];
    if (!opts || !opts[m.i]) return;
    T.lineup[slot] = opts[m.i];
    G.last = { p, slot };
    delete G.cache[p][slot];
    const tk = taken(G);
    pruneOpts(G.cache[0], tk); pruneOpts(G.cache[1], tk);
    G.turn++;
    prepTurn();
  } else if (m.t === "reroll" && myTurn && G.rerolls[p] > 0) {
    const T = G.teams[p], slot = G.cur[p];
    G.rerolls[p]--;
    G.cache[p][slot] = slotOptions(slotPos(T.formation, slot), taken(G), G.cache[p][slot]);
  } else if (m.t === "tactic" && G.phase === "tactics" && !G.tactics[p] && TACTIC_ORDER.includes(m.tac)) {
    G.tactics[p] = m.tac;
    if (G.tactics[0] && G.tactics[1]) playDuelGame();
  } else if (m.t === "rematch" && p === 0 && G.phase === "over") {
    return duelStart();
  } else return;
  publish();
}
function playDuelGame() {
  const G = App.G;
  const [A, B] = G.teams.map((t, i) => withProf({ ...t, name: G.names[i] }));
  const res = simulate(A, B, G.tactics[0], G.tactics[1]);
  G.games.push(res);
  G.wins[res.winner === "a" ? 0 : 1]++;
  G.tactics = [null, null];
  if (Math.max(...G.wins) >= 2) { G.phase = "over"; G.winner = G.wins[0] >= 2 ? 0 : 1; }
}
function viewFor(p) {
  const G = App.G, hide = G.phase === "formation";
  return {
    phase: G.phase, names: G.names, me: p, turn: G.turn, cur: G.cur, rerolls: G.rerolls, last: G.last,
    teams: G.teams.map((t, i) => (hide && i !== p ? { formation: t.formation ? "?" : null, lineup: {} } : t)),
    opts: G.phase === "draft" && PICK_ORDER[G.turn] === p ? G.cache[p][G.cur[p]] : null,
    locked: G.tactics.map(Boolean), myTactic: G.tactics[p], games: G.games, wins: G.wins, winner: G.winner,
  };
}
function publish() {
  const L = App.lobby;
  if (L && L.guest) App.net.send(L.guest.id, { t: "state", v: viewFor(1) });
  onState(JSON.parse(JSON.stringify(viewFor(0))));
}
function act(m) {
  if (App.mode === "host") duelAct(0, m);
  else if (App.net) App.net.toHost(m);
}

// ----- Both: rendering the duel -----
function onState(V) {
  App.V = V;
  if (V.games.length < App.seen) App.seen = V.games.length;
  if (V.games.length > App.seen) {
    const g = App.seen++;
    App.watch = { match: duelMatch(V, g), label: `Game ${g + 1} · Best of three`, live: true,
      banner: won => (V.winner != null && g === V.games.length - 1 ? (won ? "Series won!" : "Series lost") : won ? "Victory" : "Defeat"),
      back: () => go("duel") };
    return go("match");
  }
  if (App.view === "match") return;
  if (App.view !== "duel") return go("duel");
  render();
}
function duelMatch(V, g) {
  const team = i => ({ ...V.teams[i], name: V.names[i], me: V.me === i });
  return { a: team(0), b: team(1), res: V.games[g] };
}
function watchDuel(g) { App.watch = { match: duelMatch(App.V, g), label: `Game ${g + 1} · Replay`, live: false, back: () => go("duel") }; go("match"); }

function duelHead(V, title, sub) {
  return `<div class="duel-head">
    <div class="dh-p ${V.me === 0 ? "me" : ""}"><span>Home</span><b>${esc(V.names[0])}</b></div>
    <div class="dh-mid"><div class="kicker">${sub}</div><h2>${title}</h2>${V.games.length ? `<div class="series">${V.wins[0]} – ${V.wins[1]}</div>` : ""}</div>
    <div class="dh-p b ${V.me === 1 ? "me" : ""}"><span>Away</span><b>${esc(V.names[1])}</b></div>
  </div>`;
}
function vDuel() {
  const V = App.V;
  if (!V) return `<section class="page"><p class="waiting"><span class="spinner"></span>Loading…</p></section>`;
  const me = V.me, opp = 1 - me, mine = V.teams[me], theirs = V.teams[opp];
  const leaveBtn = `<div class="btn-row center"><button class="btn ghost" onclick="leave()">Leave duel</button></div>`;

  if (V.phase === "formation") {
    return `<section class="page">${duelHead(V, "Pick a formation", "Online duel")}
      ${mine.formation ? `<p class="waiting center-w"><span class="spinner"></span>Locked in ${mine.formation}. ${theirs.formation ? "Starting…" : `Waiting for ${esc(V.names[opp])}…`}</p>`
        : `<p class="muted center">Your opponent can't see your choice until you both lock in.</p>${formationPicker("duelFormation")}`}
      ${leaveBtn}</section>`;
  }
  if (V.phase === "draft") {
    const turnP = PICK_ORDER[V.turn], myTurn = turnP === me;
    const fresh = V.last;
    return `<section class="page draft">${duelHead(V, myTurn ? "Your pick" : `${esc(V.names[opp])} is picking`, `Pick ${V.turn + 1} of 22`)}
      <div class="turn-strip">${PICK_ORDER.map((p, i) => `<i class="${p === me ? "m" : "o"} ${i < V.turn ? "done" : i === V.turn ? "now" : ""}"></i>`).join("")}</div>
      <div class="duel-draft">
        <div><div class="row-between"><span class="panel-h">Your XI · ${mine.formation}</span>${teamMeters(mine)}</div>
          ${pitchHtml(mine, { cur: myTurn ? V.cur[me] : null, click: myTurn, fresh: fresh && fresh.p === me ? fresh.slot : null })}</div>
        <div class="dd-mid">${myTurn ? draftSide(mine, V.cur[me], V.opts, V.rerolls[me], true)
          : `<div class="their-turn"><span class="spinner big"></span><h3>${esc(V.names[opp])} is choosing their ${POS_NAME[slotPos(theirs.formation, V.cur[opp])]}</h3><p class="muted">Players they pick can't be offered to you.</p></div>`}</div>
        <div><div class="row-between"><span class="panel-h">${esc(V.names[opp])} · ${theirs.formation}</span>${teamMeters(theirs)}</div>
          ${pitchHtml(theirs, { cur: !myTurn ? V.cur[opp] : null, fresh: fresh && fresh.p === opp ? fresh.slot : null })}</div>
      </div>
      ${leaveBtn}</section>`;
  }
  const [A, B] = [0, 1].map(i => withProf(V.teams[i]));
  const myProf = (me ? B : A).prof, oppProf = (me ? A : B).prof;
  const history = V.games.length ? `<div class="games">${V.games.map((r, i) => `<button class="gm" onclick="watchDuel(${i})"><span>Game ${i + 1}</span>
      <b class="${(r.winner === "a" ? 0 : 1) === me ? "good" : "bad"}">${r.score[0]} – ${r.score[1]}${r.pens ? ` (${r.pens[0]}–${r.pens[1]} p)` : ""}</b><em>${TACTICS[r.tactics[0]].name} vs ${TACTICS[r.tactics[1]].name}</em><i>Replay ▸</i></button>`).join("")}</div>` : "";
  if (V.phase === "over") {
    const won = V.winner === me;
    return `<section class="page center">${duelHead(V, won ? "You win the series" : `${esc(V.names[opp])} wins the series`, "Full time")}
      ${won ? `<div class="trophy">🏆</div>` : ""}${history}
      <div class="squad-row">${[0, 1].map(i => `<div class="panel"><div class="panel-h">${esc(V.names[i])} · ${V.teams[i].formation}</div>${pitchHtml(V.teams[i], { small: true })}</div>`).join("")}</div>
      <div class="btn-row center">${me === 0 ? `<button class="btn primary big" onclick="act({t:'rematch'})">Rematch ▸</button>` : `<p class="waiting"><span class="spinner"></span>Waiting for the host to start a rematch</p>`}
        <button class="btn ghost" onclick="leave()">Leave</button></div></section>`;
  }
  // Tactics phase
  const choice = V.myTactic || App.myTactic;
  return `<section class="page">${duelHead(V, `Game ${V.games.length + 1}`, "Team talk · Best of three")}
    ${history}
    <div class="scout panel"><b>Scouting report:</b> ${esc(V.names[opp])} (${theirs.formation}, rating ${Math.round(oppProf.ovr)}, chem ${oppProf.chem.total}/33) look built for
      <b>${TACTICS[bestTactic(oppProf)].name}</b>. Your squad: rating ${Math.round(myProf.ovr)}, chem ${myProf.chem.total}/33.</div>
    ${tacticCards(myProf, choice, oppProf, "duelTactic", !!V.myTactic)}
    <div class="btn-row center">${V.myTactic ? `<p class="waiting"><span class="spinner"></span>Locked in ${TACTICS[V.myTactic].name}. ${V.locked[opp] ? "Kicking off…" : `Waiting for ${esc(V.names[opp])}…`}</p>`
      : `<button class="btn primary big" ${choice ? "" : "disabled"} onclick="lockTactic()">Lock in ▸</button><span class="muted small">${V.locked[opp] ? `${esc(V.names[opp])} has locked in.` : ""}</span>`}</div>
    <div class="squad-row">${[0, 1].map(i => `<div class="panel"><div class="panel-h">${esc(V.names[i])} · ${V.teams[i].formation}</div>${pitchHtml(V.teams[i], { small: true })}</div>`).join("")}</div>
    ${leaveBtn}</section>`;
}
function duelFormation(f) { act({ t: "formation", f }); }
function duelTactic(t) { App.myTactic = t; render(); }
function lockTactic() { if (App.myTactic) { act({ t: "tactic", tac: App.myTactic }); App.myTactic = null; } }

initBg();
render();
