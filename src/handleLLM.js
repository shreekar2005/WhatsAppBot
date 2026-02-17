const fs = require('fs');
const { CONFIG, MEMORY_FILE, USE_CLOUD_FIRST, CLOUD_MODEL, LOCAL_MODEL, OPENROUTER_API_KEY } = require('./config');
const { getKnowledgeBase, scrubSensitiveData, delay } = require('./utils');

function getSystemPrompt() {
    const timeNow = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const { status, facts } = getKnowledgeBase();
    const identityLine = `You are ${CONFIG.agent_name} — ${CONFIG.owner_name}'s Personal Assistant.`;

    return `
${identityLine}
${CONFIG.my_style}

CURRENT TIME: ${timeNow}

MY KNOWLEDGE (About ${CONFIG.owner_name}):
- CURRENT STATUS: ${status}
- If status is "Available", tell them to call ${CONFIG.owner_name} directly.
- If status is "Busy", take a message. If urgent, tell them to call ${CONFIG.owner_name}.
${facts}

${CONFIG.security_rules}
`;
}

// Function receives chatHistory map from index.js
async function askLLM(senderID, userText, chatHistory) {
    // 1. PREPARE CONTEXT
    let userContext = chatHistory.get(senderID) || [];
    userContext.push({ role: 'user', content: userText });

    // Keep memory short (last 30 messages)
    if (userContext.length > 30) userContext = userContext.slice(-30);

    const payloadMessages = [
        { role: 'system', content: getSystemPrompt() },
        ...userContext
    ];

    let cleanReply = "";
    let capturedReasoning = null; 

    // --- HELPER: CALL OPENROUTER ---
    const callOpenRouter = async () => {
        console.log(`☁️  Using Cloud Model: ${CLOUD_MODEL}`);
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'WhatsApp Bot'
            },
            body: JSON.stringify({
                model: CLOUD_MODEL,
                messages: payloadMessages,
                reasoning: { enabled: true }, 
                stream: false,
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        if (!response.ok) {
            const errData = await response.text();
            throw new Error(`OpenRouter Error: ${response.status} - ${errData}`);
        }
        const data = await response.json();
        const msg = data.choices?.[0]?.message;
        return { content: msg?.content, reasoning_details: msg?.reasoning_details };
    };

    // --- HELPER: CALL LOCAL OLLAMA ---
    const callOllama = async () => {
        console.log(`🦙 Using Local Model: ${LOCAL_MODEL}`);
        const response = await fetch('http://127.0.0.1:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: LOCAL_MODEL,
                messages: payloadMessages,
                stream: false,
                options: { num_ctx: 4096, num_predict: 1000, temperature: 0.7 }
            })
        });
        if (!response.ok) throw new Error(`Ollama Error: ${response.status}`);
        const data = await response.json();
        return { content: data.message?.content };
    };

    // 2. EXECUTE WITH FALLBACK LOGIC
    try {
        let result = null;
        if (USE_CLOUD_FIRST) {
            try { result = await callOpenRouter(); } 
            catch (cloudErr) {
                console.error("⚠️ Cloud failed, switching to Local:", cloudErr.message);
                result = await callOllama();
            }
        } else {
            try { result = await callOllama(); } 
            catch (localErr) {
                console.error("⚠️ Local failed, switching to Cloud:", localErr.message);
                result = await callOpenRouter();
            }
        }
        
        if (result) {
            cleanReply = result.content;
            capturedReasoning = result.reasoning_details;
        }

    } catch (finalError) {
        console.error("❌ All AI providers failed:", finalError);
        return "I'm having trouble connecting to my brain right now.";
    }

    // 3. FINAL CLEANUP & SAVE
    if (!cleanReply) cleanReply = "I'm speechless.";
    cleanReply = scrubSensitiveData(cleanReply);
    
    const assistantMsg = { role: 'assistant', content: cleanReply };
    if (capturedReasoning) assistantMsg.reasoning_details = capturedReasoning;

    userContext.push(assistantMsg);
    chatHistory.set(senderID, userContext);
    
    // Save memory to file
    try { fs.writeFileSync(MEMORY_FILE, JSON.stringify([...chatHistory])); } 
    catch (err) { console.error("error saving memory:", err); }

    await delay(1000 + Math.random() * 1000);
    return cleanReply;
}

module.exports = { askLLM };