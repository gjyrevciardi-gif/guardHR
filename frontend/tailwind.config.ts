import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

type Palette = Record<string, string | Record<string, string>>;

/**
 * One source of truth for both themes. Every colour is an "R G B" triple exposed as a CSS variable, so a
 * theme switch is a single attribute on <html> and Tailwind's opacity modifiers (bg-white/90) keep working.
 * Light values are the original brand palette; dark values were picked so text/background pairs keep the
 * contrast ratios checked in docs/accessibility.md.
 */
const light: Palette = {
  white: "255 255 255", // card surface
  canvas: "243 247 239", // page background
  ink: "20 58 49",
  navy: "20 58 49",
  teal: "22 74 65", // primary action
  mist: "231 241 224",
  sage: "92 122 102",
  muted: "86 112 96",
  moss: "77 119 78",
  line: { DEFAULT: "212 228 201", strong: "186 207 174" },
  shell: { 50: "247 252 244", 100: "239 247 234", 200: "231 241 224", 300: "212 228 201", 400: "205 230 191", 500: "157 200 141", 600: "111 140 116", 700: "77 119 78", 800: "47 98 66", 900: "22 74 65", 950: "20 58 49" },
  slate: { 50: "247 251 244", 100: "237 243 231", 200: "225 235 217", 300: "203 220 193", 400: "156 179 162", 500: "124 150 131", 600: "79 106 89", 700: "69 99 84", 800: "47 76 64", 900: "30 56 48", 950: "16 42 35" },
  emerald: { 50: "228 239 221", 100: "215 233 206", 200: "195 221 182", 300: "157 200 141", 400: "127 181 109", 500: "77 119 78", 600: "61 107 71", 700: "47 98 66", 800: "36 82 57", 900: "27 66 48", 950: "15 42 32" },
  amber: { 50: "253 246 233", 100: "251 239 216", 200: "247 223 175", 300: "241 178 74", 400: "224 160 50", 500: "208 146 31", 600: "192 138 34", 700: "168 116 19", 800: "151 98 12", 900: "125 81 9" },
  red: { 50: "254 242 242", 100: "254 226 226", 200: "254 202 202", 300: "252 165 165", 400: "248 113 113", 500: "239 68 68", 600: "220 38 38", 700: "185 28 28", 800: "153 27 27" },
  gold: { DEFAULT: "241 178 74", soft: "251 239 216", text: "151 98 12", deep: "151 98 12", ink: "10 56 47" },
};

const dark: Palette = {
  white: "20 35 31",
  canvas: "12 24 20",
  ink: "230 240 228",
  navy: "230 240 228",
  teal: "157 200 141",
  mist: "12 24 20",
  sage: "143 174 152",
  muted: "155 181 163",
  moss: "142 194 127",
  line: { DEFAULT: "38 62 54", strong: "56 86 75" },
  shell: { 50: "17 30 26", 100: "22 38 33", 200: "30 52 45", 300: "43 71 61", 400: "61 98 84", 500: "157 200 141", 600: "125 156 131", 700: "142 194 127", 800: "180 214 167", 900: "205 230 191", 950: "230 240 228" },
  slate: { 50: "17 30 26", 100: "24 41 36", 200: "38 62 54", 300: "55 84 73", 400: "110 138 121", 500: "133 158 142", 600: "168 190 175", 700: "190 208 195", 800: "212 227 214", 900: "232 241 230", 950: "243 248 242" },
  emerald: { 50: "20 46 36", 100: "24 56 43", 200: "34 74 56", 300: "61 110 84", 400: "127 181 109", 500: "109 170 108", 600: "109 170 108", 700: "143 204 140", 800: "168 220 160", 900: "190 232 184", 950: "15 42 32" },
  amber: { 50: "43 35 17", 100: "52 42 20", 200: "74 58 24", 300: "241 178 74", 400: "224 160 50", 500: "208 146 31", 600: "224 168 70", 700: "236 190 100", 800: "240 205 130", 900: "247 222 175" },
  red: { 50: "52 22 22", 100: "68 28 28", 200: "100 40 40", 300: "153 66 66", 400: "239 68 68", 500: "239 68 68", 600: "248 113 113", 700: "252 165 165", 800: "254 202 202" },
  gold: { DEFAULT: "241 178 74", soft: "52 42 20", text: "230 180 90", deep: "240 200 130", ink: "10 56 47" },
};

const variableName = (family: string, shade?: string) => `--c-${family}${shade && shade !== "DEFAULT" ? `-${shade}` : ""}`;

function toVariables(palette: Palette) {
  const out: Record<string, string> = {};
  for (const [family, value] of Object.entries(palette)) {
    if (typeof value === "string") out[variableName(family)] = value;
    else for (const [shade, triple] of Object.entries(value)) out[variableName(family, shade)] = triple;
  }
  return out;
}

function toColors(palette: Palette) {
  const out: Record<string, string | Record<string, string>> = {};
  for (const [family, value] of Object.entries(palette)) {
    out[family] = typeof value === "string"
      ? `rgb(var(${variableName(family)}) / <alpha-value>)`
      : Object.fromEntries(Object.keys(value).map((shade) => [shade, `rgb(var(${variableName(family, shade)}) / <alpha-value>)`]));
  }
  return out;
}

export default {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sora)", "Sora", "Trebuchet MS", "sans-serif"],
        mono: ["var(--font-plex-mono)", "IBM Plex Mono", "ui-monospace", "monospace"],
      },
      colors: {
        ...toColors(light),
        // The call stage is dark in both themes, like every video product: it never follows the theme.
        stage: { DEFAULT: "#0b1713", raised: "#12231d", rail: "#0f1d18", line: "rgba(255,255,255,0.09)", ink: "#eaf3e7", muted: "#9db8a7", accent: "#9dc88d" },
      },
      boxShadow: {
        soft: "0 24px 80px rgba(22, 74, 65, 0.13)",
        lift: "0 16px 44px rgba(22, 74, 65, 0.09)",
        card: "0 1px 2px rgba(20, 58, 49, 0.05), 0 8px 24px -12px rgba(20, 58, 49, 0.10)",
      },
      keyframes: {
        rise: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
        ping: { "75%, 100%": { transform: "scale(2.2)", opacity: "0" } },
      },
      animation: { rise: "rise .35s ease-out both", ping: "ping 1.6s cubic-bezier(0,0,.2,1) infinite" },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ":root": toVariables(light),
        'html[data-theme="dark"]': { ...toVariables(dark), colorScheme: "dark" },
      });
    }),
  ],
} satisfies Config;
