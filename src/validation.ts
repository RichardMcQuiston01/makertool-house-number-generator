import type {
  AssemblyConfig,
  Result,
  ScrewSize,
  SignConfig,
  ValidationError,
} from './types.js';

const HOUSE_NUMBER_PATTERN = /^[0-9]+$/;
const VALID_SCREW_SIZES: ReadonlySet<ScrewSize> = new Set([
  'M3',
  'M4',
  'M5',
  '#4-40',
  '#6-32',
  '#8-32',
  '#10-24',
  '1/4-20',
]);

/**
 * Validates a {@link SignConfig}, returning either the validated config or the
 * full list of field-level problems found. Every field is checked so a caller
 * can surface all problems at once instead of one at a time.
 */
export function validateSignConfig(
  config: SignConfig,
): Result<SignConfig, ValidationError[]> {
  const errors: ValidationError[] = [];

  if (!HOUSE_NUMBER_PATTERN.test(config.houseNumber)) {
    errors.push({
      field: 'houseNumber',
      message:
        'House number must contain only digits (0-9) and cannot be empty.',
    });
  }

  if (config.style === 'nameAndNumbers') {
    if (!config.name || config.name.trim().length === 0) {
      errors.push({
        field: 'name',
        message:
          'Name is required when style is "nameAndNumbers" and cannot be blank.',
      });
    }
    if (!config.font.nameFont || config.font.nameFont.trim().length === 0) {
      errors.push({
        field: 'font.nameFont',
        message: 'A name font must be selected when style is "nameAndNumbers".',
      });
    }
  }

  if (!config.font.numberFont || config.font.numberFont.trim().length === 0) {
    errors.push({
      field: 'font.numberFont',
      message: 'A number font must be selected.',
    });
  }

  if (!Number.isFinite(config.margin) || config.margin <= 0) {
    errors.push({
      field: 'margin',
      message: 'Margin must be a positive, finite number.',
    });
  }

  const assemblyError = validateAssembly(config.assembly);
  if (assemblyError) {
    errors.push(assemblyError);
  }

  return errors.length > 0
    ? {ok: false, error: errors}
    : {ok: true, value: config};
}

function validateAssembly(
  assembly: AssemblyConfig,
): ValidationError | undefined {
  if (assembly.type !== 'hardware') {
    return undefined;
  }
  if (!VALID_SCREW_SIZES.has(assembly.screwSize)) {
    return {
      field: 'assembly.screwSize',
      message: `Screw size "${assembly.screwSize}" is not a supported size. Supported sizes: ${[...VALID_SCREW_SIZES].join(', ')}.`,
    };
  }
  return undefined;
}
