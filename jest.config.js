/** @type {import('jest').Config} */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  transform: {
    // The only source file with JSX, which Babel is not set up to transform here.
    'src/CodePush\\.js$': '<rootDir>/jest.jsxTransformer.cjs',
    '^.+\\.(t|j)sx?$': 'babel-jest',
  },
  watchman: false,
};
