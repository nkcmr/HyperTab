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
  const waiter = useRef(new Map<number, PromiseFinishers<unknown>>());
  useEffect(() => {
    const msgListener: Parameters<
      typeof port.current.onMessage.addListener
    >["0"] = (message) => {
      if (!("id" in message) || typeof message.id !== "number") {
        return;
      }
      const promfinishers = waiter.current.get(message.id);
      if (!promfinishers) {
        return;
      }
      waiter.current.delete(message.id);
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
        waiter.current.set(id, {
          reject,
          resolve(value) {
            resolve(value as chrome.tabs.Tab[]);
          },
        });
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
  match?: Omit<FuseResultMatch, "key">;
}> = ({ text, match }) => {
  if (!match) {
    return <>{text}</>;
  }
  if (text.toLowerCase().includes("spec.matrix")) {
    console.log({ text, match });
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

const prefersDarkMode = (): boolean => {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

const useDarkMode = (): boolean => {
  const [dm, setdm] = useState(() => {
    return prefersDarkMode();
  });
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (ev: MediaQueryListEvent) => {
      setdm(ev.matches);
    };
    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  }, []);
  return dm;
};

const Popup: FunctionComponent = () => {
  const darkMode = useDarkMode();
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
    bgpage
      .listTabs()
      .then((returnedTabs) => {
        if (returnedTabs.find((t) => !!t.favIconUrl)) {
          setEnabledFavicons(FAVICON_SUPPORTED_VIA_TAB_DATA);
        }
        setTabs(returnedTabs);
      })
      .finally(() => {});
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
      <div
        style={{ padding: "1em", display: "flex" }}
        className="ht-search-wrapper"
      >
        <div style={{ marginRight: "1em" }}>
          <svg
            style={{ scale: "0.85" }}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
          >
            <path
              fill={darkMode ? "#e9e9e9" : "#636363"}
              d="M23.809 21.646l-6.205-6.205c1.167-1.605 1.857-3.579 1.857-5.711 0-5.365-4.365-9.73-9.731-9.73-5.365 0-9.73 4.365-9.73 9.73 0 5.366 4.365 9.73 9.73 9.73 2.034 0 3.923-.627 5.487-1.698l6.238 6.238 2.354-2.354zm-20.955-11.916c0-3.792 3.085-6.877 6.877-6.877s6.877 3.085 6.877 6.877-3.085 6.877-6.877 6.877c-3.793 0-6.877-3.085-6.877-6.877z"
            />
          </svg>
        </div>
        <input
          className="ht-search-input"
          type="text"
          autoFocus
          placeholder="Search Tabs"
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
      <div style={{ padding: "1em", fontWeight: "bold" }}>
        Open Tabs ({tabs.length})
      </div>
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
                cursor: "pointer",
                backgroundColor:
                  i === selectedTab
                    ? darkMode
                      ? "#535353"
                      : "#e9e9e9"
                    : undefined,

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
                <div
                  className="ht-tab-favicon"
                  style={{ marginRight: "1em", padding: ".5em" }}
                >
                  <img width={16} height={16} src={favicURL} />
                </div>
              )}
              <div className="ht-tab-right" style={{ width: "93%" }}>
                <div
                  className="ht-tab-title"
                  style={{
                    color: darkMode ? "#e9e9e9" : "#2b2b2b",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontSize: "1.1em",
                    marginBottom: "6px",
                    width: "98%",
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
