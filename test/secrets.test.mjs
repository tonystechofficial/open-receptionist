import test from 'node:test';
import assert from 'node:assert/strict';
import { safeEqual } from '../src/server/secrets.mjs';

test('only the exact secret matches, and a missing value never does', () => {
  assert.equal(safeEqual('s3cret', 's3cret'), true);
  assert.equal(safeEqual('s3creT', 's3cret'), false);
  assert.equal(safeEqual('s3cre', 's3cret'), false);
  assert.equal(safeEqual(null, 's3cret'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual('x', undefined), false);
});
