// Groq Coder — Sidebar Script

const vscode = acquireVsCodeApi();
let planMode = false;
let isWaiting = false;
let lastUserText = '';
let lastModel = 'auto';
let lastPlanMode = false;
let streamBuffer = '';
let streamMsgDiv = null;
const DEFAULT_MODEL = 'moonshotai/kimi-k2-instruct-0905';

const hasKey = document.body.dataset.hasKey === 'true';

// ─── Markdown renderer ─────────────────────────────────────────────────────

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderInline(text) {
    return escapeHtml(text)
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderMarkdown(text) {
    const lines = text.split('\n');
    let html = '';
    let i = 0;
    let inList = false;

    while (i < lines.length) {
        const line = lines[i];

        // Fenced code block
        if (line.startsWith('```')) {
            if (inList) { html += '</ul>'; inList = false; }
            const lang = line.slice(3).trim();
            let code = '';
            i++;
            while (i < lines.length && !lines[i].startsWith('```')) {
                code += lines[i] + '\n';
                i++;
            }
            // Remove trailing newline
            if (code.endsWith('\n')) { code = code.slice(0, -1); }
            const langLabel = lang || 'code';
            html += `<div class="code-block"><div class="code-header"><span class="code-lang">${escapeHtml(langLabel)}</span><button class="copy-btn" data-copy>Copy</button></div><pre><code>${escapeHtml(code)}</code></pre></div>`;
            i++;
            continue;
        }

        // Horizontal rule
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
            if (inList) { html += '</ul>'; inList = false; }
            html += '<hr>';
            i++;
            continue;
        }

        // Headers
        if (line.startsWith('### ')) {
            if (inList) { html += '</ul>'; inList = false; }
            html += `<h3>${renderInline(line.slice(4))}</h3>`;
            i++; continue;
        }
        if (line.startsWith('## ')) {
            if (inList) { html += '</ul>'; inList = false; }
            html += `<h2>${renderInline(line.slice(3))}</h2>`;
            i++; continue;
        }
        if (line.startsWith('# ')) {
            if (inList) { html += '</ul>'; inList = false; }
            html += `<h1>${renderInline(line.slice(2))}</h1>`;
            i++; continue;
        }

        // Unordered list
        if (/^[-*•] /.test(line)) {
            if (!inList) { html += '<ul>'; inList = true; }
            html += `<li>${renderInline(line.slice(2))}</li>`;
            i++; continue;
        }

        // Ordered list
        if (/^\d+\. /.test(line)) {
            if (inList) { html += '</ul>'; inList = false; }
            const content = line.replace(/^\d+\. /, '');
            html += `<li>${renderInline(content)}</li>`;
            i++; continue;
        }

        // Close list on blank/non-list line
        if (inList) { html += '</ul>'; inList = false; }

        // Blank line
        if (line.trim() === '') {
            i++; continue;
        }

        // Regular paragraph
        html += `<p>${renderInline(line)}</p>`;
        i++;
    }

    if (inList) { html += '</ul>'; }

    return html;
}

// ─── Copy code handler ─────────────────────────────────────────────────────

document.addEventListener('click', (e) => {
    if (!e.target || !e.target.hasAttribute('data-copy')) { return; }
    const btn = e.target;
    const code = btn.closest('.code-block').querySelector('code').textContent;
    vscode.postMessage({ command: 'copyToClipboard', text: code });
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
    }, 2000);
});

// ─── Onboarding ────────────────────────────────────────────────────────────

document.getElementById('get-key-btn').addEventListener('click', () => {
    vscode.postMessage({ command: 'openExternal', url: 'https://console.groq.com/keys' });
});

document.getElementById('save-key-btn').addEventListener('click', saveKey);
document.getElementById('api-key-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { saveKey(); }
});

function saveKey() {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) { return; }
    document.getElementById('key-error').style.display = 'none';
    document.getElementById('save-key-btn').textContent = 'Connecting...';
    document.getElementById('save-key-btn').disabled = true;
    vscode.postMessage({ command: 'saveApiKey', key });
}

// ─── Screen switching ───────────────────────────────────────────────────────

function showOnboarding() {
    document.getElementById('onboarding').style.display = 'flex';
    document.getElementById('chat-app').style.display = 'none';
}

