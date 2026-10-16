import base from "@wasfa/config/eslint";

// The price engine must stay a pure function (BILLING §4): no I/O, no clock, no network.
// Time comes in through `input.now`; never call `new Date()` without arguments or `Date.now()` there.
const IO_MODULES = [
  "node:*",
  "fs",
  "fs/*",
  "crypto",
  "http",
  "https",
  "@wasfa/db",
  "@wasfa/db/*",
  "ioredis",
  "drizzle-orm",
  "drizzle-orm/*",
];

export default [
  ...base,
  {
    files: ["src/price-engine.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: IO_MODULES,
              message: "The price engine is pure: no I/O imports.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "The price engine is pure: no network." },
        { name: "process", message: "The price engine is pure: no environment access." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "Use input.now; the engine has no clock." },
        { object: "Math", property: "random", message: "The engine is deterministic." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Use input.now; the engine has no clock.",
        },
      ],
    },
  },
];
