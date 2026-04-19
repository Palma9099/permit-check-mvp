import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1a1a1a',
        'ink-soft': '#3a3a3a',
        'ink-muted': '#6a6a6a',
        card: '#ffffff',
        page: '#f7f6f2',
        flag: {
          strong: '#b71c1c',
          medium: '#b45309',
          weak: '#4b5563',
          ok: '#065f46',
        },
      },
      fontFamily: {
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)',
      },
    },
  },
  plugins: [],
};
export default config;
