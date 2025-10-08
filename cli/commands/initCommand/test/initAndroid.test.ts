import fs from "fs";
import path from "path";
import { initAndroid, modifyMainApplicationKt } from "../initAndroid.ts";
import { jest, expect, describe, it } from "@jest/globals";

const tempDir = path.join(__dirname, 'temp');

// https://github.com/react-native-community/template/blob/0.80.2/template/android/app/src/main/java/com/helloworld/MainApplication.kt
const ktTemplate = `
package com.helloworld

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here, for example:
              // add(MyReactNativePackage())
            }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
`;

describe('Android init command', () => {
    it('should correctly modify Kotlin MainApplication content', () => {
        const modifiedContent = modifyMainApplicationKt(ktTemplate);
        expect(modifiedContent).toContain('import com.microsoft.codepush.react.CodePush');
        expect(modifiedContent).toContain('override fun getJSBundleFile(): String = CodePush.getJSBundleFile()');
    });

    it('should log a message and exit if MainApplication.java is found', async () => {
        const originalCwd = process.cwd();

        fs.mkdirSync(tempDir, { recursive: true });
        process.chdir(tempDir);

        // Arrange
        const javaAppDir = path.join(tempDir, 'android', 'app', 'src', 'main', 'java', 'com', 'helloworld');
        fs.mkdirSync(javaAppDir, { recursive: true });
        const javaFilePath = path.join(javaAppDir, 'MainApplication.java');
        const originalContent = '// Java file content';
        fs.writeFileSync(javaFilePath, originalContent);

        const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {
        });

        // Act
        await initAndroid();

        // Assert
        expect(consoleSpy).toHaveBeenCalledWith('log: MainApplication.java is not supported. Please migrate to MainApplication.kt.');
        const finalContent = fs.readFileSync(javaFilePath, 'utf-8');
        expect(finalContent).toBe(originalContent); // Ensure file is not modified

        consoleSpy.mockRestore();

        process.chdir(originalCwd);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });
});
