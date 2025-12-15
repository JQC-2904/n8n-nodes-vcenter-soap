import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

export interface SoapClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  allowInsecure?: boolean;
  caCertificate?: string;
  timeout?: number;
  soapVersion?: string;
  debugHttp?: boolean;
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
  datacenter: { name: string; moRef: string };
  powerState?: string;
  uuid?: string;
  vmPathName?: string;
}

interface ParsedSoapResponse {
  envelope: any;
}

const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const VIM_NS = 'urn:vim25';

export class VCenterSoapClient {
  private readonly http: AxiosInstance;
  private readonly options: SoapClientOptions;
  private readonly endpoint: string;
  private sessionCookie: string | null = null;
  private static httpDebugLogged = false;
  private readonly parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true });
  private readonly builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '', suppressBooleanAttributes: false });

  constructor(options: SoapClientOptions) {
    this.options = { allowInsecure: true, ...options };

    this.endpoint = this.normalizeEndpoint(options.baseUrl);

    // Explicitly disable all proxy behaviour for SOAP calls.
    process.env.NO_PROXY = '*';

    // TLS handling is explicit and scoped: use a custom https.Agent for SOAP requests only.
    // - If allowInsecure is true, certificate verification is skipped for lab environments.
    // - If a custom CA is provided, it is injected while keeping verification enabled.
    // - Otherwise, Node.js default verification is used.
    const httpsAgent = this.createHttpsAgent();

    this.http = axios.create({
      baseURL: this.endpoint,
      timeout: options.timeout ?? 15000,
      httpsAgent,
      proxy: false,
      maxRedirects: 0,
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: [(response: string) => response],
      adapter: axios.defaults.adapter,
    });
  }

  private normalizeEndpoint(baseUrl: string): string {
    const trimmed = baseUrl
      .replace(/\/+$/, '')
      .replace(/\/sdk\/vimService\.wsdl$/i, '/sdk/vimService')
      .replace(/\/sdk$/i, '/sdk/vimService');
    if (!/^https:\/\//i.test(trimmed)) {
      throw new Error('Only HTTPS endpoints are supported for SOAP transport.');
    }
    if (trimmed.endsWith('/sdk/vimService')) return trimmed;
    return `${trimmed}/sdk/vimService`;
  }

  private createHttpsAgent(): https.Agent {
    return new https.Agent({
      keepAlive: false,
      rejectUnauthorized: !this.options.allowInsecure,
      ca: this.options.caCertificate,
    });
  }

  private buildEnvelope(body: any) {
    return this.builder.build({
      'soapenv:Envelope': {
        '@_xmlns:soapenv': SOAP_ENV_NS,
        '@_xmlns:urn': VIM_NS,
        'soapenv:Body': body,
      },
    });
  }

  private normalizeSoapBody(body: any): string {
    const envelope = typeof body === 'string' ? body : this.buildEnvelope(body);
    const soapBody = (envelope instanceof Buffer ? envelope.toString('utf8') : String(envelope)).replace(/^\uFEFF/, '');
    const normalized = soapBody.trim();
    if (!normalized.startsWith('<')) {
      throw new Error('SOAP body must start with "<" after normalization.');
    }
    return normalized;
  }

  private parseResponse(xml: string): ParsedSoapResponse {
    try {
      const parsed = this.parser.parse(xml);
      const envelope = parsed?.Envelope ?? parsed?.['soapenv:Envelope'] ?? parsed?.['SOAP-ENV:Envelope'];
      if (!envelope) throw new Error('SOAP Envelope not found');
      return { envelope };
    } catch (error) {
      const snippet = xml.slice(0, 500);
      const message = error instanceof Error ? error.message : 'Unknown parsing error';
      throw new Error(`Failed to parse SOAP response: ${message}. Response snippet: ${snippet}`);
    }
  }

  private extractFaultString(xml: string): string | undefined {
    const match = xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
    return match?.[1]?.trim();
  }

  private async send(body: any, _soapAction?: string): Promise<any> {
    const soapActionHeader = 'urn:vim25/7.0';
    const soapBody = this.normalizeSoapBody(body);
    const headers: Record<string, string> = {
      'Content-Type': 'text/xml; charset=utf-8',
      Accept: 'text/xml',
      SOAPAction: soapActionHeader,
    };
    headers['Content-Length'] = Buffer.byteLength(soapBody, 'utf8').toString();

    if (this.sessionCookie) {
      headers.Cookie = `vmware_soap_session=${this.sessionCookie}`;
    }

    if (this.options.debugHttp && !VCenterSoapClient.httpDebugLogged) {
      const adapter = this.http.defaults.adapter;
      const adapterName = Array.isArray(adapter)
        ? adapter.map((fn) => (typeof fn === 'function' ? fn.name || 'anonymous' : 'unknown')).join(', ')
        : typeof adapter === 'function'
          ? adapter.name || 'anonymous'
          : 'unknown';

      // One-time transport debug log to verify request fidelity.
      // eslint-disable-next-line no-console
      console.debug('[vcenter-soap:http]', {
        method: 'POST',
        url: this.endpoint,
        headers,
        bodyPreview: soapBody.slice(0, 120),
        proxyDisabled: this.http.defaults.proxy === false,
        adapter: adapterName,
      });

      VCenterSoapClient.httpDebugLogged = true;
    }

    const response = await this.http.post('', soapBody, {
      headers,
      maxRedirects: 0,
    });

    if (response.status === 404) {
      throw new Error(
        'SOAP endpoint not reachable (404). Your Envoy/LB is not routing /sdk/vimService. Fix routing or use direct vCenter URL.',
      );
    }

    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      const session = setCookie.find((cookie: string) => cookie.startsWith('vmware_soap_session'));
      if (session) {
        const match = session.match(/vmware_soap_session=([^;]+)/);
        if (match?.[1]) {
          this.sessionCookie = match[1];
        }
      }
    }

    if (response.status !== 200) {
      const bodySnippet = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
      const snippet = (response.status === 500 ? this.extractFaultString(bodySnippet) ?? bodySnippet : bodySnippet).slice(
        0,
        500,
      );
      throw new Error(
        `SOAP request failed (status ${response.status}) for ${this.endpoint} [SOAPAction: ${soapActionHeader}]: ${snippet}`,
      );
    }

    const parsed = this.parseResponse(response.data ?? '');
    const bodyNode = parsed.envelope?.Body ?? parsed.envelope?.body;
    if (!bodyNode) throw new Error(`Invalid SOAP response. Response snippet: ${(response.data ?? '').slice(0, 500)}`);
    return bodyNode;
  }

  async retrieveServiceContent(): Promise<RetrieveServiceContentResult> {
    const envelope = this.buildEnvelope({
      'urn:RetrieveServiceContent': {
        'urn:_this': {
          '@_type': 'ServiceInstance',
          '#text': 'ServiceInstance',
        },
      },
    });

    const response = await this.send(envelope, 'urn:vim25/7.0');
    const result = response.RetrieveServiceContentResponse?.returnval ?? response.retrieveServiceContentResponse?.returnval;
    if (!result) throw new Error('Missing RetrieveServiceContent response');

    return {
      rootFolder: result.rootFolder?.val ?? result.rootFolder,
      propertyCollector: result.propertyCollector?.val ?? result.propertyCollector,
      sessionManager: result.sessionManager?.val ?? result.sessionManager,
      about: result.about ?? {},
    };
  }

  async login(): Promise<LoginResult> {
    const body = {
      'urn:Login': {
        'urn:_this': { '@_type': 'SessionManager', '#text': 'SessionManager' },
        'urn:userName': this.options.username,
        'urn:password': this.options.password,
      },
    };

    const response = await this.send(body, 'urn:vim25/7.0');
    const cookie = this.sessionCookie ?? '';
    if (!cookie) throw new Error('Login did not return a session cookie');
    return { sessionCookie: cookie };
  }

  private normalizeValues(values: any): string[] {
    if (values === undefined || values === null) return [];
    if (Array.isArray(values)) return values.map((value) => value.val ?? value);
    return [values.val ?? values];
  }

  private extractObjects(response: any): any[] {
    const objects = response.RetrievePropertiesExResponse?.returnval?.objects ?? response.retrievePropertiesExResponse?.returnval?.objects;
    if (!objects) return [];
    return Array.isArray(objects) ? objects : [objects];
  }

  private async retrieveProperties(objectType: string, properties: string[], objectRefs: string[]) {
    const objectSet = objectRefs.map((ref) => ({
      'urn:obj': { '@_type': objectType, '#text': ref },
    }));

    const body = {
      'urn:RetrievePropertiesEx': {
        'urn:_this': { '@_type': 'PropertyCollector', '#text': 'propertyCollector' },
        'urn:specSet': {
          'urn:propSet': properties.map((path) => ({ 'urn:type': objectType, 'urn:pathSet': path })),
          'urn:objectSet': objectSet,
        },
        'urn:options': {},
      },
    };

    const response = await this.send(body, 'RetrievePropertiesEx');
    return this.extractObjects(response);
  }

  async getRootChildren(rootFolder: string): Promise<string[]> {
    const objects = await this.retrieveProperties('Folder', ['childEntity'], [rootFolder]);
    const childProps = objects[0]?.propSet ?? [];
    const propArray = Array.isArray(childProps) ? childProps : [childProps];
    const values = propArray.find((p) => p.name === 'childEntity')?.val ?? [];
    return this.normalizeValues(values);
  }

  async getDatacentersInfo(datacenterIds: string[]): Promise<{ moRef: string; name: string; vmFolder: string }[]> {
    const objects = await this.retrieveProperties('Datacenter', ['name', 'vmFolder'], datacenterIds);
    return objects.map((obj) => {
      const props = Array.isArray(obj.propSet) ? obj.propSet : [obj.propSet];
      const name = props.find((p: any) => p.name === 'name')?.val ?? '';
      const vmFolder = (props.find((p: any) => p.name === 'vmFolder')?.val?.val ?? props.find((p: any) => p.name === 'vmFolder')?.val) ?? '';
      return { moRef: obj.obj?.val ?? obj.obj, name, vmFolder };
    });
  }

  async getFolderChildren(folderIds: string[]): Promise<Record<string, string[]>> {
    const objects = await this.retrieveProperties('Folder', ['childEntity'], folderIds);
    const folderMap: Record<string, string[]> = {};
    for (const obj of objects) {
      const props = Array.isArray(obj.propSet) ? obj.propSet : [obj.propSet];
      const children = this.normalizeValues(props.find((p: any) => p.name === 'childEntity')?.val ?? []);
      folderMap[obj.obj?.val ?? obj.obj] = children;
    }
    return folderMap;
  }

  async getVmNames(vmIds: string[]): Promise<Record<string, string>> {
    const objects = await this.retrieveProperties('VirtualMachine', ['name'], vmIds);
    const nameMap: Record<string, string> = {};
    for (const obj of objects) {
      const props = Array.isArray(obj.propSet) ? obj.propSet : [obj.propSet];
      const name = props.find((p: any) => p.name === 'name')?.val ?? '';
      nameMap[obj.obj?.val ?? obj.obj] = name;
    }
    return nameMap;
  }

  async getVmDetails(vmIds: string[]): Promise<Record<string, Partial<VmSummary>>> {
    const objects = await this.retrieveProperties('VirtualMachine', ['name', 'runtime.powerState', 'summary.config.uuid', 'summary.config.vmPathName'], vmIds);
    const detailMap: Record<string, Partial<VmSummary>> = {};
    for (const obj of objects) {
      const props = Array.isArray(obj.propSet) ? obj.propSet : [obj.propSet];
      const ref = obj.obj?.val ?? obj.obj;
      detailMap[ref] = {
        name: props.find((p: any) => p.name === 'name')?.val ?? '',
        powerState: props.find((p: any) => p.name === 'runtime.powerState')?.val ?? undefined,
        uuid: props.find((p: any) => p.name === 'summary.config.uuid')?.val ?? undefined,
        vmPathName: props.find((p: any) => p.name === 'summary.config.vmPathName')?.val ?? undefined,
      };
    }
    return detailMap;
  }

  async testConnection(): Promise<Record<string, any>> {
    try {
      const firstContent = await this.retrieveServiceContent();
      await this.login();
      const secondContent = await this.retrieveServiceContent();
      return {
        apiType: secondContent.about.apiType,
        fullName: secondContent.about.fullName,
        version: secondContent.about.version,
        build: secondContent.about.build,
        rootFolder: secondContent.rootFolder,
        authenticated: true,
      };
    } catch (error) {
      throw error;
    }
  }

  async findVmsByName(options: {
    nameQuery: string;
    maxResults?: number;
    includePowerState?: boolean;
    includeUuid?: boolean;
    debug?: boolean;
  }): Promise<{ items: VmSummary[]; debug?: Record<string, any> }> {
    const debugLog: Record<string, any> = {};
    const content = await this.retrieveServiceContent();
    debugLog.rootFolder = content.rootFolder;

    const childEntities = await this.getRootChildren(content.rootFolder);
    const datacenters = childEntities.filter((id) => id.startsWith('datacenter-'));
    debugLog.datacenters = datacenters;

    const dcInfo = await this.getDatacentersInfo(datacenters);
    const maxResults = options.maxResults ?? 100;

    const visitedFolders = new Set<string>();
    const visitedVMs = new Set<string>();
    const matched: VmSummary[] = [];
    const queue: { folder: string; dcName: string; dcRef: string }[] = [];

    for (const dc of dcInfo) {
      queue.push({ folder: dc.vmFolder, dcName: dc.name, dcRef: dc.moRef });
    }

    while (queue.length && matched.length < maxResults) {
      const current = queue.shift()!;
      if (visitedFolders.has(current.folder)) continue;
      visitedFolders.add(current.folder);

      const children = (await this.getFolderChildren([current.folder]))[current.folder] ?? [];
      const folders = children.filter((id) => id.startsWith('group-'));
      const vms = children.filter((id) => id.startsWith('vm-'));

      for (const folder of folders) {
        queue.push({ folder, dcName: current.dcName, dcRef: current.dcRef });
      }

      for (const vm of vms) {
        if (visitedVMs.has(vm)) continue;
        visitedVMs.add(vm);
      }
    }

    const vmList = Array.from(visitedVMs);
    debugLog.foldersVisited = visitedFolders.size;
    debugLog.vmsDiscovered = vmList.length;

    const nameMap = await this.getVmNames(vmList);
    const filter = (name: string) => name.toLowerCase().includes(options.nameQuery.toLowerCase());
    const filteredIds = vmList.filter((id) => filter(nameMap[id] ?? '')); 

    let detailsMap: Record<string, Partial<VmSummary>> = {};
    if (options.includePowerState || options.includeUuid) {
      detailsMap = await this.getVmDetails(filteredIds);
    }

    for (const dc of dcInfo) {
      for (const vm of filteredIds) {
        if (matched.length >= maxResults) break;
        const vmName = nameMap[vm];
        const details = detailsMap[vm] ?? {};
        matched.push({
          moRef: vm,
          name: vmName,
          datacenter: { name: dc.name, moRef: dc.moRef },
          powerState: options.includePowerState ? details.powerState : undefined,
          uuid: options.includeUuid ? details.uuid : undefined,
          vmPathName: options.includeUuid ? details.vmPathName : undefined,
        });
      }
    }

    const debug = options.debug
      ? {
          ...debugLog,
          firstVm: matched[0]?.moRef,
          firstVmName: matched[0]?.name,
        }
      : undefined;

    return { items: matched, debug };
  }
}
