declare const browser: typeof chrome;

// tabSwitches is a stack of all tab activations. every time a tab becomes
// active it is prepended (unshift) to the front of the array. this means that
// there will be duplicate IDs in the array.
//
// this is handled in 2 ways:
// 1. when the popup opens and asks for a list of tabs, we will only insert the tab
// in the result when it is _first_ seen and ignored thereafter. however, over
// time this will lead to a lot of wasted work since most of the iteration will
// be just skipping elements in this array.
//
// 2. the array is periodically "compacted" by simply running it through a uniq()
// operation, therefore reducing most wasted work most of the time.
let tabSwitches: number[] = [];

function uniq<T = any>(array: T[]): T[] {
  if (array.length <= 1) {
    return array;
  }
  const seen = new Set<T>();
  const result = [];
  for (let ele of array) {
    if (seen.has(ele)) {
      continue;
    }
    seen.add(ele);
    result.push(ele);
  }
  return result;
}

setInterval(() => {
  // periodically compact tabSwitches
  tabSwitches = uniq(tabSwitches);
}, 1000);

async function listTabs(): Promise<chrome.tabs.Tab[]> {
  const _tabs = await browser.tabs.query({});
  // filter out file:///... things, safari does not really have
  // safari://... things like chrome
  const tabs = _tabs.filter((t) => t.url || t.title);

  const hit = new Map<number, boolean>(
    tabs.filter((t) => !!t.id).map((t) => [t.id!, false])
  );
  const tabsById = new Map<number, chrome.tabs.Tab>(
    tabs.filter((t) => !!t.id).map((t) => [t.id!, t])
  );
  const resultTabs = [];
  for (let tabId of tabSwitches.slice(1)) {
    if (hit.get(tabId)) {
      continue;
    }
    hit.set(tabId, true);
    const tab = tabsById.get(tabId);
    if (!tab) {
      continue;
    }
    resultTabs.push(tab);
  }
  for (let [tabId, didHit] of hit.entries()) {
    if (didHit) {
      continue;
    }
    const tab = tabsById.get(tabId);
    if (!tab) {
      continue;
    }
    resultTabs.push(tab);
  }
  return resultTabs;
}

try {
  browser.runtime.onConnect.addListener((port) => {
    port.onMessage.addListener(async (message) => {
      switch (message.rpc) {
        case "closeTab":
          await browser.tabs.remove(message.args.tabID);
          port.postMessage({
            result: await listTabs(),
            id: message.id,
          });
          return;
        case "listTabs":
          console.time(`rpc:listTabs:${message.id}`);
          try {
            const resultTabs = await listTabs();
            port.postMessage({
              result: resultTabs,
              id: message.id,
            });
          } finally {
            console.timeEnd(`rpc:listTabs:${message.id}`);
          }
          return;
        default:
          port.postMessage({
            error: `unknown rpc method: ${message.rpc}`,
            id: message.id,
          });
      }
    });
  });

  type Command = () => Promise<void> | void;

  browser.tabs.onActivated.addListener((activeInfo) => {
    if (activeInfo.tabId) {
      tabSwitches.unshift(activeInfo.tabId);
    }
  });

  const commands = new Map<string, Command>([
    [
      "openTabSwitcher",
      async () => {
        console.log("open that tab switcher!");
        await (browser as any).browserAction.openPopup();
        // await browser.action.openPopup();
      },
    ],
  ]);

  browser.commands.onCommand.addListener(async (command) => {
    console.log(`received keyboard shortcut: ${command}`);
    const fn = commands.get(command);
    if (!fn) {
      throw new Error(`unmapped command: ${command}`);
    }
    try {
      await Promise.resolve(fn());
    } catch (e) {
      console.error(`command function failed: ${e}`);
    }
  });
} catch (e) {
  // wrapping everything in a try/catch because F-ING SAFARI refuses to
  // help you understand why background scripts fail. (https://developer.apple.com/forums/thread/705321)
  console.error(`background startup failure: ${e}`);
}
