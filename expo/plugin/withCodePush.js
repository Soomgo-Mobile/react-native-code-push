const { createRunOncePlugin } = require('expo/config-plugins');
const { withAndroidMainApplicationDependency } = require('./withCodePushAndroid');
const { withIosBridgingHeader, withIosAppDelegateDependency } = require('./withCodePushIos');
const pkg = require('../../package.json');

const withCodePush = (config) => {
  config = withAndroidMainApplicationDependency(config);
  config = withIosBridgingHeader(config);
  config = withIosAppDelegateDependency(config);

  return config;
};

module.exports = createRunOncePlugin(withCodePush, pkg.name, pkg.version);
