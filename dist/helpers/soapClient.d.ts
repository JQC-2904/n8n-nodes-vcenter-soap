import { URL } from 'url';
interface VCenterSoapConfig {
    serverUrl: string;
    username: string;
    password: string;
    allowInsecure?: boolean;
    timeout?: number;
    debug?: boolean;
    logger?: (message: string) => void;
}
interface RetrieveServiceContentResult {
    about: {
        apiType: string;
        fullName: string;
        version?: string;
        build?: string;
    };
    sessionManager: string;
}
export declare class VCenterSoapClient {
    private readonly endpoint;
    private readonly config;
    private sessionCookie?;
    constructor(config: VCenterSoapConfig);
    static normalizeEndpoint(serverUrl: string): URL;
    testConnection(): Promise<Record<string, string | boolean>>;
    retrieveServiceContent(): Promise<RetrieveServiceContentResult>;
    login(sessionManager: string): Promise<void>;
    private buildEnvelope;
    private escapeXml;
    private logDebug;
    private sendSoapRequest;
    private extractSessionCookie;
    private parseSoapBody;
}
export {};
