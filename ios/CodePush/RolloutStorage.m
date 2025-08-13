#import "RolloutStorage.h"

@implementation RolloutStorage

RCT_EXPORT_MODULE();

RCT_EXPORT_METHOD(setItem:(NSString *)key value:(NSString *)value) {
  [[NSUserDefaults standardUserDefaults] setObject:value forKey:key];
}

RCT_EXPORT_METHOD(getItem:(NSString *)key
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  NSString *value = [[NSUserDefaults standardUserDefaults] stringForKey:key];
  resolve(value);
}

RCT_EXPORT_METHOD(removeItem:(NSString *)key) {
  [[NSUserDefaults standardUserDefaults] removeObjectForKey:key];
}

@end
