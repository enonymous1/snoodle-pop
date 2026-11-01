# 🫧 Snoodle Pop

A Snood-style bubble shooter that runs entirely in the browser — no build step, no dependencies, no downloads.

Aim from the bottom, shoot a blob up into the hex board, match **3 or more** of the same colour to pop them, and drop any clusters left floating. Clear the whole board to advance. Every 6 shots a new row pushes down — don't let the board cross the red danger line.

## Play it

- **Locally:** open `index.html` in any browser, or serve the folder: `python3 -m http.server 8000` then visit http://localhost:8000
- **On GitHub Pages:** push this repo to GitHub, then Settings → Pages → **Deploy from a branch** → `main` / `/ (root)`. Your game will be at `https://<your-username>.github.io/snoodle-pop/`
  - The included `.github/workflows/pages.yml` also deploys via GitHub Actions on push to `main`. If you use that route, set Pages → Source to **GitHub Actions** instead.

## Controls

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Aim | Move mouse / drag finger | ← → |
| Shoot | Click / lift finger | Space / ↑ |
| Swap current ↔ next | ⇄ Swap button | S |
| Pause | ⏸ Pause button | P |
| Restart | ↻ Restart button | R |
| Sound | 🔊 button | M |

The dotted line previews the shot, including bounces off the side walls.

## How it works

- `index.html` — page shell, HUD, help text
- `style.css` — layout, responsive board
- `game.js` — the whole game: hex grid, match-3 search, floating-cluster drops, row pushes, levels, particles, WebAudio blips, local best score (`localStorage`)
- `.github/workflows/pages.yml` — static Pages deploy, no build

Levels scale up: level 1 starts with 5 rows and 4 colours; each level adds a row (up to 8) and a colour (up to 6). The bubble you shoot is always drawn from colours still on the board, so you never get stuck with an impossible colour.

## A note on Snood

This is a fan-style tribute inspired by the classic bubble shooter *Snood* (1996). It is **not** Snood, is not affiliated with or endorsed by its creators, and uses no Snood art, audio, names, or assets — every blob face, colour, sound, and line of code here is original. The name "Snoodle Pop" is a playful nod, not a claim to the Snood trademark.

## License

MIT — see `LICENSE`. Fork it, reskin the blobs, add levels, make it yours.
