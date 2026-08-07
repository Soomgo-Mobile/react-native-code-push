const crypto = require('crypto');
const ts = require('typescript');

/**
 * `src/CodePush.js` carries the JSX of the `codePush` decorator, and the Babel config of
 * this repository has no JSX transform - an app bundling the library transforms it with
 * the React Native preset. Tests still have to load the module, so it is compiled with
 * TypeScript instead, which turns the JSX into `React.createElement` calls and leaves the
 * rest of the file to the same downlevelling Babel would have applied.
 */
const COMPILER_OPTIONS = {
  allowJs: true,
  esModuleInterop: true,
  jsx: ts.JsxEmit.React,
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
};

module.exports = {
  process(sourceText, sourcePath) {
    const { outputText } = ts.transpileModule(sourceText, {
      fileName: sourcePath,
      compilerOptions: COMPILER_OPTIONS,
    });

    return { code: outputText };
  },

  getCacheKey(sourceText, sourcePath) {
    return crypto
      .createHash('sha1')
      .update(ts.version)
      .update('\0', 'utf8')
      .update(JSON.stringify(COMPILER_OPTIONS))
      .update('\0', 'utf8')
      .update(sourcePath)
      .update('\0', 'utf8')
      .update(sourceText)
      .digest('hex');
  },
};
