#pragma once

#include <cstddef>
#include <string>

namespace tabby_keychain {

constexpr std::size_t kMaxHostBytes = 253;
constexpr std::size_t kMaxAccountBytes = 1024;
constexpr std::size_t kMaxPasswordBytes = 65536;
constexpr std::size_t kMaxOwnerBytes = 1024;
constexpr const char* kOwnerPrefix = "org.tabby.cyberduck-keychain:v1:";

inline bool validText(const std::string& value, std::size_t maximum) {
    if (value.empty() || value.size() > maximum) return false;
    for (unsigned char c : value) {
        if (c < 0x20 || c == 0x7f) return false;
    }
    return true;
}

// Host is already canonicalized by the caller. Never normalize only the Keychain
// side: the bytes here must also be used in the Cyberduck launch URL.
inline bool validHost(const std::string& host) {
    if (!validText(host, kMaxHostBytes)) return false;
    for (unsigned char c : host) {
        if (c > 0x7e || c == ' ' || c == '/' || c == '\\' || c == '@' ||
            c == '?' || c == '#' || c == '[' || c == ']') return false;
    }
    return true;
}

inline bool validOwner(const std::string& owner) {
    // Persist the complete stable custom-SSH profile ID. Profile names may be
    // part of this ID, so do not rewrite/case-fold it or require a bare UUID.
    const std::string prefix = "ssh:custom:";
    return validText(owner, kMaxOwnerBytes) && owner.size() > prefix.size() &&
        owner.compare(0, prefix.size(), prefix) == 0;
}

inline bool validTuple(const std::string& host, unsigned int port,
                       const std::string& account, const std::string& owner) {
    return validHost(host) && port >= 1 && port <= 65535 &&
        validText(account, kMaxAccountBytes) && validOwner(owner);
}

inline std::string ownerMarker(const std::string& owner) {
    return std::string(kOwnerPrefix) + owner;
}

inline bool isOwned(const std::string& marker, const std::string& owner,
                    bool creatorMatches) {
    return validOwner(owner) && creatorMatches && marker == ownerMarker(owner);
}

inline void erase(void* data, std::size_t size) noexcept {
    // Volatile stores cannot be optimized away. This wipes our input Buffer, not
    // any immutable JavaScript string from which the caller originally made it.
    volatile unsigned char* bytes = static_cast<volatile unsigned char*>(data);
    while (size--) *bytes++ = 0;
}

class EraseOnExit {
public:
    EraseOnExit(void* data, std::size_t size) : data_(data), size_(size) {}
    ~EraseOnExit() { if (data_) erase(data_, size_); }
    EraseOnExit(const EraseOnExit&) = delete;
    EraseOnExit& operator=(const EraseOnExit&) = delete;
private:
    void* data_;
    std::size_t size_;
};

} // namespace tabby_keychain
