#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(RolloutStorage, NSObject)

RCT_EXTERN_METHOD(setItem:(NSString *)key value:(NSString *)value)
RCT_EXTERN_METHOD(getItem:(NSString *)key resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(removeItem:(NSString *)key)

@end