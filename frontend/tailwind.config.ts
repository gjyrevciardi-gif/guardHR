import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#f7fbff",
        navy: "#050a12",
        teal: "#00d7e6",
        mist: "#050a12",
      },
      boxShadow: { soft: "0 24px 80px rgba(0, 215, 230, 0.10)" },
    },
  },
  plugins: [],
} satisfies Config;
