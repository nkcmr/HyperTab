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
import { styled } from "styled-components";
import "./scrollIntoViewIfNeededPolyfill";

function t(
  messageName: string,
  substitutions?: string | string[] | undefined
): string {
  return browser.i18n.getMessage(messageName, substitutions);
}

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
  closeTab(tabID: number): Promise<chrome.tabs.Tab[]>;
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
    closeTab(tabID) {
      return new Promise((resolve, reject) => {
        const id = ++msgId.current;
        waiter.current.set(id, {
          reject,
          resolve(value) {
            resolve(value as chrome.tabs.Tab[]);
          },
        });
        port.current.postMessage({ rpc: "closeTab", id, args: { tabID } });
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

function faviconURL(t: chrome.tabs.Tab): string | undefined {
  return (
    t.favIconUrl ??
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
  );
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

const POPUP_WIDTH = 500;

const TAB_ITEM_WIDTH = POPUP_WIDTH;
const TAB_ITEM_PADDING_PX = 15;
const TAB_ITEM_FAVICON_SIZE = 30;
const TAB_ITEM_FLEX_GAP = 15;
const TAB_ITEM_MAIN_WIDTH =
  TAB_ITEM_WIDTH -
  TAB_ITEM_PADDING_PX * 2 -
  TAB_ITEM_FAVICON_SIZE -
  TAB_ITEM_FLEX_GAP;

const SEARCH_CONTAINER_WIDTH = POPUP_WIDTH;
const SEARCH_ICON_SIZE = 24;
const SEARCH_ICON_CONTAINER_SIZE = 30;
const SEARCH_ICON_PADDING = (SEARCH_ICON_CONTAINER_SIZE - SEARCH_ICON_SIZE) / 2;
const SEARCH_CONTAINER_FLEX_GAP = TAB_ITEM_FLEX_GAP;
const SEARCH_CONTAINER_PADDING = TAB_ITEM_PADDING_PX;
const SEARCH_INPUT_WIDTH =
  SEARCH_CONTAINER_WIDTH -
  SEARCH_CONTAINER_PADDING * 2 -
  SEARCH_ICON_CONTAINER_SIZE -
  SEARCH_CONTAINER_FLEX_GAP;

const TabList = styled.div`
  max-height: 500px;
  overflow: scroll;
`;
const TabListEmpty = styled.div`
  padding: 1.5em;
  font-size: 1.1em;
  display: flex;
  justify-content: center;
`;
const TabItem = styled.div<{ $selected: boolean; $dark: boolean }>`
  width: ${TAB_ITEM_WIDTH}px;
  padding: ${TAB_ITEM_PADDING_PX}px;
  cursor: pointer;
  background-color: ${(props) =>
    props.$selected ? (props.$dark ? "#535353" : "#e9e9e9") : "inherit"};
  display: flex;
  gap: ${TAB_ITEM_FLEX_GAP}px;
  align-items: center;
  &:hover {
    background-color: ${(props) => (props.$dark ? "#4e4e4e" : "#efefef")};
  }
`;
const TabItemFavicon = styled.div<{ $dark: boolean }>`
  background-color: ${(props) => (props.$dark ? "#6e6e6e" : "#d9d9d9")};
  border-radius: 5px;
  padding: 0.5em;
  width: ${TAB_ITEM_FAVICON_SIZE}px;
  height: ${TAB_ITEM_FAVICON_SIZE}px;
  padding: 7px;
  flex-shrink: 0;
`;
const TabItemCloseBox = styled.div`
  cursor: pointer;
`;
const TabItemMain = styled.div`
  width: ${TAB_ITEM_MAIN_WIDTH}px;
`;
const TabItemMainTitle = styled.div<{ $dark: boolean }>`
  color: ${(props) => (props.$dark ? "#e9e9e9" : "#2b2b2b")};
  font-size: 1.1em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
const TabItemMainHostname = styled.div<{ $dark: boolean }>`
  color: ${(props) => (props.$dark ? "#a9a9a9" : "#6e6e6e")};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const SearchContainer = styled.div`
  display: flex;
  width: ${SEARCH_CONTAINER_WIDTH}px;
  gap: ${TAB_ITEM_FLEX_GAP}px;
  padding: ${TAB_ITEM_PADDING_PX}px;
  align-items: center;
`;

const SearchIconLeftContainer = styled.div`
  padding: ${SEARCH_ICON_PADDING}px;
`;

const SearchInputRightContainer = styled.div``;
const SearchInput = styled.input`
  width: ${SEARCH_INPUT_WIDTH}px;
  outline: none;
  border: none;
  font-size: 1.2em;
`;

type searchField = {
  aliases?: string[];
  filterValues: (value: string | null) => boolean;
  evaluate: (t: chrome.tabs.Tab, value: string | null) => boolean;
};

const searchFields: Record<string, searchField> = {
  sys: {
    filterValues(value) {
      return ["true", "false"].includes(value?.toLowerCase() ?? "");
    },
    evaluate(t, value) {
      if (!t.url) {
        return value === "true";
      }
      const ishttp = !!t.url.match(/^https?:\/\//i);
      return ishttp !== (value === "true");
    },
  },
  pinned: {
    filterValues(value) {
      return ["true", "false"].includes(value?.toLowerCase() ?? "");
    },
    evaluate(t, value) {
      return t.pinned === (value === "true");
    },
  },
  hostname: {
    aliases: ["domain"],
    filterValues(value) {
      return true;
    },
    evaluate(t, value) {
      if (!t.url) {
        return false;
      }
      return hostname(t.url).includes(value ?? "");
    },
  },
} as const;

function getSearchField(key: string): searchField | null {
  return key in searchFields
    ? searchFields[key]
    : Object.values(searchFields).find((sf) => {
        return sf.aliases?.includes(key) ?? false;
      }) ?? null;
}

function structuredQuery(query: string): Map<string, string | null> {
  return new Map<string, string | null>(
    query
      .split(/\s+/g)
      .map((pair): [string, string | null] => {
        const [key, value] = pair.split(":", 2);
        return [key, value ?? null];
      })
      .filter(([key, value]) => {
        const sf = getSearchField(key);
        if (!sf) {
          return false;
        }
        return sf.filterValues(value);
      })
  );
}

const Popup: FunctionComponent = () => {
  const darkMode = useDarkMode();
  const [tabSelector, setTabSelector] = useState(0);
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

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
      keys: [
        "title",
        {
          name: "hostname",
          getFn(obj) {
            return obj.url ? hostname(obj.url) : "";
          },
        },
      ],
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
    const sq = structuredQuery(searchQuery);
    if (sq.size > 0) {
      return tabs
        .filter((tab) => {
          for (let [key, value] of sq.entries()) {
            if (!getSearchField(key)!.evaluate(tab, value)) {
              return false;
            }
          }
          return true;
        })
        .map(
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
        // if (returnedTabs.find((t) => !!t.favIconUrl)) {
        //   setEnabledFavicons(FAVICON_SUPPORTED_VIA_TAB_DATA);
        // }
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

  const [tabHover, setTabHover] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    requestIdleCallback(() => {
      // this is more reliable than autoFocus attribute. sometimes autoFocus
      // would let the popup open and then input would not be focused.
      inputRef.current?.focus();
    });
  }, [inputRef.current]);
  return (
    <div>
      <SearchContainer>
        <SearchIconLeftContainer>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width={SEARCH_ICON_SIZE}
            height={SEARCH_ICON_SIZE}
            viewBox="0 0 24 24"
          >
            <path
              fill={darkMode ? "#e9e9e9" : "#636363"}
              d="M23.809 21.646l-6.205-6.205c1.167-1.605 1.857-3.579 1.857-5.711 0-5.365-4.365-9.73-9.731-9.73-5.365 0-9.73 4.365-9.73 9.73 0 5.366 4.365 9.73 9.73 9.73 2.034 0 3.923-.627 5.487-1.698l6.238 6.238 2.354-2.354zm-20.955-11.916c0-3.792 3.085-6.877 6.877-6.877s6.877 3.085 6.877 6.877-3.085 6.877-6.877 6.877c-3.793 0-6.877-3.085-6.877-6.877z"
            />
          </svg>
        </SearchIconLeftContainer>
        <SearchInputRightContainer>
          <SearchInput
            ref={inputRef}
            type="text"
            placeholder={t("ui_search_tabs")}
            value={searchQuery}
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
        </SearchInputRightContainer>
      </SearchContainer>
      <hr style={{ opacity: "0.3", marginTop: "0px" }} />
      <div style={{ padding: "1em", fontWeight: "bold" }}>
        {t("ui_open_tabs", `${tabs.length}`)}
      </div>
      <TabList>
        {searchResults.length === 0 ? (
          <TabListEmpty>No Results Found</TabListEmpty>
        ) : null}
        {searchResults.map((t, i) => {
          const favicURL = faviconURL(t.item);
          const showCloseAction = tabHover === t.item.id! && !t.item.pinned;
          return (
            <TabItem
              key={t.item.id}
              $dark={darkMode}
              $selected={i === selectedTab}
              onClick={() => {
                focusTab(t.item.id!, t.item.windowId);
              }}
              ref={i === tabSelector ? selectedTabEle : undefined}
            >
              <TabItemFavicon
                $dark={darkMode}
                onMouseEnter={() => {
                  setTabHover(t.item.id!);
                }}
                onMouseLeave={() => {
                  setTabHover(null);
                }}
              >
                {showCloseAction ? (
                  <TabItemCloseBox
                    title="Close Tab"
                    onClick={(e) => {
                      e.stopPropagation();
                      bgpage.closeTab(t.item.id!).then((newtabs) => {
                        if (i < selectedTab) {
                          setTabSelector((n) => n - 1);
                        }
                        setTabs(newtabs);
                      });
                    }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width={16}
                      height={16}
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm4.151 17.943l-4.143-4.102-4.117 4.159-1.833-1.833 4.104-4.157-4.162-4.119 1.833-1.833 4.155 4.102 4.106-4.16 1.849 1.849-4.1 4.141 4.157 4.104-1.849 1.849z" />
                    </svg>
                  </TabItemCloseBox>
                ) : (
                  <img width={16} height={16} src={favicURL} />
                )}
              </TabItemFavicon>
              <TabItemMain>
                <TabItemMainTitle $dark={darkMode}>
                  <HighlightMatches
                    text={t.item.title ?? ""}
                    match={t.matches?.find((m) => m.key === "title")}
                  />
                </TabItemMainTitle>
                <TabItemMainHostname $dark={darkMode}>
                  {t.item.url ? hostname(t.item.url) : ""}
                </TabItemMainHostname>
              </TabItemMain>
            </TabItem>
          );
        })}
      </TabList>
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById("main")!);
root.render(<Popup />);
