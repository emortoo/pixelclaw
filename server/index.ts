import * as path from 'path';
import * as http from 'http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { OpenClawController } from '../src/openclawController.js';
import { STANDALONE_PORT } from '../src/constants.js';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Serve webview static files
const webviewDist = path.join(__dirname, 'webview');
app.use(express.static(webviewDist));

// Fallback for SPA routing (Express 5 syntax)
app.get('/{*path}', (_req, res) => {
	res.sendFile(path.join(webviewDist, 'index.html'));
});

// Controller
const controller = new OpenClawController();

// Track connected clients
const clients = new Set<WebSocket>();

// Broadcast to all connected clients
function broadcast(msg: Record<string, unknown>): void {
	const data = JSON.stringify(msg);
	for (const ws of clients) {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(data);
		}
	}
}

controller.setPostMessage(broadcast);
controller.start();

// Assets root: dist/ directory (same level as server.js)
const assetsRoot = __dirname;

wss.on('connection', (ws) => {
	clients.add(ws);
	console.log(`[Server] Client connected (total: ${clients.size})`);

	ws.on('message', async (raw) => {
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(raw.toString());
		} catch {
			return;
		}

		if (message.type === 'webviewReady') {
			// Send full state to this specific client (not broadcast)
			const clientPostMessage = (msg: Record<string, unknown>) => {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify(msg));
				}
			};
			await controller.handleWebviewReady(assetsRoot, clientPostMessage);
		} else {
			controller.handleMessage(message);
		}
	});

	ws.on('close', () => {
		clients.delete(ws);
		console.log(`[Server] Client disconnected (total: ${clients.size})`);
	});
});

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : STANDALONE_PORT;
server.listen(port, () => {
	console.log(`\n  PixelClaw standalone server running at:`);
	console.log(`  http://localhost:${port}\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
	console.log('\n[Server] Shutting down...');
	controller.stop();
	wss.close();
	server.close();
	process.exit(0);
});
