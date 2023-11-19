import Fuse, { FuseResult, FuseResultMatch, RangeTuple } from "fuse.js";
import React, {
  FunctionComponent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactDOM from "react-dom/client";
import { useHotkeys } from "react-hotkeys-hook";
import "./scrollIntoViewIfNeededPolyfill";

function hostname(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return "";
  }
}

const browser = chrome;

interface BackgroundPage {
  listTabs(): Promise<chrome.tabs.Tab[]>;
}

function useBackgroundPage(): BackgroundPage {
  const msgId = useRef<number>(1);
  const port = useRef<chrome.runtime.Port>(browser.runtime.connect());
  type PromiseFinishers<T> = {
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: any) => void;
  };
  const waiter = new Map<number, PromiseFinishers<unknown>>();
  useEffect(() => {
    const msgListener: Parameters<
      typeof port.current.onMessage.addListener
    >["0"] = (message) => {
      if (!("id" in message) || typeof message.id !== "number") {
        return;
      }
      const promfinishers = waiter.get(message.id);
      if (!promfinishers) {
        return;
      }
      waiter.delete(message.id);
      if (message.error) {
        promfinishers.reject(message.error);
      } else {
        promfinishers.resolve(message.result);
      }
    };

    port.current.onMessage.addListener(msgListener);
    return () => {
      port.current.onMessage.removeListener(msgListener);
      port.current.disconnect();
    };
  }, []);

  return {
    listTabs() {
      return new Promise((resolve, reject) => {
        const id = ++msgId.current;
        waiter.set(id, {
          reject,
          resolve(value) {
            console.timeEnd(`bgpage:rpc:listTabs:${id}`);
            resolve(value as chrome.tabs.Tab[]);
          },
        });
        console.time(`bgpage:rpc:listTabs:${id}`);
        port.current.postMessage({ rpc: "listTabs", id });
      });
    },
  };
}

const focusTab = (tabId: number, windowId: number): void => {
  browser.tabs.update(tabId, { active: true });
  browser.windows.update(windowId, { focused: true });
  window.close();
};

const HighlightMatches: FunctionComponent<{
  text: string;
  match?: FuseResultMatch;
}> = ({ text, match }) => {
  if (!match) {
    return <>{text}</>;
  }
  const parts: JSX.Element[] = [];
  const indicies = structuredClone(match.indices) as RangeTuple[];
  let currentPart = "";
  let currentMatchIndicy: RangeTuple | undefined;
  for (let i = 0; i < text.length; i++) {
    if (indicies.length > 0 && indicies[0][0] === i) {
      currentMatchIndicy = indicies.shift();
      if (currentPart.length > 0) {
        parts.push(<>{currentPart}</>);
        currentPart = "";
      }
    }
    currentPart += text[i];
    if (
      currentMatchIndicy &&
      (currentMatchIndicy[1] === i || i === text.length - 1)
    ) {
      currentMatchIndicy = undefined;
      parts.push(<b style={{ fontWeight: "bold" }}>{currentPart}</b>);
      currentPart = "";
    }
  }
  if (currentPart) {
    parts.push(<>{currentPart}</>);
  }
  return (
    <>
      {parts.map((p, i) => (
        <React.Fragment key={i}>{p}</React.Fragment>
      ))}
    </>
  );
};

// <big_sigh> ...
function faviconsWork(tabURL: string, size: number): Promise<boolean> {
  return new Promise((resolve) => {
    const hiddenDiv = document.createElement("div", {});
    hiddenDiv.setAttribute("style", "display:none;");
    const testImg = document.createElement("img");
    testImg.src = faviconURL({ url: tabURL } as chrome.tabs.Tab, 32)!;
    testImg.onerror = () => {
      document.body.removeChild(hiddenDiv);
      resolve(false);
    };
    testImg.onload = () => {
      document.body.removeChild(hiddenDiv);
      resolve(true);
    };
    hiddenDiv.appendChild(testImg);
    document.body.appendChild(hiddenDiv);
  });
}

