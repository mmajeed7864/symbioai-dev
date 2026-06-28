import globals from "globals";

/**
 * Flat ESLint config (ESLint 9+).
 * - Browser scripts (main.js, symbio-widget.js) are classic <script> files.
 * - Root config files (.eleventy.js, this file) are ESM running on Node.
 */
export default [
  {
    ignores: ["dist/**", "node_modules/**", "src/assets/js/symbio-widget.min.js"],
  },
  {
    files: ["src/assets/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      eqeqeq: ["warn", "smart"],
      "prefer-const": "warn",
      "no-var": "warn",
    },
  },
  {
    files: ["*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none" }],
    },
  },
];
