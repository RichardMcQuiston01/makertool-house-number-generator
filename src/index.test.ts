import {describe, expect, it} from 'vitest';
import {validateSignConfig} from './index.js';

describe('package entry point', () => {
  it('exposes validateSignConfig', () => {
    expect(typeof validateSignConfig).toBe('function');
  });
});