function faviconURL(t: chrome.tabs.Tab, size: number): string | undefined {
  if (t.favIconUrl) {
    return t.favIconUrl;
  }
  if (!t.url) {
    return;
  }
  const url = new URL(browser.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", t.url);
  url.searchParams.set("size", `${size}`);
  return url.toString();
}

const Popup: FunctionComponent = () => {
  const [tabSelector, setTabSelector] = useState(0);
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const FAVICON_NOT_SUPPORTED = 0;
  const FAVICON_SUPPORTED_VIA_EXT_URL = 1;
  const FAVICON_SUPPORTED_VIA_TAB_DATA = 2;
  const [enableFavicons, setEnabledFavicons] = useState(FAVICON_NOT_SUPPORTED);
  useEffect(() => {
    faviconsWork("https://www.google.com", 32).then((ok) => {
      if (enableFavicons === 0) {
        setEnabledFavicons(FAVICON_SUPPORTED_VIA_EXT_URL);
      }
    });
  }, []);

  useEffect(() => {
    if (tabs.length === 0) {
      return;
    }
    console.log({ tabs });
  }, [tabs]);

  useEffect(() => {
    setTabSelector(0);
  }, [setTabSelector, searchQuery]);
  const searchIndex = useMemo(() => {
    const result = new Fuse(tabs, {
      keys: ["title", "url"],
      includeMatches: true,
    });
    return result;
  }, [tabs]);
  const searchResults = useMemo(() => {
    if (!searchQuery) {
      return tabs.map(
        (t, i): FuseResult<chrome.tabs.Tab> => ({
          item: t,
          refIndex: i,
        })
      );
    }
    return searchIndex.search(searchQuery);
  }, [tabs, searchIndex, searchQuery]);

  const selectedTab = Math.max(
    0,
    Math.min(searchResults.length - 1, tabSelector)
  );

  const selectNext = useCallback(() => {
    setTabSelector((n) => Math.min(searchResults.length - 1, n + 1));
  }, [searchResults]);
  const selectPrev = useCallback(() => {
    setTabSelector((n) => Math.max(0, n - 1));
  }, [setTabSelector]);

  const goToTab = useCallback(() => {
    focusTab(
      searchResults[tabSelector].item.id!,
      searchResults[tabSelector].item.windowId
    );
  }, [searchResults, tabSelector]);
  useHotkeys(
    "Down",
    () => {
      selectNext();
    },
    [selectNext]
  );
  useHotkeys(
    "Up",
    () => {
      selectPrev();
    },
    [selectPrev]
  );
  useHotkeys(
    "Enter",
    () => {
      goToTab();
    },
    [goToTab]
  );

  const bgpage = useBackgroundPage();
  useEffect(() => {
    console.time("queryTabs");
    bgpage
      .listTabs()
      .then((returnedTabs) => {
        if (returnedTabs.find((t) => !!t.favIconUrl)) {
          setEnabledFavicons(FAVICON_SUPPORTED_VIA_TAB_DATA);
        }
        setTabs(returnedTabs);
      })
      .finally(() => {
        console.timeEnd("queryTabs");
      });
  }, []);

  const selectedTabEle = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedTabEle.current) {
      return;
    }

    // scrollIntoViewIfNeeded is non standard but for just safari it works
    // great!
    (selectedTabEle as any).current.scrollIntoViewIfNeeded(false);
  }, [selectedTabEle.current]);

  return (
    <div>
      <div style={{ padding: "1em" }}>
        <input
          type="text"
          autoFocus
          value={searchQuery}
          style={{
            width: "100%",
            outline: "none",
            border: "none",
            fontSize: "1.1em",
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              selectNext();
            } else if (e.key === "ArrowUp") {
              selectPrev();
            } else if (e.key === "Enter") {
              goToTab();
            }
          }}
          spellCheck="false"
          autoCorrect="false"
          onChange={(e) => {
            setSearchQuery(e.target.value);
          }}
        />
      </div>
      <hr style={{ opacity: "0.3", marginTop: "0px" }} />
      <div
        style={{
          maxHeight: "500px",
          overflow: "scroll",
          // minHeight: "300px"
        }}
      >
        {searchResults.length === 0 ? (
          <div
            style={{
              padding: "1.5em",
              fontSize: "1.1em",
              display: "flex",
              justifyContent: "center",
            }}
          >
            No Results Found
          </div>
        ) : null}
        {searchResults.map((t, i) => {
          const favicURL = enableFavicons !== 0 ? faviconURL(t.item, 32) : null;
          return (
            <div
              key={t.item.id}
              className="ht-tab"
              onClick={() => {
                focusTab(t.item.id!, t.item.windowId);
              }}
              ref={i === tabSelector ? selectedTabEle : undefined}
              style={{
                padding: "10px",
                backgroundColor: i === selectedTab ? "#e9e9e9" : undefined,

                // favicon support
                ...(enableFavicons
                  ? {
                      display: "flex",
                      alignItems: "center",
                    }
                  : {}),
              }}
            >
              {favicURL && (
                <div className="ht-tab-favicon" style={{ marginRight: "1em" }}>
                  <img width={16} height={16} src={favicURL} />
                </div>
              )}
              <div>
                <div
                  className="ht-tab-title"
                  style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontSize: "1.1em",
                    marginBottom: "6px",
                  }}
                >
                  {
                    <HighlightMatches
                      text={t.item.title ?? ""}
                      match={t.matches?.find((m) => m.key === "title")}
                    />
                  }
                </div>
                <div
                  className="ht-tab-location"
                  style={{
                    color: "#6e6e6e",
                  }}
                >
                  {t.item.url ? hostname(t.item.url) : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById("main")!);
root.render(<Popup />);
