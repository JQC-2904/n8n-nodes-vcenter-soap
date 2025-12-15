"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VCenterSoap = void 0;
const soapClient_1 = require("../../helpers/soapClient");
class VCenterSoap {
    constructor() {
        this.description = {
            displayName: 'VCenter SOAP',
            name: 'vCenterSoap',
            group: ['transform'],
            version: 1,
            description: 'Interact with VMware vCenter SOAP API',
            defaults: {
                name: 'VCenter SOAP',
            },
            inputs: ['main'],
            outputs: ['main'],
            credentials: [
                {
                    name: 'vCenterSoapApi',
                    required: true,
                },
            ],
            properties: [
                {
                    displayName: 'Operation',
                    name: 'operation',
                    type: 'options',
                    options: [
                        {
                            name: 'Test connection',
                            value: 'testConnection',
                            description: 'Validate SOAP connectivity and authentication',
                        },
                        {
                            name: 'Find VMs by name',
                            value: 'searchVMByName',
                            description: 'Search Virtual Machines by name recursively',
                        },
                    ],
                    default: 'testConnection',
                    noDataExpression: true,
                },
                {
                    displayName: 'Name Query',
                    name: 'nameQuery',
                    type: 'string',
                    required: true,
                    default: '',
                    description: 'Name to search for',
                    displayOptions: {
                        show: {
                            operation: ['searchVMByName'],
                        },
                    },
                },
                {
                    displayName: 'Match Mode',
                    name: 'matchMode',
                    type: 'options',
                    options: [
                        {
                            name: 'Exact',
                            value: 'exact',
                        },
                        {
                            name: 'Contains',
                            value: 'contains',
                        },
                    ],
                    default: 'exact',
                    displayOptions: {
                        show: {
                            operation: ['searchVMByName'],
                        },
                    },
                },
                {
                    displayName: 'Max Results',
                    name: 'maxResults',
                    type: 'number',
                    typeOptions: {
                        minValue: 1,
                        maxValue: 1000,
                    },
                    default: 50,
                    description: 'Maximum number of VMs to return',
                    displayOptions: {
                        show: {
                            operation: ['searchVMByName'],
                        },
                    },
                },
                {
                    displayName: 'Include Power State',
                    name: 'includePowerState',
                    type: 'boolean',
                    default: true,
                    displayOptions: {
                        show: {
                            operation: ['searchVMByName'],
                        },
                    },
                },
                {
                    displayName: 'Include UUID and Path',
                    name: 'includeUuidAndPath',
                    type: 'boolean',
                    default: false,
                    displayOptions: {
                        show: {
                            operation: ['searchVMByName'],
                        },
                    },
                },
                {
                    displayName: 'Enable Debug Logs',
                    name: 'debug',
                    type: 'boolean',
                    default: false,
                    description: 'Log discovery stats to the n8n debug output',
                    displayOptions: {
                        show: {
                            operation: ['searchVMByName'],
                        },
                    },
                },
            ],
        };
    }
    async execute() {
        const items = this.getInputData();
        const returnData = [];
        const operation = this.getNodeParameter('operation', 0);
        const credentials = (await this.getCredentials('vCenterSoapApi'));
        const client = new soapClient_1.VCenterSoapClient({
            serverUrl: credentials.serverUrl,
            username: credentials.username,
            password: credentials.password,
            allowInsecure: credentials.allowInsecure,
            timeout: credentials.timeout,
            debug: credentials.debug,
            logger: (message) => this.logger.debug(message),
        });
        if (operation === 'testConnection') {
            const result = await client.testConnection();
            for (let i = 0; i < items.length; i++) {
                returnData.push({ json: { ...result } });
            }
            return [returnData];
        }
        if (operation === 'searchVMByName') {
            const nameQuery = this.getNodeParameter('nameQuery', 0);
            const matchMode = this.getNodeParameter('matchMode', 0);
            const maxResults = this.getNodeParameter('maxResults', 0);
            const includePowerState = this.getNodeParameter('includePowerState', 0);
            const includeUuidAndPath = this.getNodeParameter('includeUuidAndPath', 0);
            const debug = this.getNodeParameter('debug', 0);
            const results = await client.searchVMByName({
                nameQuery,
                matchMode,
                maxResults,
                includePowerState,
                includeUuidAndPath,
                debug,
            });
            for (const result of results) {
                returnData.push({ json: result });
            }
            return [returnData];
        }
        throw new Error(`Unsupported operation: ${operation}`);
    }
}
exports.VCenterSoap = VCenterSoap;
