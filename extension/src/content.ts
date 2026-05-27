declare class Chess {
    reset(): void;
    move(m: string): any;
    fen(): string;
    turn(): 'w' | 'b';
    moves(options?: { verbose: boolean }): any[];
    history(options?: { verbose: boolean }): any[];
}

class UIController {
    private debugDot: HTMLDivElement;
    private svgLayer: SVGSVGElement | null = null;
    private boardObserver: ResizeObserver | null = null;
    private currentBoard: Element | null = null;

    constructor() {
        this.debugDot = document.createElement('div');
        this.debugDot.style.cssText =
            'position:fixed; bottom:15px; right:15px; width:15px; height:15px; background:#ef4444; border-radius:50%; z-index:999999; box-shadow: 0 0 10px rgba(0,0,0,0.5); pointer-events: none; transition: background-color 0.3s;';
        document.body.appendChild(this.debugDot);
    }

    public setStatus(color: string) {
        this.debugDot.style.background = color;
    }

    public getBoard(): Element | null {
        if (!this.currentBoard || !document.contains(this.currentBoard)) {
            this.currentBoard = document.querySelector(
                'cg-board, chess-board, .board',
            );
            this.attachResizeObserver();
        }
        return this.currentBoard;
    }

    public isBlackOrientation(): boolean {
        return !!document.querySelector(
            '.flipped, .orientation-black, [orientation="black"], .cg-wrap.orientation-black, chess-board.flipped',
        );
    }

    private attachResizeObserver() {
        if (this.boardObserver) this.boardObserver.disconnect();
        if (!this.currentBoard) return;
        this.boardObserver = new ResizeObserver(() => this.syncSvgPosition());
        this.boardObserver.observe(this.currentBoard);
    }

    private syncSvgPosition() {
        if (!this.svgLayer || !this.currentBoard) return;
        const rect = this.currentBoard.getBoundingClientRect();
        this.svgLayer.style.top = `${rect.top}px`;
        this.svgLayer.style.left = `${rect.left}px`;
        this.svgLayer.style.width = `${rect.width}px`;
        this.svgLayer.style.height = `${rect.height}px`;
    }

    public clearArrow() {
        if (this.svgLayer) this.svgLayer.innerHTML = '';
    }

    public renderArrow(moveString: string, isActive: boolean) {
        if (!moveString || moveString.length < 4) return;
        const board = this.getBoard();
        if (!board) return;

        if (!this.svgLayer) {
            this.svgLayer = document.createElementNS(
                'http://www.w3.org/2000/svg',
                'svg',
            );
            this.svgLayer.id = 'ai-core-arrow-layer';
            this.svgLayer.style.cssText =
                'position: fixed; pointer-events: none; z-index: 9999999 !important; overflow: visible; display: block;';
            document.body.appendChild(this.svgLayer);
            this.syncSvgPosition();
        }

        this.svgLayer.setAttribute('viewBox', '0 0 100 100');
        const isBlack = this.isBlackOrientation();

        const calcPercent = (sq: string) => {
            let f = sq.charCodeAt(0) - 97;
            let r = 8 - parseInt(sq[1]);
            if (isBlack) {
                f = 7 - f;
                r = 7 - r;
            }
            return { x: f * 12.5 + 6.25, y: r * 12.5 + 6.25 };
        };

        const ptStart = calcPercent(moveString.substring(0, 2));
        const ptEnd = calcPercent(moveString.substring(2, 4));
        const angle = Math.atan2(ptEnd.y - ptStart.y, ptEnd.x - ptStart.x);

        const uiColor = isActive
            ? 'rgba(16, 185, 129, 0.9)'
            : 'rgba(239, 68, 68, 0.9)';
        this.svgLayer.innerHTML = '';

        const line = document.createElementNS(
            'http://www.w3.org/2000/svg',
            'line',
        );
        line.setAttribute('x1', ptStart.x.toString());
        line.setAttribute('y1', ptStart.y.toString());
        line.setAttribute('x2', (ptEnd.x - 4 * Math.cos(angle)).toString());
        line.setAttribute('y2', (ptEnd.y - 4 * Math.sin(angle)).toString());
        line.setAttribute('stroke', uiColor);
        line.setAttribute('stroke-width', '2.5');
        line.setAttribute('stroke-linecap', 'round');

        const head = document.createElementNS(
            'http://www.w3.org/2000/svg',
            'polygon',
        );
        head.setAttribute('points', '0,0 -5,-3 -5,3');
        head.setAttribute('fill', uiColor);
        head.setAttribute(
            'transform',
            `translate(${ptEnd.x}, ${ptEnd.y}) rotate(${(angle * 180) / Math.PI})`,
        );

        this.svgLayer.appendChild(line);
        this.svgLayer.appendChild(head);
    }
}

