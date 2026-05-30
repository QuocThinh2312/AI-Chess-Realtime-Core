import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';

const PORT = 8080;
const ENGINE_PATH = path.join(__dirname, '../stockfish.exe');
const SYZYGY_PATH = path.join(__dirname, '../Syzygy');

class ChessServer {
    private wss: WebSocketServer;
    private engine!: ChildProcessWithoutNullStreams;
    private clients: Set<WebSocket> = new Set();
    private stdoutBuffer: string = '';

    constructor() {
        this.wss = new WebSocketServer({ port: PORT });
        console.log(
            `🚀 [Server] Local Server đang chạy tại ws://localhost:${PORT}`,
        );
        this.initEngine();
        this.setupWebSocket();
        this.handleShutdown();
    }

    private initEngine() {
        try {
            this.engine = spawn(ENGINE_PATH);
            console.log('♟️ [Server] Động cơ Stockfish Native đã khởi động!');

            const initCommands = [
                'uci',
                'setoption name Hash value 4096',
                'setoption name Threads value 8',
                'setoption name Use NNUE value true',
                `setoption name SyzygyPath value ${SYZYGY_PATH}`,
                'setoption name SyzygyProbeDepth value 1',
                'setoption name SyzygyProbeLimit value 7',
                'setoption name Syzygy50MoveRule value true',
                'isready',
            ];
            this.engine.stdin.write(initCommands.join('\n') + '\n');

            this.engine.stdout.on('data', this.handleEngineOutput.bind(this));
            this.engine.stderr.on('data', (data) =>
                console.error(`[Engine Error]: ${data}`),
            );

            this.engine.on('close', (code) => {
                console.error(
                    `🔥 [Server] Stockfish crash (Code: ${code}). Đang khởi động lại...`,
                );
                this.initEngine();
            });
        } catch (error) {
            console.error(
                '🔥 [Server] Không tìm thấy file stockfish.exe!',
                error,
            );
            process.exit(1);
        }
    }

    private handleEngineOutput(data: Buffer) {
        this.stdoutBuffer += data.toString();
        let newlineIndex;

        while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
            const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
            this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

            if (line.startsWith('bestmove') || line.startsWith('readyok')) {
                this.broadcast(line);
            }
        }
    }

    private setupWebSocket() {
        this.wss.on('connection', (ws: WebSocket) => {
            console.log('✅ [Server] Extension đã kết nối!');
            this.clients.add(ws);
            this.engine.stdin.write('isready\n');

            ws.on('message', (message: string) => {
                this.engine.stdin.write(`${message}\n`);
            });

            ws.on('close', () => {
                console.log('❌ [Server] Extension ngắt kết nối.');
                this.clients.delete(ws);
            });
        });
    }

    private broadcast(message: string) {
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }

    private handleShutdown() {
        process.on('SIGINT', () => {
            console.log('\n🛑 [Server] Đang tắt hệ thống, giải phóng CPU...');
            if (this.engine) this.engine.kill('SIGKILL');
            process.exit();
        });
    }
}

new ChessServer();
