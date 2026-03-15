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
  s.preserve_paths = '*.js'
  s.library        = 'z'
  s.source_files = 'ios/CodePush/*.{h,m,mm}'
  s.public_header_files = ['ios/CodePush/CodePush.h']

  # Note: Even though there are copy/pasted versions of some of these dependencies in the repo,
  # we explicitly let CocoaPods pull in the versions below so all dependencies are resolved and
  # linked properly at a parent workspace level.
  s.dependency 'React-Core'
  s.dependency 'SSZipArchive', '~> 2.5.5'

  if ENV['RCT_NEW_ARCH_ENABLED'] == '1'
    s.compiler_flags = '-DRCT_NEW_ARCH_ENABLED=1'
    s.pod_target_xcconfig = {
      'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
      'HEADER_SEARCH_PATHS' => "\"$(PODS_ROOT)/Headers/Public/ReactCodegen\" \"${PODS_CONFIGURATION_BUILD_DIR}/ReactCodegen/ReactCodegen.framework/Headers\""
    }

    s.dependency 'ReactCodegen'
    s.dependency 'RCTRequired'
    s.dependency 'RCTTypeSafety'
    s.dependency 'ReactCommon/turbomodule/core'
  end
end
