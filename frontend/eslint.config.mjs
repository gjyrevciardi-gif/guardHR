import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "public/mediapipe/wasm/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Regression guard for the accessibility pass: every label names a control, no clickable divs.
    rules: {
      "jsx-a11y/label-has-associated-control": ["error", { assert: "either" }],
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/click-events-have-key-events": "error",
      "jsx-a11y/no-noninteractive-element-interactions": "error",
      "jsx-a11y/no-autofocus": "error",
    },
  },
];

export default config;
