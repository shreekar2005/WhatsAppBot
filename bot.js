const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

async function startBot() {
    // Manage session/auth state (saves login info in 'auth_info' folder)
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    // Initialize the connection
    const sock = makeWASocket({
        auth: state,
    });

    // Listen for connection updates (QR code, logging in, etc.)
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // manually print QR if that exists
        if (qr) {
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('Bot is online!');
        }
    });


    // Save credentials whenever they are updated
    sock.ev.on('creds.update', saveCreds);

    // THE MESSAGE LISTENER
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const sender = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        console.log(`Received message from ${sender}: ${text}`);

        if (text && text.toLowerCase() === 'hello') {
            await sock.sendMessage(sender, { text: 'tune muze hello bolaa, ye le mera HII.' });
        }
    });
}

// Start the bot
startBot();
