"use client";

import { messages } from "@/lib/messages";

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** 브라우저에서 내부 API를 호출한다. 실패 시 ApiClientError. */
export async function api<T>(url: string, init?: { method?: string; body?: unknown; signal?: AbortSignal; keepalive?: boolean }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init?.signal,
    keepalive: init?.keepalive,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiClientError(res.status, err.code ?? "INTERNAL_ERROR", err.message ?? messages.errors.INTERNAL_ERROR, err);
  }
  return data as T;
}
