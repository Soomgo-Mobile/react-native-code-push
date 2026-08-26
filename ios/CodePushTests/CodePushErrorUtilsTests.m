#import <XCTest/XCTest.h>
#import "CodePush.h"

@interface CodePushErrorUtilsTests : XCTestCase
@end

@implementation CodePushErrorUtilsTests

static NSError *urlError(NSInteger code)
{
    return [NSError errorWithDomain:NSURLErrorDomain code:code userInfo:nil];
}

- (void)testNamesAConnectionThatDroppedAsANetworkFailure
{
    XCTAssertTrue([CodePushErrorUtils isNetworkFailure:urlError(NSURLErrorNetworkConnectionLost)]);
    XCTAssertTrue([CodePushErrorUtils isNetworkFailure:urlError(NSURLErrorTimedOut)]);
}

- (void)testNamesAConnectionThatNeverOpenedAsANetworkFailure
{
    XCTAssertTrue([CodePushErrorUtils isNetworkFailure:urlError(NSURLErrorNotConnectedToInternet)]);
    XCTAssertTrue([CodePushErrorUtils isNetworkFailure:urlError(NSURLErrorCannotConnectToHost)]);
    XCTAssertTrue([CodePushErrorUtils isNetworkFailure:urlError(NSURLErrorDNSLookupFailed)]);
    XCTAssertTrue([CodePushErrorUtils isNetworkFailure:urlError(NSURLErrorSecureConnectionFailed)]);
}

- (void)testDoesNotNameAMalformedRequestAsANetworkFailure
{
    // The request never reached a network to fail on, so retrying it anywhere else is
    // no more likely to work.
    XCTAssertFalse([CodePushErrorUtils isNetworkFailure:urlError(NSURLErrorBadURL)]);
    XCTAssertFalse([CodePushErrorUtils isNetworkFailure:urlError(NSURLErrorUnsupportedURL)]);
}

- (void)testDoesNotNameAnErrorStatusAsANetworkFailure
{
    // What the download handler raises for a status of 400 or above: the connection
    // worked, so the archives behind it are worth asking for.
    NSError *error = [CodePushErrorUtils errorWithMessage:@"Received 503 response from https://cdn.example.test/full.zip"];

    XCTAssertTrue([CodePushErrorUtils isCodePushError:error]);
    XCTAssertFalse([CodePushErrorUtils isNetworkFailure:error]);
}

- (void)testNamesAnErrorStatusApartFromTheOtherErrorsCodePushRaises
{
    NSError *status = [CodePushErrorUtils errorWithMessage:@"Received 404 response from https://cdn.example.test/diff.zip"
                                            httpStatusCode:404];
    NSError *other = [CodePushErrorUtils errorWithMessage:@"Received empty response from https://cdn.example.test/diff.zip"];

    XCTAssertTrue([CodePushErrorUtils isHttpStatusError:status]);
    XCTAssertFalse([CodePushErrorUtils isHttpStatusError:other]);
    XCTAssertFalse([CodePushErrorUtils isHttpStatusError:[NSError errorWithDomain:NSURLErrorDomain
                                                                             code:NSURLErrorTimedOut
                                                                         userInfo:nil]]);
}

- (void)testDoesNotNameANilErrorAsANetworkFailure
{
    XCTAssertFalse([CodePushErrorUtils isNetworkFailure:nil]);
}

@end
