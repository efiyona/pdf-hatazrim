import type { ReactNode } from 'react'

const S = (c: ReactNode, size = 24) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{c}</svg>
)

export const Icons: Record<string, (s?: number) => ReactNode> = {
  image: (s) => S(<><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-8 9" /></>, s),
  merge: (s) => S(<><path d="M6 4h7l4 4v4" /><path d="M6 4v12a2 2 0 0 0 2 2h3" /><rect x="11" y="13" width="9" height="8" rx="2" /></>, s),
  split: (s) => S(<><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8 7.5 20 17M8 16.5 20 7" /></>, s),
  rotate: (s) => S(<><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>, s),
  compress: (s) => S(<><path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" /></>, s),
  toimg: (s) => S(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="m9 17 2-2.5 1.5 1.5L15 13" /></>, s),
  folder: (s) => S(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />, s),
  up: (s) => S(<path d="m6 15 6-6 6 6" />, s),
  down: (s) => S(<path d="m6 9 6 6 6-6" />, s),
  x: (s) => S(<path d="M6 6l12 12M18 6 6 18" />, s),
  back: (s) => S(<path d="m9 6 6 6-6 6" />, s),
  lock: (s) => S(<><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>, s),
  check: (s) => S(<path d="m5 12 5 5 9-10" />, s),
  info: (s) => S(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>, s),
  warn: (s) => S(<><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17h.01" /></>, s),
  download: (s) => S(<><path d="M12 4v11" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" /></>, s),
  share: (s) => S(<><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" /></>, s),
  ocr: (s) => S(<><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M8 9h8M8 12.5h8M8 16h5" /></>, s),
  scan: (s) => S(<><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M4 12h16" /></>, s),
  camera: (s) => S(<><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.5" /></>, s),
  word: (s) => S(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="m8.5 11 1.5 6 2-5 2 5 1.5-6" /></>, s),
  pdf: (s) => S(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></>, s),
}
export const TOOL_COLORS: Record<string, string> = { image: '#f58220', merge: '#6c5ce7', split: '#e84a6f', rotate: '#12a594', compress: '#2f80ed', toimg: '#e5a000', ocr: '#0e9f8e', scan: '#d6336c', word: '#2b6cd9' }
