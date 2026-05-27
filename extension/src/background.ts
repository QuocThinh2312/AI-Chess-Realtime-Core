type Target = { tabId: number };
type Action = { target: Target; x: number; y: number };

const attachedTabs = new Set<number>();
const actionQueue: Action[] = [];
let isProcessingQueue = false;

const sendCommandAsync = (
    target: Target,
    method: string,
    params: Record<string, any>,
): Promise<void> => {
    return new Promise((resolve, reject) => {
        chrome.debugger.sendCommand(target, method, params, () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
        });
    });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function processQueue() {
    if (isProcessingQueue || actionQueue.length === 0) return;
    isProcessingQueue = true;

    while (actionQueue.length > 0) {
        const action = actionQueue.shift();
        if (!action) continue;

        try {
            await sendCommandAsync(action.target, 'Input.dispatchMouseEvent', {
                type: 'mousePressed',
                x: action.x,
                y: action.y,
                button: 'left',
                clickCount: 1,
            });

            await sleep(8);

            await sendCommandAsync(action.target, 'Input.dispatchMouseEvent', {
                type: 'mouseReleased',
                x: action.x,
                y: action.y,
                button: 'left',
                clickCount: 1,
            });

            await sleep(5);
        } catch (error) {
            console.warn('Debugger click failed:', error);
        }
    }
    isProcessingQueue = false;
}

chrome.runtime.onMessage.addListener((request, sender) => {
    if (request.action === 'execute_hardware_click' && sender.tab?.id) {
        const tabId = sender.tab.id;
        actionQueue.push({ target: { tabId }, x: request.x, y: request.y });

        if (!attachedTabs.has(tabId)) {
            chrome.debugger.attach({ tabId }, '1.2', () => {
                if (!chrome.runtime.lastError) {
                    attachedTabs.add(tabId);
                    setTimeout(processQueue, 50); 
                }
            });
        } else {
            processQueue();
        }
    }
});

chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId) attachedTabs.delete(source.tabId);
});
