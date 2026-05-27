import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = 8080;
const ENGINE_PATH = './stockfish.exe';

const wss = new WebSocketServer({ port: PORT });
console.log(`🚀 [Server] Local Server đang chạy tại ws://localhost:${PORT}`);

let engine: ChildProcessWithoutNullStreams;
try {
    engine = spawn(ENGINE_PATH);
    console.log('♟️ [Server] Động cơ Stockfish Native đã khởi động!');
} catch (error) {
    console.error('🔥 [Server] Không tìm thấy file stockfish.exe!', error);
    process.exit(1);
}

engine.stdin.write('uci\n');
engine.stdin.write('setoption name Hash value 4096\n');
engine.stdin.write('setoption name Threads value 8\n');
engine.stdin.write('setoption name Use NNUE value true\n');

const clients = new Set<WebSocket>();

wss.on('connection', (ws: WebSocket) => {
    console.log('✅ [Server] Extension đã kết nối!');
    clients.add(ws);

    engine.stdin.write('isready\n');

    ws.on('message', (message: string) => {
        engine.stdin.write(`${message}\n`);
    });

    ws.on('close', () => {
        console.log('❌ [Server] Extension ngắt kết nối.');
        clients.delete(ws);
    });
});

let stdoutBuffer = '';
engine.stdout.on('data', (data: Buffer) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split('\n');

    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
            if (
                trimmed.startsWith('bestmove') ||
                trimmed.startsWith('readyok')
            ) {
                clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(trimmed);
                    }
                });
            }
        }
    }
});

engine.stderr.on('data', (data: Buffer) =>
    console.error(`Lỗi Engine: ${data.toString()}`),
);

process.on('SIGINT', () => {
    console.log('\n🛑 [Server] Đang tắt hệ thống, giải phóng CPU...');
    engine.kill('SIGKILL');
    process.exit();
});
