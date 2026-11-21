// SVG renderers for the personal sanctuary and the congregation monument.
// Pure string builders: state in, markup out. Gradient ids are suffixed per
// render because SVG ids are document-global: two SVGs sharing an id would
// both paint with whichever definition came first.
let seq = 0;

const lamp = (x, y, lit, i, glow) => `
  <g class="lamp ${lit ? 'lit' : ''}" style="--d:${i * 0.15}s">
    ${lit ? `<ellipse cx="${x}" cy="${y - 7}" rx="7" ry="10" fill="url(#${glow})"/>` : ''}
    <path d="M${x - 2.5} ${y - 4} q2.5 -8 5 0 z" fill="${lit ? '#FFC94D' : '#6b6b6b'}"/>
    <rect x="${x - 4}" y="${y - 3}" width="8" height="4" rx="2" fill="#B8862B"/>
  </g>`;

function lampstand(cx, base, litCount, glow) {
  // Seven-lamp stand: a central shaft and three pairs of branches (Exodus 25:31-37).
  const xs = [-36, -24, -12, 0, 12, 24, 36];
  const order = [3, 2, 4, 1, 5, 0, 6]; // light from the centre outward
  const lit = new Set(order.slice(0, litCount));
  const arms = [12, 24, 36].map(w =>
    `<path d="M${cx - w} ${base - 46} Q${cx - w} ${base - 18 + w / 3} ${cx} ${base - 16 + w / 3} Q${cx + w} ${base - 18 + w / 3} ${cx + w} ${base - 46}" stroke="#B8862B" stroke-width="3" fill="none"/>`).join('');
  return `<g>
    <rect x="${cx - 2}" y="${base - 48}" width="4" height="48" fill="#B8862B"/>
    ${arms}
    <rect x="${cx - 14}" y="${base - 3}" width="28" height="5" rx="2" fill="#8E6420"/>
    ${xs.map((dx, i) => lamp(cx + dx, base - 46, lit.has(i), i, glow)).join('')}
  </g>`;
}

