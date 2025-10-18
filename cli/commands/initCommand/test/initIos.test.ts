import { modifyObjectiveCAppDelegate, modifySwiftAppDelegate } from "../initIos.js";
import { expect, describe, it} from "@jest/globals";

// https://github.com/react-native-community/template/blob/0.80.2/template/ios/HelloWorld/AppDelegate.swift
const swiftTemplate = `
import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()
    reactNativeDelegate = delegate
    reactNativeFactory = factory
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "HelloWorld",
      in: window,
      launchOptions: launchOptions
    )
    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
    #if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }
}
`;

// https://github.com/react-native-community/template/blob/0.76.9/template/ios/HelloWorld/AppDelegate.mm
const objcTemplate = `
#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.moduleName = @"HelloWorld";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
`;

describe('iOS init command - pure functions', () => {
    it('should correctly modify Swift AppDelegate content', () => {
        const modifiedContent = modifySwiftAppDelegate(swiftTemplate);
        expect(modifiedContent).toContain('CodePush.bundleURL()');
        expect(modifiedContent).not.toContain('Bundle.main.url(forResource: "main", withExtension: "jsbundle")');
    });

    it('should correctly modify Objective-C AppDelegate content', () => {
        const modifiedContent = modifyObjectiveCAppDelegate(objcTemplate);
        expect(modifiedContent).toContain('#import <CodePush/CodePush.h>');
        expect(modifiedContent).toContain('[CodePush bundleURL]');
        expect(modifiedContent).not.toContain('[[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];');
    });
});
