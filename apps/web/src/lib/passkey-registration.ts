"use client";

import { startRegistration } from "@simplewebauthn/browser";
import type { Passkey as AuthPasskey } from "@better-auth/passkey";

import { shouldUseCompatPasskeyAlgorithms } from "./passkey-browser";

type RegistrationOptionsJSON = Parameters<typeof startRegistration>[0]["optionsJSON"];
type PublicKeyCredentialParam = NonNullable<RegistrationOptionsJSON["pubKeyCredParams"]>[number];

type BetterAuthErrorPayload = {
  code?: unknown;
  message?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
  };
};

const compatAlgorithmIds = [-7, -257] as const;

function buildAuthUrl(path: string, params?: URLSearchParams) {
  const url = new URL(`/api/auth${path}`, window.location.origin);

  if (params) {
    url.search = params.toString();
  }

  return url;
}

async function readJson(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json();
}

function toAuthError(payload: unknown, status: number, fallback: string) {
  const candidate = payload as BetterAuthErrorPayload | null | undefined;
  const code =
    typeof candidate?.error?.code === "string"
      ? candidate.error.code
      : typeof candidate?.code === "string"
        ? candidate.code
        : "UNKNOWN_ERROR";
  const message =
    typeof candidate?.error?.message === "string"
      ? candidate.error.message
      : typeof candidate?.message === "string"
        ? candidate.message
        : fallback;

  const error = new Error(message) as Error & {
    code?: string;
    status?: number;
    payload?: unknown;
  };

  error.code = code;
  error.status = status;
  error.payload = payload;

  return error;
}

async function requestJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(buildAuthUrl(path), {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw toAuthError(payload, response.status, `HTTP ${response.status}`);
  }

  return payload as T;
}

function applyCompatAlgorithms(options: RegistrationOptionsJSON) {
  if (!shouldUseCompatPasskeyAlgorithms()) {
    return options;
  }

  const params = options.pubKeyCredParams ?? [];
  const filtered = compatAlgorithmIds
    .map((alg) => params.find((entry) => entry.type === "public-key" && entry.alg === alg))
    .filter((entry): entry is PublicKeyCredentialParam => entry !== undefined);

  if (!filtered.length) {
    return options;
  }

  return {
    ...options,
    pubKeyCredParams: filtered,
  };
}

export async function registerPasskey(name: string) {
  const params = new URLSearchParams();

  if (name) {
    params.set("name", name);
  }

  const options = await requestJson<RegistrationOptionsJSON>(
    `/passkey/generate-register-options?${params.toString()}`,
    {
      method: "GET",
    },
  );
  const response = await startRegistration({
    optionsJSON: applyCompatAlgorithms(options),
  });

  return requestJson<AuthPasskey>("/passkey/verify-registration", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      response,
      name,
    }),
  });
}
