// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Dashboard-scoped theme tokens
      colors: {
        'nova-bg': 'var(--nova-bg)',
        'nova-surface': 'var(--nova-surface)',
        'nova-surface-2': 'var(--nova-surface-2)',
        'nova-border': 'var(--nova-border)',
        'nova-text': 'var(--nova-text)',
        'nova-text-dim': 'var(--nova-text-dim)',
        'nova-purple': 'var(--nova-accent-purple)',
        'nova-orange': 'var(--nova-accent-orange)',
      },
      fontFamily: {
        // `font-mono` → IBM Plex Mono (via the --font-mono token). Titles keep
        // `font-museo`, labels/prose keep `font-space` (both already defined as
        // utilities in globals.css).
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
  safelist: [
    'transition-opacity',
    'duration-300',
    'opacity-0',
    'opacity-100',
    'pointer-events-none',
    'animate-spin',
    'blur',
    'grayscale',
  ],
};