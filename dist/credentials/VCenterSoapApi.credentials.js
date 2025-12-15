"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VCenterSoapApi = void 0;
class VCenterSoapApi {
    constructor() {
        this.name = 'vCenterSoapApi';
        this.displayName = 'VCenter SOAP API';
        this.documentationUrl = 'https://developer.vmware.com/apis/968/vsphere';
        this.properties = [
            {
                displayName: 'Server URL',
                name: 'baseUrl',
                type: 'string',
                default: '',
                placeholder: 'https://vcenter.example.com',
                required: true,
            },
            {
                displayName: 'Username',
                name: 'username',
                type: 'string',
                default: '',
                required: true,
            },
            {
                displayName: 'Password',
                name: 'password',
                type: 'string',
                typeOptions: { password: true },
                default: '',
                required: true,
            },
            {
                displayName: 'Allow Insecure TLS',
                name: 'allowInsecure',
                type: 'boolean',
                default: false,
                description: 'Whether to skip TLS certificate verification for lab environments',
            },
            {
                displayName: 'Request Timeout (ms)',
                name: 'timeout',
                type: 'number',
                default: 15000,
                description: 'How long to wait for SOAP responses before failing',
            },
        ];
        this.test = {
            request: {
                baseURL: '={{$credentials.baseUrl}}',
                url: '/sdk',
                method: 'POST',
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                },
                body: `<?xml version="1.0" encoding="UTF-8"?>
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
        <soapenv:Body>
          <urn:RetrieveServiceContent>
            <urn:_this type="ServiceInstance">ServiceInstance</urn:_this>
          </urn:RetrieveServiceContent>
        </soapenv:Body>
      </soapenv:Envelope>`
            },
        };
    }
}
exports.VCenterSoapApi = VCenterSoapApi;
//# sourceMappingURL=VCenterSoapApi.credentials.js.map