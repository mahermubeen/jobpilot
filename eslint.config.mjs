import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Code-quality and DSA limits from docs/standards/CODE_QUALITY.md and DSA_PERFORMANCE.md.
// They are errors, so `npm run lint` (and scripts/check.sh, the pre-push hook and CI) fail on them.
// A loop that must stay sequential gets `// eslint-disable-next-line no-await-in-loop -- <why>`.
const SIZE_AND_SHAPE = {
  complexity: ["error", 10],
  "max-depth": ["error", 3],
  "max-params": ["error", 4],
  "max-lines-per-function": ["error", { max: 40, skipBlankLines: true, skipComments: true }],
  "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
  "max-nested-callbacks": ["error", 3],
  "no-await-in-loop": "error",
};

const ARRAY_CALLBACK = /^(map|filter|forEach|some|every|reduce|flatMap|find|findIndex|sort)$/.source;
const FIND = /^(find|findIndex|findLast|findLastIndex)$/.source;

// Patterns that are usually O(n²) or O(n) per step where a Map, Set or index does it in O(1).
const DSA_SMELLS = [
  {
    selector: "CallExpression[callee.property.name='shift'][arguments.length=0]",
    message: "shift() is O(n) per call; walk with an index or use a queue.",
  },
  {
    selector: `:matches(ForStatement, ForOfStatement, ForInStatement, WhileStatement, DoWhileStatement) > .body CallExpression[callee.property.name=/${FIND}/]`,
    message: "find() inside a loop is O(n²); build a Map or Set before the loop.",
  },
  {
    selector: `CallExpression[callee.property.name=/${ARRAY_CALLBACK}/] > :function CallExpression[callee.property.name=/${FIND}/]`,
    message: "find() inside an array callback is O(n²); build a Map before the loop.",
  },
  {
    selector: "CallExpression[callee.property.name=/^(includes|indexOf)$/][callee.object.type='ArrayExpression']",
    message: "A literal array searched with includes/indexOf; hoist it into a module-level Set and use has().",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    rules: { ...SIZE_AND_SHAPE, "no-restricted-syntax": ["error", ...DSA_SMELLS] },
  },
  {
    // A describe() block holds many tests, tests await steps in order, and fakes pop canned replies
    // off a short queue. Tests are not hot paths, so only these limits are relaxed there.
    files: ["tests/**"],
    rules: {
      "max-lines-per-function": "off",
      "max-nested-callbacks": ["error", 5],
      "no-await-in-loop": "off",
      "no-restricted-syntax": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
