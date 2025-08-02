package com.microsoft.codepush.react;

import android.content.Context;
import android.content.SharedPreferences;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;

public class RolloutStorageModule extends ReactContextBaseJavaModule {

    private final SharedPreferences prefs;

    public RolloutStorageModule(ReactApplicationContext reactContext) {
        super(reactContext);
        prefs = reactContext.getSharedPreferences("CodePushPrefs", Context.MODE_PRIVATE);
    }

    @Override
    public String getName() {
        return "RolloutStorage";
    }

    @ReactMethod
    public void getItem(String key, Promise promise) {
        promise.resolve(prefs.getString(key, null));
    }

    @ReactMethod
    public void setItem(String key, String value) {
        prefs.edit().putString(key, value).apply();
    }

    @ReactMethod
    public void removeItem(String key) {
        prefs.edit().remove(key).apply();
    }
}
