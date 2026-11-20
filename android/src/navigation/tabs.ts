/** The five bottom-tab destinations (spec section 6). Settings is reached from the header, not a tab. */
export const TABS = [
  { name: 'index', title: 'Home', glyph: '🏠' },
  { name: 'play', title: 'Play', glyph: '▦' },
  { name: 'ai-lab', title: 'AI Lab', glyph: '✨' },
  { name: 'memory', title: 'Memory', glyph: '🧠' },
  { name: 'analytics', title: 'Analytics', glyph: '📊' },
] as const;

export type TabName = (typeof TABS)[number]['name'];
