import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeProperties,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { VCenterSoapClient } from '../../helpers/soapClient';

export class VCenterSoap implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'VCenter SOAP',
    name: 'vCenterSoap',
    group: ['transform'],
    icon: 'file:vmware.svg',
    version: 1,
    description: 'Interactúa con VMware vCenter usando la API SOAP (vim25)',
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
        displayName: 'Recurso',
        name: 'resource',
        type: 'options',
        options: [
          {
            name: 'Conexión',
            value: 'connection',
            description: 'Probar la conexión SOAP',
          },
          {
            name: 'Máquinas Virtuales',
            value: 'vm',
            description: 'Operaciones de VM',
          },
        ],
        default: 'connection',
      },
      {
        displayName: 'Operación',
        name: 'operation',
        type: 'options',
        displayOptions: {
          show: {
            resource: ['connection'],
          },
        },
        options: [
          {
            name: 'Probar Conexión',
            value: 'test',
            description: 'Ejecuta RetrieveServiceContent y Login para validar autenticación',
          },
        ],
        default: 'test',
      },
      {
        displayName: 'Operación',
        name: 'operation',
        type: 'options',
        displayOptions: {
          show: {
            resource: ['vm'],
          },
        },
        options: [
          {
            name: 'Buscar VMs por Nombre',
            value: 'findByName',
            description: 'Busca recursivamente VMs en todos los datacenters y carpetas',
          },
        ],
        default: 'findByName',
      },
      {
        displayName: 'Nombre o patrón',
        name: 'nameQuery',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: {
            resource: ['vm'],
            operation: ['findByName'],
          },
        },
        description: 'Coincidencia parcial (contains) sobre el nombre de la VM',
      },
      {
        displayName: 'Máximo de resultados',
        name: 'maxResults',
        type: 'number',
        default: 100,
        displayOptions: {
          show: {
            resource: ['vm'],
            operation: ['findByName'],
          },
        },
      },
      {
        displayName: 'Incluir estado de encendido',
        name: 'includePowerState',
        type: 'boolean',
        default: true,
        displayOptions: {
          show: {
            resource: ['vm'],
            operation: ['findByName'],
          },
        },
      },
      {
        displayName: 'Incluir UUID y ruta',
        name: 'includeUuid',
        type: 'boolean',
        default: true,
        displayOptions: {
          show: {
            resource: ['vm'],
            operation: ['findByName'],
          },
        },
      },
      {
        displayName: 'Habilitar debug',
        name: 'debug',
        type: 'boolean',
        default: false,
        displayOptions: {
          show: {
            resource: ['vm'],
            operation: ['findByName'],
          },
        },
        description: 'Devuelve información de raíz, datacenters y progreso de traversal',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const resource = this.getNodeParameter('resource', 0) as string;
    const operation = this.getNodeParameter('operation', 0) as string;

    const credentials = await this.getCredentials('vCenterSoapApi');
    const client = new VCenterSoapClient({
      baseUrl: credentials.baseUrl as string,
      username: credentials.username as string,
      password: credentials.password as string,
      allowInsecure: credentials.allowInsecure as boolean,
      timeout: (credentials.timeout as number) ?? 15000,
    });

    if (resource === 'connection' && operation === 'test') {
      const result = await client.testConnection();
      return [[{ json: result as IDataObject }]];
    }

    if (resource === 'vm' && operation === 'findByName') {
      const nameQuery = this.getNodeParameter('nameQuery', 0) as string;
      const maxResults = this.getNodeParameter('maxResults', 0) as number;
      const includePowerState = this.getNodeParameter('includePowerState', 0) as boolean;
      const includeUuid = this.getNodeParameter('includeUuid', 0) as boolean;
      const debug = this.getNodeParameter('debug', 0) as boolean;

      const response = await client.findVmsByName({
        nameQuery,
        maxResults,
        includePowerState,
        includeUuid,
        debug,
      });

      for (const item of response.items) {
        const payload: IDataObject = { ...item };
        if (!includePowerState) delete payload.powerState;
        if (!includeUuid) {
          delete payload.uuid;
          delete payload.vmPathName;
        }
        returnData.push({ json: payload });
      }

      if (response.debug) {
        returnData.push({ json: { debug: response.debug } });
      }

      return [returnData];
    }

    return [items];
  }
}
