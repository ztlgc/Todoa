import React from "react";
import ReactDOM from "react-dom/client";
import { QuickAdd } from "@/features/quick-add/QuickAdd";
import "@/index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode><QuickAdd /></React.StrictMode>,
);