function showChat() {
    document.getElementById('onboarding').style.display = 'none';
    document.getElementById('chat-app').style.display = 'flex';
    if (document.getElementById('messages').children.length === 0) {
        addMessage(
            'Hey! I\'m Groq Coder ⚡\n\nI can:\n• Write & explain code\n• Create full projects with real files\n• Read your open file for context\n• Plan before building (toggle 📋 Plan Mode)\n\nType `/` to see all commands. Open a folder, then try:\n\'create a portfolio website\'',
            'ai'
        );
    }
    setTimeout(() => document.getElementById('prompt').focus(), 100);
}

// ─── Plan mode ─────────────────────────────────────────────────────────────

document.getElementById('plan-btn').addEventListener('click', () => {
    planMode = !planMode;
    const btn = document.getElementById('plan-btn');
    btn.classList.toggle('active', planMode);
    btn.textContent = planMode ? '📋 Plan: ON' : '📋 Plan';
    addMessage(
        planMode
            ? '📋 Plan Mode ON — I\'ll outline a plan before writing any code.'
            : '📋 Plan Mode OFF — executing directly.',
        'system-note'
    );
});

// ─── Clear history ──────────────────────────────────────────────────────────

document.getElementById('clear-btn').addEventListener('click', () => {
    document.getElementById('messages').innerHTML = '';
    vscode.postMessage({ command: 'clearHistory' });
    addMessage('Chat history cleared.', 'system-note');
});

// ─── Key overlay ────────────────────────────────────────────────────────────

document.getElementById('key-btn').addEventListener('click', () => {
    document.getElementById('key-overlay').classList.add('show');
    setTimeout(() => document.getElementById('overlay-key-input').focus(), 50);
});

document.getElementById('overlay-cancel').addEventListener('click', () => {
    document.getElementById('key-overlay').classList.remove('show');
});

document.getElementById('overlay-save').addEventListener('click', saveOverlayKey);
document.getElementById('overlay-key-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { saveOverlayKey(); }
    if (e.key === 'Escape') { document.getElementById('overlay-cancel').click(); }
});

function saveOverlayKey() {
    const key = document.getElementById('overlay-key-input').value.trim();
    if (!key) { return; }
    vscode.postMessage({ command: 'saveApiKey', key });
    document.getElementById('key-overlay').classList.remove('show');
    document.getElementById('overlay-key-input').value = '';
    addMessage('✅ API key updated.', 'system-note');
}

// ─── Slash command menu ─────────────────────────────────────────────────────

const SLASH_COMMANDS = [
    { cmd: '/codebase',  desc: 'Send all workspace files as context' },
    { cmd: '/selection', desc: 'Send your highlighted/selected code as context' },
    { cmd: '/explain',   desc: 'Explain the active file in detail' },
    { cmd: '/fix',       desc: 'Find and fix bugs in the active file' },
    { cmd: '/test',      desc: 'Write unit tests for the active file' },
    { cmd: '/doc',       desc: 'Add documentation comments to the active file' },
    { cmd: '/refactor',  desc: 'Refactor the active file for clarity' },
    { cmd: '/commit',    desc: 'Write a git commit message for the changes' },
];

const SLASH_PROMPTS = {
    '/explain':  'Explain the following code in detail — what it does, how it works, key patterns, and anything tricky:',
    '/fix':      'Find and fix all bugs in the following code. List each bug and what you changed to fix it:',
    '/test':     'Write comprehensive unit tests for the following code. Cover all edge cases:',
    '/doc':      'Add clear JSDoc/docstring comments to every function and class in the following code:',
    '/refactor': 'Refactor the following code to be cleaner, more readable, and follow best practices. Explain key changes:',
    '/commit':   'Write a clear, concise git commit message for the following code changes. Use conventional commit format:',
};

let slashMenuIndex = -1;

const promptEl = document.getElementById('prompt');
const slashMenuEl = document.getElementById('slash-menu');

