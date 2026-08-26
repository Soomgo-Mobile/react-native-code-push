#import "CodePush.h"

@implementation CodePushErrorUtils

static NSString *const CodePushErrorDomain = @"CodePushError";
static const int CodePushErrorCode = -1;

+ (NSError *)errorWithMessage:(NSString *)errorMessage
{
    return [NSError errorWithDomain:CodePushErrorDomain
                               code:CodePushErrorCode
                           userInfo:@{ NSLocalizedDescriptionKey: NSLocalizedString(errorMessage, nil) }];
}

+ (BOOL)isCodePushError:(NSError *)err
{
    return err != nil && [CodePushErrorDomain isEqualToString:err.domain];
}

/*
 * Whether the request failed because the network did not carry it.
 *
 * A server that answered is not this, however it answered: the connection worked, and
 * asking a different URL over it is worth doing. A connection that never opened or that
 * dropped is, and every URL behind it is equally out of reach.
 *
 * Named from the codes rather than the domain, because `NSURLErrorDomain` also covers a
 * URL that was malformed or a scheme that is not supported - failures of the request
 * rather than of the network under it.
 */
+ (BOOL)isNetworkFailure:(NSError *)err
{
    if (err == nil || ![NSURLErrorDomain isEqualToString:err.domain]) {
        return NO;
    }

    switch (err.code) {
        case NSURLErrorTimedOut:
        case NSURLErrorCannotFindHost:
        case NSURLErrorCannotConnectToHost:
        case NSURLErrorNetworkConnectionLost:
        case NSURLErrorDNSLookupFailed:
        case NSURLErrorNotConnectedToInternet:
        case NSURLErrorSecureConnectionFailed:
            return YES;
        default:
            return NO;
    }
}

@end