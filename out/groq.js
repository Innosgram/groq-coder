"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleGroqRequest = handleGroqRequest;
const vscode = require("vscode");
const groq_sdk_1 = require("groq-sdk");
async function handleGroqRequest(prompt) {
    const config = vscode.workspace.getConfiguration('groqCoder');
    const apiKey = config.get('apiKey');
    if (!apiKey) {
        return "⚠️ Please set your 'groqCoder.apiKey' in VS Code Settings first (File > Preferences > Settings).";
    }
    const groq = new groq_sdk_1.default({ apiKey });
    // Gather context from active editor
    let context = "";
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const doc = activeEditor.document;
        context = `\n\n--- Current Active File: ${doc.fileName} ---\n${doc.getText()}`;
    }
    const fullPrompt = prompt + (context ? `\n\nHere is the user's current active file for context:\n${context}` : "");
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: "You are an elite AI coding assistant inside the user's IDE. You are integrated using the Groq API. Provide concise, direct, and highly accurate coding answers. If the user shares their active file context, analyze it to write the best possible answer."
                },
                {
                    role: 'user',
                    content: fullPrompt
                }
            ],
            model: 'llama3-8b-8192', // Replace with 'llama3-70b-8192' or 'mixtral-8x7b-32768' for better capacity
        });
        return chatCompletion.choices[0]?.message?.content || "No response generated from Groq.";
    }
    catch (error) {
        return `Error communicating with Groq API: ${error.message || error}`;
    }
}
//# sourceMappingURL=groq.js.map