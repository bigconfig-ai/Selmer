export interface ResponseLike {
    status: number;
    headers: Record<string, string>;
    body: string;
}
export declare function handleTemplateParsingError(ex: unknown): ResponseLike;
export declare function wrapErrorPage<Request, Response>(handler: (request: Request) => Response): (request: Request) => Response | ResponseLike;
