/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          dark: '#1a1a2e',
          medium: '#16213e', 
          light: '#0f3460',
        },
        accent: '#4da8ff',
        text: {
          primary: '#eee',
          secondary: '#aaa',
          muted: '#888'
        }
      }
    },
  },
  plugins: [],
}