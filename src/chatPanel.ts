import * as vscode from 'vscode';
import { handleGroqRequestStreaming, selectAutoModel, validateApiKey, fetchAvailableModels } from './groq';

interface HistoryMessage {
    type: 'user' | 'ai' | 'system-note';
    text: string;
    model?: string;
}

export class ChatPanel {
    public static current: ChatPanel | undefined;
    public static readonly viewType = 'groqCoder.chat';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _context: vscode.ExtensionContext;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, extensionContext: vscode.ExtensionContext) {
        if (ChatPanel.current) {
            ChatPanel.current._panel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ChatPanel.viewType,
            'Groq Coder',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri],
            }
        );

        ChatPanel.current = new ChatPanel(panel, extensionUri, extensionContext);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._context = context;

        this._panel.webview.html = this._getHtml(this._panel.webview);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        vscode.window.onDidChangeActiveTextEditor((editor) => {
            const fileName = editor ? editor.document.fileName.split(/[\\/]/).pop() || '' : null;
            this._panel.webview.postMessage({ command: 'activeFileChanged', fileName });
        }, null, this._disposables);

        this._panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {

                case 'ready': {
                    const history = this._context.globalState.get<HistoryMessage[]>('groqCoder.chatHistory', []);
                    this._panel.webview.postMessage({ command: 'historyLoaded', messages: history });
                    this._loadModels();
                    const activeEditor = vscode.window.activeTextEditor;
                    if (activeEditor) {
                        const fileName = activeEditor.document.fileName.split(/[\\/]/).pop() || '';
                        this._panel.webview.postMessage({ command: 'activeFileChanged', fileName });
                    }
                    return;
                }

                case 'saveApiKey': {
                    const key = (message.key ?? '').trim();
                    if (!key) { return; }
                    this._panel.webview.postMessage({ command: 'apiKeyValidating' });
                    const result = await validateApiKey(key);
                    if (!result.valid) {
                        this._panel.webview.postMessage({ command: 'apiKeyInvalid', error: result.error });
                        return;
                    }
                    await vscode.workspace.getConfiguration('groqCoder').update('apiKey', key, vscode.ConfigurationTarget.Global);
                    this._panel.webview.postMessage({ command: 'apiKeySaved' });
                    this._loadModels();
                    return;
                }

                case 'clearApiKey': {
                    await vscode.workspace.getConfiguration('groqCoder').update('apiKey', '', vscode.ConfigurationTarget.Global);
                    this._panel.webview.postMessage({ command: 'apiKeyCleared' });
                    return;
                }

                case 'openExternal': {
                    vscode.env.openExternal(vscode.Uri.parse(message.url));
                    return;
                }

                case 'copyToClipboard': {
                    vscode.env.clipboard.writeText(message.text);
                    return;
                }

                case 'clearHistory': {
                    await this._context.globalState.update('groqCoder.chatHistory', []);
                    return;
                }

                case 'sendMessage': {
                    const { text, model, planMode } = message;
                    const resolvedModel = model === 'auto' ? selectAutoModel(text) : model;

                    this._saveToHistory({ type: 'user', text });
                    this._panel.webview.postMessage({ command: 'streamStart' });

                    let extraContext: string | undefined;
                    // /selection — inject selected text as context
                    if (text.trim().toLowerCase().startsWith('/selection')) {
                        const editor = vscode.window.activeTextEditor;
                        if (editor && !editor.selection.isEmpty) {
                            const selected = editor.document.getText(editor.selection);
                            const fileName = editor.document.fileName.split(/[\\/]/).pop() || '';
                            extraContext = `\n\n--- Selected code from ${fileName} ---\n\`\`\`\n${selected}\n\`\`\``;
                            this._panel.webview.postMessage({ command: 'contextNote', text: `📎 Selected code from ${fileName} attached` });
                        } else {
                            this._panel.webview.postMessage({ command: 'contextNote', text: '⚠️ No text selected — highlight code in the editor first' });
                        }
                    }

                    const lower = text.trim().toLowerCase();
                    const wantsFiles = !extraContext && (
                        lower.startsWith('/codebase') ||
                        /\b(read|look at|analyze|understand|scan|check|review|explore|see)\b.{0,30}\b(codebase|my (files|code|project|repo|repository|folder)|all files|the files)\b/.test(lower) ||
                        /\b(codebase|my (files|code|project|repo|repository))\b.{0,30}\b(read|look|analyze|understand|scan|check|review|explore)\b/.test(lower)
                    );

                    if (wantsFiles) {
                        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                        if (workspaceFolder) {
                            extraContext = await this._readWorkspaceFiles();
                            this._panel.webview.postMessage({ command: 'contextNote', text: '📎 Workspace files attached as context' });
                        } else {
                            extraContext = '(No workspace folder open — open a folder in VS Code first)';
                        }
                    }

                    let fullText = '';
                    try {
                        fullText = await handleGroqRequestStreaming(text, resolvedModel, planMode, (chunk) => {
                            this._panel.webview.postMessage({ command: 'streamChunk', text: chunk });
                        }, extraContext);
                    } catch (e: any) {
                        fullText = `Error: ${e.message}`;
                        this._panel.webview.postMessage({ command: 'streamChunk', text: fullText });
                    }

                    const { text: processedText } = await this._handleFileOperations(fullText);
                    this._saveToHistory({ type: 'ai', text: processedText, model: resolvedModel });

                    this._panel.webview.postMessage({
                        command: 'streamDone',
                        text: processedText,
                        resolvedModel,
                    });
                    return;
                }
            }
        }, null, this._disposables);
    }

    private _saveToHistory(msg: HistoryMessage) {
        const history = this._context.globalState.get<HistoryMessage[]>('groqCoder.chatHistory', []);
        history.push(msg);
        if (history.length > 100) { history.splice(0, history.length - 100); }
        this._context.globalState.update('groqCoder.chatHistory', history);
    }

    private async _loadModels() {
        const apiKey = vscode.workspace.getConfiguration('groqCoder').get<string>('apiKey') ?? '';
        if (!apiKey.trim()) { return; }
        try {
            const models = await fetchAvailableModels(apiKey);
            this._panel.webview.postMessage({ command: 'modelsLoaded', models });
        } catch {
            // silently keep the hardcoded fallback list in the webview
        }
    }

    private async _handleFileOperations(response: string): Promise<{ text: string }> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) { return { text: response }; }

        const wsEdit = new vscode.WorkspaceEdit();
        const summary: string[] = [];
        const highlightUris: { uri: vscode.Uri; range?: vscode.Range }[] = [];
        const modifiedUris: vscode.Uri[] = [];
        let hasOps = false;

        // ── Targeted edits: ### EDIT: file\nFIND:\n```\n...\n```\nREPLACE:\n```\n...\n```
        const editRegex = /### EDIT: (.+?)\nFIND:\n```[^\n]*\n([\s\S]*?)```\s*\nREPLACE:\n```[^\n]*\n([\s\S]*?)```/g;
        let m: RegExpExecArray | null;
        while ((m = editRegex.exec(response)) !== null) {
            const relPath = m[1].trim();
            const findText = m[2];
            const replaceText = m[3];
            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, relPath);
            try {
                const doc = await vscode.workspace.openTextDocument(fileUri);
                const content = doc.getText();
                const idx = content.indexOf(findText);
                if (idx >= 0) {
                    const startPos = doc.positionAt(idx);
                    const endPos = doc.positionAt(idx + replaceText.length);
                    wsEdit.replace(fileUri, new vscode.Range(doc.positionAt(idx), doc.positionAt(idx + findText.length)), replaceText);
                    highlightUris.push({ uri: fileUri, range: new vscode.Range(startPos, endPos) });
                    modifiedUris.push(fileUri);
                    summary.push(`✏️ Edited \`${relPath}\``);
                    hasOps = true;
                } else {
                    summary.push(`⚠️ Couldn't find the target code in \`${relPath}\` — it may have changed`);
                }
            } catch {
                summary.push(`⚠️ \`${relPath}\` not found`);
            }
        }

        // ── Full file create/replace: ### FILE: file\n```\n...\n```
        const fileRegex = /### FILE: (.+?)\n```[\w]*\n([\s\S]*?)```/g;
        const processed = new Set<string>();
        while ((m = fileRegex.exec(response)) !== null) {
            const relPath = m[1].trim();
            const content = m[2];
            if (processed.has(relPath)) { continue; }
            processed.add(relPath);
            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, relPath);

            if (relPath.includes('/')) {
                const parentPath = relPath.split('/').slice(0, -1).join('/');
                await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolder.uri, parentPath));
            }

            let exists = false;
            try { await vscode.workspace.fs.stat(fileUri); exists = true; } catch { }

            if (exists) {
                const doc = await vscode.workspace.openTextDocument(fileUri);
                const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                wsEdit.replace(fileUri, fullRange, content);
                summary.push(`📝 Updated \`${relPath}\``);
            } else {
                wsEdit.createFile(fileUri, { overwrite: false });
                wsEdit.insert(fileUri, new vscode.Position(0, 0), content);
                summary.push(`✅ Created \`${relPath}\``);
            }
            highlightUris.push({ uri: fileUri });
            modifiedUris.push(fileUri);
            hasOps = true;
        }

        if (!hasOps) { return { text: response }; }

        // Apply all changes atomically — undoable with Ctrl+Z
        await vscode.workspace.applyEdit(wsEdit);

        // Save and highlight changed files
        const highlightDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
            isWholeLine: true,
        });

        for (const { uri, range } of highlightUris) {
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                await doc.save();
                const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
                const highlightRange = range ?? new vscode.Range(0, 0, Math.min(doc.lineCount - 1, 20), 0);
                editor.setDecorations(highlightDecoration, [highlightRange]);
                editor.revealRange(highlightRange, vscode.TextEditorRevealType.InCenter);
            } catch { /* skip */ }
        }

        // Clear highlights after 4 seconds
        setTimeout(() => highlightDecoration.dispose(), 4000);

        const cleaned = response
            .replace(/### EDIT: .+?\nFIND:\n```[^\n]*\n[\s\S]*?```\s*\nREPLACE:\n```[^\n]*\n[\s\S]*?```/g, '')
            .replace(/### FILE: .+?\n```[\w]*\n[\s\S]*?```/g, '')
            .trim();

        const summaryText = summary.join('\n');
        const footer = '\n\n💡 Changes are undoable with **Ctrl+Z**';
        return {
            text: cleaned ? `${cleaned}\n\n${summaryText}${footer}` : `${summaryText}${footer}`,
        };
    }

    private _getHtml(webview: vscode.Webview): string {
        const apiKey = vscode.workspace.getConfiguration('groqCoder').get<string>('apiKey') ?? '';
        const hasKey = apiKey.trim().length > 0;
        const onboardingStyle = hasKey ? 'display:none' : 'display:flex';
        const chatStyle = hasKey ? 'display:flex; flex-direction:column; height:100vh' : 'display:none';

        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'sidebar.js')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${webview.cspSource};">
<title>Groq Coder</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    height: 100vh;
    overflow: hidden;
    font-size: 13px;
}

