import * as vscode from 'vscode';

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'groqCoder.chatView';

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        const scriptUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'launcher.js')
        );

        const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src ${webviewView.webview.cspSource};`;

        webviewView.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
    text-align: center;
    gap: 12px;
}
.logo { font-size: 36px; }
.title { font-size: 15px; font-weight: 700; }
.sub { font-size: 11px; color: var(--vscode-descriptionForeground); line-height: 1.5; }
#open-btn {
    margin-top: 8px;
    padding: 8px 20px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    font-family: var(--vscode-font-family);
    width: 100%;
    transition: background 0.15s;
}
#open-btn:hover { background: var(--vscode-button-hoverBackground); }
.note { font-size: 10px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
    <div class="logo">⚡</div>
    <div class="title">Groq Coder</div>
    <div class="sub">AI coding assistant powered by Groq</div>
    <button id="open-btn">Open Chat Panel →</button>
    <div class="note">Opens beside your code so you can see your files and chat at the same time</div>
    <script src="${scriptUri}"></script>
</body>
</html>`;

        webviewView.webview.onDidReceiveMessage(msg => {
            if (msg.command === 'openChat') {
                vscode.commands.executeCommand('groqCoder.startChat');
            }
        });
    }
}
