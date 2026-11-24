import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { followTerminalTheme } from "../ui/theme";
import { App } from "./App";
import { prBridge } from "./lib/prApi";

followTerminalTheme();

const container = document.getElementById("root");
if (!container) throw new Error("The page has no #root element.");

const context = await prBridge().target();
createRoot(container).render(
  <StrictMode>
    <App context={context} />
  </StrictMode>,
);
