"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const chatWebview_1 = require("./chatWebview");
function activate(context) {
    console.log('Groq Coder extension is now active!');
    let disposable = vscode.commands.registerCommand('groqCoder.startChat', () => {
        chatWebview_1.ChatWebview.createOrShow(context.extensionUri);
    });
    context.subscriptions.push(disposable);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map