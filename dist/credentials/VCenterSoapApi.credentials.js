"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VCenterSoapApi = void 0;
class VCenterSoapApi {
    constructor() {
        this.name = 'vCenterSoapApi';
        this.displayName = 'VCenter SOAP API';
        this.properties = [
            {
                displayName: 'Server URL',
                description: 'Base URL of the vCenter server (example: https://vcsa.example.com)',
                name: 'serverUrl',
                type: 'string',
                default: '',
                placeholder: 'https://vcsa.example.com',
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
                default: '',
                typeOptions: {
                    password: true,
                },
                required: true,
            },
            {
                displayName: 'Allow Insecure TLS',
                name: 'allowInsecure',
                type: 'boolean',
                default: false,
                description: 'Disable certificate verification for lab or self-signed environments',
            },
            {
                displayName: 'Request Timeout (ms)',
                name: 'timeout',
                type: 'number',
                default: 30000,
                description: 'Timeout for SOAP requests in milliseconds',
            },
            {
                displayName: 'Enable Debug Logging',
                name: 'debug',
                type: 'boolean',
                default: false,
                description: 'Log SOAP request and response details for troubleshooting',
            },
        ];
    }
}
exports.VCenterSoapApi = VCenterSoapApi;
