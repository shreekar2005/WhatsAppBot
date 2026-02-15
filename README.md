# whatsapp bot

this project implements a whatsapp bot using the baileys library. it handles authentication via qr code, maintains persistent sessions, and auto-replies to specific messages.

### directory structure

```text
.
├── auth_info/           # session credentials (generated automatically) (ignored by git)
├── node_modules/        # dependencies (ignored by git)
├── bot.js               # main bot logic
├── package.json         # npm configuration
├── package-lock.json    # dependency lock file
└── README.md
```

note: the `auth_info/` folder is generated automatically when you run the code and scan the qr code. it contains sensitive session data and should not be committed to git.

### how it works

the bot operates on a simple event-based architecture:

1. **authentication:**

* uses `useMultiFileAuthState` to store session credentials in the `auth_info` directory.
* on the first run, it generates a qr code in the terminal. scanning this with your whatsapp mobile app links the device.

2. **connection handling:**

* auto-reconnects if the connection drops (e.g., internet issues).
* stops trying to reconnect only if the user explicitly logs out from the mobile app.

3. **message listener:**

* listens for the `messages.upsert` event to detect new incoming messages.
* checks the text content of the message. if a user sends **"hello"** (case-insensitive), the bot replies with: *"tune muze hello bolaa, ye le mera HII."*

### key files and functions

**`bot.js`**

* `startBot()`: main function that initializes the socket connection.
* `saveCreds`: updates the `auth_info` folder whenever session keys change to keep the login alive.
* `sock.ev.on('messages.upsert')`: the core logic that parses incoming messages and triggers replies.

### how to run

1. **clone the repository**
download the code to your local machine.

```bash
git clone https://github.com/shreekar2005/WhatsAppBot.git
```

2. **navigate to directory**
enter the project folder.

```bash
cd WhatsAppBot
```

3. **install dependencies**
install the required libraries (@whiskeysockets/baileys, qrcode-terminal) as defined in `package.json`.

```bash
npm install
```

4. **start the bot**
run the bot script.

```bash
node bot.js
```

5. **scan qr code**

* the terminal will display a qr code.
* open whatsapp on your phone -> three dots -> linked devices -> link a device.
* scan the code.

6. **test the bot**

* send "hello" to yourself
* the bot should reply immediately to that.