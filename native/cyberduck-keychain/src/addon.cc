// Direct, synchronous N-API bridge. No command, IPC endpoint, secret-bearing
// file, password retrieval API, or diagnostic containing caller data exists.
#include <node_api.h>
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <Security/SecCode.h>
#include <Security/SecStaticCode.h>
#include <Security/SecRequirement.h>
#include <Security/SecKeychainSearch.h>
#include <Security/SecTrustedApplication.h>
#include <Security/SecACL.h>
#include <dlfcn.h>
#include <libproc.h>
#include <limits.h>
#include <unistd.h>

#include <cmath>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

#include "policy.h"
#include "signing_config.h"
#include "partition_policy.h"

namespace {
using namespace tabby_keychain;

// Confirmed from the upstream release-9-5-4 codesign-requirement.txt. Require
// the current Developer ID chain; deliberately exclude the deprecated root.
constexpr const char* kCyberduckRequirement =
    "anchor apple generic and identifier \"ch.sudo.cyberduck\" and "
    "certificate 1[field.1.2.840.113635.100.6.2.6] exists and "
    "certificate leaf[field.1.2.840.113635.100.6.1.13] exists and "
    "certificate leaf[subject.OU] = \"G69SCX94XU\"";
constexpr UInt32 kCreator = 0x54627943; // TbyC, local ownership marker
constexpr UInt32 kRuntimeFlag = 0x10000; // CS_RUNTIME (hardened runtime)
std::mutex operationMutex;

template<typename T> class CF {
public:
    CF() = default;
    explicit CF(T value) : value_(value) {}
    ~CF() { if (value_) CFRelease(value_); }
    CF(const CF&) = delete;
    CF& operator=(const CF&) = delete;
    T get() const { return value_; }
    T* out() { return &value_; }
    T release() { T result = value_; value_ = nullptr; return result; }
private:
    T value_ = nullptr;
};

CFStringRef makeString(const std::string& input) {
    return CFStringCreateWithBytes(kCFAllocatorDefault,
        reinterpret_cast<const UInt8*>(input.data()), input.size(),
        kCFStringEncodingUTF8, false);
}

bool canonicalPath(const std::string& input, std::string& result) {
    if (input.empty() || input.front() != '/' || input.size() >= PATH_MAX ||
        input.find('\0') != std::string::npos) return false;
    char resolved[PATH_MAX];
    if (!realpath(input.c_str(), resolved)) return false;
    result = resolved;
    return true;
}

bool requirement(const std::string& source, CF<SecRequirementRef>& output) {
    CF<CFStringRef> text(makeString(source));
    return text.get() && SecRequirementCreateWithString(text.get(),
        kSecCSDefaultFlags, output.out()) == errSecSuccess;
}

std::string tabbyRequirement(bool includeRenderer) {
    const std::string ids = includeRenderer ?
        "(identifier \"org.tabby\" or identifier \"org.tabby.helper.Renderer\")" :
        "identifier \"org.tabby\"";
    return "anchor apple generic and " + ids +
        " and certificate 1[field.1.2.840.113635.100.6.2.6] exists"
        " and certificate leaf[field.1.2.840.113635.100.6.1.13] exists"
        " and certificate leaf[subject.OU] = \"" TABBY_KEYCHAIN_TEAM_ID "\"";
}

bool inspectCode(const std::string& path, SecRequirementRef expected,
                 CF<SecStaticCodeRef>& code, CF<CFDataRef>* digest = nullptr) {
    CF<CFURLRef> url(CFURLCreateFromFileSystemRepresentation(kCFAllocatorDefault,
        reinterpret_cast<const UInt8*>(path.data()), path.size(), true));
    if (!url.get() || SecStaticCodeCreateWithPath(url.get(), kSecCSDefaultFlags,
            code.out()) != errSecSuccess) return false;
    if (SecStaticCodeCheckValidity(code.get(), kSecCSStrictValidate |
            kSecCSCheckAllArchitectures | kSecCSCheckNestedCode,
            expected) != errSecSuccess) return false;
    if (digest) {
        CF<CFDictionaryRef> info;
        if (SecCodeCopySigningInformation(code.get(), kSecCSSigningInformation,
                info.out()) != errSecSuccess) return false;
        auto value = static_cast<CFDataRef>(CFDictionaryGetValue(info.get(), kSecCodeInfoUnique));
        if (!value || CFGetTypeID(value) != CFDataGetTypeID()) return false;
        *digest->out() = static_cast<CFDataRef>(CFRetain(value));
    }
    return true;
}

bool unsafeEntitlement(CFDictionaryRef info, CFStringRef name) {
    auto entitlements = static_cast<CFDictionaryRef>(
        CFDictionaryGetValue(info, kSecCodeInfoEntitlementsDict));
    if (!entitlements) return false;
    if (CFGetTypeID(entitlements) != CFDictionaryGetTypeID()) return true;
    auto value = CFDictionaryGetValue(entitlements, name);
    return value && !CFEqual(value, kCFBooleanFalse);
}

bool validateHost() {
    if (std::strlen(TABBY_KEYCHAIN_TEAM_ID) != 10) return false;
    CF<SecRequirementRef> hostRequirement;
    CF<SecCodeRef> self;
    if (!requirement(tabbyRequirement(true), hostRequirement) ||
        SecCodeCopySelf(kSecCSDefaultFlags, self.out()) != errSecSuccess ||
        SecCodeCheckValidity(self.get(), kSecCSStrictValidate,
            hostRequirement.get()) != errSecSuccess) return false;

    CF<CFDictionaryRef> info;
    if (SecCodeCopySigningInformation(reinterpret_cast<SecStaticCodeRef>(self.get()),
            kSecCSSigningInformation | kSecCSDynamicInformation, info.out()) != errSecSuccess)
        return false;
    auto flagsValue = static_cast<CFNumberRef>(CFDictionaryGetValue(info.get(), kSecCodeInfoFlags));
    UInt32 flags = 0;
    if (!flagsValue || CFGetTypeID(flagsValue) != CFNumberGetTypeID() ||
        !CFNumberGetValue(flagsValue, kCFNumberSInt32Type, &flags) || !(flags & kRuntimeFlag) ||
        unsafeEntitlement(info.get(), CFSTR("com.apple.security.get-task-allow")) ||
        unsafeEntitlement(info.get(), CFSTR("com.apple.security.cs.disable-library-validation")) ||
        unsafeEntitlement(info.get(), CFSTR("com.apple.security.cs.allow-dyld-environment-variables")))
        return false;

    // Neither a signed standalone Electron binary nor a renderer outside its
    // sealed Tabby bundle is sufficient. Also ensure this addon is the sealed
    // bundle resource, rather than a separately loaded native module.
    char executable[PROC_PIDPATHINFO_MAXSIZE];
    std::string selfPath;
    if (proc_pidpath(getpid(), executable, sizeof(executable)) <= 0 ||
        !canonicalPath(executable, selfPath)) return false;
    const auto boundary = selfPath.find(".app/Contents/");
    if (boundary == std::string::npos) return false;
    const std::string root = selfPath.substr(0, boundary + 4);
    Dl_info addonInfo {};
    std::string addonPath;
    if (!dladdr(reinterpret_cast<const void*>(&validateHost), &addonInfo) ||
        !addonInfo.dli_fname || !canonicalPath(addonInfo.dli_fname, addonPath) ||
        addonPath != root + "/Contents/Resources/cyberduck-keychain/cyberduck_keychain.node")
        return false;
    CF<SecRequirementRef> rootRequirement;
    CF<SecStaticCodeRef> rootCode;
    return requirement(tabbyRequirement(false), rootRequirement) &&
        inspectCode(root, rootRequirement.get(), rootCode);
}

bool validateCyberduck(const std::string& suppliedPath, std::string& path,
                       CF<CFDataRef>* digest = nullptr) {
    if (!canonicalPath(suppliedPath, path) || path.size() < 4 ||
        path.compare(path.size() - 4, 4, ".app") != 0) return false;
    CF<SecRequirementRef> expected;
    CF<SecStaticCodeRef> code;
    return requirement(kCyberduckRequirement, expected) &&
        inspectCode(path, expected.get(), code, digest);
}

const char* statusFor(OSStatus status) {
    switch (status) {
        case errSecUserCanceled:
        case errSecAuthFailed:
        case errSecInteractionNotAllowed: return "denied";
        case errSecNotAvailable:
        case errSecNoDefaultKeychain: return "unavailable";
        case errSecItemNotFound: return "not-found";
        case errSecDuplicateItem: return "conflict";
        case errSecParam: return "invalid";
        default: return "failed";
    }
}

bool readString(napi_env env, napi_value value, std::size_t maximum, std::string& out) {
    napi_valuetype type;
    std::size_t length = 0;
    if (napi_typeof(env, value, &type) != napi_ok || type != napi_string ||
        napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok ||
        length == 0 || length > maximum) return false;
    std::vector<char> bytes(length + 1);
    std::size_t written = 0;
    if (napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &written) != napi_ok ||
        written != length) return false;
    out.assign(bytes.data(), length);
    return out.find('\0') == std::string::npos;
}

