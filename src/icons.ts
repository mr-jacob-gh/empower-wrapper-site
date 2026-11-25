// Small stroke icons (24x24, currentColor).
const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  logo: svg(`<path d="M4 17l5.5-5.5 4 4L20 9"/><path d="M15 9h5v5"/>`),
  dashboard: svg(`<rect x="3.5" y="3.5" width="7" height="9" rx="2"/><rect x="13.5" y="3.5" width="7" height="5" rx="2"/><rect x="13.5" y="11.5" width="7" height="9" rx="2"/><rect x="3.5" y="15.5" width="7" height="5" rx="2"/>`),
  bank: svg(`<path d="M3 9.5L12 4l9 5.5"/><path d="M5 10v8M9.7 10v8M14.3 10v8M19 10v8M3 20h18"/>`),
  card: svg(`<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/>`),
  growth: svg(`<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>`),
  clock: svg(`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`),
  home: svg(`<path d="M4 20V10l8-6 8 6v10z"/><path d="M10 20v-6h4v6"/>`),
  wallet: svg(`<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 9.5h14M16 13.5h2"/>`),
  refresh: svg(`<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>`),
  alert: svg(`<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.1"/>`),
  plug: svg(`<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>`),
};
