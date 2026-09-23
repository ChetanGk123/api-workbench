// Runtime DOM is built with createElement/textContent only: no HTML parsing, no Trusted Types
// policy and no interpolation of imported data into markup.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

type Shape = readonly [string, Record<string, string>];
const p = (d: string): Shape => ['path', { d }];
const circle = (cx: string, cy: string, r: string): Shape => ['circle', { cx, cy, r }];
const rect = (x: string, y: string, width: string, height: string): Shape => ['rect', { x, y, width, height, rx: '2' }];

// Icon geometry copied from the reference screens so the bundle needs no icon font or sprite file.
export const ICONS = {
  bolt: [p('M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z')],
  home: [p('M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8'), p('M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z')],
  flask: [p('M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2'), p('M8.5 2h7'), p('M7 16h10')],
  server: [rect('2', '2', '20', '8'), rect('2', '14', '20', '8'), p('M6 6h.01'), p('M6 18h.01')],
  shuffle: [p('m18 14 4 4-4 4'), p('m18 2 4 4-4 4'), p('M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-7.6a4 4 0 0 1 3.3-1.7H22'), p('M2 6h1.972a4 4 0 0 1 3.6 2.2'), p('M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45')],
  route: [circle('6', '19', '3'), p('M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15'), circle('18', '5', '3')],
  flame: [p('M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z')],
  gear: [p('M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z'), circle('12', '12', '3')],
  download: [p('M12 15V3'), p('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), p('m7 10 5 5 5-5')],
  book: [p('M12 7v14'), p('M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z')],
  minus: [p('M5 12h14')],
  close: [p('M18 6 6 18'), p('m6 6 12 12')],
  expand: [p('M8 3H5a2 2 0 0 0-2 2v3'), p('M21 8V5a2 2 0 0 0-2-2h-3'), p('M3 16v3a2 2 0 0 0 2 2h3'), p('M16 21h3a2 2 0 0 0 2-2v-3')],
  selector: [p('m7 15 5 5 5-5'), p('m7 9 5-5 5 5')],
  right: [p('m9 18 6-6-6-6')],
  play: [p('M6 3 20 12 6 21Z')],
  history: [p('M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'), p('M3 3v5h5'), p('M12 7v5l4 2')],
  plus: [p('M5 12h14'), p('M12 5v14')],
  back: [p('m15 18-6-6 6-6'), p('M9 12h10')],
  up: [p('m18 15-6-6-6 6')],
  down: [p('m6 9 6 6 6-6')],
  edit: [p('M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z')],
  trash: [p('M3 6h18'), p('M19 6v14c0 1-1 2-2 2H7c-1 0-2-2-2-2V6'), p('M8 6V4c0-1 2-2 2-2h4c1 0 2 1 2 2v2')],
  link: [p('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'), p('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71')],
  list: [p('m3 17 2 2 4-4'), p('m3 7 2 2 4-4'), p('M13 6h8'), p('M13 12h8'), p('M13 18h8')],
  globe: [circle('12', '12', '10'), p('M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20'), p('M2 12h20')],
} satisfies Record<string, readonly Shape[]>;
export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 'aw-i14'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `aw-i ${size}`.trim());
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attributes] of ICONS[name]) {
    const shape = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  return svg;
}

export function button(className: string, label: string, onClick: () => void, signal: AbortSignal): HTMLButtonElement {
  const element = el('button', className, label);
  element.type = 'button';
  element.addEventListener('click', onClick, { signal });
  return element;
}

export function iconButton(className: string, name: IconName, label: string, onClick: () => void, signal: AbortSignal): HTMLButtonElement {
  const element = button(className, '', onClick, signal);
  element.setAttribute('aria-label', label);
  element.title = label;
  element.append(icon(name));
  return element;
}
