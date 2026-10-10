import base from "@wasfa/config/eslint";

export default [
  ...base,
  {
    rules: {
      // Nest modules are decorated empty/static classes by design.
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
    },
  },
];
