import { type Region } from './types.js';
export interface WxCloudConfig {
    appId: string;
    privateKey: string;
    region: Region;
}
export declare function loadConfig(): Partial<WxCloudConfig>;
