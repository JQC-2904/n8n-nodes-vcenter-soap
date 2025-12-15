import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';
export declare class VCenterSoapApi implements ICredentialType {
    name: string;
    displayName: string;
    documentationUrl: string;
    properties: INodeProperties[];
    test: ICredentialTestRequest;
}
