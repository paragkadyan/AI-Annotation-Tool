# AI Auto-Annotator

A specialized VS Code extension for tracking AI-generated code. It automates the "handshake" between developers and AI, ensuring every block generated via **GitHub Copilot Tab Suggestions** or **Copilot Chat** is uniquely identified and tracked through its lifecycle.

---

## Getting Started

### Installation

1. **Package:** Run `npx vsce package` to create a `.vsix` file.
2. **Install:** Open VS Code > Extensions (`Ctrl+Shift+X`) > `...` > **Install from VSIX...**.
3. **Activation:** The extension activates on startup. It will immediately prompt for your **Employee ID**. This ID is used for all metadata stamps.
4. **Auto-Setup:** The extension automatically scans for `.github/copilot-instructions.md`. It will create the file or append required markers if they are missing.

---

## Usage Examples

The extension specifically monitors **Tab Suggestions** and **Copilot Chat** generation. It is designed to ignore `undo`, `redo`, and `paste` operations to prevent flagging non-AI content.

### 1. New Code Generation

Generate code using a Tab suggestion. The extension detects the AI injection and automatically wraps it in the correct comment syntax for your active editor.

**Example:**

```python
# >>> AI_START | ID: 12345 | 17-03-2026
def addition(a, b):
    return a + b
# <<< AI_END

```

### 2. Manual Modification (Shared Workspace)

When you modify an existing AI block, the extension appends your ID to the `EditedBy` chain, maintaining a full audit trail of the logic's evolution.

**Example:**

```python
# >>> AI_START | ID: 12345 | 17-03-2026 | EditedBy: 12345 (17-03-2026)
def addition_of_multiple(a, b):
    print("Adding", a, "and", b)
    return a + b
# <<< AI_END

```

> [!IMPORTANT]
> **Copilot Chat Users:** When using Copilot Chat, remember to add the `.github/copilot-instructions.md` file as **context** (use `#file`) to your chat session to ensure the AI follows the specific marking protocol.

---

## Features

### AI Content Percentage

The extension provides a real-time audit of your file. It calculates the ratio of AI-managed lines (those residing within `AI_START` and `AI_END` markers) against the total lines in the document.

* **Logic:** It scans the active document and calculates the percentage based on annotated line counts.
* **Purpose:** Helps teams monitor the balance between human-authored logic and AI-assisted generation.

### Management Commands

Access these via the Command Palette (`Ctrl+Shift+P`):

* `AI Annotator: Reset ID`: Update your Employee ID for future annotations.
* `AI Annotator: Create Handshake File`: Triggers manual md file creation
---

## Testing Logic

The test suite ensures the integrity of the annotation engine:

* **Tab Simulation:** Mocks large text injections to verify the 1200ms debounce and character length triggers.
* **Edit Chain:** Validates that `EditedBy` metadata is correctly appended to existing chains.
* **Language Detection:** Confirms that comment characters (e.g., `//` for JS, `#` for Python) are correctly mapped to the file type.
* **Event Filtering:** Ensures that `paste` and `undo` operations do not trigger the annotation logic.