struct Tuple {
    std::string host, account, owner;
    // Attribute APIs use UInt32, although FindInternetPassword takes UInt16.
    UInt32 port = 0;
    SecProtocolType protocol = kSecProtocolTypeSSH;
    SecAuthenticationType authentication = kSecAuthenticationTypeDefault;
    std::vector<SecKeychainAttribute> attributes;

    bool parse(napi_env env, napi_value* args, napi_value ownerValue) {
        double portValue;
        if (!readString(env, args[0], kMaxHostBytes, host) ||
            napi_get_value_double(env, args[1], &portValue) != napi_ok ||
            !std::isfinite(portValue) || portValue != std::floor(portValue) ||
            portValue < 1 || portValue > 65535 ||
            !readString(env, args[2], kMaxAccountBytes, account) ||
            !readString(env, ownerValue, kMaxOwnerBytes, owner)) return false;
        port = static_cast<UInt32>(portValue);
        if (!validTuple(host, port, account, owner)) return false;
        attributes = {
            {kSecServerItemAttr, static_cast<UInt32>(host.size()), host.data()},
            {kSecAccountItemAttr, static_cast<UInt32>(account.size()), account.data()},
            {kSecPortItemAttr, sizeof(port), &port},
            {kSecProtocolItemAttr, sizeof(protocol), &protocol},
            {kSecAuthenticationTypeItemAttr, sizeof(authentication), &authentication},
        };
        return true;
    }
};

