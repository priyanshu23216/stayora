import "dotenv/config";
import Redis from "ioredis";

export const redis = new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    maxRetriesPerRequest: 3,
});

redis.on("connect", () => {
    console.log("Connected to Redis successfully!");
});

redis.on("error", (err) => {
    console.error("Redis connection error:", err.message);
});

export default redis;
