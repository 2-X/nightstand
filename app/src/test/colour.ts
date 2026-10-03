// Colour maths for the contrast tests. Colours are '#rrggbb' or 'rgba(r,g,b,a)' without spaces.
type Rgb = [number, number, number];

function parse(colour: string): { rgb: Rgb; alpha: number } {
  const rgba = colour.match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/);
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
  const hex = colour.match(/^#([0-9a-f]{6})$/i);
  if (!hex) throw new Error(`Not a hex or rgba colour: ${colour}`);
  return { rgb: [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb, alpha: 1 };
}

// The colour seen when top is drawn over an opaque colour.
function over(top: string, below: string): Rgb {
  const fg = parse(top);
  const bg = parse(below);
  if (bg.alpha !== 1) throw new Error(`Not opaque: ${below}`);
  return [0, 1, 2].map(i => fg.rgb[i] * fg.alpha + bg.rgb[i] * (1 - fg.alpha)) as Rgb;
}

const luminance = ([r, g, b]: Rgb) => {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

export function flatten(top: string, below: string): string {
  return '#' + over(top, below).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

export function ratio(top: string, below: string): number {
  const a = luminance(over(top, below));
  const b = luminance(over(below, below));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// How far a colour is from grey: the gap between its largest and smallest channel.
export function spread(colour: string, page: string): number {
  const rgb = over(colour, page);
  return Math.max(...rgb) - Math.min(...rgb);
}

// A plain RGB distance, enough to tell two colours apart at a glance.
export function distance(a: string, b: string, page: string): number {
  const x = over(a, page);
  const y = over(b, page);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
