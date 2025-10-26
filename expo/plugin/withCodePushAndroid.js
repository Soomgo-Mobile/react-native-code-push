const { withMainApplication, WarningAggregator } = require('expo/config-plugins');

const IMPORT_CODE_PUSH = 'import com.microsoft.codepush.react.CodePush';
const RN_082_MARKER = '  getDefaultReactHost(';
const JS_BUNDLE_FILE_PATH_ARGUMENT = 'jsBundleFilePath = CodePush.getJSBundleFile()';

function androidMainApplicationApplyImplementation(mainApplication, find, add, reverse = false) {
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

    Android manual setup: https://github.com/Soomgo-Mobile/react-native-code-push#2-1-manual-setup
    `,
  );

  return mainApplication;
}

function addJsBundleFilePathArgument(mainApplication) {
  if (mainApplication.includes(JS_BUNDLE_FILE_PATH_ARGUMENT)) {
    return mainApplication;
  }

  const packageListArgumentPattern = /(packageList\s*=\s*\n\s*PackageList\(this\)[\s\S]+?\},\s*\n)/;

  if (!packageListArgumentPattern.test(mainApplication)) {
    WarningAggregator.addWarningAndroid(
      'withCodePushAndroid',
      `
      Failed to detect "packageList = PackageList(this)" block in MainApplication.kt.
      Please add "jsBundleFilePath = CodePush.getJSBundleFile()" inside getDefaultReactHost arguments.

      Android manual setup: https://github.com/Soomgo-Mobile/react-native-code-push#2-1-manual-setup
      `,
    );
    return mainApplication;
  }

  return mainApplication.replace(packageListArgumentPattern, (match) => {
    if (match.includes('jsBundleFilePath')) {
      return match;
    }

    return `${match}      ${JS_BUNDLE_FILE_PATH_ARGUMENT},\n`;
  });
}

const withAndroidMainApplicationDependency = (config) => {
  return withMainApplication(config, (action) => {
    action.modResults.contents = androidMainApplicationApplyImplementation(
      action.modResults.contents,
      'import com.facebook.react.ReactApplication',
      IMPORT_CODE_PUSH,
    );

    if (!action.modResults.contents.includes('CodePush.getJSBundleFile()')) {
      if (action.modResults.contents.includes(RN_082_MARKER)) {
        action.modResults.contents = addJsBundleFilePathArgument(action.modResults.contents);
      } else {
        action.modResults.contents = androidMainApplicationApplyImplementation(
          action.modResults.contents,
          'object : DefaultReactNativeHost(this) {',
          '        override fun getJSBundleFile(): String = CodePush.getJSBundleFile()\n');
      }
    }

    return action;
  });
};

module.exports = {
  withAndroidMainApplicationDependency,
};
