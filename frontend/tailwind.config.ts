import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sora)", "Sora", "Trebuchet MS", "sans-serif"],
        mono: ["var(--font-plex-mono)", "IBM Plex Mono", "ui-monospace", "monospace"],
      },
      colors: {
        // Brand aliases. Kept under the old names so every existing page picks up
        // the shell palette without a rewrite.
        ink: "#143a31",
        navy: "#143a31",
        teal: "#164a41",
        mist: "#e7f1e0",
        sage: "#5c7a66",
        moss: "#4d774e",

        // Shell greens, lightest to deepest.
        shell: {
          50: "#f7fcf4",
          100: "#eff7ea",
          200: "#e7f1e0",
          300: "#d4e4c9",
          400: "#cde6bf",
          500: "#9dc88d",
          600: "#6f8c74",
          700: "#4d774e",
          800: "#2f6242",
          900: "#164a41",
          950: "#143a31",
        },

        // Gold accent from the shell mark.
        gold: {
          DEFAULT: "#f1b24a",
          soft: "#fbefd8",
          text: "#c08a22",
          deep: "#97620c",
          ink: "#0a382f",
        },

        // The neutral ramp is tinted green so grey UI never reads as cold blue.
        slate: {
          50: "#f7fbf4",
          100: "#edf3e7",
          200: "#e1ebd9",
          300: "#cbdcc1",
          400: "#9cb3a2",
          500: "#7c9683",
          600: "#5c7a66",
          700: "#456354",
          800: "#2f4c40",
          900: "#1e3830",
          950: "#102a23",
        },

        // Success chips stay in the shell family.
        emerald: {
          50: "#e4efdd",
          100: "#d7e9ce",
          200: "#c3ddb6",
          300: "#9dc88d",
          400: "#7fb56d",
          500: "#4d774e",
          600: "#3d6b47",
          700: "#2f6242",
          800: "#245239",
          900: "#1b4230",
          950: "#0f2a20",
        },

        // Warning chips match the gold accent.
        amber: {
          50: "#fdf6e9",
          100: "#fbefd8",
          200: "#f7dfaf",
          300: "#f1b24a",
          400: "#e0a032",
          500: "#d0921f",
          600: "#c08a22",
          700: "#a87413",
          800: "#97620c",
          900: "#7d5109",
        },
      },
      boxShadow: {
        soft: "0 24px 80px rgba(22, 74, 65, 0.13)",
        lift: "0 16px 44px rgba(22, 74, 65, 0.09)",
      },
    },
  },
  plugins: [],
} satisfies Config;
