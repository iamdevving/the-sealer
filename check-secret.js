require('dotenv').config({ path: '.env.local' });

const secret = process.env.CDP_API_KEY_SECRET;

if (!secret) {
  console.log('CDP_API_KEY_SECRET is not set or empty');
  process.exit(1);
}

console.log('Raw secret chars:', secret.length);

try {
  const decoded = Buffer.from(secret, 'base64');
  console.log('Decoded bytes:', decoded.length);
  if (decoded.length === 64) {
    console.log('GOOD: 64 bytes - ready for Ed25519');
  } else {
    console.log('BAD: Not 64 bytes');
  }
  console.log('First 10 hex:', decoded.slice(0, 10).toString('hex'));
} catch (err) {
  console.error('Decode error:', err.message);
}