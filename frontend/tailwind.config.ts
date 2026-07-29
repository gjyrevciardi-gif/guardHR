import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17202f",
        navy: "#173c58",
        teal: "#0d9488",
        mist: "#f4f7f8",
      },
      boxShadow: { soft: "0 18px 50px rgba(23, 60, 88, 0.08)" },
    },
  },
  plugins: [],
} satisfies Config;

