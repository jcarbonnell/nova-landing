// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
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