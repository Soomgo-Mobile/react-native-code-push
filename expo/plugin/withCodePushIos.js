const { withAppDelegate, withXcodeProject, WarningAggregator } = require('expo/config-plugins');
const { getAppDelegate } = require('@expo/config-plugins/build/ios/Paths');
const path = require('path');
const fs = require('fs');

function iosApplyImplementation(
  appDelegate,
  find,
  add,
  replace,
) {
  if (appDelegate.includes(add)) {
    return appDelegate;
  }

  if (appDelegate.includes(find)) {
    return appDelegate.replace(find, replace ? add : `${find}\n${add}`);
  }

  WarningAggregator.addWarningIOS(
    'withCodePushIos',
    `
    Failed to detect "${find.replace(/\n/g, '').trim()}" in the AppDelegate.(m|swift).
    Please ${replace ? 'replace' : 'add'} "${add.replace(/\n/g, '').trim()}" to the AppDelegate.(m|swift).
    Supported format: Expo SDK default template.

    iOS manual setup: https://github.com/Soomgo-Mobile/react-native-code-push#2-ios-setup
    `,
  );

  return appDelegate;
}

function getBridgingHeaderFileFromXcode(project) {
  const buildConfigs = project.pbxXCBuildConfigurationSection();

  for (const key in buildConfigs) {
    const config = buildConfigs[key];
    if (
      typeof config === 'object' &&
      config.buildSettings &&
      config.buildSettings['SWIFT_OBJC_BRIDGING_HEADER']
    ) {
      const bridgingHeaderFile = config.buildSettings[
        'SWIFT_OBJC_BRIDGING_HEADER'
      ].replace(/"/g, '');

      return bridgingHeaderFile;
    }
  }
  return null;
}

const withIosAppDelegateDependency = (config) => {
  return withAppDelegate(config, (action) => {
    const language = action.modResults.language;

    if (['objc', 'objcpp'].includes(language)) {
      action.modResults.contents = iosApplyImplementation(
        action.modResults.contents,
        `#import "AppDelegate.h"`,
        `#import <CodePush/CodePush.h>`,
      );
      action.modResults.contents = iosApplyImplementation(
        action.modResults.contents,
        `return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];`,
        `return [CodePush bundleURL];`,
        true,
      );

      return action;
    }

    if (language === 'swift') {
      action.modResults.contents = iosApplyImplementation(
        action.modResults.contents,
        `return Bundle.main.url(forResource: "main", withExtension: "jsbundle")`,
        `return CodePush.bundleURL()`,
        true,
      );

      return action;
    }

    WarningAggregator.addWarningIOS(
      'withIosAppDelegate',
      `${language} AppDelegate file is not supported yet.`,
    );

    return action;
  });
};

const withIosBridgingHeader = (config) => {
  return withXcodeProject(config, (action) => {
    const projectRoot = action.modRequest.projectRoot;
    const appDelegate = getAppDelegate(projectRoot);

    if (appDelegate.language === 'swift') {
      const bridgingHeaderFile = getBridgingHeaderFileFromXcode(
        action.modResults,
      );

      const bridgingHeaderPath = path.join(
        action.modRequest.platformProjectRoot,
        bridgingHeaderFile,
      );

      if (fs.existsSync(bridgingHeaderPath)) {
        let content = fs.readFileSync(bridgingHeaderPath, 'utf8');
        const codePushImport = '#import <CodePush/CodePush.h>';

        if (!content.includes(codePushImport)) {
          content += `${codePushImport}\n`;
          fs.writeFileSync(bridgingHeaderPath, content);
        }

        return action;
      }

      WarningAggregator.addWarningIOS(
        'withIosBridgingHeader',
        `
        Failed to detect ${bridgingHeaderPath} file.
        Please add CodePush integration manually:
        #import <CodePush/CodePush.h>

        Supported format: Expo SDK default template.
        iOS manual setup: https://github.com/Soomgo-Mobile/react-native-code-push#2-edit-appdelegate-code
        `
      );

      return action;
    }

    return action;
  });
};

module.exports = {
  withIosAppDelegateDependency,
  withIosBridgingHeader,
};