class AICore {
    private engine = new Chess();
    private ui = new UIController();
    private ws: WebSocket | null = null;

    private state = {
        masterMoveList: [] as string[],
        lastHash: null as string | null,
        lastFen: null as string | null,
        lastAutomatedFen: null as string | null,
        computedBestMove: null as string | null,
        isAutoPilot: false,
        isExecuting: false,
        isServerReady: false,
    };

    private moveUpdateTimeout: number | undefined;
    private targetSelector = '';

    constructor() {
        this.initSelector();
        this.connectWebSocket();
        this.setupKeyboard();
        this.setupResetListeners();
        this.setupDOMObserver();
    }

    private initSelector() {
        const isChessCom = window.location.hostname.includes('chess.com');
        this.targetSelector = isChessCom
            ? '.move-list-container .move-text-component, .move-list-row .node, .move-list-live-response .node'
            : 'l4x rm, rm6 rm, u8t, kwdb, .tview2 m, v1f, .main-line-ply, [data-node], rm6 kwdb, l4x kwdb, m';
    }

    private connectWebSocket() {
        try {
            this.ws = new WebSocket('ws://localhost:8080');

            this.ws.onopen = () => this.ui.setStatus('#eab308');
            this.ws.onclose = () => {
                this.state.isServerReady = false;
                this.ui.setStatus('#ef4444');
                setTimeout(() => this.connectWebSocket(), 1000);
            };
            this.ws.onmessage = (e: MessageEvent) =>
                this.handleWSMessage(e.data);
        } catch {
            setTimeout(() => this.connectWebSocket(), 1000);
        }
    }

    private handleWSMessage(data: string) {
        if (data === 'readyok') {
            this.state.isServerReady = true;
            this.ui.setStatus('#10b981');
            this.processGameState(true);
        }

        if (data.startsWith('bestmove')) {
            const move = data.split(' ')[1];
            if (move === '(none)') return;

            const isLegal = this.engine
                .moves({ verbose: true })
                .some((m) => m.from + m.to + (m.promotion || '') === move);
            if (!isLegal) return;

            this.state.computedBestMove = move;
            this.ui.renderArrow(move, this.state.isAutoPilot);

            this.triggerAutomationIfNeeded();
        }
    }

    private isOurTurn(): boolean {
        const isBlack = this.ui.isBlackOrientation();
        return (
            (isBlack && this.engine.turn() === 'b') ||
            (!isBlack && this.engine.turn() === 'w')
        );
    }

    private triggerAutomationIfNeeded() {
        if (
            this.state.isAutoPilot &&
            this.state.computedBestMove &&
            !this.state.isExecuting &&
            this.isOurTurn()
        ) {
            const currentFen = this.engine.fen();
            if (this.state.lastAutomatedFen !== currentFen) {
                this.state.lastAutomatedFen = currentFen;
                this.executeHardwareClick(this.state.computedBestMove);
            }
        }
    }

