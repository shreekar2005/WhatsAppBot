const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { CONFIG, MEMORY_FILE, KNOWLEDGE_FILE, INFO_FILE, CONFIG_FILE, USE_CLOUD_FIRST, CLOUD_MODEL, LOCAL_MODEL } = require('./src/config');
const { updateStatus, appendInfo, getKnowledgeBase } = require('./src/utils');
const { askLLM } = require('./src/handleLLM');

// state variables
let chatHistory = new Map();
if (fs.existsSync(MEMORY_FILE)) {
    try { chatHistory = new Map(JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'))); } 
    catch (err) { chatHistory = new Map(); }
}

let activeSessions = new Map();
let mutedUsers = new Map(); // tracks users who paused auto-reply
let OWNER_GROUP_ID = null; 
let IS_AGENT_ACTIVE = false; 

function saveMemory() {
    try { fs.writeFileSync(MEMORY_FILE, JSON.stringify([...chatHistory])); } 
    catch (err) { console.error("error saving memory:", err); }
}

async function startAgent() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: require('pino')({ level: 'silent' }) 
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'close') {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startAgent();
        } else if (connection === 'open') {
            console.log(`${CONFIG.agent_name} is ready! (State: Sleeping) 💤`);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || !msg.key.remoteJid) return;

        // --- 1. DEFINING THE "ROOM" (Chat Context) ---
        let roomLid = msg.key.remoteJid;

        
        // --- 2. DEFINING THE "SENDER" (Who spoke) ---
        // If it's a group, the sender is 'participant'.
        let senderLid = msg.key.participant;

        // --- 3. DEFINING ME ---
        const myOwnLid = sock.user.lid.split(':')[0] + "@lid"; // my lid = my (message yourself) chats lid
        // if(msg.key.fromMe) actualSender=myOwnLid;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) return;

        // guard blocks
        let textByAgent = false;
        if (text.startsWith(`${CONFIG.agent_name} `)) textByAgent=true;
        if (text.startsWith(`*${CONFIG.agent_name} `)) textByAgent=true;
        if (text.startsWith(`💤 ${CONFIG.agent_name} `)) textByAgent=true;
        if (text.startsWith(`*${CONFIG.owner_name} is Busy!*`)) textByAgent=true;
        if (text.startsWith(`Commands for Agent ${CONFIG.agent_name}`)) textByAgent=true;

        // --- 5. DISPLAY NAMES ---
        let userName = msg.pushName;
        if (msg.key.fromMe) {
            userName = textByAgent ? `${CONFIG.agent_name}` : "YOU (Owner)";
        }
        if (!userName) userName = "Unknown User";

        // --- 6. CHECK GROUP STATUS ---
        const isGroup = roomLid.endsWith('@g.us');
        const isNoteToSelf = !isGroup && msg.key.fromMe && (roomLid === myOwnLid);

        // --- 7. BETTER LOGGING ---
        let chatType = isGroup ? "[Group Chat]" : "[Private Chat]";
        
         
        if(senderLid) console.log(`👤 Who: ${userName} (${senderLid})`);
        else console.log(`👤 Who: ${userName}`);
        console.log(`🏠 Chat: ${roomLid} ${chatType}`);
        console.log(`💬 Msg: ${text}`);
        console.log(`------------------------------------------------`);

        if (text.trim().toLowerCase().startsWith('/ignore')) return;
        if(textByAgent) return;

        // admin group logic
        if (isGroup) {
            if (!OWNER_GROUP_ID) {
                try {
                    const metadata = await sock.groupMetadata(roomLid);
                    if (metadata.subject === CONFIG.owner_group_name) {
                        OWNER_GROUP_ID = roomLid;
                        await sock.sendMessage(roomLid, { text: `${CONFIG.agent_name} : Owner Group Connected! Type /help.` });
                        console.log("✅ Owner Group Linked:", OWNER_GROUP_ID);
                    }
                } catch (err) {}
            }

            if (roomLid === OWNER_GROUP_ID) {
                const cmd = text.trim();
                const cmdLower = cmd.toLowerCase();
                
                if (cmdLower === "/help") {
                    const adminMenu = 
`*${CONFIG.agent_name} Control Center*
- */wake* : Activate Agent
- */sleep* : Deactivate Agent
- */status* : Check Agent Status
- */agentname* : Check Agent Name
- */mystatus [msg]* : Update Owner Status
- */myinfo [msg]* : Add Fact
- */clear* : Wipe Memory`;
                    await sock.sendMessage(roomLid, { text: adminMenu });
                }
                else if (cmdLower === "/wake") { 
                    IS_AGENT_ACTIVE = true; 
                    await sock.sendMessage(roomLid, { text: `⚡ ${CONFIG.agent_name} is now AWAKE.` }); 
                }
                else if (cmdLower === "/sleep") { 
                    IS_AGENT_ACTIVE = false; 
                    await sock.sendMessage(roomLid, { text: `💤 ${CONFIG.agent_name} is now SLEEPING.` }); 
                }
                else if (cmdLower === "/status") {
                    const { status } = getKnowledgeBase();
                    const stateText = IS_AGENT_ACTIVE ? "✅ AWAKE" : "💤 SLEEPING";
                    await sock.sendMessage(roomLid, { text: `📊 Status: ${stateText}\n🧠 Owner Status: ${status || 'Empty'}` });
                }
                else if (cmd.startsWith("/mystatus")) {
                    const newStatus = text.slice(9).trim(); 
                    if (newStatus.length > 0) updateStatus(newStatus);
                    await sock.sendMessage(roomLid, { text: `✅ Status Updated` });
                }
                else if (cmd.startsWith("/myinfo")) {
                    const newInfo = text.slice(7).trim(); 
                    if (newInfo.length > 0) appendInfo(newInfo);
                    await sock.sendMessage(roomLid, { text: `✅ Fact Added` });
                }
                else if (cmdLower === "/clear") { 
                    chatHistory.clear(); saveMemory(); activeSessions.clear(); 
                    await sock.sendMessage(roomLid, { text: "🧹 System Reset Done." }); 
                }
                return; 
            }
        }

        // self chat filter
        if (msg.key.fromMe) {
            if (isNoteToSelf) {
                console.log("Self text detected!!!.");
                console.log(`------------------------------------------------`);
            } else {
                return; // sent to a friend, ignore
            }
        }

        // user logic
        const cmd = text.toLowerCase().trim();

        if (cmd === '/agent') {
            if (!IS_AGENT_ACTIVE) {
                await sock.sendMessage(roomLid, { text: `💤 ${CONFIG.agent_name} is currently sleeping.` });
                return;
            }
            activeSessions.set(roomLid, true);
            await sock.sendMessage(roomLid, { text: `${CONFIG.agent_name} : Yes, how can I help?` });
            return;
        }

        if (cmd === '/clear') {
            chatHistory.delete(roomLid);
            activeSessions.delete(roomLid);
            saveMemory();
            await sock.sendMessage(roomLid, { text: `${CONFIG.agent_name} : 🧹 Memory cleared` });
            return;
        }

        // new /sleep logic for users
        if (cmd === '/sleep' && !isGroup) {
            mutedUsers.set(roomLid, Date.now() + 30000); // 30 seconds
            await sock.sendMessage(roomLid, { text: `💤 Got it. I'll stop sending automated messages to you for 30 seconds.` });
            return;
        }

        if (cmd === '/help' && !isGroup) {
            const helpMenu = 
`Commands for Agent ${CONFIG.agent_name}
- */ignore <text>* : Agent will fully ignore text after '/ignore'
- */agent* : Start chat with agent
- */clear* : Clear your chat memory for agent
- */sleep* : Pause auto-replies for 30sec
- */q* : Stop chat with agent
- */help* : Show this menu
*WARNING* : Currently I am in development stage, so please be kind :)`;
            await sock.sendMessage(roomLid, { text: helpMenu });
            return;
        }

        if (!IS_AGENT_ACTIVE) return;

        if ((cmd === '/q' || cmd === '/exit') && activeSessions.has(roomLid)) {
            activeSessions.delete(roomLid);
            await sock.sendMessage(roomLid, { text: `${CONFIG.agent_name} : Bye! 👋` });
            return;
        }

        if (activeSessions.has(roomLid)) {
            await sock.sendPresenceUpdate('composing', roomLid);
            const aiReply = await askLLM(roomLid, text, chatHistory);
            await sock.sendMessage(roomLid, { text: `${CONFIG.agent_name} : ` + aiReply });
            await sock.sendPresenceUpdate('paused', roomLid);
        } else if (!isGroup) {
            // check if user is in "silent" period
            const muteExpiry = mutedUsers.get(roomLid);
            if (muteExpiry && Date.now() < muteExpiry) return; 

            // only send auto-message in private DMs
            await sock.sendMessage(roomLid, { text: 
`*${CONFIG.owner_name} is Busy!*
Assistant "${CONFIG.agent_name}" here.
Type /agent to talk.
Type /help for more help.
Type /sleep to pause this automated message for 30sec` });
        }
    });
}

startAgent();