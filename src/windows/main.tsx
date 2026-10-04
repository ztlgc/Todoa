import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/app/App";
import AclProbe from "@/app/AclProbe";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "@/index.css";

const screen = getCurrentWebviewWindow().label === "acl-probe" ? <AclProbe /> : <App />;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {screen}
  </React.StrictMode>,
);
