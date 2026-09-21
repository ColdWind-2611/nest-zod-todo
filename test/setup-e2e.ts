import 'dotenv/config';
import 'reflect-metadata';

const testUrl = process.env.DATABASE_URL_TEST;
if (!testUrl) {
  throw new Error('DATABASE_URL_TEST 未设置，检查 .env');
}
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
