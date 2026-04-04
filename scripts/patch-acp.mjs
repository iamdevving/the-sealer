import { Redis } from '@upstash/redis';
import { config } from 'dotenv';
config({ path: '.env.local' });

const redis = new Redis({ 
  url: process.env.KV_REST_API_URL, 
  token: process.env.KV_REST_API_TOKEN 
});

const uid = '0xcbe6c4247e068d80adbc688a1b082001deb3c0fe3dc383d438964e22470e410a';
const key = `achievement:pending:${uid}`;

const data = await redis.get(key);
console.log('CURRENT:', JSON.stringify(data, null, 2));

const updated = { ...data, acpContractAddress: '0xfc31B7a8Aa6b3Dd746fFff043CA6dF9410864Fa2' };
await redis.set(key, updated);
console.log('DONE — acpContractAddress patched');