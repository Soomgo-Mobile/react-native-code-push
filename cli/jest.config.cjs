/** @type {import('jest').Config} */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  // resolver: '<rootDir>/jest.resolver.cjs',
  transform: {
    '^.+\\.(t|j)s$': ['babel-jest', { configFile: '../babel.config.js' }],
  },
  moduleFileExtensions: ['ts', 'js'],
  watchman: false,
};
