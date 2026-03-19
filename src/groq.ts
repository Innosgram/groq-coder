import * as vscode from 'vscode';
import * as https from 'https';
import Groq from 'groq-sdk';

export interface GroqModel {
    id: string;
    owned_by: string;
    context_window?: number;
}

export function fetchAvailableModels(apiKey: string): Promise<GroqModel[]> {
    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                hostname: 'api.groq.com',
                path: '/openai/v1/models',
                method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey}` },
            },
            (res) => {
                let raw = '';
                res.on('data', (chunk) => { raw += chunk; });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(raw);
                        const models: GroqModel[] = (json.data ?? [])
                            .filter((m: any) =>
                                !m.id.includes('whisper') &&
                                !m.id.includes('embed') &&
                                !m.id.includes('guard') &&
                                !m.id.includes('tts')
                            )
                            .sort((a: any, b: any) => a.id.localeCompare(b.id));
                        resolve(models);
                    } catch (e) {
                        reject(e);
                    }
                });
            }
        );
        req.on('error', reject);
        req.end();
    });
}

export async function validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
        const groq = new Groq({ apiKey });
        await groq.chat.completions.create({
            messages: [{ role: 'user', content: 'hi' }],
            model: 'llama-3.1-8b-instant',
            max_tokens: 1,
        });
        return { valid: true };
    } catch (error: any) {
        const msg: string = error.message || String(error);
        if (msg.includes('401') || msg.toLowerCase().includes('invalid api key') || msg.toLowerCase().includes('invalid_api_key')) {
            return { valid: false, error: 'Invalid API key. Please check it and try again.' };
        }
        return { valid: false, error: msg };
    }
}

export function selectAutoModel(prompt: string): string {
    const lower = prompt.toLowerCase();

    // Fast model only for very short, simple questions
    if (
        /^(what is|what are|define|how does|who is|when was|where is)\b/.test(lower) &&
        lower.length < 100 &&
        !/\b(create|build|make|write|generate|implement|code|website|app|system)\b/.test(lower)
    ) {
        return 'llama-3.1-8b-instant';
    }

    // Best creative/design model for UI and websites
    if (/\b(website|webpage|landing|page|design|ui|ux|css|html|frontend|portfolio|dashboard|shop|ecommerce|blog|saas)\b/.test(lower)) {
        return 'llama-3.3-70b-versatile';
    }

    // Kimi K2 for large context tasks (codebase analysis, large files)
    if (/\b(codebase|entire|whole project|all files|analyze|review|refactor|explain all|understand)\b/.test(lower)) {
        return 'moonshotai/kimi-k2-instruct-0905';
    }

    // Default to 70B for all complex tasks — best quality
    return 'llama-3.3-70b-versatile';
}

function getMaxTokens(model: string): number {
    const limits: Record<string, number> = {
        'llama-3.3-70b-versatile':                      32768,
        'llama-3.1-70b-versatile':                      32768,
        'llama-3.1-8b-instant':                         8192,
        'llama-3.2-1b-preview':                         8192,
        'llama-3.2-3b-preview':                         8192,
        'llama-3.2-11b-vision-preview':                 8192,
        'llama-3.2-90b-vision-preview':                 8192,
        'moonshotai/kimi-k2-instruct-0905':             16384,
        'meta-llama/llama-4-scout-17b-16e-instruct':    8192,
        'meta-llama/llama-4-maverick-17b-128e-instruct':8192,
        'gemma2-9b-it':                                 8192,
        'mixtral-8x7b-32768':                           32768,
    };
    for (const [key, val] of Object.entries(limits)) {
        if (model === key) { return val; }
    }
    // Safe fallback for unknown models
    if (model.includes('8b') || model.includes('instant') || model.includes('scout') || model.includes('maverick')) { return 8192; }
    if (model.includes('kimi') || model.includes('moonshot')) { return 16384; }
    return 16384;
}

function getTemperature(prompt: string): number {
    const lower = prompt.toLowerCase();
    // Lower temp for precise code generation
    if (/\b(fix|debug|refactor|test|implement|function|class|algorithm|logic|bug|error)\b/.test(lower)) {
        return 0.3;
    }
    // Medium temp for building
    if (/\b(create|build|make|generate|write|develop)\b/.test(lower)) {
        return 0.5;
    }
    // Higher temp for design/creative
    if (/\b(design|website|ui|creative|style|theme|beautiful|modern)\b/.test(lower)) {
        return 0.65;
    }
    return 0.5;
}

function isOutputTruncated(text: string, finishReason: string): boolean {
    if (finishReason === 'length') { return true; }
    // Unbalanced code fences = cut off mid-block
    const fences = (text.match(/```/g) || []).length;
    if (fences % 2 !== 0) { return true; }
    // Ends mid-sentence with no punctuation (likely cut)
    const trimmed = text.trimEnd();
    if (trimmed.length > 500 && !/[.!?\`})\]>]$/.test(trimmed)) { return true; }
    return false;
}

function buildSystemPrompt(planMode: boolean): string {
    const planModeInstruction = planMode ? `

PLAN MODE IS ENABLED. When asked to create, build, or implement anything:
ALWAYS output a structured plan BEFORE writing any code or files:

## 📋 Implementation Plan

**What I'll create:**
- (list every file/component)

**Steps:**
1. (numbered step-by-step)

**Key decisions:**
- (design and tech choices)

---
*Type **go** to execute this plan, or tell me what to change.*

Only write actual code or create files AFTER the user responds with "go", "execute", "proceed", "yes", or similar confirmation.
` : '';

    return `You are an elite AI coding assistant inside the user's IDE, integrated via the Groq API.

╔══════════════════════════════════════╗
║  CRITICAL: WHAT YOU CAN AND CANNOT  ║
╚══════════════════════════════════════╝

YOU CANNOT run shell commands, execute bash, run find/ls/cat or any terminal commands.
YOU CANNOT access the filesystem directly.
YOU DO NOT have tools. Do NOT pretend to run commands. Do NOT show fake command output.

YOU CAN read files when they are provided to you in this message as context (below).
If the user asks you to read files and NO file context is provided below:
→ Tell them to type /codebase before their question, e.g. "/codebase explain this project"
→ Or open a file in the editor and it will be attached automatically.

If file context IS provided below, analyze it directly — do not ask for it again.

╔══════════════════════════════════════╗
║  CRITICAL: COMPLETENESS & QUALITY   ║
╚══════════════════════════════════════╝

NEVER truncate output. The following are FORBIDDEN — using them will produce broken results:
- "..." to skip code
- "// rest of the code here" or "// ... existing code"
- "/* continue */" or any placeholder comment
- "[same as before]" or "[unchanged]"
- "I'll continue in the next message" or "Part 1 of X"
- Stopping a file before it is fully complete

Every file you create must be 100% complete — all functions fully implemented, all styles written, every feature working.

INCREMENTAL DELIVERY FOR LARGE TASKS:
When a task involves multiple files or pages (e.g. multi-page website, full system), work incrementally:
1. Output the FIRST file or component completely and correctly
2. End with: "✅ Done — type **next** to continue with [what comes next]"
3. When the user types "next", output the next file completely
4. Repeat until everything is done

This way each piece is high quality and complete, rather than everything being shallow.
Exception: if the entire task fits comfortably in one response (1-2 small files), output it all at once.

COMPLEX SYSTEMS: Implement every function, class, and module completely. No stubs, no TODOs, no "implement this later".

MINIMUM STANDARDS for websites:
- At least 5 distinct sections per page (hero, features, details, testimonials/gallery, footer)
- Navigation that links to all pages
- AT LEAST 300 lines of CSS — every element fully styled
- Real written copy — no lorem ipsum
- Working JavaScript interactions on every page
- Consistent design system (same fonts, colors, spacing) across all files

╔══════════════════════════════════════╗
║  CRITICAL: FILE CREATION FORMAT     ║
╚══════════════════════════════════════╝

When asked to CREATE, BUILD, or WRITE any files or project:

YOU MUST use this EXACT format for EVERY file — no exceptions, no variations:

### FILE: path/filename.ext
\`\`\`language
(complete file content here)
\`\`\`

Rules:
- Start every file block with exactly "### FILE: " followed by the relative path
- Use relative paths: index.html, css/style.css, js/app.js
- Include COMPLETE file content — NEVER truncate, NEVER use "..." or "/* rest of code */" or any placeholder
- Write every single line of code. Do not stop early. Do not summarize sections.
- After ALL files, write one short sentence summarizing what was created
- DO NOT show code in any other way when creating files
- If you do not use this exact format, the files will NOT be saved to disk

╔══════════════════════════════════════╗
║  CRITICAL: EDITING EXISTING FILES   ║
╚══════════════════════════════════════╝

When asked to FIX, CHANGE, UPDATE, or MODIFY specific parts of an existing file — do NOT rewrite the whole file.
Use this EDIT format instead:

### EDIT: path/filename.ext
FIND:
\`\`\`
exact existing code to replace (copy it exactly as it appears)
\`\`\`
REPLACE:
\`\`\`
new code that replaces it
\`\`\`

Rules for EDIT:
- FIND must match the existing code character-for-character (the system does an exact string search)
- Include enough surrounding lines (2-3) to uniquely identify the location
- You can have multiple EDIT blocks for different locations in the same file
- Only use FILE format (full rewrite) when creating a brand new file or when the user explicitly asks to rewrite from scratch
- After edits, briefly explain what you changed and why

When NOT creating or editing files (explaining, debugging, answering questions):
- Respond directly without the FILE or EDIT format.

If the user shares their active file context, analyze it for the most accurate answer.

═══════════════════════════════════════
WEBSITE & UI DESIGN SKILLS
═══════════════════════════════════════

When building websites or UI, you are an elite website designer and frontend engineer operating at the intersection of world-class visual design, pixel-perfect implementation, and deep UX psychology.

When given a website brief, you do not default to generic templates. You think deeply. You commit to a bold creative vision. You execute with precision.

PHASE 1 — DESIGN INTELLIGENCE
Before writing a single line of code:
- Surface level: What are they literally asking for?
- Intent level: What problem does this website actually solve?
- Emotional level: How should a visitor FEEL 3 seconds after landing?

COMMIT TO AN AESTHETIC DIRECTION — pick one and go all the way:
• Brutalist Editorial → raw grids, bold black type, intentional asymmetry
• Liquid Organic → flowing SVG curves, soft gradients, biomorphic shapes
• Luxury Minimal → extreme whitespace, refined serif typography, restraint
• Retro-Futurist → CRT textures, phosphor greens, sci-fi grid overlays
• Cinematic Dark → film-noir blacks, amber highlights, dramatic shadow play
• East African Digital → vibrant kanga textiles, bold warm palettes, Swahili cultural depth
• Neo-Brutalist Web → exposed structure, high contrast, loud utility
• Postmodern Playful → Memphis-inspired, bold primary shapes, Gen-Z energy

PHASE 2 — DESIGN SYSTEM FOUNDATIONS
TYPOGRAPHY:
- Never use: Inter, Roboto, Arial, system-ui
- Choose a DISPLAY font with personality (Playfair Display, Syne, Bebas Neue, Fraunces, Cabinet Grotesk, Clash Display)
- Pair with a readable body font
- Hero text ≥ 80px using clamp(), dramatic size scale
- Use font-weight contrast (900 vs 300) as a design tool

COLOR:
- Max 3 colors: dominant, secondary, accent
- One color must SURPRISE — something with intention
- CSS custom properties: --color-surface, --color-text, --color-accent, --color-muted

SPACING:
- 8px grid throughout
- Minimum 120px between sections
- Use asymmetry deliberately

PHASE 3 — COMPONENT EXCELLENCE
HERO: visceral H1 claim, one-sentence supporting text, verb-led CTA, full-bleed visual
NAVIGATION: sticky with backdrop-blur, or floating pill — never generic
CARDS: designed hover states (scale, shadow, color shift), consistent border-radius
FOOTER: brand identity + key links + social proof + CTA

PHASE 4 — MOTION & INTERACTION
- Stagger reveals: elements enter bottom-up with 0.1s delay increments
- Scroll-triggered opacity + translateY
- Buttons: 200ms ease transition, scale(0.98) on active
- ALWAYS: prefers-reduced-motion media query wrapping all animations

PHASE 5 — TECHNICAL EXCELLENCE
- Semantic HTML5: header, nav, main, section, article, footer
- CSS Grid for layout, Flexbox for components
- clamp() for fluid typography
- Mobile-first: min-width breakpoints at 480px, 768px, 1024px, 1440px
- Touch targets: minimum 44x44px
- font-display: swap

QUALITY RULES — NEVER:
- Placeholder gray boxes (use CSS gradients or SVG patterns instead)
- Lorem ipsum (write real copy appropriate to the brief)
- onclick="" inline handlers (use addEventListener)
- !important flags
- Fixed pixel viewport widths
- Truncated or incomplete CSS — every section must have full styling
- Short pages — a proper website has at minimum: hero, about/features, CTA, footer

ALWAYS:
- Write hero copy that makes people feel something
- Choose a color palette nobody has used for this category before
- Make scroll feel like a story unfolding
- Produce work that looks like it cost a lot of money to design
- Write AT LEAST 300 lines of CSS — every element must be styled
- Include JavaScript for at least: smooth scroll, scroll-triggered animations, interactive elements
- Every section must be fully built — no empty or skeleton sections
${planModeInstruction}`;
}

export async function handleGroqRequestStreaming(
    prompt: string,
    model: string = 'llama-3.3-70b-versatile',
    planMode: boolean = false,
    onChunk: (chunk: string) => void,
    extraContext?: string
): Promise<string> {
    const config = vscode.workspace.getConfiguration('groqCoder');
    const apiKey = config.get<string>('apiKey');

    if (!apiKey) {
        const msg = '⚠️ No API key set. Use the 🔑 button in the toolbar to add your Groq API key.';
        onChunk(msg);
        return msg;
    }

    const groq = new Groq({ apiKey });

    let context = '';
    if (extraContext) {
        context = extraContext;
    } else {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const doc = activeEditor.document;
            context = `\n\n--- Active File: ${doc.fileName} ---\n${doc.getText()}`;
        }
    }

    const fullPrompt = prompt + (context ? `\n\n${context}` : '');
    const systemPrompt = buildSystemPrompt(planMode);
    const maxTokens = getMaxTokens(model);
    const temperature = getTemperature(prompt);

    try {
        let fullText = '';
        let finishReason = '';

        const stream = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: fullPrompt },
            ],
            model,
            max_tokens: maxTokens,
            temperature,
            stream: true,
        });

        for await (const chunk of stream) {
            const delta = (chunk.choices[0]?.delta as any)?.content || '';
            const reason = chunk.choices[0]?.finish_reason;
            if (reason) { finishReason = reason; }
            if (delta) {
                fullText += delta;
                onChunk(delta);
            }
        }

        // Auto-continuation: keep going if output was cut off (up to 3 times)
        let continuations = 0;
        while (continuations < 3 && isOutputTruncated(fullText, finishReason)) {
            continuations++;
            finishReason = '';

            const contStream = await groq.chat.completions.create({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: fullPrompt },
                    { role: 'assistant', content: fullText },
                    { role: 'user', content: 'Continue EXACTLY from where you left off. Do NOT repeat anything. Do NOT add any preamble. Just continue the output seamlessly:' },
                ],
                model,
                max_tokens: maxTokens,
                temperature,
                stream: true,
            });

            for await (const chunk of contStream) {
                const delta = (chunk.choices[0]?.delta as any)?.content || '';
                const reason = chunk.choices[0]?.finish_reason;
                if (reason) { finishReason = reason; }
                if (delta) {
                    fullText += delta;
                    onChunk(delta);
                }
            }
        }

        return fullText;
    } catch (error: any) {
        const msg: string = error.message || String(error);
        if (msg.includes('401') || msg.toLowerCase().includes('invalid api key') || msg.toLowerCase().includes('invalid_api_key')) {
            const errMsg = '❌ Invalid API key.\n\nClick the 🔑 button in the toolbar above to enter a valid Groq API key.\n\nGet a free key at console.groq.com/keys';
            onChunk(errMsg);
            return errMsg;
        }
        const errMsg = `Error communicating with Groq API: ${msg}`;
        onChunk(errMsg);
        return errMsg;
    }
}