#onboarding {
    flex-direction: column;
    height: 100vh;
    padding: 40px 24px 24px;
    max-width: 520px;
    margin: 0 auto;
}

.brand { text-align: center; padding-bottom: 24px; border-bottom: 1px solid var(--vscode-widget-border, #333); margin-bottom: 20px; }
.brand-logo { font-size: 36px; margin-bottom: 8px; }
.brand-title { font-size: 18px; font-weight: 700; }
.brand-sub { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 4px; }

#setup-bubbles { flex: 1; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; margin-bottom: 16px; }

@keyframes bubbleIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
}

.setup-bubble {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border, #444);
    border-radius: 4px 14px 14px 14px;
    padding: 12px 14px;
    font-size: 13px;
    line-height: 1.55;
    max-width: 90%;
    opacity: 0;
    animation: bubbleIn 0.4s ease forwards;
}
.setup-bubble:nth-child(1) { animation-delay: 0.1s; }
.setup-bubble:nth-child(2) { animation-delay: 0.8s; }
.setup-bubble:nth-child(3) { animation-delay: 1.5s; }
.setup-bubble:nth-child(4) { animation-delay: 2.2s; }

#key-section { opacity: 0; display: flex; flex-direction: column; gap: 8px; animation: bubbleIn 0.4s ease 2.9s forwards; }

.get-key-btn {
    padding: 9px 14px;
    border: 1px dashed var(--vscode-button-background);
    border-radius: 4px;
    color: var(--vscode-button-background);
    font-size: 12px;
    cursor: pointer;
    background: transparent;
    font-family: var(--vscode-font-family);
    transition: all 0.15s;
    width: 100%;
}
.get-key-btn:hover { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }

.key-row { display: flex; gap: 8px; }

#api-key-input {
    flex: 1;
    padding: 8px 12px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 4px;
    font-size: 13px;
    font-family: monospace;
}
#api-key-input:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }

.primary-btn {
    padding: 8px 16px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    font-family: var(--vscode-font-family);
    transition: background 0.15s;
    white-space: nowrap;
}
.primary-btn:hover { background: var(--vscode-button-hoverBackground); }
.primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }

#key-error { display: none; font-size: 11px; color: var(--vscode-errorForeground, #f48771); padding: 4px 0; }

/* ─── CHAT ─── */
#chat-app { flex-direction: column; height: 100vh; }

.toolbar {
    display: flex; align-items: center; gap: 6px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--vscode-widget-border, #333);
    flex-shrink: 0;
    background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background));
}

.toolbar select {
    flex: 1;
    padding: 4px 6px;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, #555);
    border-radius: 3px;
    font-size: 12px;
    cursor: pointer;
    font-family: var(--vscode-font-family);
}

.toolbar-btn {
    padding: 4px 9px;
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-widget-border, #444);
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
    white-space: nowrap;
    font-family: var(--vscode-font-family);
    transition: all 0.15s;
    flex-shrink: 0;
}
.toolbar-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.07)); }
.toolbar-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }

.icon-btn { padding: 4px 7px; background: transparent; border: none; cursor: pointer; color: var(--vscode-descriptionForeground); font-size: 14px; border-radius: 3px; transition: color 0.15s; flex-shrink: 0; }
.icon-btn:hover { color: var(--vscode-foreground); }

#messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }

.msg { font-size: 13px; line-height: 1.6; word-wrap: break-word; }
.msg.user { align-self: flex-end; background: var(--vscode-button-background); color: var(--vscode-button-foreground); padding: 10px 14px; border-radius: 14px 14px 3px 14px; max-width: 80%; white-space: pre-wrap; }
.msg.ai { align-self: flex-start; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, #444); padding: 10px 14px; border-radius: 3px 14px 14px 14px; max-width: 92%; }
.msg.system-note { align-self: center; color: var(--vscode-descriptionForeground); font-size: 11px; font-style: italic; white-space: pre-wrap; }

/* ─── Markdown in AI messages ─── */
.msg.ai p { margin-bottom: 8px; }
.msg.ai p:last-of-type { margin-bottom: 0; }
.msg.ai h1 { font-size: 17px; font-weight: 700; margin: 14px 0 6px; }
.msg.ai h2 { font-size: 15px; font-weight: 700; margin: 12px 0 5px; }
.msg.ai h3 { font-size: 13px; font-weight: 700; margin: 10px 0 4px; }
.msg.ai ul, .msg.ai ol { padding-left: 18px; margin: 6px 0; }
.msg.ai li { margin-bottom: 3px; }
.msg.ai strong { font-weight: 700; }
.msg.ai em { font-style: italic; }
.msg.ai hr { border: none; border-top: 1px solid var(--vscode-widget-border, #444); margin: 10px 0; }
.msg.ai code {
    font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
    font-size: 12px;
    background: rgba(255,255,255,0.08);
    padding: 1px 5px;
    border-radius: 3px;
}

/* ─── Code blocks ─── */
.code-block {
    margin: 8px 0;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--vscode-widget-border, #444);
    background: var(--vscode-editor-background);
}
.code-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 10px;
    background: rgba(255,255,255,0.04);
    border-bottom: 1px solid var(--vscode-widget-border, #444);
}
.code-lang {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    font-family: monospace;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.8;
}
.copy-btn {
    font-size: 11px;
    padding: 2px 8px;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    border: 1px solid var(--vscode-widget-border, #555);
    border-radius: 3px;
    cursor: pointer;
    font-family: var(--vscode-font-family);
    transition: all 0.15s;
}
.copy-btn:hover { color: var(--vscode-foreground); border-color: var(--vscode-foreground); }
.copy-btn.copied { color: #4ec9b0; border-color: #4ec9b0; }
.code-block pre {
    margin: 0;
    padding: 10px 12px;
    overflow-x: auto;
    font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre;
}
.code-block pre code { background: none; padding: 0; border-radius: 0; font-size: inherit; }

/* ─── Streaming cursor ─── */
.streaming-cursor::after {
    content: '▋';
    animation: blink 0.8s step-start infinite;
}
@keyframes blink { 50% { opacity: 0; } }

/* ─── Retry button ─── */
.retry-btn {
    display: inline-block;
    margin-top: 8px;
    padding: 3px 10px;
    font-size: 11px;
    background: transparent;
    color: var(--vscode-descriptionForeground);
    border: 1px solid var(--vscode-widget-border, #444);
    border-radius: 3px;
    cursor: pointer;
    font-family: var(--vscode-font-family);
    transition: all 0.15s;
}
.retry-btn:hover { color: var(--vscode-foreground); border-color: var(--vscode-foreground); }

.msg-meta { display: block; font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 8px; opacity: 0.6; }

.thinking { align-self: flex-start; display: flex; gap: 4px; align-items: center; padding: 12px 16px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, #444); border-radius: 3px 14px 14px 14px; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vscode-descriptionForeground); animation: bounce 1.2s ease-in-out infinite; }
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes bounce { 0%,60%,100% { transform:translateY(0);opacity:.4; } 30% { transform:translateY(-5px);opacity:1; } }

.input-area { padding: 12px 16px 16px; border-top: 1px solid var(--vscode-widget-border, #333); flex-shrink: 0; position: relative; }

/* ─── Slash command menu ─── */
.slash-menu {
    position: absolute;
    bottom: calc(100% + 2px);
    left: 16px;
    right: 16px;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border, #444);
    border-radius: 4px;
    overflow: hidden;
    z-index: 50;
    box-shadow: 0 -4px 16px rgba(0,0,0,0.3);
}
.slash-item {
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    gap: 12px;
    align-items: baseline;
    font-size: 12px;
    transition: background 0.1s;
}
.slash-item:hover, .slash-item.active { background: var(--vscode-list-hoverBackground); }
.slash-cmd { font-weight: 700; color: var(--vscode-textLink-foreground, #4fc1ff); width: 80px; flex-shrink: 0; font-family: monospace; }
.slash-desc { color: var(--vscode-descriptionForeground); }

#prompt {
    width: 100%; min-height: 64px; max-height: 160px;
    padding: 10px 12px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: 4px; resize: vertical;
    font-family: var(--vscode-font-family); font-size: 13px; line-height: 1.5;
    margin-bottom: 8px;
}
#prompt:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }

.input-footer { display: flex; justify-content: space-between; align-items: center; }
.hint-text { font-size: 11px; color: var(--vscode-descriptionForeground); }

#send-btn { padding: 6px 20px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; font-size: 13px; font-weight: 600; font-family: var(--vscode-font-family); transition: background 0.15s; }
#send-btn:hover { background: var(--vscode-button-hoverBackground); }
#send-btn:disabled { opacity: 0.45; cursor: not-allowed; }

#key-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 100; align-items: center; justify-content: center; padding: 40px; }
#key-overlay.show { display: flex; }
.overlay-card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 20px; width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 10px; }
.overlay-title { font-size: 14px; font-weight: 600; }
.overlay-row { display: flex; gap: 8px; }
#overlay-key-input { flex: 1; padding: 8px 12px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); border-radius: 4px; font-size: 13px; font-family: monospace; }
#overlay-key-input:focus { outline: 1px solid var(--vscode-focusBorder); }
.secondary-btn { padding: 7px 14px; background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-widget-border); border-radius: 4px; cursor: pointer; font-size: 13px; font-family: var(--vscode-font-family); }
</style>
</head>
<body data-has-key="${hasKey}">

<!-- ═══ ONBOARDING ═══ -->
<div id="onboarding" style="${onboardingStyle}">
    <div class="brand">
        <div class="brand-logo">⚡</div>
        <div class="brand-title">Groq Coder</div>
        <div class="brand-sub">AI coding assistant — powered by Groq</div>
    </div>
    <div id="setup-bubbles">
        <div class="setup-bubble">👋 Hey! Welcome to Groq Coder.</div>
        <div class="setup-bubble">I'm your AI coding assistant, powered by Groq's lightning-fast inference.</div>
        <div class="setup-bubble">I can write code, build full projects, create real files in your workspace, and explain your open file.</div>
        <div class="setup-bubble">To get started, paste your free Groq API key below. It takes 30 seconds to get one. 🚀</div>
    </div>
    <div id="key-section">
        <button class="get-key-btn" id="get-key-btn">🔑 Get your free API key at console.groq.com →</button>
        <div class="key-row">
            <input type="password" id="api-key-input" placeholder="Paste your key here (gsk_...)">
            <button class="primary-btn" id="save-key-btn">Connect</button>
        </div>
        <div id="key-error"></div>
    </div>
</div>

<!-- ═══ CHAT ═══ -->
<div id="chat-app" style="${chatStyle}">
    <div class="toolbar">
        <select id="model-select" title="Select AI model">
            <option value="auto">⚡ Auto</option>
            <optgroup label="── Production ──">
                <option value="llama-3.3-70b-versatile">Llama 3.3 70B · Best Quality</option>
                <option value="llama-3.1-8b-instant">Llama 3.1 8B · Fastest</option>
            </optgroup>
            <optgroup label="── Preview ──">
                <option value="moonshotai/kimi-k2-instruct-0905">Kimi K2 · 262K context</option>
                <option value="meta-llama/llama-4-scout-17b-16e-instruct">Llama 4 Scout 17B</option>
            </optgroup>
        </select>
        <button class="toolbar-btn" id="plan-btn" title="Toggle Plan Mode">📋 Plan</button>
        <button class="icon-btn" id="clear-btn" title="Clear chat history" style="display:inline-flex;align-items:center;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
        <button class="icon-btn" id="key-btn" title="Change API key" style="display:inline-flex;align-items:center;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
        </button>
    </div>
    <div id="messages"></div>
    <div id="file-indicator" style="display:none; align-items:center; gap:6px; padding:3px 12px; font-size:11px; color:var(--vscode-descriptionForeground); border-top:1px solid var(--vscode-widget-border,#333); flex-shrink:0;">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
        <span id="file-indicator-name"></span> attached
    </div>
    <div class="input-area">
        <div class="slash-menu" id="slash-menu"></div>
        <textarea id="prompt" placeholder="Ask anything… or type / for commands"></textarea>
        <div class="input-footer">
            <span class="hint-text">Enter ↵ send · Shift+Enter newline · / commands</span>
            <button id="send-btn">Send</button>
        </div>
    </div>
</div>

<!-- ═══ KEY OVERLAY ═══ -->
<div id="key-overlay">
    <div class="overlay-card">
        <div class="overlay-title">🔑 Update API Key</div>
        <input type="password" id="overlay-key-input" placeholder="Paste new Groq key (gsk_...)">
        <div class="overlay-row">
            <button class="secondary-btn" id="overlay-cancel">Cancel</button>
            <button class="primary-btn" id="overlay-save" style="flex:1">Save Key</button>
        </div>
    </div>
</div>

<script src="${scriptUri}"></script>
</body>
</html>`;
    }

    private async _readWorkspaceFiles(): Promise<string> {
        const files = await vscode.workspace.findFiles(
            '**/*.{ts,js,tsx,jsx,py,html,css,json,md,php,go,rs,java,c,cpp,h,vue,svelte}',
            '{**/node_modules/**,**/dist/**,**/out/**,**/.git/**}',
            40
        );

        let context = '\n\n--- Workspace Files ---\n';
        let totalChars = 0;
        const MAX_CHARS = 60000;

        for (const file of files) {
            if (totalChars >= MAX_CHARS) { break; }
            try {
                const bytes = await vscode.workspace.fs.readFile(file);
                const text = Buffer.from(bytes).toString('utf8');
                const relativePath = vscode.workspace.asRelativePath(file);
                const snippet = text.slice(0, 4000);
                context += `\n### ${relativePath}\n\`\`\`\n${snippet}${text.length > 4000 ? '\n... (truncated)' : ''}\n\`\`\`\n`;
                totalChars += snippet.length;
            } catch { /* skip unreadable files */ }
        }

        return context;
    }

    public dispose() {
        ChatPanel.current = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) { d.dispose(); }
        }
    }
}
