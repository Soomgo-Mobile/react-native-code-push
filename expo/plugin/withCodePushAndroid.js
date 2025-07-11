const { withAppBuildGradle, withMainApplication, WarningAggregator } = require('expo/config-plugins');

function androidApplyImplementation(appBuildGradle) {
  const codePushImplementation = `apply from: "../../node_modules/@bravemobile/react-native-code-push/android/codepush.gradle"`;

  if (!appBuildGradle.includes(codePushImplementation)) {
    return `${appBuildGradle.trimEnd()}\n${codePushImplementation}\n`;
  }

  return appBuildGradle;
}

function androidMainApplicationApplyImplementation(
  mainApplication,
  find,
  add,
  reverse = false,
) {
  if (mainApplication.includes(add)) {
    return mainApplication;
  }

  if (mainApplication.includes(find)) {
    return mainApplication.replace(find, reverse ? `${add}\n${find}` : `${find}\n${add}`);
  }

  WarningAggregator.addWarningAndroid(
    'withCodePushAndroid',
    `
    Failed to detect "${find.replace(/\n/g, '').trim()}" in the MainApplication.kt.
    Please add "${add.replace(/\n/g, '').trim()}" to the MainApplication.kt.
    Supported format: Expo SDK default template.

    Android manual setup: https://github.com/Soomgo-Mobile/react-native-code-push#3-android-setup
    `,
  );

  return mainApplication;
}

const withAndroidBuildScriptDependency = (config) => {
  return withAppBuildGradle(config, (action) => {
    action.modResults.contents = androidApplyImplementation(
      action.modResults.contents,
    );

    return action;
  });
};

const withAndroidMainApplicationDependency = (config) => {
  return withMainApplication(config, (action) => {
    action.modResults.contents = androidMainApplicationApplyImplementation(
      action.modResults.contents,
      'class MainApplication : Application(), ReactApplication {',
      'import com.microsoft.codepush.react.CodePush\n',
      true,
    );

    action.modResults.contents = androidMainApplicationApplyImplementation(
      action.modResults.contents,
      'object : DefaultReactNativeHost(this) {',
      '          override fun getJSBundleFile(): String = CodePush.getJSBundleFile()\n',
    );
    return action;
  });
};

module.exports = {
  withAndroidBuildScriptDependency,
  withAndroidMainApplicationDependency,
};
