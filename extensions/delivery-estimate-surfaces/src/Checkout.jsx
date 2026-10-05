import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { Estimate } from "./Estimate.jsx";

export default function extension() {
  render(<Estimate />, document.body);
}
