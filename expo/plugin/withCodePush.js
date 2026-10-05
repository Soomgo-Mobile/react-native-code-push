const { createRunOncePlugin } = require('expo/config-plugins');
const { withAndroidMainApplicationDependency, withAndroidDiffUpdates } = require('./withCodePushAndroid');
const { withIosBridgingHeader, withIosAppDelegateDependency, withIosDiffUpdates } = require('./withCodePushIos');
const pkg = require('../../package.json');

const withCodePush = (config, { diffUpdates = false } = {}) => {
  config = withAndroidMainApplicationDependency(config);
  config = withIosBridgingHeader(config);
  config = withIosAppDelegateDependency(config);

  if (diffUpdates) {
    config = withAndroidDiffUpdates(config);
    config = withIosDiffUpdates(config);
  }

  return config;
};

module.exports = createRunOncePlugin(withCodePush, pkg.name, pkg.version);