// Search metadata only. Omit path/domain just as Cyberduck's lookup does; even
// a matching entry with a nonempty path/domain is a conflict, never overwritten.
const char* findOwned(Tuple& tuple, CF<SecKeychainItemRef>& item) {
    SecKeychainAttributeList query {static_cast<UInt32>(tuple.attributes.size()), tuple.attributes.data()};
    CF<SecKeychainSearchRef> search;
    OSStatus status = SecKeychainSearchCreateFromAttributes(nullptr,
        kSecInternetPasswordItemClass, &query, search.out());
    if (status != errSecSuccess) return statusFor(status);
    status = SecKeychainSearchCopyNext(search.get(), item.out());
    if (status != errSecSuccess) return statusFor(status);
    CF<SecKeychainItemRef> second;
    status = SecKeychainSearchCopyNext(search.get(), second.out());
    if (status == errSecSuccess) return "conflict";
    if (status != errSecItemNotFound) return statusFor(status);

    SecKeychainAttribute attributes[] = {
        {kSecCommentItemAttr, 0, nullptr}, {kSecCreatorItemAttr, 0, nullptr},
        {kSecPathItemAttr, 0, nullptr}, {kSecSecurityDomainItemAttr, 0, nullptr},
    };
    SecKeychainAttributeList requested {4, attributes};
    // Passing null for length/outData is important: never retrieve a secret.
    status = SecKeychainItemCopyContent(item.get(), nullptr, &requested, nullptr, nullptr);
    if (status == errSecNoSuchAttr) return "conflict";
    if (status != errSecSuccess) return statusFor(status);
    std::string marker;
    if (attributes[0].data && attributes[0].length <= kMaxOwnerBytes + std::strlen(kOwnerPrefix))
        marker.assign(static_cast<const char*>(attributes[0].data), attributes[0].length);
    const bool creatorMatches = attributes[1].length == sizeof(kCreator) &&
        attributes[1].data && std::memcmp(attributes[1].data, &kCreator, sizeof(kCreator)) == 0;
    const bool emptyScope = attributes[2].length == 0 && attributes[3].length == 0;
    SecKeychainItemFreeContent(&requested, nullptr);
    return emptyScope && isOwned(marker, tuple.owner, creatorMatches) ? "owned" : "conflict";
}

