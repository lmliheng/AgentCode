export declare const REGION_ENUM: readonly ['ap-shanghai', 'ap-guangzhou', 'ap-beijing'];
export type Region = (typeof REGION_ENUM)[number];
export declare const WXCLOUD_DEFAULT_TIMEOUT = 120000;
export declare const WXCLOUD_DEPLOY_TIMEOUT = 300000;
export interface WxCloudResult {
    stdout: string;
    stderr: string;
}
