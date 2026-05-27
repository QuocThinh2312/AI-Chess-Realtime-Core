type Target = { tabId: number };
type Action = { target: Target; x: number; y: number };

class HardwareClicker {
    private attachedTabs: Set<number> = new Set();
    private actionQueue: Action[] = [];
    private isProcessing: boolean = false;

    constructor() {
        this.setupListeners();
    }

    private sendCommandAsync(
        target: Target,
        method: string,
        params: Record<string, any>,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            chrome.debugger.sendCommand(target, method, params, () => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve();
            });
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async processQueue() {
        if (this.isProcessing || this.actionQueue.length === 0) return;
        this.isProcessing = true;

        while (this.actionQueue.length > 0) {
            const action = this.actionQueue.shift();
            if (!action) continue;

            try {
                await this.sendCommandAsync(
                    action.target,
                    'Input.dispatchMouseEvent',
                    {
                        type: 'mousePressed',
                        x: action.x,
                        y: action.y,
                        button: 'left',
                        clickCount: 1,
                    },
                );
                await this.sleep(8);
                await this.sendCommandAsync(
                    action.target,
                    'Input.dispatchMouseEvent',
                    {
                        type: 'mouseReleased',
                        x: action.x,
                        y: action.y,
                        button: 'left',
                        clickCount: 1,
                    },
                );
                await this.sleep(2);
            } catch (error) {
                console.warn(
                    '[Background] Lỗi thực thi click phần cứng:',
                    error,
                );
            }
        }
        this.isProcessing = false;
    }

    private setupListeners() {
        chrome.runtime.onMessage.addListener((request, sender) => {
            if (request.action === 'execute_hardware_click' && sender.tab?.id) {
                const tabId = sender.tab.id;
                this.actionQueue.push({
                    target: { tabId },
                    x: request.x,
                    y: request.y,
                });

                if (!this.attachedTabs.has(tabId)) {
                    chrome.debugger.attach({ tabId }, '1.2', () => {
                        if (!chrome.runtime.lastError) {
                            this.attachedTabs.add(tabId);
                            this.processQueue();
                        }
                    });
                } else {
                    this.processQueue();
                }
            }
        });

        chrome.debugger.onDetach.addListener((source) => {
            if (source.tabId) this.attachedTabs.delete(source.tabId);
        });
    }
}

new HardwareClicker();
