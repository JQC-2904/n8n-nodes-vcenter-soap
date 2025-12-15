import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { VCenterSoapClient } from '../../helpers/soapClient';

type VCenterSoapCredentials = {
  serverUrl: string;
  username: string;
  password: string;
  allowInsecure?: boolean;
  timeout?: number;
  debug?: boolean;
};

export class VCenterSoap implements INodeType {
  description: INodeTypeDescription = {
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
        ],
        default: 'testConnection',
        noDataExpression: true,
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    const operation = this.getNodeParameter('operation', 0) as string;
    if (operation !== 'testConnection') {
      throw new Error('Only the "Test connection" operation is supported in this version.');
    }

    const credentials = (await this.getCredentials('vCenterSoapApi')) as VCenterSoapCredentials;
    const client = new VCenterSoapClient({
      serverUrl: credentials.serverUrl,
      username: credentials.username,
      password: credentials.password,
      allowInsecure: credentials.allowInsecure,
      timeout: credentials.timeout,
      debug: credentials.debug,
      logger: (message: string) => this.logger.debug(message),
    });

    const result = await client.testConnection();

    for (let i = 0; i < items.length; i++) {
      returnData.push({ json: { ...result } });
    }

    return [returnData];
  }
}

