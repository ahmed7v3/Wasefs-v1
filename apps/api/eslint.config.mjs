import base from "@wasfa/config/eslint";

// Raw query-builder calls: `db.select(...)`, `handle.db.update(...)`, ...
const RAW_QUERY =
  "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(select|selectDistinct|insert|update|delete|execute|transaction)$/]";

export default [
  ...base,
  {
    rules: {
      // Nest modules are decorated empty/static classes by design.
      "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }],
    },
  },
  {
    // Convention (AGENT section 5.4, Task 1.6): services, controllers and guards never build
    // queries. Data access lives in `*.repo.ts` files; user- or organization-owned tables go through
    // `scopedRepo` (common/scoped-repo.ts) so the ownership filter cannot be forgotten.
    files: [
      "src/**/*.service.ts",
      "src/**/*.controller.ts",
      "src/**/*.guard.ts",
      "src/**/*.interceptor.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `${RAW_QUERY}[callee.object.property.name='db']`,
          message:
            "No raw queries in services: put the query in a *.repo.ts (scopedRepo for user-owned data).",
        },
        {
          selector: `${RAW_QUERY}[callee.object.name='db']`,
          message:
            "No raw queries in services: put the query in a *.repo.ts (scopedRepo for user-owned data).",
        },
      ],
    },
  },
];
