/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          DEFAULT: '#0f172a',
          light: '#475569',
          muted: '#64748b',
        },
        paper: {
          DEFAULT: '#f8fafc',
          warm: '#eef2ff',
          dark: '#e2e8f0',
        },
        primary: {
          DEFAULT: '#2563eb',
          light: '#93c5fd',
          dark: '#1d4ed8',
        },
        accent: {
          DEFAULT: '#f97316',
          light: '#fed7aa',
          dark: '#c2410b',
        },
        success: {
          DEFAULT: '#22c55e',
          light: '#dcfce7',
          dark: '#166534',
        },
        warning: {
          DEFAULT: '#f59e0b',
          light: '#fef3c7',
          dark: '#b45309',
        },
        error: {
          DEFAULT: '#ef4444',
          light: '#fecaca',
          dark: '#b91c1c',
        },
        info: {
          DEFAULT: '#0ea5e9',
          light: '#bae6fd',
          dark: '#0369a1',
        },
        highlight: {
          DEFAULT: '#8b5cf6',
          light: '#ddd6fe',
          dark: '#6d28d9',
        },
      },
    },
  },
  plugins: [],
}
