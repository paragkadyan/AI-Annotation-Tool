"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCommentStyle = getCommentStyle;
const COMMENT_STYLES = {
    javascript: { linePrefix: "//" },
    typescript: { linePrefix: "//" },
    javascriptreact: { linePrefix: "//" },
    typescriptreact: { linePrefix: "//" },
    java: { linePrefix: "//" },
    c: { linePrefix: "//" },
    cpp: { linePrefix: "//" },
    csharp: { linePrefix: "//" },
    go: { linePrefix: "//" },
    rust: { linePrefix: "//" },
    swift: { linePrefix: "//" },
    kotlin: { linePrefix: "//" },
    dart: { linePrefix: "//" },
    php: { linePrefix: "//" },
    python: { linePrefix: "#" },
    ruby: { linePrefix: "#" },
    shellscript: { linePrefix: "#" },
    bash: { linePrefix: "#" },
    yaml: { linePrefix: "#" },
    sql: { linePrefix: "--" },
    html: { blockStart: "<!--", blockEnd: "-->" },
    xml: { blockStart: "<!--", blockEnd: "-->" },
    css: { blockStart: "/*", blockEnd: "*/" }
};
const DEFAULT_STYLE = { linePrefix: "//" };
function getCommentStyle(languageId) {
    return COMMENT_STYLES[languageId] || DEFAULT_STYLE;
}
//# sourceMappingURL=commentStyles.js.map