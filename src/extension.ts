import * as vscode from 'vscode';
import { SidebarProvider } from './sidebarProvider';
import { ChatPanel } from './chatPanel';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SidebarProvider.viewType,
            new SidebarProvider(context.extensionUri),
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('groqCoder.startChat', () => {
            ChatPanel.createOrShow(context.extensionUri, context);
        })
    );
}

export function deactivate() {}
