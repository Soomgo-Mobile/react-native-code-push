# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Invoked via reflection, when setting js bundle.
-keepclassmembers class com.facebook.react.ReactInstanceManager {
    private final ** mBundleLoader;
}
-keepclassmembers class com.facebook.react.ReactDelegate {
    private ** mReactHost; # RN < 0.81
    private ** reactHost; # RN 0.81+
    public void reload(...); # RN 0.74 and above
}
# bridgeless
-keepclassmembers class com.facebook.react.defaults.DefaultReactHostDelegate {
    private ** jsBundleLoader;
}
# bridgeless
-keepclassmembers class com.facebook.react.runtime.ReactHostImpl {
    private final ** mReactHostDelegate; # RN < 0.81
    private final ** reactHostDelegate; # RN 0.81+
}

# Can't find referenced class org.bouncycastle.**
-dontwarn com.nimbusds.jose.**
