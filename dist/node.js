export class FunctionNode {
    handler;
    constructor(handler) {
        this.handler = handler;
    }
    renderNode(context) {
        return this.handler(context);
    }
    get meta() {
        return this.handler.meta;
    }
}
export class TextNode {
    text;
    constructor(text) {
        this.text = text;
    }
    renderNode(_context) {
        return String(this.text);
    }
    toString() {
        return String(this.text);
    }
}
//# sourceMappingURL=node.js.map