const char* unlocked(SecKeychainRef keychain) {
    SecKeychainStatus state = 0;
    const OSStatus status = SecKeychainGetStatus(keychain, &state);
    if (status != errSecSuccess) return statusFor(status);
    return (state & kSecUnlockStateStatus) ? nullptr : "denied";
}

const char* makeAccess(const std::string& path, CF<SecAccessRef>& access,
                       SecKeychainItemRef existing = nullptr) {
    CF<CFDataRef> before;
    std::string canonical;
    if (!validateCyberduck(path, canonical, &before)) return "denied";
    CF<SecTrustedApplicationRef> host, cyberduck;
    OSStatus status = SecTrustedApplicationCreateFromPath(nullptr, host.out());
    if (status != errSecSuccess) return statusFor(status);
    status = SecTrustedApplicationCreateFromPath(canonical.c_str(), cyberduck.out());
    if (status != errSecSuccess) return statusFor(status);
    const void* apps[] = {host.get(), cyberduck.get()};
    CF<CFArrayRef> trusted(CFArrayCreate(kCFAllocatorDefault, apps, 2, &kCFTypeArrayCallBacks));
    if (!trusted.get()) return "failed";
    // Application grants stay exactly these two apps. Partition metadata is a
    // separate, additional check; it never replaces these narrow app ACLs.
    status = existing ? SecKeychainItemCopyAccess(existing, access.out()) :
        SecAccessCreate(CFSTR("Tabby password shared with Cyberduck"), trusted.get(), access.out());
    if (status != errSecSuccess) return statusFor(status);
    // SecAccessCreate's system default also includes an all-app ENCRYPT ACL.
    // Restrict every simple ACL, including ancillary rights, before creation.
    // The owner/change-ACL right belongs only to this signed Tabby process.
    CF<CFArrayRef> hostOnly(CFArrayCreate(kCFAllocatorDefault, apps, 1, &kCFTypeArrayCallBacks));
    CF<CFArrayRef> acls;
    if (!hostOnly.get()) return "failed";
    status = SecAccessCopyACLList(access.get(), acls.out());
    if (status != errSecSuccess) return statusFor(status);
    if (!acls.get() || CFArrayGetCount(acls.get()) == 0) return "failed";
    unsigned partitions = 0, owners = 0;
    bool decrypt = false;
    for (CFIndex i = 0; i < CFArrayGetCount(acls.get()); ++i) {
        auto acl = static_cast<SecACLRef>(const_cast<void*>(CFArrayGetValueAtIndex(acls.get(), i)));
        CF<CFArrayRef> applications;
        CF<CFStringRef> description;
        SecKeychainPromptSelector prompt = 0;
        status = SecACLCopyContents(acl, applications.out(), description.out(), &prompt);
        if (status != errSecSuccess) return statusFor(status);
        CF<CFArrayRef> authorizations(SecACLCopyAuthorizations(acl));
        if (!authorizations.get() || !description.get()) return "failed";
        const auto range = CFRangeMake(0, CFArrayGetCount(authorizations.get()));
        if (CFArrayContainsValue(authorizations.get(), range, kSecACLAuthorizationPartitionID)) {
            if (++partitions != 1) return "failed";
            status = partition::configure(acl);
            if (status != errSecSuccess) return statusFor(status);
            continue;
        }
        if (CFArrayContainsValue(authorizations.get(), range, kSecACLAuthorizationIntegrity)) {
            if (CFArrayGetCount(authorizations.get()) != 1 || applications.get()) return "failed";
            continue; // Preserve system integrity metadata, never add app grants.
        }
        const bool owner = CFArrayContainsValue(authorizations.get(),
            CFRangeMake(0, CFArrayGetCount(authorizations.get())), kSecACLAuthorizationChangeACL);
        if (owner) ++owners;
        if (CFArrayContainsValue(authorizations.get(), range, kSecACLAuthorizationDecrypt)) decrypt = true;
        status = SecACLSetContents(acl, owner ? hostOnly.get() : trusted.get(),
            description.get(), prompt);
        if (status != errSecSuccess) return statusFor(status);
        CF<CFArrayRef> checkedApplications;
        CF<CFStringRef> checkedDescription;
        SecKeychainPromptSelector checkedPrompt = 0;
        status = SecACLCopyContents(acl, checkedApplications.out(),
            checkedDescription.out(), &checkedPrompt);
        if (status != errSecSuccess) return statusFor(status);
        CF<CFArrayRef> checkedAuthorizations(SecACLCopyAuthorizations(acl));
        if (!checkedApplications.get() || !checkedAuthorizations.get() ||
            !CFEqual(checkedApplications.get(), owner ? hostOnly.get() : trusted.get()) ||
            !CFEqual(checkedAuthorizations.get(), authorizations.get()) ||
            checkedPrompt != prompt) return "failed";
    }
    if (owners != 1 || !decrypt || (existing && partitions != 1)) return "failed";
    CF<CFDataRef> after;
    std::string again;
    if (!validateCyberduck(canonical, again, &after) || again != canonical ||
        !CFEqual(before.get(), after.get())) return "denied";
    return nullptr;
}

