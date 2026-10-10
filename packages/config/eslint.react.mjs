// ESLint flat config for React / Next.js packages: the base config plus the hooks rules.
import reactHooks from "eslint-plugin-react-hooks";

import base from "./eslint.config.mjs";

export default [
  ...base,
  {
    files: ["**/*.{ts,tsx,jsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
];
