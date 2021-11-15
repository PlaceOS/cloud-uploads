import { CloudProvider } from "./cloud-provider";
import { Type } from "./types";

const PROVIDERS: Record<string, Type<CloudProvider>> = {};

export function registerUploadProvider(name: string, provider: Type<CloudProvider>) {
    PROVIDERS[name] = provider;
}

export function getUploadProvider(name: string): Type<CloudProvider> | null {
    return PROVIDERS[name] || null;
}
