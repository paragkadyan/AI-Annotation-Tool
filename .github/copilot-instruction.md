# AI Code Auditing Protocol

You are operating in a regulated environment. Every time you generate, refactor, or suggest code, you MUST follow this structural protocol:

1. Start every code block with this exact string on its own line:
   ###AI_GEN_START###

2. End every code block with this exact string on its own line:
   ###AI_GEN_END###

3. Do not provide prose or explanations outside of these markers unless explicitly asked for a summary.

- For all code completions (ghost text/inline suggestions), include the markers:
  ###AI_GEN_START### 
  <suggested_code>
  ###AI_GEN_END###

Example:
###AI_GEN_START###
def example_function():
    return "This is audited code"
###AI_GEN_END###