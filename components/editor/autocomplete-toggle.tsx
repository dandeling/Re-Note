"use client";

import type { Editor } from "@tiptap/react";
import { Sparkles } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Autocomplete, clearAutocomplete, type AutocompleteContext } from "@/components/editor/autocomplete-extension";
import { api, ApiClientError } from "@/lib/api-client";
import { messages } from "@/lib/messages";
import { cn } from "@/lib/utils";

const t = messages.autocomplete;
const PREF_KEY = "renote.autocomplete.enabled";
const HINT_KEY = "renote.autocomplete.hintSeen";

/* ───────── 켜기/끄기 기억 (localStorage, 기본 켬) ───────── */

const prefListeners = new Set<() => void>();

function readPref() {
  try {
    return window.localStorage.getItem(PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

function writePref(on: boolean) {
  try {
    window.localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    // 저장이 막힌 브라우저에서는 이번 화면에서만 기억한다.
  }
  memoryPref = on;
  prefListeners.forEach((l) => l());
}

let memoryPref: boolean | null = null;

function subscribePref(listener: () => void) {
  prefListeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key === PREF_KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    prefListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const getPref = () => memoryPref ?? readPref();

function takeHint() {
  try {
    if (window.localStorage.getItem(HINT_KEY)) return false;
    window.localStorage.setItem(HINT_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

type Availability = { available: true } | { available: false; reason: string } | null;

type LiveState = {
  enabledPref: boolean;
  availability: Availability;
  limitReached: boolean;
  pauseUntil: number;
  documentId: string;
  getTitle: () => string;
};

type Callbacks = {
  onAnnounce: (text: string) => void;
  onLimit: () => void;
  onUnavailable: (reason: string) => void;
};

/** React 밖에서 확장과 최신 상태를 묶는다 (확장은 에디터를 만들 때 한 번만 쓰이므로). */
function createAutocompleteController(initial: LiveState, cb: Callbacks) {
  const live: LiveState = { ...initial };
  const extension = Autocomplete.configure({
    debounceMs: 1200,
    hintText: t.hint,
    takeHint,
    isEnabled: () =>
      live.enabledPref && live.availability?.available !== false && !live.limitReached && Date.now() >= live.pauseUntil,
    onChange: (text) => cb.onAnnounce(text ? t.announce : ""),
    fetchSuggestion: async (ctx: AutocompleteContext, signal: AbortSignal) => {
      try {
        const res = await api<{ completion: string }>("/api/ai/autocomplete", {
          method: "POST",
          body: {
            documentId: live.documentId,
            before: ctx.before,
            section: ctx.section.trim().slice(0, 200) || undefined,
            title: live.getTitle().trim().slice(0, 200) || undefined,
          },
          signal,
        });
        return res.completion ?? "";
      } catch (err) {
        if (err instanceof ApiClientError) {
          if (err.status === 429) {
            if (err.body?.reason === "DAILY_LIMIT") {
              live.limitReached = true;
              cb.onLimit();
            } else {
              const seconds = Number(err.body?.retryAfterSeconds) || 30;
              live.pauseUntil = Date.now() + seconds * 1000;
            }
          } else if (err.status === 503) {
            live.availability = { available: false, reason: err.message };
            cb.onUnavailable(err.message);
          }
        }
        // 그 밖의 실패(네트워크, 취소 등)는 조용히 넘어간다.
        return "";
      }
    },
  });
  return {
    extension,
    sync(next: Omit<LiveState, "pauseUntil">) {
      Object.assign(live, next);
    },
    setEnabled(on: boolean) {
      live.enabledPref = on;
    },
  };
}

/**
 * 에디터 글쓰기 자동완성.
 * `extension`은 useEditor의 extensions에 넣고, `renderToggle(editor)`는 툴바에 둔다.
 */
export function useAutocomplete({ documentId, getTitle }: { documentId: string; getTitle: () => string }) {
  const enabledPref = useSyncExternalStore(subscribePref, getPref, () => true);
  const [availability, setAvailability] = useState<Availability>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [announce, setAnnounce] = useState("");

  const [controller] = useState(() =>
    createAutocompleteController(
      { enabledPref: true, availability: null, limitReached: false, pauseUntil: 0, documentId, getTitle },
      {
        onAnnounce: setAnnounce,
        onLimit: () => setLimitReached(true),
        onUnavailable: (reason) => setAvailability({ available: false, reason }),
      },
    ),
  );
  useEffect(() => {
    controller.sync({ enabledPref, availability, limitReached, documentId, getTitle });
  });

  useEffect(() => {
    let cancelled = false;
    api<{ available: boolean; reason?: string }>("/api/ai/autocomplete")
      .then((res) => {
        if (cancelled) return;
        setAvailability(res.available ? { available: true } : { available: false, reason: res.reason ?? messages.ai.errors.notConfigured });
      })
      .catch(() => {
        // 확인하지 못하면 일단 켜 두고, 실제 요청이 503을 받으면 그때 끈다.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function renderToggle(editor: Editor): ReactNode {
    const unavailable = availability?.available === false ? availability.reason : null;
    const on = enabledPref && !unavailable;
    return (
      <div className="flex items-center gap-1.5 border-l pl-2">
        <button
          type="button"
          data-testid="autocomplete-toggle"
          aria-pressed={on}
          disabled={Boolean(unavailable)}
          title={unavailable ? t.unavailable.replace("{reason}", unavailable) : on ? t.toggleOn : t.toggleOff}
          onClick={() => {
            const next = !enabledPref;
            writePref(next);
            controller.setEnabled(next);
            if (!next) clearAutocomplete(editor.view);
          }}
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
            on && "bg-accent text-primary",
          )}
        >
          <Sparkles className="size-4" aria-hidden />
          {t.toggle}
        </button>
        {limitReached ? (
          <span data-testid="autocomplete-limit" className="text-xs text-muted-foreground">
            {t.limitReached}
          </span>
        ) : null}
        <span className="sr-only" aria-live="polite" data-testid="autocomplete-live">
          {announce}
        </span>
      </div>
    );
  }

  return { extension: controller.extension, renderToggle };
}
