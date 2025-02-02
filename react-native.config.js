module.exports = {
    dependency: {
        platforms: {
            android: {
                packageImportPath: "import com.microsoft.codepush.react.CodePush;",
                packageInstance:
                    "new CodePush(getResources().getString(R.string.CodePushDeploymentKey), getApplicationContext(), BuildConfig.DEBUG)",
                sourceDir: './android/app'
            }
        }
    }
};
