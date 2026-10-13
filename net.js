"use strict";
// Networking. The host's browser runs the game; this layer only moves messages.
//  - "server": WebSocket relay (server.js). Used automatically when the page is served by server.js,
//    or when window.FUT_DRAFT_SERVER points at one. Room codes are 4 letters.
//  - "p2p": WebRTC via PeerJS's free public broker, for static hosting with no server. Room codes are 5 characters.
const Net = (() => {
  const PREFIX = "futdraft-v1-";
  const P2P_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const genCode = n => Array.from({ length: n }, () => P2P_CHARS[Math.floor(Math.random() * P2P_CHARS.length)]).join("");

  function emitter() {
    const h = {};
    return { on(e, f) { (h[e] = h[e] || []).push(f); }, emit(e, ...a) { (h[e] || []).forEach(f => f(...a)); } };
  }

  function relayUrl() {
    if (window.FUT_DRAFT_SERVER) return window.FUT_DRAFT_SERVER;
    if (!/^https?:$/.test(location.protocol)) return null;
    return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
  }
  function openSocket(url, timeout = 3000) {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { return reject(e); }
      const t = setTimeout(() => { ws.close(); reject(new Error("timeout")); }, timeout);
      ws.onopen = () => { clearTimeout(t); resolve(ws); };
      ws.onerror = () => { clearTimeout(t); reject(new Error("Could not reach the game server")); };
    });
  }

  function relay(ws, create, code) {
    return new Promise((resolve, reject) => {
      const ev = emitter();
      let ok = false, closed = false;
      const out = m => ws.readyState === 1 && ws.send(JSON.stringify(m));
      const api = { ...ev, kind: "server", isHost: create, id: create ? "host" : null, code: null,
        send(to, data) { out({ type: "send", to, data }); },
        toHost(data) { out({ type: "send", to: "host", data }); },
        close() { closed = true; ws.close(); } };
      ws.onmessage = e => {
        let m;
        try { m = JSON.parse(e.data); } catch (x) { return; }
        if (m.type === "created") { ok = true; api.code = m.code; resolve(api); }
        else if (m.type === "joined") { ok = true; api.id = m.id; api.code = m.code; resolve(api); }
        else if (m.type === "error" && !ok) { reject(new Error(m.message)); ws.close(); }
        else if (m.type === "peer-join") ev.emit("join", m.id);
        else if (m.type === "peer-leave") ev.emit("leave", m.id);
        else if (m.type === "msg") ev.emit("message", m.from, m.data);
        else if (m.type === "host-left" && !closed) { closed = true; ev.emit("close", "The host left the game"); }
      };
      ws.onclose = () => {
        if (!ok) reject(new Error("Connection closed"));
        else if (!closed) { closed = true; ev.emit("close", "Lost connection to the game server"); }
      };
      out(create ? { type: "create" } : { type: "join", code });
    });
  }

  function loadPeer() {
    if (window.Peer) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load the peer-to-peer library"));
      document.head.appendChild(s);
    });
  }

  function p2pHostTry(code) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(PREFIX + code), ev = emitter(), conns = new Map(), seen = new Map();
      let open = false, hb;
      const drop = id => {
        const c = conns.get(id);
        if (!c) return;
        conns.delete(id); seen.delete(id);
        try { c.close(); } catch (e) { /* already closed */ }
        ev.emit("leave", id);
      };
      const api = { ...ev, kind: "p2p", isHost: true, id: "host", code,
        send(to, d) { const c = conns.get(to); if (c && c.open) c.send(d); },
        close() { clearInterval(hb); peer.destroy(); } };
      peer.on("open", () => {
        open = true;
        resolve(api);
        // Heartbeat: WebRTC close events are unreliable, so drop peers that go quiet.
        hb = setInterval(() => {
          const now = Date.now();
          conns.forEach((c, id) => { if (now - (seen.get(id) || now) > 15000) drop(id); else if (c.open) c.send({ __hb: 1 }); });
        }, 4000);
      });
      peer.on("error", err => { if (!open) { peer.destroy(); reject(err); } });
      peer.on("disconnected", () => { if (!peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (e) { /* ignore */ } }, 1000); });
      peer.on("connection", conn => {
        conn.on("open", () => { conns.set(conn.peer, conn); seen.set(conn.peer, Date.now()); ev.emit("join", conn.peer); });
        conn.on("data", d => { seen.set(conn.peer, Date.now()); if (!(d && d.__hb)) ev.emit("message", conn.peer, d); });
        conn.on("close", () => drop(conn.peer));
        conn.on("error", () => drop(conn.peer));
      });
    });
  }
  async function p2pHost() {
    await loadPeer();
    let last;
    for (let i = 0; i < 4; i++) {
      try { return await p2pHostTry(genCode(5)); }
      catch (e) { last = e; if (e.type !== "unavailable-id") break; }
    }
    throw new Error("Could not open a room" + (last && last.type ? ` (${last.type})` : ""));
  }
  async function p2pJoin(code) {
    await loadPeer();
    return new Promise((resolve, reject) => {
      const peer = new Peer(), ev = emitter();
      let conn, ok = false, closed = false, hb, last = Date.now();
      const fail = msg => { if (ok) return; clearTimeout(to); peer.destroy(); reject(new Error(msg)); };
      const shut = reason => { if (closed) return; closed = true; clearInterval(hb); peer.destroy(); ev.emit("close", reason); };
      const to = setTimeout(() => fail("Could not reach that room"), 15000);
      const api = { ...ev, kind: "p2p", isHost: false, id: null, code,
        toHost(d) { if (conn && conn.open) conn.send(d); },
        close() { closed = true; clearInterval(hb); peer.destroy(); } };
      peer.on("open", id => {
        api.id = id;
        conn = peer.connect(PREFIX + code, { reliable: true });
        conn.on("open", () => {
          ok = true; clearTimeout(to); last = Date.now(); resolve(api);
          hb = setInterval(() => { if (Date.now() - last > 15000) shut("Lost connection to the host"); else conn.send({ __hb: 1 }); }, 4000);
        });
        conn.on("data", d => { last = Date.now(); if (!(d && d.__hb)) ev.emit("message", "host", d); });
        conn.on("close", () => (ok ? shut("The host left the game") : fail("Room not found")));
      });
      peer.on("error", err => fail(err.type === "peer-unavailable" ? "Room not found. Check the code." : `Connection failed (${err.type})`));
    });
  }

  async function create() {
    const url = relayUrl();
    if (url) {
      let ws = null;
      try { ws = await openSocket(url); } catch (e) { /* no server here: fall back to p2p */ }
      if (ws) return relay(ws, true);
    }
    return p2pHost();
  }
  async function join(raw) {
    const code = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length === 4) {
      const url = relayUrl();
      if (!url) throw new Error("That room is on a game server this page can't reach");
      return relay(await openSocket(url), false, code);
    }
    if (code.length === 5) return p2pJoin(code);
    throw new Error("Room codes are 4 or 5 characters");
  }
  return { create, join };
})();
