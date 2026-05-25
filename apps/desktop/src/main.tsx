import React from "react";
import ReactDOM from "react-dom/client";
import "github-markdown-css/github-markdown.css";
import "katex/dist/katex.min.css";
import "./styles/app.css";
import "./styles/markdown.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
