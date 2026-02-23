/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // shadcn-style token mapping (Tailwind v3)
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
      },

      // Make default `border` and `ring` utilities use the tokens too (optional but common)
      borderColor: { DEFAULT: "hsl(var(--border))" },
      ringColor: { DEFAULT: "hsl(var(--ring))" },
      ringOffsetColor: { DEFAULT: "hsl(var(--background))" },
    },
  },
  plugins: [],
}

