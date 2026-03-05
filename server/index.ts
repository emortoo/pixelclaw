import * as path from 'path';
import * as http from 'http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { OpenClawController } from '../src/openclawController.js';
import { STANDALONE_PORT } from '../src/constants.js';
import { agentDB } from '../src/agentDatabase.js';
import { floorManager } from '../src/floorManager.js';
import { meetingManager } from '../src/meetingManager.js';
import { agentAI } from '../src/agentBehavior.js';
import { setupWeb4API } from '../src/web4api.js';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Parse JSON bodies
app.use(express.json());

// Setup Web4 API routes
setupWeb4API(app);

// Serve webview static files
const webviewDist = path.join(__dirname, 'webview');
app.use(express.static(webviewDist));

// Control Center route
app.get('/control', (_req, res) => {
	res.sendFile(path.join(webviewDist, 'control-center.html'));
});

// Web4 status endpoint
app.get('/api/status', (_req, res) => {
	const activeFloor = floorManager.getActiveFloor();
	const agents = agentDB.list();
	res.json({
		status: 'running',
		version: '2.0.0-web4',
		activeFloor: activeFloor.id,
		totalAgents: agents.length,
		activeAgents: agents.filter(a => a.state.status === 'working').length,
		floors: Object.keys(floorManager.listFloors()).length
	});
});

// Floor switch endpoint with WebSocket notification
app.post('/api/floors/:id/activate', (req, res) => {
	const floorId = req.params.id;
	const success = floorManager.switchFloor(floorId);
	
	if (!success) {
		return res.status(404).json({ error: 'Floor not found' });
	}
	
	// Notify all clients to reload
	broadcast({
		type: 'floorChanged',
		floorId,
		message: `Switched to ${floorManager.getFloor(floorId)?.name || floorId}`
	});
	
	res.json({ success: true, floorId });
});

// Fallback for SPA routing
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

// Assets root: dist/ directory
const assetsRoot = __dirname;

wss.on('connection', (ws) => {
	clients.add(ws);
	console.log(`[Server] Client connected (total: ${clients.size})`);
	
	// Send Web4 welcome message
	ws.send(JSON.stringify({
		type: 'web4Welcome',
		message: 'Connected to PixelClaw Web4',
		version: '2.0.0'
	}));

	ws.on('message', async (raw) => {
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(raw.toString());
		} catch {
			return;
		}

		// Handle Web4 messages
		if (message.type === 'agentStatusUpdate') {
			const { agentId, status, task } = message as { agentId: string; status: string; task?: string };
			agentDB.setStatus(agentId, status as any, task);
			broadcast({
				type: 'agentStatusChanged',
				agentId,
				status,
				task
			});
			return;
		}

		if (message.type === 'agentMove') {
			const { agentId, floorId, seatId, x, y } = message as { 
				agentId: string; floorId: string; seatId: string; x: number; y: number 
			};
			agentDB.setPosition(agentId, floorId, seatId, x, y);
			broadcast({
				type: 'agentMoved',
				agentId,
				floorId,
				seatId,
				x,
				y
			});
			return;
		}

		if (message.type === 'requestFloorList') {
			const floors = floorManager.listFloors();
			ws.send(JSON.stringify({
				type: 'floorList',
				floors,
				activeFloorId: floorManager.getActiveFloor().id
			}));
			return;
		}

		if (message.type === 'switchFloor') {
			const { floorId } = message as { floorId: string };
			const success = floorManager.switchFloor(floorId);
			if (success) {
				broadcast({
					type: 'floorChanged',
					floorId,
					message: `Switched to ${floorManager.getFloor(floorId)?.name || floorId}`
				});
			}
			return;
		}

		if (message.type === 'webviewReady') {
			const clientPostMessage = (msg: Record<string, unknown>) => {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify(msg));
				}
			};
			await controller.handleWebviewReady(assetsRoot, clientPostMessage);
			
			// Send Web4 state
			ws.send(JSON.stringify({
				type: 'web4State',
				activeFloor: floorManager.getActiveFloor(),
				agents: agentDB.list().map(a => ({
					id: a.profile.id,
					name: a.profile.name,
					role: a.profile.role,
					status: a.state.status,
					floorId: a.position.floorId,
					seatId: a.position.seatId
				}))
			}));
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
	console.log(`\n  🚀 PixelClaw Web4 Server running at:`);
	console.log(`  http://localhost:${port}`);
	console.log(`  API: http://localhost:${port}/api/status\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
	console.log('\n[Server] Shutting down...');
	agentAI.stop();
	agentDB.save();
	floorManager.saveCurrentLayout();
	controller.stop();
	wss.close();
	server.close();
	process.exit(0);
});
