#include "../src/policy.h"
#include <cassert>
#include <cstring>
#include <iostream>

int main() {
    using namespace tabby_keychain;
    const std::string owner = "ssh:custom:sample:123e4567-e89b-42d3-a456-426614174000";
    const std::string other = "ssh:custom:sample:123e4567-e89b-42d3-a456-426614174001";
    assert(validTuple("host.example", 22, "user", owner));
    assert(validTuple("2001:db8::1", 65535, "user.name", owner));
    assert(validTuple("fe80::1%en0", 2222, "用户", owner));
    assert(!validTuple("", 22, "user", owner));
    assert(!validTuple("host", 0, "user", owner));
    assert(!validTuple("host", 65536, "user", owner));
    assert(!validTuple("host", 22, "", owner));
    assert(!validTuple("host", 22, std::string("a\0b", 3), owner));
    assert(!validTuple("host", 22, "user\n", owner));
    assert(!validTuple("host", 22, std::string(1025, 'u'), owner));
    assert(!validTuple(std::string(254, 'h'), 22, "user", owner));
    for (const char* host : {"sftp://host", "user@host", "a b", "a\\b", "a/b", "[::1]", "a#b", "a?b", "host\n"})
        assert(!validHost(host));
    assert(!validOwner(""));
    assert(!validOwner("123e4567-e89b-42d3-a456-426614174000"));
    assert(!validOwner("ssh:custom:"));
    assert(!validOwner("local:custom:sample"));
    assert(!validOwner("ssh:custom:name\n"));
    assert(!validOwner("ssh:custom:" + std::string(1024, 'x')));
    assert(validOwner("ssh:custom:unicode-用户:fixture"));
    const std::string longestOwner = "ssh:custom:" + std::string(1013, 'x');
    assert(validOwner(longestOwner));
    assert(isOwned(ownerMarker(longestOwner), longestOwner, true));
    assert(isOwned(ownerMarker(owner), owner, true));
    assert(!isOwned(ownerMarker(owner), owner, false));
    assert(!isOwned(ownerMarker(other), owner, true));
    assert(!isOwned("unrelated keychain comment", owner, true));
    assert(!isOwned(ownerMarker(owner) + "suffix", owner, true));

    unsigned char fakeSecret[] = {0x00, 0xff, 0x12, 0x34};
    {
        EraseOnExit wipe(fakeSecret, sizeof(fakeSecret));
    }
    for (auto byte : fakeSecret) assert(byte == 0);
    unsigned char exceptionSecret[] = {0xff, 0xa1};
    try {
        EraseOnExit wipe(exceptionSecret, sizeof(exceptionSecret));
        throw 1;
    } catch (...) {}
    for (auto byte : exceptionSecret) assert(byte == 0);
    {
        EraseOnExit empty(nullptr, 0);
    }
    std::cout << "Native policy tests passed (validation, ownership, zeroization).\n";
}
