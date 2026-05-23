import { render } from "./parser.js";
import { SelmerValidationError } from "./validator.js";

export interface ResponseLike {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function handleTemplateParsingError(ex: unknown): ResponseLike {
  if (ex instanceof SelmerValidationError && ex.data.type === "selmer/validation-error") {
    return {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: render(String(ex.data.errorTemplate ?? "{{error}}"), ex.data)
    };
  }
  throw ex;
}

export function wrapErrorPage<Request, Response>(handler: (request: Request) => Response): (request: Request) => Response | ResponseLike {
  return (request: Request) => {
    try {
      return handler(request);
    } catch (ex) {
      return handleTemplateParsingError(ex);
    }
  };
}
