const vscode = acquireVsCodeApi();
document.getElementById('open-btn').addEventListener('click', () => {
    vscode.postMessage({ command: 'openChat' });
});
