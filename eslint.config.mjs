import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";


export default [
  {files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"]},
  {ignores: ["Examples/**"]},
  {languageOptions: { globals: {
    ...globals.node,
    ...globals.mocha,
    ...globals.browser,
    ...globals.jest
  } }},
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,
  {"rules": {
    "@typescript-eslint/no-require-imports": "warn",
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/no-unused-expressions": "warn",
    "no-empty": "warn",
    "@typescript-eslint/no-explicit-any": "warn",
    "no-var": "warn",
    "@typescript-eslint/no-this-alias": "warn",
    "@typescript-eslint/no-empty-object-type": "warn",
    "react/no-deprecated": "warn",
    "no-extra-boolean-cast": "warn",
    "no-useless-escape": "warn",
    "no-control-regex": "warn",
  }}
];
