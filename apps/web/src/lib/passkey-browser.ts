type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    brands?: Array<{
      brand: string;
      version: string;
    }>;
    platform?: string;
  };
};

type ConditionalPublicKeyCredential = typeof PublicKeyCredential & {
  isConditionalMediationAvailable?: () => Promise<boolean>;
};

const ignoredPasskeyErrorTokens = [
  "auth cancelled",
  "authentication cancelled",
  "registration cancelled",
  "notallowederror",
  "aborterror",
  "cancelled",
  "canceled",
];

function getBrowserLabel(userAgent: string, navigatorObject: NavigatorWithUserAgentData) {
  const brands = navigatorObject.userAgentData?.brands ?? [];
  const preferredBrand = brands.find((entry) => !/chromium|not.?a.?brand/i.test(entry.brand));

  if (preferredBrand) {
    return preferredBrand.brand;
  }

  if (/edg\//i.test(userAgent)) {
    return "Edge";
  }

  if (/firefox\//i.test(userAgent)) {
    return "Firefox";
  }

  if (/chrome\//i.test(userAgent)) {
    return "Chrome";
  }

  if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) {
    return "Safari";
  }

  return "Navigateur";
}

function getPlatformLabel(navigatorObject: NavigatorWithUserAgentData) {
  const rawPlatform = navigatorObject.userAgentData?.platform ?? navigatorObject.platform ?? "";
  const normalized = rawPlatform.toLowerCase();

  if (normalized.includes("win")) {
    return "Windows";
  }

  if (normalized.includes("mac")) {
    return "macOS";
  }

  if (normalized.includes("iphone") || normalized.includes("ipad") || normalized.includes("ios")) {
    return "iOS";
  }

  if (normalized.includes("android")) {
    return "Android";
  }

  if (normalized.includes("linux")) {
    return "Linux";
  }

  return "Cet appareil";
}

export async function canUseConditionalPasskeyAutofill() {
  if (typeof window === "undefined" || typeof PublicKeyCredential === "undefined") {
    return false;
  }

  const credentialApi = PublicKeyCredential as ConditionalPublicKeyCredential;

  if (typeof credentialApi.isConditionalMediationAvailable !== "function") {
    return false;
  }

  try {
    return await credentialApi.isConditionalMediationAvailable();
  } catch {
    return false;
  }
}

export function isIgnorablePasskeyError(error?: { code?: string; message?: string } | null) {
  const haystack = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return ignoredPasskeyErrorTokens.some((token) => haystack.includes(token));
}

export function getPasskeyErrorMessage(error: unknown, fallback: string) {
  if (!error) {
    return fallback;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      error?: {
        message?: unknown;
      };
    };

    if (typeof candidate.message === "string" && candidate.message) {
      return candidate.message;
    }

    if (typeof candidate.error?.message === "string" && candidate.error.message) {
      return candidate.error.message;
    }
  }

  return fallback;
}

export function getSuggestedPasskeyName() {
  if (typeof navigator === "undefined") {
    return "Cet appareil";
  }

  const navigatorObject = navigator as NavigatorWithUserAgentData;
  const platform = getPlatformLabel(navigatorObject);
  const browser = getBrowserLabel(navigator.userAgent, navigatorObject);

  return platform === "Cet appareil" ? browser : `${platform} · ${browser}`;
}
