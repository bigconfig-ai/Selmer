import type { Delimiters, ScannerLike, TagInfo } from "./types.js";
export declare class Scanner implements ScannerLike {
    index: number;
    readonly input: string;
    readonly delimiters: Delimiters;
    private readonly tagCollector?;
    constructor(input: string, delimiters: Delimiters, tagCollector?: TagInfo[]);
    eof(): boolean;
    readChar(): string | undefined;
    peek(offset?: number): string | undefined;
    startsWith(value: string): boolean;
    startsTag(): boolean;
    startsShortComment(): boolean;
    skipShortComment(): void;
    readTagContent(): string;
    readTagInfo(): TagInfo;
}
export declare function checkTagArgs(args: string): string;
export declare function readTagInfoFromString(tagString: string, delimiters: Delimiters): TagInfo;
export declare function tagInnerContent(tagString: string, delimiters: Delimiters): string;
