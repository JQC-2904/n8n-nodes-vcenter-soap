import * as https from 'node:https';
import { IncomingMessage } from 'node:http';
import { URL } from 'node:url';
import { parseStringPromise, processors } from 'xml2js';

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
  rootFolder?: string;
  propertyCollector?: string;
}

type MatchMode = 'exact' | 'contains';

export class VCenterSoapClient {
  private readonly endpoint: URL;

  private readonly config: VCenterSoapConfig;

  private sessionCookie?: string;

  constructor(config: VCenterSoapConfig) {
    this.endpoint = VCenterSoapClient.normalizeEndpoint(config.serverUrl);
    this.config = config;
  }

  static normalizeEndpoint(serverUrl: string): URL {
    const url = new URL(serverUrl);
    if (url.protocol !== 'https:') {
      throw new Error('Server URL must use https');
    }
    url.pathname = '/sdk/vimService';
    url.search = '';
    url.hash = '';
    return url;
  }

  async testConnection(): Promise<Record<string, string | boolean>> {
    const firstContent = await this.retrieveServiceContent();
    if (!firstContent.sessionManager) {
      throw new Error('SessionManager reference not found');
    }
    await this.login(firstContent.sessionManager);
    const secondContent = await this.retrieveServiceContent();
    const about = secondContent.about;

    return {
      connected: true,
      apiType: about.apiType,
      fullName: about.fullName,
      version: about.version ?? '',
      build: about.build ?? '',
    };
  }

  async retrieveServiceContent(): Promise<RetrieveServiceContentResult> {
    const body = this.buildEnvelope(`    <RetrieveServiceContent xmlns="urn:vim25">\n      <_this type="ServiceInstance">ServiceInstance</_this>\n    </RetrieveServiceContent>`);
    const responseXml = await this.sendSoapRequest(body);
    const parsedBody = await this.parseSoapBody(responseXml);
    const result = parsedBody?.RetrieveServiceContentResponse?.returnval;
    if (!result?.about || !result.sessionManager) {
      throw new Error('Unexpected RetrieveServiceContent response');
    }

    return {
      about: {
        apiType: result.about.apiType,
        fullName: result.about.fullName,
        version: result.about.version,
        build: result.about.build,
      },
      sessionManager: result.sessionManager._ ?? result.sessionManager,
      rootFolder: result.rootFolder?._ ?? result.rootFolder,
      propertyCollector: result.propertyCollector?._ ?? result.propertyCollector,
    };
  }

  async login(sessionManager: string): Promise<void> {
    const escapedUsername = this.escapeXml(this.config.username);
    const escapedPassword = this.escapeXml(this.config.password);
    const body = this.buildEnvelope(
      `    <Login xmlns="urn:vim25">\n      <_this type="SessionManager">${sessionManager}</_this>\n      <userName>${escapedUsername}</userName>\n      <password>${escapedPassword}</password>\n    </Login>`,
    );

    const responseXml = await this.sendSoapRequest(body);
    await this.parseSoapBody(responseXml);
    if (!this.sessionCookie) {
      throw new Error('Authentication failed: session cookie not received');
    }
  }

  private buildEnvelope(innerXml: string): string {
    const normalizedInnerXml = this.ensureRetrievePropertiesExOptions(innerXml);

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">',
      '  <soapenv:Body>',
      normalizedInnerXml,
      '  </soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('\n');
  }

