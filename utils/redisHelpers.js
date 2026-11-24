import redis from "../config/redis.js";

// Atomic INCR + EXPIRE via Lua script so a crash between commands can never cause a permanent lock
const ATOMIC_INCR_EXPIRE_LUA = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
    redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
else
    local ttl = redis.call("TTL", KEYS[1])
    if ttl == -1 then
        redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
    end
end
return current
`;

export async function atomicIncrWithExpiry(key, ttlSeconds) {
    const count = await redis.eval(ATOMIC_INCR_EXPIRE_LUA, 1, key, String(ttlSeconds));
    return Number(count);
}

const LISTINGS_VERSION_KEY = "stayora:listings:version";

// O(1) cache versioning replaces blocking O(N) `redis.keys("listingsBy*")`
export async function getListingsCacheVersion() {
    try {
        const version = await redis.get(LISTINGS_VERSION_KEY);
        return version || "1";
    } catch {
        return "1";
    }
}

export async function invalidateListingsListCache() {
    try {
        await redis.incr(LISTINGS_VERSION_KEY);
        await redis.del("categories:all");
    } catch (err) {
        console.error("Cache invalidation error:", err.message);
    }
}

export async function invalidatePropertyCache(propertyId) {
    try {
        if (propertyId) {
            await redis.del(`property:${propertyId}`);
        }
        await invalidateListingsListCache();
    } catch (err) {
        console.error("Property cache invalidation error:", err.message);
    }
}
