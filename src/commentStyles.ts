export interface CommentStyle {
    linePrefix?: string;
    blockStart?: string;
    blockEnd?: string;
}

const COMMENT_STYLES: Record<string, CommentStyle> = {

    // C-style languages
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
    scala: { linePrefix: "//" },

    // Hash-style
    python: { linePrefix: "#" },
    ruby: { linePrefix: "#" },
    shellscript: { linePrefix: "#" },
    bash: { linePrefix: "#" },
    yaml: { linePrefix: "#" },
    dockerfile: { linePrefix: "#" },
    powershell: { linePrefix: "#" },
    r: { linePrefix: "#" },

    // Dash-style
    sql: { linePrefix: "--" },
    lua: { linePrefix: "--" },
    haskell: { linePrefix: "--" },

    // Block comment languages
    html: { blockStart: "<!--", blockEnd: "-->" },
    xml: { blockStart: "<!--", blockEnd: "-->" },
    svg: { blockStart: "<!--", blockEnd: "-->" },
    css: { blockStart: "/*", blockEnd: "*/" },

    // Others
    scss: { linePrefix: "//" },
    less: { linePrefix: "//" },
    matlab: { linePrefix: "%" },
    latex: { linePrefix: "%" },
    erlang: { linePrefix: "%" },
    fortran: { linePrefix: "!" },
    vb: { linePrefix: "'" }
};

const DEFAULT_STYLE: CommentStyle = { linePrefix: "//" };

export function getCommentStyle(languageId: string): CommentStyle {
    return COMMENT_STYLES[languageId] || DEFAULT_STYLE;
}