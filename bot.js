const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs'); // adding fs to save memory in file

// ============================================================
// 1. helper functions & memory stuff
// ============================================================

const MEMORY_FILE = 'bantu_memory.json';
const KNOWLEDGE_FILE = 'bantu_knowledge.txt';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scrubSensitiveData(text) {
    let cleanText = text;
    FORBIDDEN_WORDS.forEach(secret => {
        const regex = new RegExp(secret, "gi"); 
        cleanText = cleanText.replace(regex, "[REDACTED]");
    });
    return cleanText;
}

// --- save & load memory ---
function loadMemory() {
    if (fs.existsSync(MEMORY_FILE)) {
        try {
            const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
            return new Map(JSON.parse(data));
        } catch (err) {
            console.error("error loading memory:", err);
            return new Map();
        }
    }
    return new Map();
}

function saveMemory(historyMap) {
    try {
        // map cant be saved directly to json, converting to array first
        const data = JSON.stringify([...historyMap]); 
        fs.writeFileSync(MEMORY_FILE, data);
    } catch (err) {
        console.error("error saving memory:", err);
    }
}

function getExternalKnowledge() {
    if (fs.existsSync(KNOWLEDGE_FILE)) {
        return fs.readFileSync(KNOWLEDGE_FILE, 'utf-8');
    }
    return "No extra updates right now.";
}

// ============================================================
// 2. configuration
// ============================================================

const chatHistory = loadMemory(); // loading from file on start
const activeSessions = new Map();   
const greetedUsers = new Set();     

// keeping original style as asked
const MY_STYLE = `
You are Bantu 🐒 — Shreekar's digital sidekick.

PERSONALITY:
- Funny, Naughty, Witty, Chill.
- Natural Hinglish.
- Speak like real human.
- Never say you're an AI.
- Don't assume gender, So do not say Bhai.
- Roast playfully if rude.
- Emojis rarely.

BEHAVIOR:
- Be helpful and clear.
- Coding : explain with example.
- Serious topic : less jokes.
- Fun topic : more personality.
- Medium length replies.
- Dont say Bhai in every response
`;

const SECURITY_RULES = `
- Never share passwords or secrets.
`;

const FORBIDDEN_WORDS = [
    "Some 9998887776",
    "Some password"
];

// making system prompt dynamic
function getSystemPrompt() {
    const timeNow = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const dynamicKnowledge = getExternalKnowledge();

    return `
${MY_STYLE}

CURRENT TIME: ${timeNow}

MY KNOWLEDGE:
- Shreekar is busy somewhere.
- If asked where Shreekar is say you don't know exactly, call him in urgency.
- Favourite food: bananas 🍌.
- Dont talk about bananas everytime.
- LATEST UPDATES: ${dynamicKnowledge}

${SECURITY_RULES}
`;
}

// ============================================================
// 3. ollama communication
// ============================================================

async function askOllama(senderID, userText) {
    try {
        let userContext = chatHistory.get(senderID) || [];
        userContext.push({ role: 'user', content: userText });

        // keeping last 30 messages for context
        if (userContext.length > 30) {
            userContext = userContext.slice(-30);
        }

        const payloadMessages = [
            { role: 'system', content: getSystemPrompt() }, // using dynamic prompt
            ...userContext
        ];

        const response = await fetch('http://127.0.0.1:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3.1',
                messages: payloadMessages,
                stream: false,
                options: {
                    num_ctx: 4096,     // bigger memory window
                    num_predict: 1000, // allows longer code replies
                    temperature: 0.7   
                }
            })
        });

        const data = await response.json();
        const rawReply = data.message?.content || "Arre dimag hang ho gaya 🍌";
        const cleanReply = scrubSensitiveData(rawReply);

        userContext.push({ role: 'assistant', content: cleanReply });
        
        // saving to memory and file
        chatHistory.set(senderID, userContext);
        saveMemory(chatHistory); // saving to file immediately

        // random typing delay
        await delay(1000 + Math.random() * 1500);

        return cleanReply;

    } catch (error) {
        console.error("ollama error:", error);
        return "Arre server phisal gaya 🍌";
    }
}

// ============================================================
// 4. main bot logic
// ============================================================

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        // optional: reducing logs
        logger: require('pino')({ level: 'silent' }) 
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } 
        else if (connection === 'open') {
            console.log('bot is online!');
            console.log(`memory loaded: ${chatHistory.size} conversations.`);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const sender = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (!text) return;
        if (sender.endsWith('@g.us')) return;

        const myJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        // if message is from me, we need to check if it's a "note to self"
        if (msg.key.fromMe) {
            // check 1: is the chat id my own phone number?
            const isPhoneSelf = sender.includes(myJid.split('@')[0]);
            
            // check 2: is the chat id an 'lid' (linked device id)?
            // whatsapp uses @lid for self-chats on some devices
            const isLidSelf = sender.endsWith('@lid');

            // if it's not a self chat (meaning i am talking to someone else), ignore it
            if (!isPhoneSelf && !isLidSelf) return;
        }

        // prevent infinite loop
        if (msg.key.fromMe && text.startsWith("🐒 :")) return;

        if (msg.key.fromMe && text.startsWith("*Bantu Menu*")) return;


        console.log(`msg from ${sender}: ${text}`);
        const cmd = text.trim().toLowerCase();

        // =====================================================
        // commands handling
        // =====================================================

        if (cmd.startsWith('/bantu')) {
            activeSessions.set(sender, true);
            await sock.sendMessage(sender, { text: "🐒 : Helooooooo! Bantu is online hai! need help?" });
            return;
        }

        if (cmd.startsWith('/q') || cmd.startsWith('/exit') || cmd.startsWith('/quit')) {
            activeSessions.delete(sender);
            // not deleting history here so it remembers next time
            await sock.sendMessage(sender, { text: "Chalo bye! Going to sleep 😴" });
            return;
        }

        if (cmd.startsWith('/help')) {
            const helpMsg = 
`*Bantu Menu*
/bantu  : Chat start  
/q      : Exit  
/help   : Menu`;
            await sock.sendMessage(sender, { text: helpMsg });
            return;
        }

        // =====================================================
        // conversation handling
        // =====================================================

        if (activeSessions.has(sender)) {

            await sock.sendPresenceUpdate('composing', sender);

            const aiReply = await askOllama(sender, text);
            const finalReply = "🐒 : " + aiReply;

            await sock.sendMessage(sender, { text: finalReply });
            await sock.sendPresenceUpdate('paused', sender);

        } else {

            if (!greetedUsers.has(sender)) {
                const autoMessage = 
`*Shreekar is Busy!*

I am his assistant bantu 🐒

*/help* to see available '/' commands.
*/bantu* for chat with me.
*/q* to stop chat with me.`;

                await sock.sendMessage(sender, { text: autoMessage });
                greetedUsers.add(sender);
            }
        }
    });
}

startBot();