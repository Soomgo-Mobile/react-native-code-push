const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  projectRoot: projectRoot,
  watchFolders: [workspaceRoot],
  resolver: {
    // Always resolve deps from the example app to avoid module duplication.
    extraNodeModules: new Proxy(
      {},
      {
        get: (_, name) => path.join(projectRoot, 'node_modules', name),
      },
    ),
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
