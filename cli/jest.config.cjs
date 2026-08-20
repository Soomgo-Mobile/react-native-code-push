/** @type {import('jest').Config} */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  resolver: '<rootDir>/jest.resolver.cjs',
  // Provisions hdiffz/hpatchz for the suites that generate real patches, once for the
  // whole run instead of once per suite.
  globalSetup: '<rootDir>/jest.globalSetup.ts',
  transform: {
    '^.+\\.(t|j)s$': ['babel-jest', { configFile: '../babel.config.js' }],
  },
  moduleFileExtensions: ['ts', 'js'],
  // `dist` holds the compiled copy of every suite here, which would otherwise run twice.
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  watchman: false,
};
