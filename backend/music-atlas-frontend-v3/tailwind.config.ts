import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}'
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#0b1021',
        panel: '#11182d',
        accent: '#4fd1c5',
        accentMuted: '#3b9d94',
        textPrimary: '#f8fafc',
        textMuted: '#cbd5e1'
      }
    }
  },
  plugins: []
};

export default config;
