import React from "react";
import ReactDOM from "react-dom/client";
import "animal-island-ui/style";
import App from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("No #root element");

ReactDOM.createRoot(rootEl).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
