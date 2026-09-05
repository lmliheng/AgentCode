import { type Region } from './types.js'

// ---------------------------------------------------------------------------
// 配置管理：从环境变量读取默认值
// ---------------------------------------------------------------------------

export interface WxCloudConfig {
  appId: string
  privateKey: string
  region: Region
}

export function loadConfig(): Partial<WxCloudConfig> {
  return {
    appId: process.env['WXCLOUD_APP_ID'] ?? undefined,
    privateKey: process.env['WXCLOUD_PRIVATE_KEY'] ?? undefined,
    region: (process.env['WXCLOUD_REGION'] as Region | undefined) ?? undefined,
  }
}