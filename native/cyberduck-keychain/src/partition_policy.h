#pragma once
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <Security/SecACL.h>
#include <string>
#include <vector>

// Public Security.framework ACL metadata only. No Keychain item/password APIs.
namespace tabby_keychain::partition {
template<typename T> class Ref {
public:
    explicit Ref(T value = nullptr) : value_(value) {}
    ~Ref() { if (value_) CFRelease(value_); }
    Ref(const Ref&) = delete;
    Ref& operator=(const Ref&) = delete;
    T get() const { return value_; }
    T* out() { return &value_; }
private:
    T value_;
};
inline int nibble(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}
inline bool decode(CFStringRef description, std::vector<UInt8>& bytes) {
    if (!description || CFGetTypeID(description) != CFStringGetTypeID()) return false;
    CFIndex length = CFStringGetLength(description);
    if (length < 2 || length > 32768 || length % 2) return false;
    std::vector<char> hex(static_cast<size_t>(length) + 1);
    if (!CFStringGetCString(description, hex.data(), hex.size(), kCFStringEncodingASCII)) return false;
    bytes.clear();
    for (CFIndex n = 0; n < length; n += 2) {
        int high = nibble(hex[n]), low = nibble(hex[n + 1]);
        if (high < 0 || low < 0) return false;
        bytes.push_back(static_cast<UInt8>((high << 4) | low));
    }
    return true;
}
inline CFStringRef encode(CFDataRef data) {
    const auto* bytes = CFDataGetBytePtr(data);
    std::string hex;
    static constexpr char digits[] = "0123456789abcdef";
    for (CFIndex n = 0; n < CFDataGetLength(data); ++n) {
        hex += digits[bytes[n] >> 4];
        hex += digits[bytes[n] & 15];
    }
    return CFStringCreateWithBytes(nullptr, reinterpret_cast<const UInt8*>(hex.data()), hex.size(), kCFStringEncodingASCII, false);
}
inline bool allowed(CFStringRef description, bool requireBoth) {
    std::vector<UInt8> bytes;
    if (!decode(description, bytes)) return false;
    Ref<CFDataRef> data(CFDataCreate(nullptr, bytes.data(), bytes.size()));
    if (!data.get()) return false;
    Ref<CFPropertyListRef> plist(CFPropertyListCreateWithData(nullptr, data.get(), kCFPropertyListImmutable, nullptr, nullptr));
    if (!plist.get() || CFGetTypeID(plist.get()) != CFDictionaryGetTypeID()) return false;
    auto dict = static_cast<CFDictionaryRef>(plist.get());
    if (CFDictionaryGetCount(dict) != 1) return false;
    auto values = static_cast<CFArrayRef>(CFDictionaryGetValue(dict, CFSTR("Partitions")));
    if (!values || CFGetTypeID(values) != CFArrayGetTypeID()) return false;
    CFIndex count = CFArrayGetCount(values);
    if (count < 1 || count > 2 || (requireBoth && count != 2)) return false;
    bool host = false, duck = false;
    for (CFIndex n = 0; n < count; ++n) {
        auto value = static_cast<CFStringRef>(CFArrayGetValueAtIndex(values, n));
        if (CFGetTypeID(value) != CFStringGetTypeID()) return false;
        if (CFEqual(value, CFSTR("teamid:" TABBY_KEYCHAIN_TEAM_ID)) && !host) host = true;
        else if (CFEqual(value, CFSTR("teamid:G69SCX94XU")) && !duck) duck = true;
        else return false; // Unknown/broad/duplicate partitions fail closed.
    }
    return host && (!requireBoth || duck);
}
inline CFStringRef desiredDescription() {
    const void* values[] = {CFSTR("teamid:" TABBY_KEYCHAIN_TEAM_ID), CFSTR("teamid:G69SCX94XU")};
    Ref<CFArrayRef> array(CFArrayCreate(nullptr, values, 2, &kCFTypeArrayCallBacks));
    if (!array.get()) return nullptr;
    const void* keys[] = {CFSTR("Partitions")};
    const void* objects[] = {array.get()};
    Ref<CFDictionaryRef> dict(CFDictionaryCreate(nullptr, keys, objects, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks));
    if (!dict.get()) return nullptr;
    Ref<CFDataRef> data(CFPropertyListCreateData(nullptr, dict.get(), kCFPropertyListXMLFormat_v1_0, 0, nullptr));
    return data.get() ? encode(data.get()) : nullptr;
}
inline OSStatus configure(SecACLRef acl) {
    Ref<CFArrayRef> apps;
    Ref<CFStringRef> description;
    SecKeychainPromptSelector prompt = 0;
    OSStatus status = SecACLCopyContents(acl, apps.out(), description.out(), &prompt);
    if (status != errSecSuccess) return status;
    Ref<CFArrayRef> rights(SecACLCopyAuthorizations(acl));
    if (apps.get() || !rights.get() || CFArrayGetCount(rights.get()) != 1 ||
        !CFEqual(CFArrayGetValueAtIndex(rights.get(), 0), kSecACLAuthorizationPartitionID) ||
        !allowed(description.get(), false)) return errSecParam;
    Ref<CFStringRef> desired(desiredDescription());
    if (!desired.get()) return errSecAllocate;
    // NULL applies ONLY to an existing system PARTITION metadata subject. It
    // never creates an all-app ACL (Apple SecACLSetSimpleContents integrityForm).
    status = SecACLSetContents(acl, nullptr, desired.get(), prompt);
    if (status != errSecSuccess) return status;
    Ref<CFArrayRef> checkedApps;
    Ref<CFStringRef> checkedDescription;
    SecKeychainPromptSelector checkedPrompt = 0;
    status = SecACLCopyContents(acl, checkedApps.out(), checkedDescription.out(), &checkedPrompt);
    if (status != errSecSuccess) return status;
    Ref<CFArrayRef> checkedRights(SecACLCopyAuthorizations(acl));
    return !checkedApps.get() && checkedRights.get() && CFEqual(rights.get(), checkedRights.get()) &&
        checkedPrompt == prompt && allowed(checkedDescription.get(), true) ? errSecSuccess : errSecParam;
}
} // namespace tabby_keychain::partition
