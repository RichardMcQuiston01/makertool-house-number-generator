/** Unit of measurement used for all dimensions in a {@link SignConfig}. */
export type Unit = 'in' | 'mm';

/** Whether the sign includes only the house number, or a name plus the house number. */
export type SignStyle = 'numbersOnly' | 'nameAndNumbers';

/** Outer shape of the sign backer. */
export type SignShape = 'square' | 'rectangle' | 'round';

/** Common screw sizes supported for hardware assembly holes. */
export type ScrewSize =
  'M3' | 'M4' | 'M5' | '#4-40' | '#6-32' | '#8-32' | '#10-24' | '1/4-20';

/**
 * How the number(s)/name layer(s) attach to the sign backer.
 * `hardware` requires a {@link ScrewSize} so mounting holes can be generated.
 */
export type AssemblyConfig =
  | {readonly type: 'hardware'; readonly screwSize: ScrewSize}
  | {readonly type: 'adhesive'};

/** Font selection for the generated cut files. */
export interface FontConfig {
  /** Font identifier resolved against the font registry (added in a later stage). */
  readonly numberFont: string;
  /** Font identifier for the name layer. Required when {@link SignConfig.style} is `nameAndNumbers`. */
  readonly nameFont?: string;
}

/** Full description of a house number sign to generate cut files for. */
export interface SignConfig {
  readonly style: SignStyle;
  /** Digits of the house's street number, e.g. `"1234"`. */
  readonly houseNumber: string;
  /** Name to include on the sign. Required when {@link style} is `nameAndNumbers`. */
  readonly name?: string;
  readonly font: FontConfig;
  readonly shape: SignShape;
  /** Uniform margin applied to every edge of the sign backer, in {@link unit}. */
  readonly margin: number;
  readonly unit: Unit;
  readonly assembly: AssemblyConfig;
}

/** A single field-level validation failure, with a descriptive, user-facing message. */
export interface ValidationError {
  readonly field: string;
  readonly message: string;
}

/** Discriminated result returned by functions that can fail with descriptive errors. */
export type Result<T, E> =
  | {readonly ok: true; readonly value: T}
  | {readonly ok: false; readonly error: E};
