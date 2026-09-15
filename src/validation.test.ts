import {describe, expect, it} from 'vitest';
import type {SignConfig} from './types.js';
import {validateSignConfig} from './validation.js';

function baseConfig(overrides: Partial<SignConfig> = {}): SignConfig {
  return {
    style: 'numbersOnly',
    houseNumber: '1234',
    font: {numberFont: 'roboto-mono'},
    shape: 'rectangle',
    margin: 0.5,
    unit: 'in',
    assembly: {type: 'adhesive'},
    ...overrides,
  };
}

describe('validateSignConfig', () => {
  it('accepts a valid numbers-only config', () => {
    const result = validateSignConfig(baseConfig());
    expect(result.ok).toBe(true);
  });

  it('accepts a valid name-and-numbers config with hardware assembly', () => {
    const result = validateSignConfig(
      baseConfig({
        style: 'nameAndNumbers',
        name: 'Smith',
        font: {numberFont: 'roboto-mono', nameFont: 'roboto'},
        assembly: {type: 'hardware', screwSize: 'M3'},
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a house number containing non-digit characters', () => {
    const result = validateSignConfig(baseConfig({houseNumber: '12B4'}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContainEqual(
        expect.objectContaining({field: 'houseNumber'}),
      );
    }
  });

  it('rejects an empty house number', () => {
    const result = validateSignConfig(baseConfig({houseNumber: ''}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContainEqual(
        expect.objectContaining({field: 'houseNumber'}),
      );
    }
  });

  it('requires a name and name font when style is nameAndNumbers', () => {
    const result = validateSignConfig(baseConfig({style: 'nameAndNumbers'}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.error.map(e => e.field);
      expect(fields).toContain('name');
      expect(fields).toContain('font.nameFont');
    }
  });

  it('rejects a non-positive margin', () => {
    const result = validateSignConfig(baseConfig({margin: 0}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContainEqual(
        expect.objectContaining({field: 'margin'}),
      );
    }
  });

  it('rejects an unsupported screw size', () => {
    const result = validateSignConfig(
      baseConfig({
        assembly: {type: 'hardware', screwSize: 'M99' as never},
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContainEqual(
        expect.objectContaining({field: 'assembly.screwSize'}),
      );
    }
  });

  it('reports every failing field at once', () => {
    const result = validateSignConfig(
      baseConfig({houseNumber: '', margin: -1}),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThanOrEqual(2);
    }
  });
});
