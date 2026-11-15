import "dotenv/config";
import session from "express-session";
import { RedisStore } from "connect-redis";
import redis from "./redis.js";

// connect-redis v10 expects node-redis v5+ method signatures adapt the shared ioredis client.
const redisStoreClient = {
    async get(key) {
        return await redis.get(key);
    },

    async set(key, value, options) {
        if (options && options.expiration && options.expiration.value) {
            const ttlInSeconds = options.expiration.value;
            return await redis.set(key, value, "EX", ttlInSeconds);
        }

        return await redis.set(key, value);
    },

    async expire(key, ttlInSeconds) {
        return await redis.expire(key, ttlInSeconds);
    },

    async del(keys) {
        if (Array.isArray(keys)) {
            if (keys.length === 0) {
                return 0;
            }
            return await redis.del(...keys);
        }

        return await redis.del(keys);
    },

    async mGet(keys) {
        return await redis.mget(keys);
    },

    async *scanIterator(options) {
        let cursor = "0";

        do {
            const result = await redis.scan(
                cursor,
                "MATCH",
                options.MATCH,
                "COUNT",
                options.COUNT
            );
            cursor = result[0];
            const keys = result[1];

            if (keys.length > 0) {
                yield keys;
            }
        } while (cursor !== "0");
    },
};

const sessionMiddleware = session({
    store: new RedisStore({
        client: redisStoreClient,
        prefix: "stayora:sess:",
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production", // set secure to true in production
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days validity for the session cookie
    },
});

export default sessionMiddleware;