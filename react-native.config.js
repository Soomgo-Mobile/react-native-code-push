module.exports = {
    dependency: {
        platforms: {
            android: {
                packageImportPath: "import com.microsoft.codepush.react.CodePush;",
                packageInstance:
                    "CodePush.getInstance(getApplicationContext(), BuildConfig.DEBUG)",
                sourceDir: './android/app',
                libraryName: 'RNCodePushSpec',
                cmakeListsPath: 'build/generated/source/codegen/jni/CMakeLists.txt',
            }
        }
    }
};
