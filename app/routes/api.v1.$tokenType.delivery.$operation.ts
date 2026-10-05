import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { handleHeadlessRequest } from "../services/headless-api.server";

export function loader({ request, params }: LoaderFunctionArgs) {
  return handleHeadlessRequest(request, params.tokenType ?? "", params.operation ?? "");
}

export function action({ request, params }: ActionFunctionArgs) {
  return handleHeadlessRequest(request, params.tokenType ?? "", params.operation ?? "");
}
