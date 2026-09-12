/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // 小清新薄荷绿主色板
        mint: {
          50: '#f1faf5',
          100: '#ddf3e7',
          200: '#bde7d1',
          300: '#8dd5b1',
          400: '#5abf90',
          500: '#37a678',
          600: '#278a63',
          700: '#216f52',
          800: '#1e5945',
          900: '#1a4a3a',
        },
        cream: '#fbfdfb',
      },
      fontFamily: {
        display: ['"Nunito"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
        sans: ['"Noto Sans SC"', '"Nunito"', 'system-ui', '-apple-system', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        soft: '0 12px 40px -16px rgba(31, 105, 82, 0.18)',
        card: '0 2px 14px -4px rgba(31, 105, 82, 0.08)',
        lift: '0 18px 44px -18px rgba(31, 105, 82, 0.28)',
        'inner-line': 'inset 0 1px 0 rgba(255,255,255,0.6)',
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
        'pop-in': 'pop-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'float-slow': 'float-slow 7s ease-in-out infinite',
        'blink-soft': 'blink-soft 1.6s ease-in-out infinite',
      },
      keyframes: {
        'fade-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'pop-in': {
          '0%': { transform: 'scale(0.94)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(-10px) rotate(3deg)' },
        },
        'blink-soft': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(0.82)' },
        },
      },
    },
  },
  plugins: [],
};
