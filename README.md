# Groq Coder

An ultra-fast AI coding assistant powered by [Groq](https://groq.com) and built for **VS Code, Cursor, Antigravity**, and any other VS Code-compatible IDE.

Groq Coder integrates directly into your editor, bringing blazing-fast AI code generations right to your fingertips. Whether you need an explanation, code fixes, or full file generation, Groq Coder leverages the speed of Groq to deliver instant results.

## Features

- **Blazing Fast Responses:** Powered by Groq's LPU™ inference technology for near-instant AI token generation.
- **Universal Compatibility:** Works seamlessly in VS Code, Cursor, Antigravity, and forks like VSCodium.
- **Integrated Chat Panel:** Chat natively with the AI without leaving your IDE environment.
- **Smart Planning Mode:** Discuss and map out your next features structurally before writing code.
- **File Generation:** Automatically create new files and apply edits based on the AI's suggestions.

## Installation

You can install this extension manually using the `.vsix` package. This works exactly the same way in VS Code, Cursor, and Antigravity:

1. Download the latest `groq-coder-x.x.x.vsix` file from the [Releases](https://github.com/Innosgram/groq-coder/releases) page (or package it locally).
2. Open your IDE (VS Code, Cursor, or Antigravity).
3. Go to the **Extensions** panel (`Ctrl+Shift+X` or `Cmd+Shift+X` on Mac).
4. Click the **`...`** (Views and More Actions) icon at the top right of the Extensions panel.
5. Select **"Install from VSIX..."** and choose the downloaded file.

## Setup

1. Click the **Groq Coder** icon on your left activity bar to open the chat panel.
2. Obtain a free API key from the [Groq Console](https://console.groq.com/).
3. Enter your API key securely into the chat panel *(or define it in your editor settings under `groqCoder.apiKey`)*.

## Extension Settings

This extension contributes the following settings:
* `groqCoder.apiKey`: Your Groq API key (optional if you prefer setting it per session in the chat view).

## Contributing

Curious about how it works or want to add a feature? 
1. Clone the repository.
2. Run `npm install`.
3. Press `F5` to open a new development window with the extension loaded.

All pull requests and issues are welcome!

## License

[MIT](LICENSE)
