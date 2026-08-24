require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'CodePush'
  s.version        = package['version'].gsub(/v|-beta/, '')
  s.summary        = package['description']
  s.author         = package['author']
  s.license        = package['license']
  s.homepage       = package['homepage']
  s.source         = { :git => 'https://github.com/Soomgo-Mobile/react-native-code-push.git', :tag => "v#{s.version}"}
  s.ios.deployment_target = '15.5'
  s.tvos.deployment_target = '15.5'
  s.preserve_paths = ['*.js', 'cpp/binarypatch/**/*.h']
  s.library        = 'z'
  # The applier that installs a binary patch update is compiled from the C sources the
  # other platform and the host build compile as well, referenced where they live rather
  # than copied here, which is what keeps the appliers of the platforms from drifting
  # apart. Only the decompressing half of zstd is needed, and its assembly fast path is
  # deliberately not vendored, so this list is the same one the other platform builds.
  s.source_files = [
    'ios/CodePush/*.{h,m,mm}',
    'cpp/binarypatch/binarypatch_zstd_decompressor.c',
    'cpp/binarypatch/vendor/HDiffPatch/libHDiffPatch/HPatch/patch.c',
    'cpp/binarypatch/vendor/zstd/common/debug.c',
    'cpp/binarypatch/vendor/zstd/common/entropy_common.c',
    'cpp/binarypatch/vendor/zstd/common/error_private.c',
    'cpp/binarypatch/vendor/zstd/common/fse_decompress.c',
    'cpp/binarypatch/vendor/zstd/common/xxhash.c',
    'cpp/binarypatch/vendor/zstd/common/zstd_common.c',
    'cpp/binarypatch/vendor/zstd/decompress/huf_decompress.c',
    'cpp/binarypatch/vendor/zstd/decompress/zstd_ddict.c',
    'cpp/binarypatch/vendor/zstd/decompress/zstd_decompress.c',
    'cpp/binarypatch/vendor/zstd/decompress/zstd_decompress_block.c'
  ]
  s.public_header_files = ['ios/CodePush/CodePush.h']

  s.test_spec 'Tests' do |test_spec|
    test_spec.source_files = 'ios/CodePushTests/**/*.{h,m}'
    test_spec.resources = 'cli/fixtures/binary-patch/*'
  end

  binary_patch_header_search_paths = '"$(PODS_TARGET_SRCROOT)/cpp/binarypatch" "$(PODS_TARGET_SRCROOT)/cpp/binarypatch/vendor/HDiffPatch" "$(PODS_TARGET_SRCROOT)/cpp/binarypatch/vendor/zstd"'
  # ZSTD_DISABLE_ASM: the assembly fast path is intentionally not vendored.
  # _IS_USED_MULTITHREAD=0: patches are applied on the thread that downloads them.
  binary_patch_preprocessor_definitions = '$(inherited) ZSTD_DISABLE_ASM=1 _IS_USED_MULTITHREAD=0'

  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => binary_patch_header_search_paths,
    'GCC_PREPROCESSOR_DEFINITIONS' => binary_patch_preprocessor_definitions
  }

  # Note: Even though there are copy/pasted versions of some of these dependencies in the repo,
  # we explicitly let CocoaPods pull in the versions below so all dependencies are resolved and
  # linked properly at a parent workspace level.
  s.dependency 'React-Core'
  s.dependency 'SSZipArchive', '~> 2.5.5'

  if ENV['RCT_NEW_ARCH_ENABLED'] == '1'
    s.compiler_flags = '-DRCT_NEW_ARCH_ENABLED=1'
    # This replaces pod_target_xcconfig rather than adding to it, so what the applier
    # needs to build has to be carried into it as well.
    s.pod_target_xcconfig = {
      'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
      'HEADER_SEARCH_PATHS' => "\"$(PODS_ROOT)/Headers/Public/ReactCodegen\" \"${PODS_CONFIGURATION_BUILD_DIR}/ReactCodegen/ReactCodegen.framework/Headers\" #{binary_patch_header_search_paths}",
      'GCC_PREPROCESSOR_DEFINITIONS' => binary_patch_preprocessor_definitions
    }

    s.dependency 'ReactCodegen'
    s.dependency 'RCTRequired'
    s.dependency 'RCTTypeSafety'
    s.dependency 'ReactCommon/turbomodule/core'
  end
end
