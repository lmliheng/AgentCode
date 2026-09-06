interface serverConfig {
    secret: string;
    allowedOrigins: Array<string>;
}
export declare function createServer(config: serverConfig): import("express-serve-static-core").Express;
export {};
