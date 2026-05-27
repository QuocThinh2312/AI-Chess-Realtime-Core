declare class Chess {
    reset(): void;
    move(m: string): void;
    fen(): string;
    turn(): 'w' | 'b';
    moves(options?: { verbose: boolean }): any[];
    history(options?: { verbose: boolean }): any[];
}

(function () {
    'use strict';

    const debugDot = document.createElement('div');
    debugDot.style.cssText =
        'position:fixed; bottom:15px; right:15px; width:15px; height:15px; background:#ef4444; border-radius:50%; z-index:999999; box-shadow: 0 0 10px rgba(0,0,0,0.5); transition: 0.3s; pointer-events: none;';
    document.body.appendChild(debugDot);

    const gameEngine = new Chess();
    let lastMoveHistoryHash: string | null = null;
    let computedBestMove: string | null = null;
    let isAutoPilotActive = false;
    let isExecutingAutoMove = false;
    let moveUpdateTimeout: number | undefined;

    let masterMoveList: string[] = [];
    let lastAutomatedFen: string | null = null;
    let lastSearchedFen: string | null = null;

    let ws: WebSocket | null = null;
    let isServerReady = false;

    function resetGameSystem() {
        clearVisualArrow();
        masterMoveList = [];
        lastMoveHistoryHash = null;
        computedBestMove = null;
        lastAutomatedFen = null;
        lastSearchedFen = null;
        gameEngine.reset();

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send('stop');
            ws.send('position startpos');
        }
    }

    document.addEventListener('click', (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        const text = target.innerText?.toLowerCase() || '';
        const isNewGameButton =
            text.includes('new 1 min') ||
            text.includes('new game') ||
            text.includes('rematch') ||
            text.includes('play again') ||
            target.closest('.game-over-button-component') ||
            target.closest('.ui_v5-button-component') ||
            target.closest('.game-row__overlay') ||
            target.closest('.fbt');

        if (isNewGameButton) resetGameSystem();
    });

    function connectWebSocket() {
        try {
            ws = new WebSocket('ws://localhost:8080');

            ws.onopen = () => {
                debugDot.style.background = '#eab308';
            };

            ws.onmessage = (event: MessageEvent) => {
                const outputLine = event.data as string;

                if (outputLine === 'readyok') {
                    isServerReady = true;
                    debugDot.style.background = '#10b981';
                    updateGameState(true);
                }

                if (outputLine.startsWith('bestmove')) {
                    const move = outputLine.split(' ')[1];
                    if (move !== '(none)') {
                        const legalMoves = gameEngine.moves({ verbose: true });
                        const isLegal = legalMoves.some(
                            (m) => m.from + m.to + (m.promotion || '') === move,
                        );

                        if (!isLegal) return;

                        computedBestMove = move;
                        renderVisualArrow(computedBestMove);

                        if (isAutoPilotActive && isOurTurn()) {
                            const currentFen = gameEngine.fen();
                            if (lastAutomatedFen !== currentFen) {
                                lastAutomatedFen = currentFen;
                                dispatchMoveAutomation(computedBestMove);
                            }
                        }
                    }
                }
            };

            ws.onclose = () => {
                isServerReady = false;
                debugDot.style.background = '#ef4444';
                setTimeout(connectWebSocket, 1000);
            };
        } catch (error) {
            setTimeout(connectWebSocket, 1000);
        }
    }

    connectWebSocket();

    const sleep = (ms: number) =>
        new Promise((resolve) => setTimeout(resolve, ms));

    function isOurTurn(): boolean {
        const isBlack = !!document.querySelector(
            '.flipped, .orientation-black, [orientation="black"], .cg-wrap.orientation-black, chess-board.flipped',
        );
        return (
            (isBlack && gameEngine.turn() === 'b') ||
            (!isBlack && gameEngine.turn() === 'w')
        );
    }

    window.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.altKey && event.key.toLowerCase() === 'a') {
            isAutoPilotActive = !isAutoPilotActive;
            if (computedBestMove) renderVisualArrow(computedBestMove);
            if (
                isAutoPilotActive &&
                computedBestMove &&
                !isExecutingAutoMove &&
                isOurTurn()
            ) {
                const currentFen = gameEngine.fen();
                if (lastAutomatedFen !== currentFen) {
                    lastAutomatedFen = currentFen;
                    dispatchMoveAutomation(computedBestMove);
                }
            }
        }
    });

    function getAbsoluteSquareCoordinates(
        boardElement: Element,
        squareName: string,
        isBlackOrientation: boolean,
    ) {
        const rect = boardElement.getBoundingClientRect();
        let fileIndex = squareName.charCodeAt(0) - 97;
        let rankIndex = 8 - parseInt(squareName[1]);
        if (isBlackOrientation) {
            fileIndex = 7 - fileIndex;
            rankIndex = 7 - rankIndex;
        }
        return {
            x: rect.left + (fileIndex + 0.5) * (rect.width / 8),
            y: rect.top + (rankIndex + 0.5) * (rect.height / 8),
        };
    }

    async function dispatchMoveAutomation(moveString: string) {
        if (isExecutingAutoMove || !moveString || moveString.length < 4) return;
        const board = document.querySelector('cg-board, chess-board, .board');
        if (!board) return;

        isExecutingAutoMove = true;
        const safetyUnlockTimeout = setTimeout(() => {
            isExecutingAutoMove = false;
        }, 1200);
        const isBlack = !!document.querySelector(
            '.flipped, .orientation-black, [orientation="black"], .cg-wrap.orientation-black, chess-board.flipped',
        );

        try {
            if (!chrome?.runtime?.sendMessage)
                throw new Error('Extension context invalid');

            const originCoords = getAbsoluteSquareCoordinates(
                board,
                moveString.substring(0, 2),
                isBlack,
            );
            chrome.runtime.sendMessage({
                action: 'execute_hardware_click',
                x: originCoords.x,
                y: originCoords.y,
            });

            await sleep(12);

            const targetCoords = getAbsoluteSquareCoordinates(
                board,
                moveString.substring(2, 4),
                isBlack,
            );
            chrome.runtime.sendMessage({
                action: 'execute_hardware_click',
                x: targetCoords.x,
                y: targetCoords.y,
            });
        } catch (err) {
            console.error('🔥 Trạng thái kết nối Extension gián đoạn.', err);
        } finally {
            clearTimeout(safetyUnlockTimeout);
            isExecutingAutoMove = false;
        }
    }

    function renderVisualArrow(moveString: string) {
        if (!moveString || moveString.length < 4) return;
        const board = document.querySelector('cg-board, chess-board, .board');
        if (!board) return;

        const isBlack = !!document.querySelector(
            '.flipped, .orientation-black, [orientation="black"], .cg-wrap.orientation-black, chess-board.flipped',
        );
        let svgLayer = document.getElementById('ai-core-arrow-layer') as any;

        if (!svgLayer) {
            svgLayer = document.createElementNS(
                'http://www.w3.org/2000/svg',
                'svg',
            );
            svgLayer.id = 'ai-core-arrow-layer';
            svgLayer.style.cssText =
                'position: fixed; pointer-events: none; z-index: 9999999 !important; overflow: visible; display: block;';
            document.body.appendChild(svgLayer);
        }

        svgLayer.setAttribute('viewBox', '0 0 100 100');
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

        svgLayer.innerHTML = '';
        const uiColor = isAutoPilotActive
            ? 'rgba(16, 185, 129, 0.9)'
            : 'rgba(239, 68, 68, 0.9)';

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
        svgLayer.appendChild(line);

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
        svgLayer.appendChild(head);
    }

    function clearVisualArrow() {
        const svgLayer = document.getElementById('ai-core-arrow-layer');
        if (svgLayer) svgLayer.innerHTML = '';
    }

    function uiLoop() {
        const svgLayer = document.getElementById('ai-core-arrow-layer');
        const board = document.querySelector('cg-board, chess-board, .board');
        if (svgLayer && board) {
            const rect = board.getBoundingClientRect();
            svgLayer.style.top = rect.top + 'px';
            svgLayer.style.left = rect.left + 'px';
            svgLayer.style.width = rect.width + 'px';
            svgLayer.style.height = rect.height + 'px';
        }
        requestAnimationFrame(uiLoop);
    }

    function extractMoveText(node: HTMLElement): string {
        let text = node.textContent?.trim() || '';
        text = text
            .replace(/0-0-0/g, 'O-O-O')
            .replace(/0-0/g, 'O-O')
            .replace(/o-o-o/gi, 'O-O-O')
            .replace(/o-o/gi, 'O-O');

        let piece = '';
        const figurineNode = node.querySelector('[data-figurine]');
        if (figurineNode) {
            piece = figurineNode.getAttribute('data-figurine') || '';
        } else {
            const iconNode = node.querySelector('.icon-font-chess');
            if (iconNode) {
                const cls = iconNode.className;
                if (cls.includes('knight')) piece = 'N';
                else if (cls.includes('bishop')) piece = 'B';
                else if (cls.includes('rook')) piece = 'R';
                else if (cls.includes('queen')) piece = 'Q';
                else if (cls.includes('king')) piece = 'K';
                else if (cls.includes('castling-queenside')) return 'O-O-O';
                else if (cls.includes('castling-kingside')) return 'O-O';
            }
        }

        piece = piece.toUpperCase();
        text = text.replace(/[\n\r\t]/g, ' ').trim();
        text = text.replace(
            /(Brilliant|Great|Best|Excellent|Good|Book|Inaccuracy|Mistake|Miss|Blunder|Forced)/gi,
            '',
        );
        text = text
            .replace(/\d+:\d+/g, '')
            .replace(/[+-]?\d+[\.,]\d+s?/g, '')
            .replace(/^\d+\.+\s*/, '');
        text = text.replace(/[^a-zA-Z0-9\-=\+#O]/g, '');

        if (!text) return '';

        if (!piece || piece === 'P') {
            text = text.replace(/^([a-h])([a-h])([1-8])/, '$1x$2$3');
        }

        if (piece && !text.includes('O-O')) {
            if (text.includes('=')) {
                text = text.replace(/=/g, '');
            }
            if (!text.startsWith(piece)) text = piece + text;
        } else if (!piece && text.includes('=')) {
            if (/^[a-h](x[a-h])?[18]=$/.test(text)) text += 'Q';
        }
        return text;
    }

    function syncMasterMoveList(visibleMoves: string[]) {
        if (visibleMoves.length === 0) {
            if (masterMoveList.length > 0) resetGameSystem();
            return;
        }

        if (masterMoveList.length > 0 && visibleMoves.length > 0) {
            if (masterMoveList[0] !== visibleMoves[0]) {
                resetGameSystem();
                masterMoveList = [...visibleMoves];
                return;
            }
        }

        if (masterMoveList.length === 0 || visibleMoves.length <= 3) {
            masterMoveList = [...visibleMoves];
            return;
        }

        let bestMatchLength = 0;
        const maxCheck = Math.min(masterMoveList.length, visibleMoves.length);

        for (let i = 1; i <= maxCheck; i++) {
            const masterSuffix = masterMoveList.slice(-i).join('|');
            const visiblePrefix = visibleMoves.slice(0, i).join('|');
            if (masterSuffix === visiblePrefix) bestMatchLength = i;
        }

        if (bestMatchLength > 0) {
            masterMoveList.push(...visibleMoves.slice(bestMatchLength));
        }
    }

    function updateGameState(force = false) {
        if (!isServerReady || !ws || ws.readyState !== WebSocket.OPEN) return;

        const isChessCom = window.location.hostname.includes('chess.com');
        let targetSelector = isChessCom
            ? '.move-list-container .move-text-component, .move-list-row .node, .move-list-live-response .node'
            : 'l4x rm, rm6 rm, u8t, kwdb, .tview2 m, v1f, .main-line-ply, [data-node], rm6 kwdb, l4x kwdb, m';

        const rawNodes = Array.from(document.querySelectorAll(targetSelector));

        const nodes = rawNodes.filter((n) => {
            const htmlNode = n as HTMLElement;
            // Bổ sung lọc '.time' để tránh rác FEN từ đồng hồ
            if (
                htmlNode.classList.contains('time-white') ||
                htmlNode.classList.contains('time-black') ||
                htmlNode.classList.contains('time') ||
                htmlNode.hasAttribute('data-move-list-el')
            )
                return false;
            if (
                htmlNode.closest(
                    '.popover, .tooltip, .hover-content, [id*="popover"], [id*="tooltip"]',
                )
            )
                return false;
            return true;
        });

        if (nodes.length === 0) {
            syncMasterMoveList([]);
            const currentHash = 'startpos';

            if (currentHash !== lastMoveHistoryHash || force) {
                lastMoveHistoryHash = currentHash;
                clearVisualArrow();
                computedBestMove = null;
                gameEngine.reset();

                debugDot.style.background = '#10b981';

                if (currentHash !== lastSearchedFen || force) {
                    lastSearchedFen = currentHash;
                    ws.send('stop');
                    ws.send('position startpos');
                    ws.send('go movetime 200');
                }
            }
            return;
        }

        let activeIndex = nodes.length - 1;
        for (let i = nodes.length - 1; i >= 0; i--) {
            const n = nodes[i] as HTMLElement;
            if (
                n.classList.contains('active') ||
                n.classList.contains('selected') ||
                n.classList.contains('act') ||
                n.hasAttribute('active') ||
                n.querySelector('.selected, .active, .highlight, .act')
            ) {
                activeIndex = i;
                break;
            }
        }

        const visibleMoves = nodes
            .slice(0, activeIndex + 1)
            .map((n) => extractMoveText(n as HTMLElement))
            .filter((m) => m.length >= 2);
        const currentHash = visibleMoves.join('|');

        if (currentHash !== lastMoveHistoryHash || force) {
            lastMoveHistoryHash = currentHash;
            clearVisualArrow();
            computedBestMove = null;

            syncMasterMoveList(visibleMoves);
            gameEngine.reset();
            let isSyncError = false;

            for (const move of masterMoveList) {
                if (gameEngine.move(move) === null) {
                    isSyncError = true;
                    break;
                }
            }

            if (isSyncError) {
                debugDot.style.background = '#f97316';
                return;
            }

            debugDot.style.background = '#10b981';
            const currentFen = gameEngine.fen();

            if (currentFen !== lastSearchedFen || force) {
                lastSearchedFen = currentFen;
                const uciString = gameEngine
                    .history({ verbose: true })
                    .map((m: any) => m.from + m.to + (m.promotion || ''))
                    .join(' ');

                ws.send('stop');
                ws.send(
                    uciString.length > 0
                        ? 'position startpos moves ' + uciString
                        : 'position startpos',
                );
                ws.send('go movetime 200');
            }
        }
    }

    const domObserver = new MutationObserver((mutations) => {
        let shouldTriggerUpdate = false;

        for (const mutation of mutations) {
            const target = mutation.target as HTMLElement;
            if (!target || !target.closest) continue;

            if (
                target.closest(
                    '.move-list-container, wc-move-list, chess-board, cg-board, rm6, l4x, kwdb, tview2, .main-line-ply, .round__app, .analyse__app, .mchat',
                ) ||
                target.classList?.contains('node') ||
                target.classList?.contains('move-text-component') ||
                ['KWDB', 'RM6', 'L4X', 'M', 'RM', 'U8T'].includes(
                    target.tagName,
                )
            ) {
                shouldTriggerUpdate = true;
                break;
            }
        }

        if (!shouldTriggerUpdate) return;

        clearTimeout(moveUpdateTimeout);
        moveUpdateTimeout = window.setTimeout(
            () => updateGameState(false),
            100,
        );
    });

    requestAnimationFrame(uiLoop);
    domObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
        characterData: true,
    });
})();