// Public CopyData exposes app paths, not serialized designated requirements.
// Exact trusted references are constructed from validated code and set/read
// back in makeAccess; this persisted check is an additional path/count check.
bool sameTrustedAppPaths(CFArrayRef actual, CFArrayRef expected) {
    if (!actual || CFArrayGetCount(actual) != CFArrayGetCount(expected)) return false;
    std::vector<bool> used(CFArrayGetCount(expected), false);
    for (CFIndex n = 0; n < CFArrayGetCount(actual); ++n) {
        CF<CFDataRef> value;
        if (SecTrustedApplicationCopyData(static_cast<SecTrustedApplicationRef>(
                const_cast<void*>(CFArrayGetValueAtIndex(actual, n))), value.out()) != errSecSuccess) return false;
        bool found = false;
        for (CFIndex m = 0; m < CFArrayGetCount(expected); ++m) {
            if (used[m]) continue;
            CF<CFDataRef> wanted;
            if (SecTrustedApplicationCopyData(static_cast<SecTrustedApplicationRef>(
                    const_cast<void*>(CFArrayGetValueAtIndex(expected, m))), wanted.out()) != errSecSuccess) return false;
            if (CFEqual(value.get(), wanted.get()) && CFDataGetLength(wanted.get()) > 1 &&
                CFDataGetBytePtr(wanted.get())[CFDataGetLength(wanted.get()) - 1] == 0) {
                used[m] = true;
                found = true;
                break;
            }
        }
        if (!found) return false;
    }
    return true;
}

