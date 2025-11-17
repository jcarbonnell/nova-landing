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
  safelist: [  // Fix: Use strings/array (no invalid regex)
    'transition-opacity duration-300',  // Specific example; add yours
    'transition-all duration-300',      // If needed
    'lg:flex', 'md:flex', 'sm:flex',    // Responsive examples
    // Add more exact classes; avoid broad regex to prevent warnings
  ],
};