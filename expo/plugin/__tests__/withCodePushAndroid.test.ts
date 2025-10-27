import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock(
  "expo/config-plugins",
  () => ({
    withMainApplication: jest.fn((config, apply) =>
      // @ts-expect-error -- mocking
      apply({ modResults: { contents: config._contents ?? "" } })
    ),
    WarningAggregator: {
      addWarningAndroid: jest.fn(),
    },
  }),
  { virtual: true }
);

const { withMainApplication, WarningAggregator } = require("expo/config-plugins");
const { withAndroidMainApplicationDependency } = require("../withCodePushAndroid.js");

// https://github.com/expo/expo/blob/deeaccf50bbc5b904c0b67c120efcf7e0accfd0b/templates/expo-template-bare-minimum/android/app/src/main/java/com/helloworld/MainApplication.kt
const expo54Template = `
package com.helloworld

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.defaults.DefaultReactNativeHost

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ReactNativeHostWrapper

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(
      this,
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())
            }

          override fun getJSMainModuleName(): String = ".expo/.virtual-metro-entry"

          override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

          override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
      }
  )

  override val reactHost: ReactHost
    get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
`;

// https://github.com/expo/expo/blob/main/templates/expo-template-bare-minimum/android/app/src/main/java/com/helloworld/MainApplication.kt
const expo55Template = `
package com.helloworld

import android.app.Application
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
        }
    )
  }

  override fun onCreate() {
    super.onCreate()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
`;

const withMainApplicationMock = withMainApplication as jest.Mock;
const addWarningAndroidMock = WarningAggregator.addWarningAndroid as jest.Mock;

describe("withAndroidMainApplicationDependency", () => {
  beforeEach(() => {
    withMainApplicationMock.mockClear();
    addWarningAndroidMock.mockClear();
  });

  it("adds CodePush import and method override in Expo SDK 53", () => {
    const result = withAndroidMainApplicationDependency({
      _contents: expo54Template,
      sdkVersion: "53.0.0",
    });

    const modifiedContent = result.modResults.contents;

    expect(modifiedContent).toContain("import com.microsoft.codepush.react.CodePush");
    expect(modifiedContent).toContain("override fun getJSBundleFile(): String = CodePush.getJSBundleFile()");
  });

  it("adds CodePush import and method override with getInstance() in Expo SDK 54", () => {
    const result = withAndroidMainApplicationDependency({
      _contents: expo54Template,
      sdkVersion: "54.0.0",
    });

    const modifiedContent = result.modResults.contents;

    expect(modifiedContent).toContain("import com.microsoft.codepush.react.CodePush");
    expect(modifiedContent).toContain("CodePush.getInstance(applicationContext, BuildConfig.DEBUG)");
    expect(modifiedContent).toContain("return CodePush.getJSBundleFile()");
  });

  it("adds CodePush import and jsBundleFilePath argument in Expo SDK 55", () => {
    const result = withAndroidMainApplicationDependency({
      _contents: expo55Template,
      sdkVersion: "55.0.0",
    });

    const modifiedContent = result.modResults.contents;

    expect(modifiedContent).toContain("import com.microsoft.codepush.react.CodePush");
    expect(modifiedContent).toContain("jsBundleFilePath = CodePush.getJSBundleFile()");

    const packageListIndex = modifiedContent.indexOf("packageList =");
    const jsBundleIndex = modifiedContent.indexOf("jsBundleFilePath = CodePush.getJSBundleFile()");
    expect(jsBundleIndex).toBeGreaterThan(packageListIndex);
  });
});