const char* verifyStoredAccess(SecKeychainItemRef item, const std::string& path) {
    std::string canonical;
    if (!validateCyberduck(path, canonical)) return "denied";
    CF<SecTrustedApplicationRef> host, duck;
    OSStatus status = SecTrustedApplicationCreateFromPath(nullptr, host.out());
    if (status == errSecSuccess) status = SecTrustedApplicationCreateFromPath(canonical.c_str(), duck.out());
    if (status != errSecSuccess) return statusFor(status);
    const void* apps[] = {host.get(), duck.get()};
    CF<CFArrayRef> trusted(CFArrayCreate(nullptr, apps, 2, &kCFTypeArrayCallBacks));
    CF<CFArrayRef> hostOnly(CFArrayCreate(nullptr, apps, 1, &kCFTypeArrayCallBacks));
    if (!trusted.get() || !hostOnly.get()) return "failed";
    CF<SecAccessRef> access;
    CF<CFArrayRef> acls;
    status = SecKeychainItemCopyAccess(item, access.out());
    if (status == errSecSuccess) status = SecAccessCopyACLList(access.get(), acls.out());
    if (status != errSecSuccess) return statusFor(status);
    if (!acls.get() || !CFArrayGetCount(acls.get())) return "failed";
    unsigned partitions = 0, owners = 0;
    bool decrypt = false;
    for (CFIndex n = 0; n < CFArrayGetCount(acls.get()); ++n) {
        auto acl = static_cast<SecACLRef>(const_cast<void*>(CFArrayGetValueAtIndex(acls.get(), n)));
        CF<CFArrayRef> applications;
        CF<CFStringRef> description;
        SecKeychainPromptSelector prompt = 0;
        status = SecACLCopyContents(acl, applications.out(), description.out(), &prompt);
        if (status != errSecSuccess) return statusFor(status);
        CF<CFArrayRef> rights(SecACLCopyAuthorizations(acl));
        if (!rights.get() || !CFArrayGetCount(rights.get())) return "failed";
        auto range = CFRangeMake(0, CFArrayGetCount(rights.get()));
        if (CFArrayContainsValue(rights.get(), range, kSecACLAuthorizationPartitionID)) {
            if (++partitions != 1 || applications.get() || CFArrayGetCount(rights.get()) != 1 ||
                !partition::allowed(description.get(), true)) return "failed";
        } else if (CFArrayContainsValue(rights.get(), range, kSecACLAuthorizationIntegrity)) {
            if (applications.get() || CFArrayGetCount(rights.get()) != 1) return "failed";
        } else {
            bool owner = CFArrayContainsValue(rights.get(), range, kSecACLAuthorizationChangeACL);
            if (owner) ++owners;
            if (CFArrayContainsValue(rights.get(), range, kSecACLAuthorizationDecrypt)) decrypt = true;
            if (!sameTrustedAppPaths(applications.get(), owner ? hostOnly.get() : trusted.get())) return "failed";
        }
    }
    return partitions == 1 && owners == 1 && decrypt ? nullptr : "failed";
}

const char* writePassword(Tuple& tuple, const std::string& path, const void* password,
                          std::size_t passwordSize) {
    if (std::strlen(TABBY_KEYCHAIN_TEAM_ID) != 10) return "unavailable";
    if (!validateHost()) return "denied";
    std::string canonical;
    if (!validateCyberduck(path, canonical)) return "denied";
    CF<SecKeychainItemRef> item;
    const char* found = findOwned(tuple, item);
    if (!std::strcmp(found, "owned")) {
        CF<SecKeychainRef> keychain;
        OSStatus status = SecKeychainItemCopyKeychain(item.get(), keychain.out());
        if (status != errSecSuccess) return statusFor(status);
        if (const char* error = unlocked(keychain.get())) return error;
        CF<SecAccessRef> access;
        if (const char* error = makeAccess(path, access, item.get())) return error;
        // Restrict access BEFORE replacing the secret, never after.
        status = SecKeychainItemSetAccess(item.get(), access.get());
        if (status != errSecSuccess) return statusFor(status);
        if (const char* error = verifyStoredAccess(item.get(), path)) return error;
        status = SecKeychainItemModifyAttributesAndData(item.get(), nullptr,
            static_cast<UInt32>(passwordSize), password);
        return status == errSecSuccess ? "stored" : statusFor(status);
    }
    if (std::strcmp(found, "not-found")) return found;

    CF<SecKeychainRef> keychain;
    OSStatus status = SecKeychainCopyDefault(keychain.out());
    if (status != errSecSuccess) return statusFor(status);
    if (const char* error = unlocked(keychain.get())) return error;
    CF<SecAccessRef> access;
    if (const char* error = makeAccess(path, access)) return error;
    std::string marker = ownerMarker(tuple.owner);
    const char* label = "Tabby shared SFTP password";
    UInt32 creator = kCreator;
    auto attributes = tuple.attributes;
    attributes.insert(attributes.end(), {
        {kSecPathItemAttr, 0, const_cast<char*>("")},
        {kSecSecurityDomainItemAttr, 0, const_cast<char*>("")},
        {kSecCommentItemAttr, static_cast<UInt32>(marker.size()), marker.data()},
        {kSecCreatorItemAttr, sizeof(creator), &creator},
        {kSecLabelItemAttr, static_cast<UInt32>(std::strlen(label)), const_cast<char*>(label)},
    });
    SecKeychainAttributeList list {static_cast<UInt32>(attributes.size()), attributes.data()};
    // Password + narrow ACL are installed in ONE Security.framework operation.
    // A duplicate appearing after our search is a conflict, not an update.
    status = SecKeychainItemCreateFromContent(kSecInternetPasswordItemClass, &list,
        static_cast<UInt32>(passwordSize), password, keychain.get(), access.get(), item.out());
    if (status != errSecSuccess) return statusFor(status);
    // The initial create is already app-restricted and partitioned to Tabby.
    // Add the verified receiver's partition only on this new exact item ref.
    CF<SecAccessRef> completed;
    const char* error = makeAccess(path, completed, item.get());
    if (!error) {
        status = SecKeychainItemSetAccess(item.get(), completed.get());
        error = status == errSecSuccess ? verifyStoredAccess(item.get(), path) : statusFor(status);
    }
    if (error) {
        // Never report stored with incomplete receiver permissions. Remove only
        // the item just created here; a cleanup denial remains a failed write.
        status = SecKeychainItemDelete(item.get());
        return status == errSecSuccess ? error : "failed";
    }
    return "stored";
}

