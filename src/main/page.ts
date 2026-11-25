import path from "node:path";
import { createRoot, type RootOptions, type WebViewProps } from "@zenbu-labs/pixel";

/**
 * The terminal font size, in CSS pixels, that the pages' own type sizes were designed against.
 * A page is zoomed so its text keeps that proportion to the terminal's text on any display.
 */
const DESIGN_TERMINAL_FONT_PX = 13;

/** The corner radius of a Rex pane, in points. */
const REX_PANE_RADIUS_PT = 10;

/** What Ctrl with a key does to the zoom: in, out, or back to the start. */
function zoomStep(key: string) {
  switch (key) {
    case "=":
    case "+":
      return 1;
    case "-":
      return -1;
    case "0":
      return 0;
    default:
      return undefined;
  }
}

type PageOptions = Pick<RootOptions, "name" | "onFocus" | "onResize"> & {
  /** The page's HTML file, built next to this script. */
  html: string;
  onQuit: () => void;
};

/**
 * Opens one of the app's pages in the terminal pane, the way every Claudesaurus page is shown:
 * zoomed to the terminal's font, with Rex's rounded corners, Ctrl+Q to quit and Ctrl+= and
 * Ctrl+- to zoom.
 */
export function openPage(options: PageOptions) {
  const root = createRoot({
    name: options.name,
    devtools: false,
    onResize: options.onResize,
    onFocus: options.onFocus,
    onKey(event) {
      if (event.kind !== "press" || !event.mods.ctrl) return;
      if (event.key === "q") {
        options.onQuit();
        return true;
      }
      const zoom = zoomStep(event.key);
      if (zoom !== undefined) {
        view.zoom(zoom);
        return true;
      }
    },
  });

  // Rex draws its panes with rounded corners, and a square page would cover them. In Rex the
  // page is rounded the same way, over a clear background, so the pane's own corners show.
  const inRex = Boolean(process.env.REX_BLOCK);
  if (inRex) root.setClearColor([0, 0, 0, 0]);

  // loadFile's options leave out `style`, but it applies them after its own full-size style, so
  // a style given here is used. It replaces that one, so it repeats the full size.
  const pageOptions: Omit<WebViewProps, "src" | "hidden" | "autoFocus"> = {
    preload: path.join(__dirname, "preload.cjs"),
    onOpenWindow: () => "deny",
  };
  if (inRex) {
    pageOptions.style = {
      width: "100%",
      height: "100%",
      cornerRadius: REX_PANE_RADIUS_PT * root.displayScale,
    };
  }
  const view = root.loadFile(path.join(__dirname, options.html), pageOptions);

  view.webContents.on("did-finish-load", () => {
    // The terminal's font size is in device pixels. Where the page is already drawn at the
    // display's scale, as on a Retina Mac, only the rest of the difference is zoom.
    const terminalFontPx = root.info.basePx / root.displayScale;
    view.webContents.setZoomFactor(terminalFontPx / DESIGN_TERMINAL_FONT_PX);
  });

  return { root, view };
}
