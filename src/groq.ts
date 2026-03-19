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

    if (/\b(entire codebase|whole project|all files|large file|long document|summarize everything)\b/.test(lower)) {
        return 'moonshotai/kimi-k2-instruct-0905';
    }
    if (/\b(what is|what are|define|explain briefly|quick|simple|how does)\b/.test(lower) && lower.length < 120) {
        return 'llama-3.1-8b-instant';
    }
    if (/\b(website|webpage|landing|design|ui|ux|css|html|animation|beautiful|modern|creative|portfolio|dashboard)\b/.test(lower)) {
        return 'llama-3.3-70b-versatile';
    }
    if (/\b(create|build|make|implement|write|generate|develop|refactor|fix|debug)\b/.test(lower)) {
        return 'llama-3.3-70b-versatile';
    }
    return 'moonshotai/kimi-k2-instruct-0905';
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

Example of correct output:
### FILE: index.html
\`\`\`html
<!DOCTYPE html>
<html>...</html>
\`\`\`

### FILE: css/style.css
\`\`\`css
body { margin: 0; }
\`\`\`

Created a homepage with stylesheet.

When NOT creating files (explaining, debugging, answering questions):
- Respond directly without the FILE format.

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
- Write AT LEAST 150 lines of CSS — every element must be styled
- Include JavaScript for at least: smooth scroll, scroll-triggered animations, interactive elements
- Every section must be fully built — no empty or skeleton sections
${planModeInstruction}`;
}

export async function handleGroqRequestStreaming(
    prompt: string,
    model: string = 'llama-3.3-70b-versatile',
    planMode: boolean = false,
    onChunk: (chunk: string) => void
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
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        const doc = activeEditor.document;
        context = `\n\n--- Active File: ${doc.fileName} ---\n${doc.getText()}`;
    }

    const fullPrompt = prompt + (context ? `\n\n${context}` : '');
    const systemPrompt = buildSystemPrompt(planMode);

    try {
        const stream = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: fullPrompt },
            ],
            model,
            max_tokens: 8192,
            temperature: 0.7,
            stream: true,
        });

        let fullText = '';
        for await (const chunk of stream) {
            const delta = (chunk.choices[0]?.delta as any)?.content || '';
            if (delta) {
                fullText += delta;
                onChunk(delta);
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
