import * as vscode from 'vscode';
import { handleGroqRequest } from './groq';

export class ChatWebview {
    public static currentPanel: ChatWebview | undefined;
    public static readonly viewType = 'groqChat';
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (ChatWebview.currentPanel) {
            ChatWebview.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ChatWebview.viewType,
            'Groq Coder',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        ChatWebview.currentPanel = new ChatWebview(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'sendMessage':
                        let response = await handleGroqRequest(message.text);
                        response = await this._handleFileCreation(response);
                        this._panel.webview.postMessage({ command: 'receiveMessage', text: response });
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        ChatWebview.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _handleFileCreation(response: string): Promise<string> {
        const fileRegex = /### FILE: (.+?)\n```[\w]*\n([\s\S]*?)```/g;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

        if (!workspaceFolder) {
            return response;
        }

        const createdFiles: string[] = [];
        let match;

        while ((match = fileRegex.exec(response)) !== null) {
            const filename = match[1].trim();
            const content = match[2];
            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filename);

            // Create parent directories if needed
            const parentUri = vscode.Uri.joinPath(workspaceFolder.uri, filename.split('/').slice(0, -1).join('/'));
            if (filename.includes('/')) {
                await vscode.workspace.fs.createDirectory(parentUri);
            }

            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
            createdFiles.push(filename);
        }

        if (createdFiles.length > 0) {
            // Strip the raw FILE blocks from the chat response
            const cleaned = response.replace(/### FILE: .+?\n```[\w]*\n[\s\S]*?```/g, '').trim();
            return `${cleaned}\n\n✅ Created ${createdFiles.length} file(s) in your workspace:\n${createdFiles.map(f => `  • ${f}`).join('\n')}`;
        }

        return response;
    }

    private _update() {
        this._panel.title = 'Groq Chat';
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Groq Coder</title>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); display: flex; flex-direction: column; height: 100vh; margin: 0; box-sizing: border-box;}
        #chat-container { flex-grow: 1; overflow-y: auto; margin-bottom: 20px; display: flex; flex-direction: column; gap: 10px; }
        .message { padding: 10px; border-radius: 5px; max-width: 80%; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; }
        .user { align-self: flex-end; background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .ai { align-self: flex-start; background-color: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); }
        #input-container { display: flex; gap: 10px; padding-bottom: 20px; }
        textarea { flex-grow: 1; min-height: 80px; padding: 10px; font-family: inherit; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); resize: vertical; border-radius: 4px; }
        button { padding: 10px 20px; background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; border-radius: 4px; font-weight: bold; }
        button:hover { background-color: var(--vscode-button-hoverBackground); }
    </style>
</head>
<body>
    <div id="chat-container">
        <div class="message ai">Hello! I am your Groq coding assistant. Ask me a question and I'll use your current active file to help you code.</div>
    </div>
    <div id="input-container">
        <textarea id="prompt" placeholder="Ask a question... (e.g., How do I reverse a string?)"></textarea>
        <button id="sendBtn">Send</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const chatContainer = document.getElementById('chat-container');
        const promptInput = document.getElementById('prompt');
        const sendBtn = document.getElementById('sendBtn');

        function appendMessage(text, className) {
            const msgDiv = document.createElement('div');
            msgDiv.className = 'message ' + className;
            msgDiv.textContent = text;
            chatContainer.appendChild(msgDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        sendBtn.addEventListener('click', () => {
            const text = promptInput.value.trim();
            if (text) {
                appendMessage(text, 'user');
                vscode.postMessage({ command: 'sendMessage', text: text });
                promptInput.value = '';
                appendMessage('Thinking...', 'ai'); // Temp thinking message
            }
        });

        promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendBtn.click();
            }
        });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'receiveMessage':
                    // remove thinking message
                    if (chatContainer.lastChild && chatContainer.lastChild.textContent === 'Thinking...') {
                        chatContainer.removeChild(chatContainer.lastChild);
                    }
                    appendMessage(message.text, 'ai');
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}
