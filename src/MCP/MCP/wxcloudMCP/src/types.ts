// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

export const REGION_ENUM = ['ap-shanghai', 'ap-guangzhou', 'ap-beijing'] as const
export type Region = (typeof REGION_ENUM)[number]

export const WXCLOUD_DEFAULT_TIMEOUT = 120_000
export const WXCLOUD_DEPLOY_TIMEOUT = 300_000

export interface WxCloudResult {
  stdout: string
  stderr: string
}