function updateSlashMenu() {
    const val = promptEl.value;
    if (!val.startsWith('/')) {
        slashMenuEl.innerHTML = '';
        slashMenuEl.style.display = 'none';
        slashMenuIndex = -1;
        return;
    }
    const query = val.toLowerCase();
    const filtered = SLASH_COMMANDS.filter(c => c.cmd.startsWith(query));
    if (filtered.length === 0) {
        slashMenuEl.innerHTML = '';
        slashMenuEl.style.display = 'none';
        slashMenuIndex = -1;
        return;
    }
    slashMenuEl.innerHTML = filtered.map((c, i) =>
        `<div class="slash-item${i === slashMenuIndex ? ' active' : ''}" data-cmd="${c.cmd}">
            <span class="slash-cmd">${c.cmd}</span>
            <span class="slash-desc">${c.desc}</span>
        </div>`
    ).join('');
    slashMenuEl.style.display = 'block';

    slashMenuEl.querySelectorAll('.slash-item').forEach(item => {
        item.addEventListener('click', () => {
            promptEl.value = item.dataset.cmd + ' ';
            slashMenuEl.innerHTML = '';
            slashMenuEl.style.display = 'none';
            promptEl.focus();
        });
    });
}

promptEl.addEventListener('input', updateSlashMenu);

