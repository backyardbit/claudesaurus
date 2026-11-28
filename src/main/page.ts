import path from "node:path";
import { createRoot, type RootOptions, type WebViewProps } from "@zenbu-labs/pixel";

const DESIGN_TERMINAL_FONT_PX = 13;

const REX_PANE_RADIUS_PT = 10;

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
  html: string;
  onQuit: () => void;
};

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

  const inRex = Boolean(process.env.REX_BLOCK);
  if (inRex) root.setClearColor([0, 0, 0, 0]);

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
    const terminalFontPx = root.info.basePx / root.displayScale;
    view.webContents.setZoomFactor(terminalFontPx / DESIGN_TERMINAL_FONT_PX);
  });

  return { root, view };
}
