import {describe, expect, it} from 'vitest';
import {PACKAGE_NAME} from './index.js';

describe('package entry point', () => {
  it('exposes the package name constant', () => {
    expect(PACKAGE_NAME).toBe('@richardmcquiston01/house-number-generator');
  });
});
