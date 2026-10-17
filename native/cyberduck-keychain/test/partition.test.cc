#define TABBY_KEYCHAIN_TEAM_ID "37BL9CNF8B"
#include "../src/partition_policy.h"
#include <Security/cssmapple.h>
#include <cassert>
#include <cstring>
#include <iostream>
using namespace tabby_keychain::partition;

CFStringRef description(const std::string& entries, const std::string& extra = "") {
    std::string xml = "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>Partitions</key><array>" + entries + "</array>" + extra + "</dict></plist>";
    Ref<CFDataRef> data(CFDataCreate(nullptr, reinterpret_cast<const UInt8*>(xml.data()), xml.size()));
    return encode(data.get());
}
const std::string host = "<string>teamid:37BL9CNF8B</string>";
const std::string duck = "<string>teamid:G69SCX94XU</string>";
int main() {
    Ref<CFStringRef> desired(desiredDescription());
    assert(allowed(desired.get(), true));
    Ref<CFStringRef> legacy(description(host));
    assert(allowed(legacy.get(), false));
    assert(!allowed(legacy.get(), true));
    for (const auto& entries : {host + host, duck, host + "<string>apple-tool:</string>", host + "<string>unsigned:</string>", host + "<string>teamid:OTHERTEAM1</string>", host + duck + "<string>apple:</string>"}) {
        Ref<CFStringRef> invalid(description(entries));
        assert(!allowed(invalid.get(), false));
    }
    Ref<CFStringRef> extra(description(host, "<key>Other</key><true/>"));
    assert(!allowed(extra.get(), false));
    assert(!allowed(CFSTR("not-hex"), false));
    assert(!allowed(CFSTR("abc"), false));
    assert(!allowed(CFSTR("00"), false));

    // Construct only an IN-MEMORY metadata subject through public APIs. This
    // executable imports no Keychain item API and never stores any credential.
    std::vector<UInt8> payload;
    assert(decode(legacy.get(), payload));
    CSSM_LIST_ELEMENT ownerType {}, partitionType {}, partitionData {};
    ownerType.ElementType = CSSM_LIST_ELEMENT_WORDID;
    ownerType.WordID = CSSM_ACL_SUBJECT_TYPE_ANY;
    CSSM_ACL_OWNER_PROTOTYPE owner {};
    owner.TypedSubject = {CSSM_LIST_TYPE_SEXPR, &ownerType, &ownerType};
    partitionType.ElementType = CSSM_LIST_ELEMENT_WORDID;
    partitionType.WordID = CSSM_ACL_SUBJECT_TYPE_PARTITION;
    partitionType.NextElement = &partitionData;
    partitionData.ElementType = CSSM_LIST_ELEMENT_DATUM;
    partitionData.Element.Word.Length = payload.size();
    partitionData.Element.Word.Data = payload.data();
    CSSM_ACL_AUTHORIZATION_TAG authorization = CSSM_ACL_AUTHORIZATION_PARTITION_ID;
    CSSM_ACL_ENTRY_INFO entry {};
    entry.EntryHandle = 1;
    entry.EntryPublicInfo.TypedSubject = {CSSM_LIST_TYPE_SEXPR, &partitionType, &partitionData};
    entry.EntryPublicInfo.Authorization = {1, &authorization};
    std::strcpy(entry.EntryPublicInfo.EntryTag, CSSM_APPLE_ACL_TAG_PARTITION_ID);
    Ref<SecAccessRef> access;
    assert(SecAccessCreateFromOwnerAndACL(&owner, 1, &entry, access.out()) == errSecSuccess);
    Ref<CFArrayRef> list;
    assert(SecAccessCopyACLList(access.get(), list.out()) == errSecSuccess);
    unsigned tested = 0;
    for (CFIndex i = 0; i < CFArrayGetCount(list.get()); ++i) {
        auto acl = static_cast<SecACLRef>(const_cast<void*>(CFArrayGetValueAtIndex(list.get(), i)));
        Ref<CFArrayRef> rights(SecACLCopyAuthorizations(acl));
        if (!CFArrayContainsValue(rights.get(), CFRangeMake(0, CFArrayGetCount(rights.get())), kSecACLAuthorizationPartitionID)) continue;
        assert(configure(acl) == errSecSuccess);
        assert(configure(acl) == errSecSuccess); // Idempotent readback.
        Ref<CFArrayRef> apps;
        Ref<CFStringRef> output;
        SecKeychainPromptSelector prompt = 0;
        assert(SecACLCopyContents(acl, apps.out(), output.out(), &prompt) == errSecSuccess);
        assert(!apps.get() && allowed(output.get(), true));
        ++tested;
    }
    assert(tested == 1);
    std::cout << "Partition metadata policy and in-memory public API tests passed; no Keychain items accessed\n";
}
