# Groq Coder

An ultra-fast AI coding assistant powered by [Groq](https://groq.com) and built for VS Code.

Groq Coder integrates directly into your editor, bringing blazing-fast AI code generations right to your fingertips. Whether you need an explanation, code fixes, or full file generation, Groq Coder leverages the speed of Groq to deliver instant results.

## Features

- **Blazing Fast Responses:** Powered by Groq's LPU™ inference technology for near-instant AI token generation.
- **Integrated Chat Panel:** Chat seamlessly with the AI without leaving your VS Code environment.
- **Smart Planning Mode:** Discuss and map out your next features structurally before writing code.
- **File Generation:** Automatically create new files and apply edits based on the AI's suggestions.

## Setup

1. Install the extension.
2. Open the **Groq Coder** panel from the Activity Bar on the left.
3. Obtain a free API key from [Groq Console](https://console.groq.com/).
4. Enter your API key in the chat panel (or define it in your VS Code settings under `groqCoder.apiKey`).

## Extension Settings

This extension contributes the following settings:
* `groqCoder.apiKey`: Your Groq API key (optional if you prefer setting it per session in the chat view).

## Contributing

Curious about how it works or want to add a feature? 
1. Clone the repository.
2. Run `npm install`.
3. Press `F5` to open a new window with the extension loaded.

All pull requests and issues are welcome!

## License

[MIT](LICENSE)
