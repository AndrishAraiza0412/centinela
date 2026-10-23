// Iconos de trazo único (24×24, stroke 1.75), construidos con createElementNS (sin inyectar HTML).
const NS = 'http://www.w3.org/2000/svg';

// Cada icono es una lista de [elemento, atributos].
const ICONS = {
  logo: [['circle', { cx: 12, cy: 5, r: 2.2 }], ['circle', { cx: 5, cy: 18.5, r: 2.2 }], ['circle', { cx: 19, cy: 18.5, r: 2.2 }],
    ['path', { d: 'M12 7.2v4.3M12 11.5 6.6 16.8M12 11.5l5.4 5.3M7.2 18.5h9.6' }]],
  canvas: [['rect', { x: 3, y: 3, width: 7.5, height: 7.5, rx: 1.5 }], ['rect', { x: 13.5, y: 3, width: 7.5, height: 7.5, rx: 1.5 }],
    ['rect', { x: 3, y: 13.5, width: 7.5, height: 7.5, rx: 1.5 }], ['rect', { x: 13.5, y: 13.5, width: 7.5, height: 7.5, rx: 1.5 }]],
  timeline: [['path', { d: 'M3 6h9M3 12h14M3 18h6' }], ['path', { d: 'M15 6h6M20 12h1M12 18h9' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  minus: [['path', { d: 'M5 12h14' }]],
  fit: [['path', { d: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3' }]],
  stop: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 1.5 }]],
  send: [['path', { d: 'M4 12 20 4l-5 16-3.5-6.5L4 12Z' }], ['path', { d: 'm11.5 13.5 4-4' }]],
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  x: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  loader: [['path', { d: 'M21 12a9 9 0 1 1-6.2-8.55' }]],
  terminal: [['path', { d: 'm5 7 5 5-5 5M12 18h7' }]],
  bot: [['rect', { x: 4, y: 8, width: 16, height: 12, rx: 2 }], ['path', { d: 'M12 8V4.5M9 13v2M15 13v2M2 13.5h2M20 13.5h2' }]],
  branch: [['circle', { cx: 6, cy: 6, r: 2 }], ['circle', { cx: 6, cy: 18, r: 2 }], ['circle', { cx: 18, cy: 8, r: 2 }],
    ['path', { d: 'M6 8v8M18 10c0 4-6 3-11 6.5' }]],
  shield: [['path', { d: 'M12 21s7.5-3.5 7.5-9.5V5.2L12 2.5 4.5 5.2v6.3C4.5 17.5 12 21 12 21Z' }], ['path', { d: 'M12 8v4M12 15.5h.01' }]],
  bell: [['path', { d: 'M6 8a6 6 0 0 1 12 0c0 7 3 8.5 3 8.5H3S6 15 6 8Z' }], ['path', { d: 'M10.3 20a2 2 0 0 0 3.4 0' }]],
  alert: [['path', { d: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z' }], ['path', { d: 'M12 9v4M12 17h.01' }]],
  close: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  folder: [['path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z' }]],
  plug: [['path', { d: 'M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5' }]],
};

export function icon(name, { size = 16, label } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: `icon icon-${name}` })) {
    svg.setAttribute(k, v);
  }
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of ICONS[name] ?? []) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  }
  return svg;
}