    private setupKeyboard() {
        window.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.altKey && e.key.toLowerCase() === 'a') {
                this.state.isAutoPilot = !this.state.isAutoPilot;
                if (this.state.computedBestMove)
                    this.ui.renderArrow(
                        this.state.computedBestMove,
                        this.state.isAutoPilot,
                    );
                this.triggerAutomationIfNeeded();
            }
        });
    }

    private getCoords(board: Element, sq: string, isBlack: boolean) {
        const rect = board.getBoundingClientRect();
        let f = sq.charCodeAt(0) - 97;
        let r = 8 - parseInt(sq[1]);
        if (isBlack) {
            f = 7 - f;
            r = 7 - r;
        }
        return {
            x: rect.left + (f + 0.5) * (rect.width / 8),
            y: rect.top + (r + 0.5) * (rect.height / 8),
        };
    }

    private async executeHardwareClick(moveString: string) {
        if (!moveString || moveString.length < 4) return;
        const board = this.ui.getBoard();
        if (!board) return;

        this.state.isExecuting = true;
        const unlockTimer = setTimeout(() => {
            this.state.isExecuting = false;
        }, 1200);
        const isBlack = this.ui.isBlackOrientation();

        try {
            if (!chrome?.runtime?.sendMessage)
                throw new Error('Context Invalidated');
            const start = this.getCoords(
                board,
                moveString.substring(0, 2),
                isBlack,
            );
            const end = this.getCoords(
                board,
                moveString.substring(2, 4),
                isBlack,
            );

            await chrome.runtime.sendMessage({
                action: 'execute_hardware_click',
                x: start.x,
                y: start.y,
            });
            await new Promise((r) => setTimeout(r, 12));
            await chrome.runtime.sendMessage({
                action: 'execute_hardware_click',
                x: end.x,
                y: end.y,
            });
        } catch (err) {
            console.error('🔥 [AI Core] Lỗi click phần cứng:', err);
            this.state.isAutoPilot = false;
            this.ui.setStatus('#ef4444');
            this.ui.clearArrow();
        } finally {
            clearTimeout(unlockTimer);
            this.state.isExecuting = false;
        }
    }

    private setupResetListeners() {
        document.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const text = target.innerText?.toLowerCase() || '';
            if (
                text.includes('new 1 min') ||
                text.includes('new game') ||
                text.includes('rematch') ||
                text.includes('play again') ||
                target.closest(
                    '.game-over-button-component, .ui_v5-button-component, .game-row__overlay, .fbt',
                )
            ) {
                this.resetSystem();
            }
        });
    }

    private resetSystem() {
        this.ui.clearArrow();
        this.state.masterMoveList = [];
        this.state.lastHash = null;
        this.state.computedBestMove = null;
        this.state.lastAutomatedFen = null;
        this.state.lastFen = null;
        this.engine.reset();

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send('stop');
            this.ws.send('position startpos');
        }
    }

    private sanitizeSAN(node: HTMLElement): string {
        let text = node.textContent?.trim() || '';
        text = text
            .replace(/0-0-0/g, 'O-O-O')
            .replace(/0-0/g, 'O-O')
            .replace(/o-o-o/gi, 'O-O-O')
            .replace(/o-o/gi, 'O-O');

        let piece = '';
        const figurine = node.querySelector('[data-figurine]');
        if (figurine) piece = figurine.getAttribute('data-figurine') || '';
        else {
            const icon = node.querySelector('.icon-font-chess');
            if (icon) {
                const c = icon.className;
                if (c.includes('knight')) piece = 'N';
                else if (c.includes('bishop')) piece = 'B';
                else if (c.includes('rook')) piece = 'R';
                else if (c.includes('queen')) piece = 'Q';
                else if (c.includes('king')) piece = 'K';
                else if (c.includes('queenside')) return 'O-O-O';
                else if (c.includes('kingside')) return 'O-O';
            }
        }

        piece = piece.toUpperCase();
        text = text
            .replace(/[\n\r\t]/g, ' ')
            .replace(
                /(Brilliant|Great|Best|Excellent|Good|Book|Inaccuracy|Mistake|Miss|Blunder|Forced)/gi,
                '',
            );
        text = text
            .replace(/\d+:\d+/g, '')
            .replace(/[+-]?\d+[\.,]\d+s?/g, '')
            .replace(/^\d+\.+\s*/, '');
        text = text.replace(/[^a-zA-Z0-9\-=\+#O]/g, '');
        if (!text) return '';

        if (!piece || piece === 'P')
            text = text.replace(/^([a-h])([a-h])([1-8])/, '$1x$2$3');
        if (piece && !text.includes('O-O')) {
            if (text.includes('=')) text = text.replace(/=/g, '');
            if (!text.startsWith(piece)) text = piece + text;
        } else if (!piece && text.includes('=')) {
            if (/^[a-h](x[a-h])?[18]=$/.test(text)) text += 'Q';
        }
        return text;
    }

    private syncMoveList(newMoves: string[]) {
        const master = this.state.masterMoveList;
        if (newMoves.length === 0) {
            if (master.length > 0) this.resetSystem();
            return;
        }
        if (
            master.length > 0 &&
            newMoves.length > 0 &&
            master[0] !== newMoves[0]
        ) {
            this.resetSystem();
            this.state.masterMoveList = [...newMoves];
            return;
        }
        if (master.length === 0 || newMoves.length <= 3) {
            this.state.masterMoveList = [...newMoves];
            return;
        }

        let matchLen = 0;
        const max = Math.min(master.length, newMoves.length);
        for (let i = 1; i <= max; i++) {
            let isMatch = true;
            for (let j = 0; j < i; j++) {
                if (master[master.length - i + j] !== newMoves[j]) {
                    isMatch = false;
                    break;
                }
            }
            if (isMatch) matchLen = i;
        }
        if (matchLen > 0)
            this.state.masterMoveList.push(...newMoves.slice(matchLen));
    }

    private getClockMs(isWhite: boolean): number {
        const query = isWhite
            ? '.time-white, .rclock-white .time, [class*="white"] .time, .clock-white'
            : '.time-black, .rclock-black .time, [class*="black"] .time, .clock-black';

        const nodes = document.querySelectorAll(query);
        for (let i = 0; i < nodes.length; i++) {
            const text = (nodes[i] as HTMLElement).innerText?.replace(
                /[^0-9:\.]/g,
                '',
            );
            if (text && /\d/.test(text)) {
                if (text.includes(':')) {
                    const [m, s] = text.split(':');
                    return (parseInt(m, 10) * 60 + parseFloat(s)) * 1000;
                }
                return parseFloat(text) * 1000;
            }
        }
        return 0;
    }

    private processGameState(force = false) {
        if (
            !this.state.isServerReady ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN
        )
            return;

        const rawNodes = Array.from(
            document.querySelectorAll(this.targetSelector),
        );
        const nodes = rawNodes.filter((n) => {
            const e = n as HTMLElement;
            return !(
                e.classList.contains('time-white') ||
                e.classList.contains('time-black') ||
                e.classList.contains('time') ||
                e.hasAttribute('data-move-list-el') ||
                e.closest('.popover, .tooltip, [id*="popover"]')
            );
        });

        const wTime = this.getClockMs(true);
        const bTime = this.getClockMs(false);
        let goCmd = 'go movetime 200';
        if (wTime > 0 && bTime > 0) {
            goCmd = `go wtime ${Math.floor(wTime)} btime ${Math.floor(bTime)}`;
        }

        if (nodes.length === 0) {
            this.syncMoveList([]);
            if ('startpos' !== this.state.lastHash || force) {
                this.state.lastHash = 'startpos';
                this.ui.clearArrow();
                this.state.computedBestMove = null;
                this.engine.reset();
                this.ui.setStatus('#10b981');

                if ('startpos' !== this.state.lastFen || force) {
                    this.state.lastFen = 'startpos';
                    this.ws.send('stop');
                    this.ws.send('position startpos');
                    this.ws.send(goCmd);
                }
            }
            return;
        }

        let activeIdx = nodes.length - 1;
        for (let i = nodes.length - 1; i >= 0; i--) {
            const e = nodes[i] as HTMLElement;
            if (
                e.classList.contains('active') ||
                e.classList.contains('selected') ||
                e.classList.contains('act') ||
                e.hasAttribute('active') ||
                e.querySelector('.selected, .active, .highlight, .act')
            ) {
                activeIdx = i;
                break;
            }
        }

        const visible = nodes
            .slice(0, activeIdx + 1)
            .map((n) => this.sanitizeSAN(n as HTMLElement))
            .filter((m) => m.length >= 2);
        const hash = visible.join('|');

        if (hash !== this.state.lastHash || force) {
            this.state.lastHash = hash;
            this.ui.clearArrow();
            this.state.computedBestMove = null;

            this.syncMoveList(visible);
            this.engine.reset();
            let err = false;

            for (const m of this.state.masterMoveList) {
                if (!(this.engine.move(m) as any)) {
                    err = true;
                    break;
                }
            }

            if (err) return this.ui.setStatus('#f97316');
            this.ui.setStatus('#10b981');

            const fen = this.engine.fen();
            if (fen !== this.state.lastFen || force) {
                this.state.lastFen = fen;
                const uci = this.engine
                    .history({ verbose: true })
                    .map((m: any) => m.from + m.to + (m.promotion || ''))
                    .join(' ');

                this.ws.send('stop');
                this.ws.send(
                    uci
                        ? `position startpos moves ${uci}`
                        : 'position startpos',
                );

                this.ws.send(goCmd);
            }
        }
    }

    private setupDOMObserver() {
        const observer = new MutationObserver((mutations) => {
            let trigger = false;
            for (const m of mutations) {
                const t = m.target as HTMLElement;
                if (!t || !t.closest) continue;
                if (
                    t.closest(
                        '.move-list-container, wc-move-list, chess-board, cg-board, rm6, l4x, kwdb, tview2, .main-line-ply, .round__app, .analyse__app',
                    ) ||
                    t.classList?.contains('node') ||
                    t.classList?.contains('move-text-component') ||
                    ['KWDB', 'RM6', 'L4X', 'M', 'RM', 'U8T'].includes(t.tagName)
                ) {
                    trigger = true;
                    break;
                }
            }
            if (!trigger) return;
            clearTimeout(this.moveUpdateTimeout);
            this.moveUpdateTimeout = window.setTimeout(
                () => this.processGameState(false),
                80,
            );
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
            characterData: true,
        });
    }
}

new AICore();
