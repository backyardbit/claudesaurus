import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "katex/dist/katex.min.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { connectBridge } from "./bridge";
import { createStore, installStore } from "./store";
import { followTerminalTheme } from "./theme";

followTerminalTheme();

const container = document.getElementById("root");
if (!container) throw new Error("The page has no #root element.");

const bridge = await connectBridge();
installStore(createStore(bridge));
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
