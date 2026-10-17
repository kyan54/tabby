{
  "targets": [{
    "target_name": "cyberduck_keychain",
    "sources": ["src/addon.cc"],
    "include_dirs": ["generated"],
    "defines": ["NAPI_VERSION=8"],
    "conditions": [["OS=='mac'", {
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "MACOSX_DEPLOYMENT_TARGET": "11.0",
        "OTHER_CPLUSPLUSFLAGS": ["-Wall", "-Wextra", "-Wno-deprecated-declarations"]
      },
      "link_settings": {
        "libraries": ["-framework Security", "-framework CoreFoundation"]
      }
    }, {"type": "none"}]]
  }]
}
