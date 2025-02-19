package com.microsoft.codepush.react;

import android.content.Context;

public class CodePushBuilder {
    private String mDeploymentKey;
    private Context mContext;

    private boolean mIsDebugMode;
    private String mServerUrl;
    private Integer mPublicKeyResourceDescriptor;

    public CodePushBuilder(Context context) {
        this.mDeploymentKey = "deprecated_deployment_key";
        this.mContext = context;
        this.mServerUrl = CodePush.getServiceUrl();
    }

    public CodePushBuilder setIsDebugMode(boolean isDebugMode) {
        this.mIsDebugMode = isDebugMode;
        return this;
    }

    public CodePushBuilder setServerUrl(String serverUrl) {
        this.mServerUrl = serverUrl;
        return this;
    }

    public CodePushBuilder setPublicKeyResourceDescriptor(int publicKeyResourceDescriptor) {
        this.mPublicKeyResourceDescriptor = publicKeyResourceDescriptor;
        return this;
    }

    public CodePush build() {
        return new CodePush(this.mContext, this.mIsDebugMode, this.mServerUrl, this.mPublicKeyResourceDescriptor);
    }
}
