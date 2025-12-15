export interface SoapClientOptions {
    baseUrl: string;
    username: string;
    password: string;
    allowInsecure?: boolean;
    caCertificate?: string;
    timeout?: number;
    soapVersion?: string;
}
export interface RetrieveServiceContentResult {
    rootFolder: string;
    propertyCollector: string;
    sessionManager: string;
    about: Record<string, string>;
}
export interface LoginResult {
    sessionCookie: string;
}
export interface VmSummary {
    moRef: string;
    name: string;
    datacenter: {
        name: string;
        moRef: string;
    };
    powerState?: string;
    uuid?: string;
    vmPathName?: string;
}
export declare class VCenterSoapClient {
    private readonly http;
    private readonly options;
    private sessionCookie;
    private readonly parser;
    private readonly builder;
    constructor(options: SoapClientOptions);
    private createHttpsAgent;
    private buildEnvelope;
    private parseResponse;
    private send;
    retrieveServiceContent(): Promise<RetrieveServiceContentResult>;
    login(): Promise<LoginResult>;
    private normalizeValues;
    private extractObjects;
    private retrieveProperties;
    getRootChildren(rootFolder: string): Promise<string[]>;
    getDatacentersInfo(datacenterIds: string[]): Promise<{
        moRef: string;
        name: string;
        vmFolder: string;
    }[]>;
    getFolderChildren(folderIds: string[]): Promise<Record<string, string[]>>;
    getVmNames(vmIds: string[]): Promise<Record<string, string>>;
    getVmDetails(vmIds: string[]): Promise<Record<string, Partial<VmSummary>>>;
    testConnection(): Promise<Record<string, any>>;
    findVmsByName(options: {
        nameQuery: string;
        maxResults?: number;
        includePowerState?: boolean;
        includeUuid?: boolean;
        debug?: boolean;
    }): Promise<{
        items: VmSummary[];
        debug?: Record<string, any>;
    }>;
}
