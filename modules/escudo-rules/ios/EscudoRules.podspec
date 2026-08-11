Pod::Spec.new do |s|
  s.name           = 'EscudoRules'
  s.version        = '1.0.0'
  s.summary        = 'Bloqueo nativo con WKContentRuleList'
  s.description    = 'Compila listas de bloqueo y se las entrega al motor de WebKit.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