export function renderSanctuary(s) {
  const id = ++seq, skyId = `sky${id}`, glowId = `glow${id}`;
  const W = 360, H = 240, ground = 196;
  const sky = s.readToday ? ['#7CC4F2', '#E8F6FF'] : s.atRisk ? ['#F29E6B', '#FCE1C4'] : ['#3B4A6B', '#7A8BAE'];
  const parts = [];

  // Stage 0 — cleared ground, a single altar of uncut stones
  parts.push(`<g><rect x="164" y="${ground - 14}" width="32" height="14" rx="3" fill="#9C9285"/>
    <rect x="170" y="${ground - 22}" width="20" height="9" rx="2" fill="#B2A898"/></g>`);

  if (s.stage >= 1) { // Foundation — stone platform
    parts.push(`<g><rect x="70" y="${ground - 16}" width="220" height="16" fill="#A89F91"/>
      ${Array.from({ length: 11 }, (_, i) => `<line x1="${70 + i * 20}" y1="${ground - 16}" x2="${70 + i * 20}" y2="${ground}" stroke="#8C8476"/>`).join('')}
      <line x1="70" y1="${ground - 8}" x2="290" y2="${ground - 8}" stroke="#8C8476"/></g>`);
  }
  if (s.stage >= 2) { // Growth — walls, doorway, garden
    parts.push(`<g><rect x="90" y="${ground - 86}" width="180" height="70" fill="#E9DFC9" stroke="#C9B98F"/>
      <path d="M165 ${ground - 16} v-38 a15 15 0 0 1 30 0 v38 z" fill="#6E4B2A"/>
      ${[40, 52, 308, 320].map(x => `<g><rect x="${x - 2}" y="${ground - 18}" width="4" height="18" fill="#6B4E2E"/>
        <circle cx="${x}" cy="${ground - 24}" r="10" fill="#5FA35A"/></g>`).join('')}
      ${[24, 336].map(x => `<circle cx="${x}" cy="${ground - 4}" r="5" fill="#E46A8C"/>`).join('')}</g>`);
  }
  if (s.stage >= 3) { // Mastery — pillars, roof, lampstand in the doorway's light
    parts.push(`<g>${[96, 128, 232, 264].map(x => `<rect x="${x - 5}" y="${ground - 100}" width="10" height="84" fill="#F5EEDC" stroke="#C9B98F"/>`).join('')}
      <path d="M78 ${ground - 100} L180 ${ground - 150} L282 ${ground - 100} z" fill="#C7A15A" stroke="#9E7C3C"/>
      <rect x="78" y="${ground - 104}" width="204" height="6" fill="#9E7C3C"/></g>`);
  }

  // Stage 0: on the altar stone. Stage 1+: on the platform, in front of the doorway.
  const standBase = s.stage >= 1 ? ground - 14 : ground - 22;
  const showStand = s.stage >= 1 || s.lampsLit > 0;

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Your sanctuary: ${s.tierName} tier, ${s.lampsLit} of 7 lamps lit" class="sanctuary-svg">
    <defs>
      <linearGradient id="${skyId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient>
      <radialGradient id="${glowId}"><stop offset="0" stop-color="#FFE9A8" stop-opacity=".95"/><stop offset="1" stop-color="#FFC94D" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#${skyId})"/>
    ${!s.readToday && !s.atRisk ? Array.from({ length: 14 }, (_, i) => `<circle cx="${(i * 53) % W}" cy="${12 + (i * 29) % 80}" r="1.2" fill="#fff" opacity=".8"/>`).join('') : ''}
    <ellipse cx="180" cy="${ground + 30}" rx="260" ry="44" fill="#7DB36A"/>
    <rect y="${ground}" width="${W}" height="${H - ground}" fill="#7DB36A"/>
    ${parts.join('')}
    ${showStand ? lampstand(180, standBase, s.lampsLit, glowId) : ''}
  </svg>`;
}

export function renderMonument(m) {
  const glowId = `mglow${++seq}`;
  const W = 360, H = 200, g = 170, st = m.stage;
  const p = [];
  p.push(`<rect x="40" y="${g}" width="280" height="8" fill="#A89F91"/>`);
  if (st >= 1) p.push(`<g>${Array.from({ length: 7 }, (_, i) => `<rect x="${60 + i * 36}" y="${g - 12}" width="32" height="12" fill="#BDB3A3" stroke="#8C8476"/>`).join('')}</g>`);
  if (st >= 2) p.push(`<g>${[84, 132, 228, 276].map(x => `<rect x="${x - 7}" y="${g - 96}" width="14" height="84" fill="#F1E8D3" stroke="#C9B98F"/>`).join('')}</g>`);
  if (st >= 3) p.push(`<path d="M60 ${g - 96} L180 ${g - 140} L300 ${g - 96} z" fill="#C7A15A" stroke="#9E7C3C"/>`);
  if (st >= 4) p.push(lampstand(180, g - 14, 7, glowId));
  if (st >= 5) p.push(`<g><circle cx="180" cy="${g - 112}" r="9" fill="#FFE07A"/><text x="180" y="${g - 108}" font-size="11" text-anchor="middle">✦</text></g>`);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Congregation monument: ${m.name}" class="monument-svg">
    <defs><radialGradient id="${glowId}"><stop offset="0" stop-color="#FFE9A8" stop-opacity=".95"/><stop offset="1" stop-color="#FFC94D" stop-opacity="0"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="#EEF4FA"/>${p.join('')}
    <rect x="40" y="${H - 14}" width="280" height="6" rx="3" fill="#D5DEE8"/>
    <rect x="40" y="${H - 14}" width="${Math.max(2, 280 * m.pct)}" height="6" rx="3" fill="#C0530A"/>
  </svg>`;
}
