/**
 * The one number formatter for everything written into an SVG: rounded to
 * 2 decimals, no trailing zeros, never `-0`, never exponent notation.
 */
export function num(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`cannot write ${value} into an SVG`);
  const hundredths = Math.round(value * 100);
  if (!Number.isSafeInteger(hundredths)) throw new Error(`number too large for an SVG: ${value}`);
  if (hundredths === 0) return "0";
  const sign = hundredths < 0 ? "-" : "";
  const abs = Math.abs(hundredths);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const fraction = frac === 0 ? "" : frac % 10 === 0 ? `.${frac / 10}` : `.${String(frac).padStart(2, "0")}`;
  return `${sign}${whole}${fraction}`;
}

export type Attrs = readonly (readonly [name: string, value: string | number])[];

/** Writes one element. Numbers go through num(); strings are escaped. */
export function el(name: string, attrs: Attrs, children?: string): string {
  return children === undefined ? `<${name}${attrText(attrs)}/>` : `${open(name, attrs)}${children}</${name}>`;
}

/** Writes an opening tag; the caller writes the matching `</name>`. */
export function open(name: string, attrs: Attrs): string {
  return `<${name}${attrText(attrs)}>`;
}

function attrText(attrs: Attrs): string {
  return attrs
    .map(([key, value]) => ` ${key}="${typeof value === "number" ? num(value) : escapeAttr(value)}"`)
    .join("");
}

export function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, "&quot;");
}
