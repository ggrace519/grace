module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    webextensions: true,
  },
  overrides: [
    { files: ["extension/src/**/*.ts", "extension/src/**/*.svelte"], parser: "@typescript-eslint/parser", plugins: ["@typescript-eslint"], extends: ["eslint:recommended"] },
    { files: ["*.js", "extension/src/**/*.js"], extends: ["eslint:recommended"] },
  ],
};