const char* revokePassword(Tuple& tuple) {
    if (std::strlen(TABBY_KEYCHAIN_TEAM_ID) != 10) return "unavailable";
    if (!validateHost()) return "denied";
    CF<SecKeychainItemRef> item;
    const char* found = findOwned(tuple, item);
    if (std::strcmp(found, "owned")) return found;
    const OSStatus status = SecKeychainItemDelete(item.get());
    return status == errSecSuccess ? "revoked" : statusFor(status);
}

napi_value result(napi_env env, const char* status) {
    napi_value value;
    if (napi_create_string_utf8(env, status, NAPI_AUTO_LENGTH, &value) != napi_ok) return nullptr;
    return value;
}

napi_value Write(napi_env env, napi_callback_info info) {
    std::size_t count = 6;
    napi_value args[6];
    if (napi_get_cb_info(env, info, &count, args, nullptr, nullptr) != napi_ok || count != 6)
        return result(env, "invalid");
    bool isBuffer = false;
    void* password = nullptr;
    std::size_t size = 0;
    if (napi_is_buffer(env, args[3], &isBuffer) != napi_ok || !isBuffer ||
        napi_get_buffer_info(env, args[3], &password, &size) != napi_ok)
        return result(env, "invalid");
    EraseOnExit wipe(password, size);
    try {
        Tuple tuple;
        std::string path;
        if (size > kMaxPasswordBytes || !tuple.parse(env, args, args[5]) ||
            !readString(env, args[4], PATH_MAX - 1, path)) return result(env, "invalid");
        std::lock_guard<std::mutex> lock(operationMutex);
        return result(env, writePassword(tuple, path, password, size));
    } catch (...) { return result(env, "failed"); }
}

napi_value Revoke(napi_env env, napi_callback_info info) {
    try {
        std::size_t count = 4;
        napi_value args[4];
        Tuple tuple;
        if (napi_get_cb_info(env, info, &count, args, nullptr, nullptr) != napi_ok || count != 4 ||
            !tuple.parse(env, args, args[3])) return result(env, "invalid");
        std::lock_guard<std::mutex> lock(operationMutex);
        return result(env, revokePassword(tuple));
    } catch (...) { return result(env, "failed"); }
}

napi_value ValidateTarget(napi_env env, napi_callback_info info) {
    bool valid = false;
    try {
        std::size_t count = 1;
        napi_value arg;
        std::string path, canonical;
        if (napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr) == napi_ok && count == 1 &&
            readString(env, arg, PATH_MAX - 1, path)) {
            std::lock_guard<std::mutex> lock(operationMutex);
            valid = validateHost() && validateCyberduck(path, canonical);
        }
    } catch (...) { /* Fail closed without exposing native error details. */ }
    napi_value value;
    if (napi_get_boolean(env, valid, &value) != napi_ok) return nullptr;
    return value;
}

napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        {"write", nullptr, Write, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"revoke", nullptr, Revoke, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"validateTarget", nullptr, ValidateTarget, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    if (napi_define_properties(env, exports, 3, properties) != napi_ok) return nullptr;
    return exports;
}
} // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
