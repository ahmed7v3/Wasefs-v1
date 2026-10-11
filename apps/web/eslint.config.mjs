import next from "@next/eslint-plugin-next";
import react from "@wasfa/config/eslint-react";

export default [
  ...react,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "@next/next": next },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs["core-web-vitals"].rules,
    },
  },
  {
    // Playwright fixtures: `use(...)` is Playwright's callback, not a React hook, and a fixture
    // that needs no other fixture must destructure an empty object (Playwright reads that list).
    files: ["e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "no-empty-pattern": "off",
    },
  },
  {
    ignores: [
      "next-env.d.ts",
      // Extra web builds and reports of the end-to-end suite.
      ".next*/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
];