  private ensureRetrievePropertiesExOptions(innerXml: string): string {
    const retrieveRegex = /<RetrievePropertiesEx\b[^>]*>[\s\S]*?<\/RetrievePropertiesEx>/m;
    const match = innerXml.match(retrieveRegex);
    if (!match) {
      return innerXml;
    }

    const retrieveBlock = match[0];
    const hasOptions = /<\/?(?:urn:)?options\b/i.test(retrieveBlock);
    if (hasOptions) {
      return innerXml;
    }

    const optionsElement = '      <options/>';
    const retrieveWithOptions = retrieveBlock.replace('</RetrievePropertiesEx>', `${optionsElement}\n    </RetrievePropertiesEx>`);

    return innerXml.replace(retrieveBlock, retrieveWithOptions);
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private logDebug(message: string, details: Record<string, unknown>): void {
    if (!this.config.debug) {
      return;
    }
    const logger = this.config.logger ?? console.log;
    logger(`${message}: ${JSON.stringify(details)}`);
  }

  private async sendSoapRequest(body: string): Promise<string> {
    const bodyBuffer = Buffer.from(body, 'utf8');
    const headers: Record<string, string> = {
      Host: this.endpoint.host,
      'Content-Type': 'text/xml; charset=utf-8',
      Accept: 'text/xml',
      SOAPAction: 'urn:vim25/7.0',
      'Content-Length': bodyBuffer.byteLength.toString(),
      Connection: 'close',
    };

    if (this.sessionCookie) {
      headers.Cookie = this.sessionCookie;
    }

    this.logDebug('SOAP request', {
      url: this.endpoint.toString(),
      method: 'POST',
      headers,
      contentLength: bodyBuffer.byteLength,
      bodyPreview: body.substring(0, 100),
    });

    const port = this.endpoint.port ? Number(this.endpoint.port) : 443;
    const options: https.RequestOptions = {
      protocol: this.endpoint.protocol,
      hostname: this.endpoint.hostname,
      port,
      path: this.endpoint.pathname,
      method: 'POST',
      headers,
      rejectUnauthorized: !this.config.allowInsecure,
      servername: this.endpoint.hostname,
    };

    return new Promise<string>((resolve, reject) => {
      const req = https.request(options, (res: IncomingMessage) => {
        const chunks: Buffer[] = [];

        const setCookieHeader = res.headers['set-cookie'];
        if (Array.isArray(setCookieHeader)) {
          const cookie = this.extractSessionCookie(setCookieHeader);
          if (cookie) {
            this.sessionCookie = cookie;
          }
        }

        res.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        res.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf8');

          this.logDebug('SOAP response', {
            statusCode: res.statusCode,
            bodyPreview: responseBody.substring(0, 200),
          });

          resolve(responseBody);
        });
      });

      req.on('error', (error: Error) => {
        reject(error);
      });

      if (this.config.timeout && this.config.timeout > 0) {
        req.setTimeout(this.config.timeout, () => {
          req.destroy(new Error('Request timed out'));
        });
      }

      req.write(bodyBuffer);
      req.end();
    });
  }

  private extractSessionCookie(cookies: string[]): string | undefined {
    for (const cookie of cookies) {
      const match = cookie.match(/vmware_soap_session=([^;]+)/i);
      if (match) {
        return `vmware_soap_session=${match[1]}`;
      }
    }
    return undefined;
  }

  private async parseSoapBody(xml: string): Promise<any> {
    let parsed: any;
    try {
      parsed = await parseStringPromise(xml, {
        explicitArray: false,
        tagNameProcessors: [processors.stripPrefix],
        attrNameProcessors: [processors.stripPrefix],
        mergeAttrs: true,
      });
    } catch (error) {
      throw new Error(`Failed to parse SOAP response: ${(error as Error).message}`);
    }

    const body = parsed?.Envelope?.Body;
    if (!body) {
      throw new Error('Invalid SOAP response: missing body');
    }

    if (body.Fault) {
      const faultString = body.Fault.faultstring || 'Unknown fault';
      throw new Error(`SOAP Fault: ${faultString}`);
    }

    return body;
  }

  private extractValMoRefs(xml: string): Array<{ moRef: string; type?: string }> {
    const results: Array<{ moRef: string; type?: string }> = [];
    const regex = /<val\b([^>]*)>([^<]+)<\/val>/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(xml))) {
      const attrs = match[1];
      const moRef = match[2].trim();
      if (!moRef) {
        continue;
      }

      let type: string | undefined;
      if (attrs) {
        const typeMatch = attrs.match(/type="([^"]+)"/i);
        if (typeMatch) {
          type = typeMatch[1];
        }
      }

      results.push({ moRef, type });
    }

    return results;
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  async searchVMByName(params: {
    nameQuery: string;
    matchMode: MatchMode;
    maxResults: number;
    includePowerState: boolean;
    includeUuidAndPath: boolean;
    debug?: boolean;
  }): Promise<Array<Record<string, unknown>>> {
    const debugEnabled = this.config.debug || params.debug;
    const logger = this.config.logger ?? console.log;
    const logDebug = (message: string, details: Record<string, unknown>) => {
      if (debugEnabled) {
        logger(`${message}: ${JSON.stringify(details)}`);
      }
    };

    const initialContent = await this.retrieveServiceContent();
    if (!initialContent.sessionManager) {
      throw new Error('SessionManager reference not found');
    }
    if (!this.sessionCookie) {
      await this.login(initialContent.sessionManager);
    }
    const serviceContent = this.sessionCookie ? await this.retrieveServiceContent() : initialContent;

    if (!serviceContent.rootFolder || !serviceContent.propertyCollector) {
      throw new Error('Service content missing rootFolder or propertyCollector');
    }

    logDebug('Service content', {
      rootFolder: serviceContent.rootFolder,
      propertyCollector: serviceContent.propertyCollector,
    });

    const datacenterDiscoveryXml = this.buildEnvelope(`    <RetrievePropertiesEx xmlns="urn:vim25">\n      <_this type="PropertyCollector">${serviceContent.propertyCollector}</_this>\n      <specSet>\n        <propSet>\n          <type>Folder</type>\n          <pathSet>childEntity</pathSet>\n        </propSet>\n        <objectSet>\n          <obj type="Folder">${serviceContent.rootFolder}</obj>\n        </objectSet>\n      </specSet>\n    </RetrievePropertiesEx>`);
    const datacenterDiscoveryResponseXml = await this.sendSoapRequest(datacenterDiscoveryXml);
    const datacenterDiscoveryParsed = await this.parseSoapBody(datacenterDiscoveryResponseXml);
    if (!datacenterDiscoveryParsed?.RetrievePropertiesExResponse) {
      throw new Error('Unexpected response when discovering datacenters');
    }

    const datacenterCandidates = this.extractValMoRefs(datacenterDiscoveryResponseXml);
    const datacenterMoRefs = datacenterCandidates
      .filter((entry) => entry.type === 'Datacenter' || entry.moRef.startsWith('datacenter-'))
      .map((entry) => entry.moRef);

    logDebug('Datacenters discovered', {
      count: datacenterMoRefs.length,
      samples: datacenterMoRefs.slice(0, 5),
    });

    const vmToDatacenter = new Map<string, { datacenterMoRef: string; datacenterName: string }>();
    const discoveredVmList: string[] = [];
    const visitedFolders = new Set<string>();
    const visitedVMs = new Set<string>();

    for (const datacenterMoRef of datacenterMoRefs) {
      const dcDetailsXml = this.buildEnvelope(`    <RetrievePropertiesEx xmlns="urn:vim25">\n      <_this type="PropertyCollector">${serviceContent.propertyCollector}</_this>\n      <specSet>\n        <propSet>\n          <type>Datacenter</type>\n          <pathSet>name</pathSet>\n          <pathSet>vmFolder</pathSet>\n        </propSet>\n        <objectSet>\n          <obj type="Datacenter">${datacenterMoRef}</obj>\n        </objectSet>\n      </specSet>\n    </RetrievePropertiesEx>`);

      const dcDetailsResponseXml = await this.sendSoapRequest(dcDetailsXml);
      const dcDetailsParsed = await this.parseSoapBody(dcDetailsResponseXml);
      const dcObjects =
        dcDetailsParsed?.RetrievePropertiesExResponse?.returnval?.objects ??
        dcDetailsParsed?.RetrievePropertiesExResponse?.returnval?.objects;

      const normalizedDcObjects = Array.isArray(dcObjects) ? dcObjects : dcObjects ? [dcObjects] : [];
      let datacenterName = datacenterMoRef;
      let vmFolderMoRef: string | undefined;

      for (const obj of normalizedDcObjects) {
        const propSet = Array.isArray(obj.propSet) ? obj.propSet : obj.propSet ? [obj.propSet] : [];
        for (const prop of propSet) {
          const propName = prop.name;
          const val: any = prop.val ?? prop._ ?? prop;
          if (propName === 'name' && typeof val === 'string') {
            datacenterName = val;
          }
          if (propName === 'vmFolder') {
            vmFolderMoRef = val?._ ?? val;
          }
        }
      }

      if (!vmFolderMoRef) {
        const vmFolderCandidates = this.extractValMoRefs(dcDetailsResponseXml);
        vmFolderMoRef = vmFolderCandidates.find((entry) => entry.moRef.startsWith('group-v'))?.moRef;
      }

      if (!vmFolderMoRef) {
        continue;
      }

      logDebug('Datacenter details', {
        datacenterMoRef,
        datacenterName,
        vmFolderMoRef,
      });

      const folderQueue: string[] = [vmFolderMoRef];
      let foldersVisitedForDc = 0;

      while (folderQueue.length > 0) {
        const folderMoRef = folderQueue.shift() as string;
        if (visitedFolders.has(folderMoRef)) {
          continue;
        }

        visitedFolders.add(folderMoRef);
        foldersVisitedForDc += 1;

        const folderChildrenXml = this.buildEnvelope(`    <RetrievePropertiesEx xmlns="urn:vim25">\n      <_this type="PropertyCollector">${serviceContent.propertyCollector}</_this>\n      <specSet>\n        <propSet>\n          <type>Folder</type>\n          <pathSet>childEntity</pathSet>\n        </propSet>\n        <objectSet>\n          <obj type="Folder">${folderMoRef}</obj>\n        </objectSet>\n      </specSet>\n    </RetrievePropertiesEx>`);

        const folderChildrenResponseXml = await this.sendSoapRequest(folderChildrenXml);
        await this.parseSoapBody(folderChildrenResponseXml);

        const childEntries = this.extractValMoRefs(folderChildrenResponseXml);
        for (const child of childEntries) {
          const childMoRef = child.moRef;
          const childType = child.type;

          if (childType === 'Folder' || childMoRef.startsWith('group-v')) {
            folderQueue.push(childMoRef);
          } else if (childType === 'VirtualMachine' || childMoRef.startsWith('vm-')) {
            if (!visitedVMs.has(childMoRef)) {
              visitedVMs.add(childMoRef);
              discoveredVmList.push(childMoRef);
              vmToDatacenter.set(childMoRef, { datacenterMoRef, datacenterName });
            }
          }
        }
      }

      logDebug('Folder traversal stats', {
        datacenterMoRef,
        foldersVisitedForDc,
        totalFoldersVisited: visitedFolders.size,
        vmsDiscovered: discoveredVmList.length,
      });
    }

    logDebug('VM discovery complete', {
      totalVMs: discoveredVmList.length,
      samples: discoveredVmList.slice(0, 5),
    });

    const matchedVMs: string[] = [];
    const nameMatches = new Map<string, string>();

    const vmChunks = this.chunkArray(discoveredVmList, 100);
    for (const vmChunk of vmChunks) {
      if (matchedVMs.length >= params.maxResults) {
        break;
      }

      const specSet = [
        '      <specSet>',
        '        <propSet>',
        '          <type>VirtualMachine</type>',
        '          <pathSet>name</pathSet>',
        '        </propSet>',
        '        <objectSet>',
        vmChunk.map((vmRef) => `          <obj type="VirtualMachine">${vmRef}</obj>`).join('\n'),
        '        </objectSet>',
        '      </specSet>',
      ].join('\n');

      const vmNamesXml = this.buildEnvelope(`    <RetrievePropertiesEx xmlns="urn:vim25">\n      <_this type="PropertyCollector">${serviceContent.propertyCollector}</_this>\n${specSet}\n    </RetrievePropertiesEx>`);

      const vmNamesResponseXml = await this.sendSoapRequest(vmNamesXml);
      const vmNamesParsed = await this.parseSoapBody(vmNamesResponseXml);
      const vmObjects = vmNamesParsed?.RetrievePropertiesExResponse?.returnval?.objects;
      const normalizedVmObjects = Array.isArray(vmObjects) ? vmObjects : vmObjects ? [vmObjects] : [];

      for (const obj of normalizedVmObjects) {
        const objRef = obj.obj?._ ?? obj.obj;
        const propSet = Array.isArray(obj.propSet) ? obj.propSet : obj.propSet ? [obj.propSet] : [];
        const nameProp = propSet.find((prop: any) => prop.name === 'name');
        const vmName = nameProp?.val ?? nameProp?._ ?? nameProp;
        if (typeof objRef === 'string' && typeof vmName === 'string') {
          const matches =
            params.matchMode === 'exact'
              ? vmName === params.nameQuery
              : vmName.includes(params.nameQuery);
          if (matches) {
            matchedVMs.push(objRef);
            nameMatches.set(objRef, vmName);
            if (matchedVMs.length >= params.maxResults) {
              break;
            }
          }
        }
      }

      if (matchedVMs.length >= params.maxResults) {
        break;
      }
    }

    logDebug('Matched VMs', {
      matchedCount: matchedVMs.length,
      samples: matchedVMs.slice(0, 5).map((ref) => nameMatches.get(ref)),
    });

    if (matchedVMs.length === 0) {
      return [];
    }

    const pathSets = ['name'];
    if (params.includePowerState) {
      pathSets.push('runtime.powerState');
    }
    if (params.includeUuidAndPath) {
      pathSets.push('summary.config.uuid', 'summary.config.vmPathName');
    }

    const results: Array<Record<string, unknown>> = [];
    const matchedChunks = this.chunkArray(matchedVMs, 100);

    for (const matchChunk of matchedChunks) {
      const propSetXml = [
        '        <propSet>',
        '          <type>VirtualMachine</type>',
        ...pathSets.map((path) => `          <pathSet>${path}</pathSet>`),
        '        </propSet>',
      ].join('\n');

      const objectSetXml = matchChunk
        .map((vmRef) => `          <objectSet>\n            <obj type="VirtualMachine">${vmRef}</obj>\n          </objectSet>`) // keep structure per object
        .join('\n');

      const vmDetailsXml = this.buildEnvelope(
        [
          '    <RetrievePropertiesEx xmlns="urn:vim25">',
          `      <_this type="PropertyCollector">${serviceContent.propertyCollector}</_this>`,
          '      <specSet>',
          propSetXml,
          objectSetXml,
          '      </specSet>',
          '    </RetrievePropertiesEx>',
        ].join('\n'),
      );

      const vmDetailsResponseXml = await this.sendSoapRequest(vmDetailsXml);
      const vmDetailsParsed = await this.parseSoapBody(vmDetailsResponseXml);
      const vmObjects = vmDetailsParsed?.RetrievePropertiesExResponse?.returnval?.objects;
      const normalizedVmObjects = Array.isArray(vmObjects) ? vmObjects : vmObjects ? [vmObjects] : [];

      for (const obj of normalizedVmObjects) {
        const vmRef = obj.obj?._ ?? obj.obj;
        if (typeof vmRef !== 'string') {
          continue;
        }

        const propSet = Array.isArray(obj.propSet) ? obj.propSet : obj.propSet ? [obj.propSet] : [];
        const entry: Record<string, unknown> = {
          moRef: vmRef,
        };

        const datacenterInfo = vmToDatacenter.get(vmRef);
        if (datacenterInfo) {
          entry.datacenterMoRef = datacenterInfo.datacenterMoRef;
          entry.datacenterName = datacenterInfo.datacenterName;
        }

        for (const prop of propSet) {
          const propName = prop.name;
          const val: any = prop.val ?? prop._ ?? prop;
          if (propName === 'name' && typeof val === 'string') {
            entry.name = val;
          }
          if (propName === 'runtime.powerState' && typeof val === 'string') {
            entry.powerState = val;
          }
          if (propName === 'summary.config.uuid' && typeof val === 'string') {
            entry.uuid = val;
          }
          if (propName === 'summary.config.vmPathName' && typeof val === 'string') {
            entry.vmPathName = val;
          }
        }

        if (!entry.name && nameMatches.has(vmRef)) {
          entry.name = nameMatches.get(vmRef);
        }

        results.push(entry);
      }
    }

    return results.slice(0, params.maxResults);
  }
}

