# Fut Draft

A football drafting game, made in the style of Rift Draft. You pick a formation, then pick one of four players for each of the 11 spots. Choose your tactics, then play.

## Modes

- **The Cup (solo):** draft your XI, then play a 4, 8 or 16-team knockout against bot teams.
- **Online duel (1v1):** one player hosts and sends a room code or invite link, and the other joins.
  - Both players draft from the same pool, so no player can end up on both teams.
  - Picks go Home, Away, Away, Home, Home… (22 picks in total). Only the player picking sees their four options.
  - It's best of three. Before each game, both players lock in a tactic in secret.

## Rules

- **Chemistry:** players next to each other link up if they share a club (green line) or a nation (gold line). Playing someone out of position lowers their rating.
- **Tactics:** Tiki-Taka, Counter-Attack, Gegenpress, Wing Play and Park the Bus. Each one beats two others and loses to two.
- **Matches:** `engine.js` simulates 90 minutes. Drawn games go to extra time and then penalties.

## Hosting (Squarespace or any static host)

The game is six static files: `index.html`, `style.css`, `data.js`, `engine.js`, `net.js` and `app.js`. It doesn't need a server. Online duels connect the two browsers directly, peer to peer, using PeerJS's free public connection broker. A few strict networks (some school or office Wi-Fi) block these direct connections.

Squarespace can't host a set of JavaScript files, so host the files somewhere free and point Squarespace at them:

1. Put this folder in a GitHub repo and turn on GitHub Pages (the same setup as Rift Draft).
2. Pick one:
   - **Subdomain (recommended):** add a file called `CNAME` containing `futdraft.james-mh.com`. In Squarespace, go to Domains → DNS and add a CNAME record from `futdraft` to `<your-github-username>.github.io`.
   - **Embed in a Squarespace page:** add a Code Block containing:
     `<iframe src="https://futdraft.james-mh.com/" style="width:100%;height:900px;border:0" allow="clipboard-write"></iframe>`

Inside an iframe, invite links point at the game's own URL, which still works.
