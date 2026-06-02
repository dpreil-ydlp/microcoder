export function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function valuesAfter(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

export function parsePositiveInteger(value: string | undefined, label: string): number | string {
  if (!value || !/^[1-9]\d*$/.test(value)) return `${label} must be a positive integer`;
  return Number.parseInt(value, 10);
}

export function parseOptionalInteger(value: string | undefined, label: string, min = 1): number | string | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return `${label} must be an integer`;
  const parsed = Number.parseInt(value, 10);
  if (parsed < min) return `${label} must be at least ${min}`;
  return parsed;
}

export function parseOptionalBoolean(value: string | undefined, label: string): boolean | string | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return `${label} must be true or false`;
}

export function validateFlagArgs(args: string[], options: {
  valueFlags: string[];
  bareFlags?: string[];
}): string | undefined {
  const valueFlags = new Set(options.valueFlags);
  const bareFlags = new Set(options.bareFlags ?? []);
  const knownFlags = new Set([...valueFlags, ...bareFlags]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) return `unexpected argument ${arg}`;
    if (!knownFlags.has(arg)) return `unknown option ${arg}`;
    if (!valueFlags.has(arg)) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) return `${arg} requires a value`;
    index += 1;
  }
  return undefined;
}
