# Walk Courageously With God — Interactive Study App

A Progressive Web App (PWA) for personal Bible study using the *Walk Courageously With God* publication.

## Features
- 📖 Interactive worksheet — all 21 Section 1 chapters with 8-step study framework
- 📍 Chronological Bible timeline with world-power bands (3300–1070 BCE)
- 🔗 WOL deep links — tap any scripture or Watchtower ref to open on WOL
- 🔊 Scripture audio — NWT audio via JW CDN + Text-to-speech offline fallback
- 💾 Auto-save answers to device storage (localStorage)
- 📤 Export / 📥 Import answers as JSON backup
- 📵 Full offline support via Service Worker (cache-first)
- 📱 Installable on Android & iOS as a home-screen PWA

## Phase 1 Progress
- ✅ Interactive timeline
- ✅ WOL deep links
- ✅ Scripture audio (NWT + TTS fallback)
- ⬜ AI study assistant (Claude-powered)

## Audio Features
- **Floating 🎵 button** — always-visible mini player (bottom-right)
- **Chapter audio bar** — one-tap NWT audio per chapter in the header
- **Ref audio icons** — 🔊 on every scripture citation, tap to play
- **WOL drawer audio** — play button alongside each Bible ref card
- **TTS fallback** — reads key verse aloud when offline or audio unavailable
- **Progress bar, skip ±10s, seek** — full playback controls

## Deployment
Hosted on Netlify, connected to this repo. Every push to `main` auto-deploys.

## Study publication
[wol.jw.org/en/wol/publication/r1/lp-e/wcg](https://wol.jw.org/en/wol/publication/r1/lp-e/wcg)
