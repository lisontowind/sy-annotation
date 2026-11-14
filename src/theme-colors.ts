/** Native SiYuan color expressions. Keep authored values in storage, resolve only for comparison. */
export const COLOR_PROPERTIES = ["color", "background-color", "text-decoration-color"] as const;
export type ColorProperty = typeof COLOR_PROPERTIES[number];
export const THEME_MODE = "--sya-theme-mode";

export function splitArguments(value: string): string[] {
  let depth = 0, start = 0;
  const result: string[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") depth--;
    else if (value[i] === "," && depth === 0) { result.push(value.slice(start, i).trim()); start = i + 1; }
  }
  result.push(value.slice(start).trim());
  return result;
}
export function mapFunction(value: string, name: string, replace: (body: string, original: string) => string): string {
  let result = "", cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf(name + "(", cursor);
    if (start < 0) break;
    let depth = 1, end = start + name.length + 1;
    for (; end < value.length && depth; end++) {
      if (value[end] === "(") depth++;
      else if (value[end] === ")") depth--;
    }
    if (depth) break;
    result += value.slice(cursor, start) + replace(value.slice(start + name.length + 1, end - 1), value.slice(start, end));
    cursor = end;
  }
  return result + value.slice(cursor);
}
export function colorPair(value: string): [string, string] | undefined {
  const trimmed = value.trim();
  if (trimmed.startsWith("light-dark(") && trimmed.endsWith(")")) {
    const args = splitArguments(trimmed.slice(11, -1));
    if (args.length === 2) return [args[0], args[1]];
  }
  const parts: Record<string, string> = {};
  const rest = mapFunction(trimmed, "var", (body, original) => {
    const [key, ...fallback] = splitArguments(body);
    if (!["--b3-legacy-light-color", "--b3-legacy-dark-color"].includes(key) || !fallback.length) return original;
    parts[key] = fallback.join(","); return "";
  });
  if (!rest.trim() && parts["--b3-legacy-light-color"] && parts["--b3-legacy-dark-color"])
    return [parts["--b3-legacy-light-color"], parts["--b3-legacy-dark-color"]];
}
export const pairedColor = (light: string, dark: string): string => `light-dark(${light.trim()}, ${dark.trim()})`;
export function browserColor(value: string): string {
  const pair = colorPair(value);
  if (!pair) return value;
  return typeof CSS !== "undefined" && !CSS.supports("color", "light-dark(white, black)")
    ? `var(--b3-legacy-light-color, ${pair[0]}) var(--b3-legacy-dark-color, ${pair[1]})`
    : pairedColor(...pair);
}
export function isFixedColor(value: string): boolean {
  return !!value.trim() && !/var\(|light-dark\(|currentcolor|inherit|initial|unset|revert/i.test(value);
}
