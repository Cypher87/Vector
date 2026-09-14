export type VectorIconName =
  | 'back'
  | 'center'
  | 'chevronDown'
  | 'chevronLeft'
  | 'chevronRight'
  | 'check'
  | 'close'
  | 'desktop'
  | 'edit'
  | 'favorite'
  | 'follow'
  | 'history'
  | 'labels'
  | 'layers'
  | 'list'
  | 'mobile'
  | 'pause'
  | 'play'
  | 'range'
  | 'rings'
  | 'receiver'
  | 'search'
  | 'settings'
  | 'sync'
  | 'tablet'
  | 'trace'
  | 'trash'
  | 'unlink'
  | 'zoomIn'
  | 'zoomOut';

const iconPaths: Record<VectorIconName, readonly string[]> = {
  back: ['M19 12H5', 'm11 5-7 7 7 7'],
  center: [
    'M12 3v3M12 18v3M3 12h3M18 12h3',
    'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
    'M12 12h.01',
  ],
  chevronDown: ['m6 9 6 6 6-6'],
  chevronLeft: ['m14 6-6 6 6 6'],
  chevronRight: ['m10 6 6 6-6 6'],
  check: ['m5 12 4 4L19 6'],
  close: ['M6 6l12 12M18 6 6 18'],
  desktop: ['M4 5h16v11H4V5Z', 'M8 20h8M12 16v4'],
  edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z'],
  favorite: ['m12 3.5 2.62 5.3 5.85.85-4.24 4.13 1 5.83L12 17l-5.23 2.75 1-5.83-4.24-4.13 5.85-.85L12 3.5Z'],
  follow: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M12 12h.01'],
  history: ['M3 3v5h5', 'M3.6 8A9 9 0 1 1 3 12', 'M12 7v5l3 2'],
  labels: ['M5 6.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z', 'M8 11h8M8 14h5'],
  layers: ['m12 3-9 5 9 5 9-5-9-5Z', 'm3 12 9 5 9-5', 'm3 16 9 5 9-5'],
  list: ['M9 6h11M9 12h11M9 18h11', 'M4 6h.01M4 12h.01M4 18h.01'],
  mobile: ['M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z', 'M11 18h2'],
  pause: ['M9 5v14M15 5v14'],
  play: ['M8 5v14l11-7Z'],
  range: ['M12 3 19 7l2 8-6 6-8-2-4-7 3-7 6-2Z', 'M12 12h.01'],
  rings: ['M12 12h.01', 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z', 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z'],
  receiver: [
    'M12 12v9M9 21h6',
    'M9.2 9.2a4 4 0 0 0 0 5.6M14.8 9.2a4 4 0 0 1 0 5.6',
    'M6.4 6.4a8 8 0 0 0 0 11.2M17.6 6.4a8 8 0 0 1 0 11.2',
    'M12 12h.01',
  ],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.35-4.35'],
  settings: [
    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 0 0 2.572-1.065Z',
    'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  ],
  sync: ['M20 7h-5V2', 'M4 17h5v5', 'M19.1 12a7 7 0 0 0-11.9-5L5 10', 'M4.9 12a7 7 0 0 0 11.9 5L19 14'],
  tablet: ['M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M11 17h2'],
  trace: ['M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', 'M18 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z', 'M7.8 14.6c1.1-3.4 4-5.3 8.4-5.2'],
  trash: ['M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14', 'M10 11v6M14 11v6'],
  unlink: ['m9.5 14.5-2 2a3 3 0 0 1-4.2-4.2l3-3a3 3 0 0 1 4.2 0', 'm14.5 9.5 2-2a3 3 0 0 1 4.2 4.2l-3 3a3 3 0 0 1-4.2 0', 'm8 16 8-8', 'M4 4l16 16'],
  zoomIn: ['M12 5v14M5 12h14'],
  zoomOut: ['M5 12h14'],
};

const svgNamespace = 'http://www.w3.org/2000/svg';

export function VectorIcon({ className = '', name }: { className?: string; name: VectorIconName }) {
  return (
    <svg
      aria-hidden="true"
      className={`vector-icon ${className}`.trim()}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {iconPaths[name].map((path) => <path d={path} key={path} />)}
    </svg>
  );
}

export function createVectorIconElement(name: VectorIconName, className = '') {
  const icon = document.createElementNS(svgNamespace, 'svg');
  icon.classList.add('vector-icon');
  for (const token of className.split(/\s+/).filter(Boolean)) icon.classList.add(token);
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('focusable', 'false');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('stroke-width', '1.8');
  icon.setAttribute('viewBox', '0 0 24 24');

  for (const pathData of iconPaths[name]) {
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('d', pathData);
    icon.appendChild(path);
  }
  return icon;
}
