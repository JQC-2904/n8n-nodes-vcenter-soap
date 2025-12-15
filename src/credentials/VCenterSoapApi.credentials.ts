import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class VCenterSoapApi implements ICredentialType {
  name = 'vCenterSoapApi';
  displayName = 'VCenter SOAP API';
  documentationUrl = 'https://developer.vmware.com/apis/968/vsphere';
  properties: INodeProperties[] = [
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
      displayName: 'Custom CA Certificate',
      name: 'caCertificate',
      type: 'string',
      default: '',
      description: 'PEM-encoded certificate for private or self-signed authorities',
    },
    {
      displayName: 'Request Timeout (ms)',
      name: 'timeout',
      type: 'number',
      default: 15000,
      description: 'How long to wait for SOAP responses before failing',
    },
  ];

  test: ICredentialTestRequest = {
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