promptEl.addEventListener('keydown', e => {
    const items = slashMenuEl.querySelectorAll('.slash-item');
    if (slashMenuEl.style.display === 'block' && items.length > 0) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            slashMenuIndex = Math.min(slashMenuIndex + 1, items.length - 1);
            items.forEach((el, i) => el.classList.toggle('active', i === slashMenuIndex));
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            slashMenuIndex = Math.max(slashMenuIndex - 1, 0);
            items.forEach((el, i) => el.classList.toggle('active', i === slashMenuIndex));
            return;
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
            const activeItem = slashMenuIndex >= 0 ? items[slashMenuIndex] : items[0];
            if (activeItem) {
                e.preventDefault();
                promptEl.value = activeItem.dataset.cmd + ' ';
                slashMenuEl.innerHTML = '';
                slashMenuEl.style.display = 'none';
                slashMenuIndex = -1;
                return;
            }
        }
        if (e.key === 'Escape') {
            slashMenuEl.innerHTML = '';
            slashMenuEl.style.display = 'none';
            slashMenuIndex = -1;
            return;
        }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

function processSlashCommand(text) {
    const lower = text.trim().toLowerCase();
    for (const [cmd, prefix] of Object.entries(SLASH_PROMPTS)) {
        if (lower.startsWith(cmd)) {
            const rest = text.trim().slice(cmd.length).trim();
            return rest ? `${prefix}\n\n${rest}` : prefix;
        }
    }
    return text;
}

// ─── Messages ───────────────────────────────────────────────────────────────

function addMessage(text, type, modelUsed) {
    const container = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'msg ' + type;

    if (type === 'ai') {
        div.innerHTML = renderMarkdown(text);
    } else {
        div.textContent = text;
    }

    if (modelUsed && type === 'ai') {
        const meta = document.createElement('span');
        meta.className = 'msg-meta';
        meta.textContent = '↳ ' + modelUsed;
        div.appendChild(meta);
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
}

function addThinking() {
    const container = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'thinking';
    div.id = 'thinking-indicator';
    div.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function removeThinking() {
    const el = document.getElementById('thinking-indicator');
    if (el) { el.remove(); }
}

function addRetryButton(msgDiv, text, model, pm) {
    const btn = document.createElement('button');
    btn.className = 'retry-btn';
    btn.textContent = '↺ Retry';
    btn.addEventListener('click', () => {
        if (isWaiting) { return; }
        btn.remove();
        sendMessageWith(text, model, pm);
    });
    msgDiv.appendChild(btn);
}

// ─── Send message ───────────────────────────────────────────────────────────

document.getElementById('send-btn').addEventListener('click', sendMessage);

function sendMessage() {
    const input = promptEl;
    const text = input.value.trim();
    if (!text || isWaiting) { return; }

    // Close slash menu
    slashMenuEl.innerHTML = '';
    slashMenuEl.style.display = 'none';

    const model = document.getElementById('model-select').value;
    input.value = '';
    sendMessageWith(text, model, planMode);
}

function sendMessageWith(text, model, pm) {
    if (isWaiting) { return; }

    lastUserText = text;
    lastModel = model;
    lastPlanMode = pm;

    const processed = processSlashCommand(text);
    const displayText = text; // show original in chat

    addMessage(displayText, 'user');
    addThinking();
    isWaiting = true;
    document.getElementById('send-btn').disabled = true;
    promptEl.disabled = true;

    vscode.postMessage({ command: 'sendMessage', text: processed, model, planMode: pm });
}

// ─── Messages from extension ────────────────────────────────────────────────

window.addEventListener('message', event => {
    const msg = event.data;
    const container = document.getElementById('messages');

    switch (msg.command) {

        case 'historyLoaded': {
            const chatEl = document.getElementById('chat-app');
            if (chatEl.style.display === 'none') { break; }
            const messages = msg.messages || [];
            if (messages.length === 0) {
                addMessage(
                    'Hey! I\'m Groq Coder ⚡\n\nI can:\n• Write & explain code\n• Create full projects with real files\n• Read your open file for context\n• Plan before building (toggle 📋 Plan Mode)\n\nType `/` to see all commands. Open a folder, then try:\n\'create a portfolio website\'',
                    'ai'
                );
            } else {
                messages.forEach(m => {
                    addMessage(m.text, m.type, m.model || null);
                });
            }
            break;
        }

        case 'modelsLoaded': {
            const select = document.getElementById('model-select');
            const previousValue = select.value;
            const groups = {};
            msg.models.forEach(m => {
                const owner = m.owned_by || 'Other';
                if (!groups[owner]) { groups[owner] = []; }
                groups[owner].push(m);
            });
            select.innerHTML = '<option value="auto">⚡ Auto</option>';
            Object.entries(groups).forEach(([owner, models]) => {
                const group = document.createElement('optgroup');
                group.label = '── ' + owner + ' ──';
                models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.id;
                    group.appendChild(opt);
                });
                select.appendChild(group);
            });
            const allValues = [...select.options].map(o => o.value);
            if (previousValue !== 'auto' && allValues.includes(previousValue)) {
                select.value = previousValue;
            } else if (allValues.includes(DEFAULT_MODEL)) {
                select.value = DEFAULT_MODEL;
            }
            break;
        }

        case 'streamStart': {
            removeThinking();
            streamBuffer = '';
            streamMsgDiv = document.createElement('div');
            streamMsgDiv.className = 'msg ai streaming-cursor';
            container.appendChild(streamMsgDiv);
            container.scrollTop = container.scrollHeight;
            break;
        }

        case 'streamChunk': {
            if (!streamMsgDiv) { break; }
            streamBuffer += msg.text;
            streamMsgDiv.innerHTML = renderMarkdown(streamBuffer);
            container.scrollTop = container.scrollHeight;
            break;
        }

        case 'streamDone': {
            if (!streamMsgDiv) { break; }
            streamMsgDiv.classList.remove('streaming-cursor');
            streamMsgDiv.innerHTML = renderMarkdown(msg.text);

            if (msg.resolvedModel) {
                const meta = document.createElement('span');
                meta.className = 'msg-meta';
                meta.textContent = '↳ ' + msg.resolvedModel;
                streamMsgDiv.appendChild(meta);
            }

            addRetryButton(streamMsgDiv, lastUserText, lastModel, lastPlanMode);

            streamMsgDiv = null;
            streamBuffer = '';
            isWaiting = false;
            document.getElementById('send-btn').disabled = false;
            promptEl.disabled = false;
            promptEl.focus();
            break;
        }

        case 'apiKeyValidating':
            break;

        case 'apiKeyInvalid': {
            const btn = document.getElementById('save-key-btn');
            btn.textContent = 'Connect';
            btn.disabled = false;
            const errEl = document.getElementById('key-error');
            errEl.textContent = '❌ ' + (msg.error || 'Invalid API key. Please check and try again.');
            errEl.style.display = 'block';
            break;
        }

        case 'apiKeySaved':
            showChat();
            break;

        case 'apiKeyCleared':
            showOnboarding();
            break;

        case 'activeFileChanged': {
            const bar = document.getElementById('file-indicator');
            if (msg.fileName) {
                document.getElementById('file-indicator-name').textContent = msg.fileName;
                bar.style.display = 'flex';
            } else {
                bar.style.display = 'none';
            }
            break;
        }

        case 'contextNote':
            addMessage(msg.text, 'system-note');
            break;
    }
});

// ─── Signal ready to extension ──────────────────────────────────────────────

vscode.postMessage({ command: 'ready' });
