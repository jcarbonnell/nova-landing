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
        'nova-bg': 'var(--novadash-bg)',
        'nova-surface': 'var(--novadash-surface)',
        'nova-surface-2': 'var(--novadash-surface-2)',
        'nova-border': 'var(--novadash-border)',
        'nova-text': 'var(--novadash-text)',
        'nova-text-dim': 'var(--novadash-text-dim)',
        'nova-purple': 'var(--novadash-accent-purple)',
        'nova-orange': 'var(--novadash-accent-orange)',
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