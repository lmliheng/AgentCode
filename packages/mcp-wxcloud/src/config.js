import {} from './types.js';
export function loadConfig() {
    return {
        appId: process.env['WXCLOUD_APP_ID'] ?? undefined,
        privateKey: process.env['WXCLOUD_PRIVATE_KEY'] ?? undefined,
        region: process.env['WXCLOUD_REGION'] ?? undefined,
    };
}
