type TerminalTheme = {
  background: number[];
  foreground: number[];
  ansi: (number[] | null)[];
};

type PixelApi = {
  theme(): TerminalTheme | null;
  onTheme(subscriber: (theme: TerminalTheme) => void): () => void;
};

declare global {
  interface Window {
    pixel?: PixelApi;
  }
}

function css(color: number[]) {
  const [red = 0, green = 0, blue = 0] = color;
  return `rgb(${red} ${green} ${blue})`;
}

function luminance(color: number[]) {
  const [red = 0, green = 0, blue = 0] = color;
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

/** ANSI palette slots that drive the page's semantic colors. */
const ANSI_VARIABLES: [index: number, variable: string][] = [
  [1, "--red"],
  [2, "--green"],
  [3, "--yellow"],
  [4, "--blue"],
];

function apply(theme: TerminalTheme) {
  const style = document.documentElement.style;
  style.setProperty("--bg", css(theme.background));
  style.setProperty("--fg", css(theme.foreground));
  for (const [index, variable] of ANSI_VARIABLES) {
    const color = theme.ansi[index];
    if (color) style.setProperty(variable, css(color));
  }
  document.documentElement.dataset.scheme = luminance(theme.background) < 0.5 ? "dark" : "light";
}

/** Colors the page from the terminal's own theme, and keeps following it. */
export function followTerminalTheme() {
  const pixel = window.pixel;
  if (!pixel) {
    if (new URLSearchParams(location.search).has("dark")) {
      apply({ background: [25, 23, 36], foreground: [224, 222, 244], ansi: [] });
    }
    return;
  }
  const theme = pixel.theme();
  if (theme) apply(theme);
  pixel.onTheme(apply);
}
