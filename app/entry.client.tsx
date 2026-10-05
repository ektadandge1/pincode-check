import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

// Some browser extensions inject custom elements directly under <html> before
// React starts. Those invalid document children break document-level hydration.
for (const child of Array.from(document.documentElement.children)) {
  if (child !== document.head && child !== document.body) child.remove();
}

hydrateRoot(
  document,
  <StrictMode>
    <HydratedRouter />
  </StrictMode>,
);
