// Redis helper functions for:
// 1. Safe rate limiting (always guarantees an expiry time so users never get permanently locked)
// 2. Fast O(1) listings cache invalidation (replaces slow `redis.keys("listingsBy*")`)

import redis from "../config/redis.js";

// Small Redis script that runs INCR + EXPIRE together in one atomic step.
// Why? If the server crashed between redis.incr() and redis.expire(), the key would stay forever!
const ATOMIC_INCR_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
    redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
else
    local ttl = redis.call("TTL", KEYS[1])
    if ttl == -1 then
        redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
    end
end
return count
`;

// Increase a rate-limit counter in Redis and guarantee it expires after ttlSeconds
export async function atomicIncrWithExpiry(key, ttlSeconds) {
    const count = await redis.eval(ATOMIC_INCR_SCRIPT, 1, key, String(ttlSeconds));
    return Number(count);
}

// Instead of scanning and deleting thousands of `listingsBy*` keys using slow redis.keys(),
// we store a single version number (e.g. "1", "2", "3").
// Every listings cache key includes this version (e.g. `listings:v2:goa:...`).
// When any listing changes, we just do `INCR stayora:listings:version` (2 -> 3) in O(1) time!
const LISTINGS_VERSION_KEY = "stayora:listings:version";

export async function getListingsCacheVersion() {
    try {
        const version = await redis.get(LISTINGS_VERSION_KEY);
        if (version) {
            return version;
        }
        return "1";
    } catch (err) {
        return "1";
    }
}

// Clear all cached /listings, /categories, and /destinations pages instantly in O(1) time
export async function invalidateListingsListCache() {
    try {
        await redis.incr(LISTINGS_VERSION_KEY);
        await redis.del("categories:all", "destinations:popular");
    } catch (err) {
        console.error("Cache invalidation error:", err.message);
    }
}

// Clear one property's detail cache + all /listings, /categories & /destinations caches
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
