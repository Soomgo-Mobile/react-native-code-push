#import "CodePush.h"

@implementation CodePushErrorUtils

static NSString *const CodePushErrorDomain = @"CodePushError";
static const int CodePushErrorCode = -1;
/*
 * The status a server answered a download with, on the error raised for it.
 *
 * Carried in the user info rather than in the error code, because the code is what JS reads
 * an error by and every error of this domain has always been -1 there.
 */
static NSString *const CodePushHttpStatusCodeKey = @"CodePushHttpStatusCode";

+ (NSError *)errorWithMessage:(NSString *)errorMessage
{
    return [NSError errorWithDomain:CodePushErrorDomain
                               code:CodePushErrorCode
                           userInfo:@{ NSLocalizedDescriptionKey: NSLocalizedString(errorMessage, nil) }];
}

+ (NSError *)errorWithMessage:(NSString *)errorMessage httpStatusCode:(NSInteger)statusCode
{
    return [NSError errorWithDomain:CodePushErrorDomain
                               code:CodePushErrorCode
                           userInfo:@{ NSLocalizedDescriptionKey: NSLocalizedString(errorMessage, nil),
                                       CodePushHttpStatusCodeKey: @(statusCode) }];
}

+ (BOOL)isCodePushError:(NSError *)err
{
    return err != nil && [CodePushErrorDomain isEqualToString:err.domain];
}

/*
 * Whether the download failed because the server answered it with a status rather than with
 * a body to install.
 */
+ (BOOL)isHttpStatusError:(NSError *)err
{
    return [self isCodePushError:err] && err.userInfo[CodePushHttpStatusCodeKey] != nil;
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