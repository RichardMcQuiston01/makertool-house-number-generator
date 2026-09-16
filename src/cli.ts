import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createFontRegistry} from './font.js';
import type {GenerateSignError, OutputFormat} from './generate.js';
import {generateSign} from './generate.js';
import type {Result, SignConfig} from './types.js';

export interface CliArgs {
  readonly configPath: string;
  readonly numberFontPath: string;
  readonly nameFontPath?: string;
  readonly outDir: string;
  readonly format: OutputFormat;
}

const VALUE_FLAGS = [
  '--config',
  '--number-font',
  '--name-font',
  '--out',
] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];

function isValueFlag(flag: string): flag is ValueFlag {
  return (VALUE_FLAGS as readonly string[]).includes(flag);
}

export function parseArgs(argv: readonly string[]): Result<CliArgs, string> {
  const values: Partial<Record<ValueFlag, string>> = {};
  let format: OutputFormat = 'both';

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i] as string;

    if (isValueFlag(flag)) {
      const value = argv[i + 1];
      if (value === undefined) {
        return {ok: false, error: `${flag} requires a value.`};
      }
      values[flag] = value;
      i += 1;
      continue;
    }

    if (flag === '--format') {
      const value = argv[i + 1];
      if (value !== 'svg' && value !== 'dxf' && value !== 'both') {
        return {
          ok: false,
          error: `--format must be one of svg, dxf, both (got "${value}").`,
        };
      }
      format = value;
      i += 1;
      continue;
    }

    return {ok: false, error: `Unrecognized argument: ${flag}`};
  }

  const configPath = values['--config'];
  const numberFontPath = values['--number-font'];
  const nameFontPath = values['--name-font'];
  const outDir = values['--out'];

  if (!configPath) {
    return {ok: false, error: 'Missing required argument: --config <path>'};
  }
  if (!numberFontPath) {
    return {
      ok: false,
      error: 'Missing required argument: --number-font <path>',
    };
  }
  if (!outDir) {
    return {ok: false, error: 'Missing required argument: --out <dir>'};
  }

  return {
    ok: true,
    value: {
      configPath,
      numberFontPath,
      ...(nameFontPath ? {nameFontPath} : {}),
      outDir,
      format,
    },
  };
}

export interface CliDeps {
  readonly readFile: (path: string) => Buffer;
  readonly writeFile: (path: string, content: string) => void;
  readonly mkdir: (path: string) => void;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function formatGenerateSignError(error: GenerateSignError): string {
  switch (error.stage) {
    case 'validation':
      return [
        'Invalid sign config:',
        ...error.errors.map(e => `  - ${e.field}: ${e.message}`),
      ].join('\n');
    case 'font':
      return `Font error: ${error.error.message}`;
    case 'layout':
      return `Layout error: ${error.error.message}`;
  }
}

/** Runs the CLI's file I/O + generation pipeline against injected filesystem deps, for testability. */
export function runCli(
  args: CliArgs,
  deps: CliDeps,
): Result<readonly string[], string> {
  let configJson: unknown;
  try {
    configJson = JSON.parse(deps.readFile(args.configPath).toString('utf8'));
  } catch (err) {
    return {
      ok: false,
      error: `Failed to read/parse config file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (typeof configJson !== 'object' || configJson === null) {
    return {ok: false, error: 'Config file must contain a JSON object.'};
  }

  const fonts = createFontRegistry();

  let numberFontBuffer: Buffer;
  try {
    numberFontBuffer = deps.readFile(args.numberFontPath);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to read number font file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const numberFontResult = fonts.register(
    'number-font',
    toArrayBuffer(numberFontBuffer),
  );
  if (!numberFontResult.ok) {
    return {ok: false, error: `Number font: ${numberFontResult.error.message}`};
  }

  if (args.nameFontPath) {
    let nameFontBuffer: Buffer;
    try {
      nameFontBuffer = deps.readFile(args.nameFontPath);
    } catch (err) {
      return {
        ok: false,
        error: `Failed to read name font file: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const nameFontResult = fonts.register(
      'name-font',
      toArrayBuffer(nameFontBuffer),
    );
    if (!nameFontResult.ok) {
      return {ok: false, error: `Name font: ${nameFontResult.error.message}`};
    }
  }

  const config: SignConfig = {
    ...(configJson as Omit<SignConfig, 'font'>),
    font: {
      numberFont: 'number-font',
      ...(args.nameFontPath ? {nameFont: 'name-font'} : {}),
    },
  };

  const result = generateSign({config, fonts, format: args.format});
  if (!result.ok) {
    return {ok: false, error: formatGenerateSignError(result.error)};
  }

  deps.mkdir(args.outDir);
  const written: string[] = [];
  for (const file of result.value) {
    const filePath = join(args.outDir, file.name);
    deps.writeFile(filePath, file.content);
    written.push(filePath);
  }
  return {ok: true, value: written};
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }

  const result = runCli(parsed.value, {
    readFile: path => readFileSync(path),
    writeFile: (path, content) => writeFileSync(path, content, 'utf8'),
    mkdir: path => {
      mkdirSync(path, {recursive: true});
    },
  });

  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Generated ${result.value.length} file(s) in ${parsed.value.outDir}`,
  );
}

// Only run when executed directly (e.g. `node dist/cli.js`), not when
// imported — this module is imported by cli.test.ts to test parseArgs/runCli.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}
