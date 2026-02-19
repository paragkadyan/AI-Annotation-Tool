# AI Code Annotation Instructions

## Mandatory Rule

If you (GitHub Copilot) generate code for this repository, you **MUST** insert
the following annotation comment **BEFORE** the generated code.

```
AI_ASSISTED: true
AI_TOOL: GitHub Copilot
EMPLOYEE_ID: ${EMPLOYEE_ID}
```

## Rules

- The annotation must appear immediately before the generated code
- The comment syntax must match the programming language:
  - `//` for JavaScript, TypeScript, Java, C, C++, Go, Rust, etc.
  - `#` for Python, Ruby, Shell, YAML, Dockerfile, etc.
  - `--` for SQL, Lua, Haskell
  - `<!-- -->` for HTML, XML
  - `/* */` for CSS
- Do not generate code without the annotation
- Do not remove or modify existing AI annotations
- If multiple code blocks are generated, each block must have its own annotation

## Environment Variables

- `EMPLOYEE_ID` is provided via a `.env` file at the project root
- Always reference it dynamically; do not hardcode values
- If `EMPLOYEE_ID` is unavailable, use the placeholder `UNKNOWN`

## Examples

### Python
```python
# AI_ASSISTED: true
# AI_TOOL: GitHub Copilot
# EMPLOYEE_ID: EMP-12345
def calculate_total(items):
    return sum(item.price for item in items)
```

### TypeScript
```typescript
// AI_ASSISTED: true
// AI_TOOL: GitHub Copilot
// EMPLOYEE_ID: EMP-12345
function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}
```

### HTML
```html
<!--
  AI_ASSISTED: true
  AI_TOOL: GitHub Copilot
  EMPLOYEE_ID: EMP-12345
-->
<div class="container">...</div>
```# AI Code Annotation Instructions

## Mandatory Rule

If you (GitHub Copilot) generate code for this repository, you **MUST** wrap
the generated code with annotation comments: a **start block** before the code
and an **end marker** after the code.

## Format

```
// AI_ASSISTED: true
// AI_TOOL: GitHub Copilot
// EMPLOYEE_ID: ${EMPLOYEE_ID}

<generated code here>

// AI_ASSISTED_END
```

## Rules

- The start annotation must appear immediately before the generated code
- The end marker `AI_ASSISTED_END` must appear immediately after the generated code
- The comment syntax must match the programming language:
  - `//` for JavaScript, TypeScript, Java, C, C++, Go, Rust, etc.
  - `#` for Python, Ruby, Shell, YAML, Dockerfile, etc.
  - `--` for SQL, Lua, Haskell
  - `<!-- -->` for HTML, XML
  - `/* */` for CSS
- Do not generate code without the annotation
- Do not remove or modify existing AI annotations
- If multiple code blocks are generated, each block must have its own start + end annotation

## Environment Variables

- `EMPLOYEE_ID` is provided via a `.env` file at the project root
- Always reference it dynamically; do not hardcode values
- If `EMPLOYEE_ID` is unavailable, use the placeholder `UNKNOWN`

## Examples

### JavaScript
```javascript
// AI_ASSISTED: true
// AI_TOOL: GitHub Copilot
// EMPLOYEE_ID: EMP-12345
function addThreeNumbers(a, b, c) {
  return a + b + c;
}
// AI_ASSISTED_END
```

### Python
```python
# AI_ASSISTED: true
# AI_TOOL: GitHub Copilot
# EMPLOYEE_ID: EMP-12345
def calculate_total(items):
    return sum(item.price for item in items)
# AI_ASSISTED_END
```

### HTML
```html
<!-- 
  AI_ASSISTED: true
  AI_TOOL: GitHub Copilot
  EMPLOYEE_ID: EMP-12345
-->
<div class="container">...</div>
<!-- AI_ASSISTED_END -->
```

## Purpose

These rules exist for:

- **AI usage transparency** — track which code was AI-generated
- **Audit compliance** — satisfy organizational review requirements
- **Legal traceability** — maintain records for IP governance

Failure to follow these rules may result in code rejection during review.

---

> **⚠️ Important**: Copilot may not always follow these instructions. This file
> serves as guidance. Actual enforcement is handled by the VS Code extension
> (`ai-code-annotator`) and CI validation pipelines.

## Purpose

These rules exist for:

- **AI usage transparency** — track which code was AI-generated
- **Audit compliance** — satisfy organizational review requirements
- **Legal traceability** — maintain records for IP governance

Failure to follow these rules may result in code rejection during review.

---

> **⚠️ Important**: Copilot may not always follow these instructions. This file
> serves as guidance. Actual enforcement is handled by the VS Code extension
> (`ai-code-annotator`) and CI validation pipelines.