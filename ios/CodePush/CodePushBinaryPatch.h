#import <Foundation/Foundation.h>

/*
 * Why an update that was downloaded as a binary patch has to be downloaded in full
 * instead.
 *
 * A failed restore is not an error the user ever hears about: it is the signal to
 * download the update's full archive. These reasons are the vocabulary the appliers of
 * every platform report, and the logs a rollout is judged from are read for exactly
 * these words, so they must not be reworded.
 */

/** The bundle inside the app binary could not be opened or read. */
extern NSString *const CodePushBinaryPatchReasonBaseBundleUnavailable;

/** The bundle inside the app binary is not the one the patch was computed against. */
extern NSString *const CodePushBinaryPatchReasonBaseHashMismatch;

/** The manifest is missing, malformed, points outside the archive, or asks for too much. */
extern NSString *const CodePushBinaryPatchReasonInvalidManifest;

/** The patch was produced by a format or a codec this client cannot apply. */
extern NSString *const CodePushBinaryPatchReasonUnsupportedFormat;

/** The applier refused the patch, or the restored bundle could not be written. */
extern NSString *const CodePushBinaryPatchReasonPatchApplyFailed;

/** The restored bundle is not the one the manifest promised. */
extern NSString *const CodePushBinaryPatchReasonTargetVerificationFailed;

/**
 * Rebuilds the JS bundle of an update that was downloaded as a binary patch archive.
 *
 * A patch archive holds everything the full archive holds except the JS bundle, which it
 * carries as a patch against the bundle that shipped inside the app binary, plus a
 * manifest describing how to rebuild it. Restoring means applying that patch, verifying
 * the result, moving it to where the bundle belongs and deleting the two patch-only
 * files. What is left is byte for byte the contents of the full archive, so the folder
 * hash check that follows the install is unchanged and stays the last line of defence.
 *
 * Nothing here trusts the patch. Neither the diff format nor the zstd streams inside it
 * carry a checksum of the data they produce, so an apply that reports success is not
 * proof of a correct result: a base bundle of the right size but the wrong content, or a
 * corrupted patch body, both produce wrong bytes without any error. The base bundle is
 * hashed before the patch is applied and the restored bundle is hashed afterwards, and
 * the restored bytes only reach the update contents once both checks have passed.
 *
 * Every failure is reported as a reason, never as an exception: the caller answers all
 * of them the same way, by downloading the full archive instead.
 */
@interface CodePushBinaryPatch : NSObject

/**
 * Turns the contents of a downloaded patch archive into the contents of the full one.
 *
 * This reads and hashes whole bundles, so it belongs on the queue the download runs on
 * and never on the main queue.
 *
 * @param unzippedFolderPath the unzipped archive, which is modified in place
 * @param workingFolderPath  scratch directory for the restored bundle, emptied before
 *                           and after the attempt so an interrupted run leaves nothing
 * @param baseBundleURL      the JS bundle that shipped inside the app binary
 * @param failureReason      set to the reason the full archive has to be downloaded
 *                           instead, whenever this returns NO
 */
+ (BOOL)restoreBundleInUnzippedFolder:(NSString *)unzippedFolderPath
                        workingFolder:(NSString *)workingFolderPath
                        baseBundleURL:(NSURL *)baseBundleURL
                        failureReason:(NSString **)failureReason;

@end
