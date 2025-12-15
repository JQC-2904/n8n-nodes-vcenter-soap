"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.VCenterSoapClient = void 0;
const https = __importStar(require("https"));
const fast_xml_parser_1 = require("fast-xml-parser");
const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const VIM_NS = 'urn:vim25';
class VCenterSoapClient {
    constructor(options) {
        this.sessionCookie = null;
        this.parser = new fast_xml_parser_1.XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true });
        this.builder = new fast_xml_parser_1.XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '', suppressBooleanAttributes: false });
        this.options = { allowInsecure: true, ...options };
        this.endpoint = this.normalizeEndpoint(options.baseUrl);
        // Explicitly disable all proxy behaviour for SOAP calls.
        process.env.NO_PROXY = '*';
        // TLS handling is explicit and scoped: use a custom https.Agent for SOAP requests only.
        // - If allowInsecure is true, certificate verification is skipped for lab environments.
        // - If a custom CA is provided, it is injected while keeping verification enabled.
        // - Otherwise, Node.js default verification is used.
        this.httpsAgent = this.createHttpsAgent();
    }
    normalizeEndpoint(baseUrl) {
        const trimmed = baseUrl
            .replace(/\/+$/, '')
            .replace(/\/sdk\/vimService\.wsdl$/i, '/sdk/vimService')
            .replace(/\/sdk$/i, '/sdk/vimService');
        if (!/^https:\/\//i.test(trimmed)) {
            throw new Error('Only HTTPS endpoints are supported for SOAP transport.');
        }
        if (trimmed.endsWith('/sdk/vimService'))
            return trimmed;
        return `${trimmed}/sdk/vimService`;
    }
    createHttpsAgent() {
        const url = new URL(this.endpoint);
        return new https.Agent({
            keepAlive: false,
            rejectUnauthorized: !this.options.allowInsecure,
            ca: this.options.caCertificate,
            servername: url.hostname,
        });
    }
    buildEnvelope(body) {
        return this.builder.build({
            'soapenv:Envelope': {
                '@_xmlns:soapenv': SOAP_ENV_NS,
                '@_xmlns:urn': VIM_NS,
                'soapenv:Body': body,
            },
        });
    }
    normalizeSoapBody(body) {
        const envelope = typeof body === 'string' ? body : this.buildEnvelope(body);
        const soapBody = (envelope instanceof Buffer ? envelope.toString('utf8') : String(envelope)).replace(/^\uFEFF/, '');
        const normalized = soapBody.trim();
        if (!normalized.startsWith('<')) {
            throw new Error('SOAP body must start with "<" after normalization.');
        }
        return normalized;
    }
    parseResponse(xml) {
        try {
            const parsed = this.parser.parse(xml);
            const envelope = parsed?.Envelope ?? parsed?.['soapenv:Envelope'] ?? parsed?.['SOAP-ENV:Envelope'];
            if (!envelope)
                throw new Error('SOAP Envelope not found');
            return { envelope };
        }
        catch (error) {
            const snippet = xml.slice(0, 500);
            const message = error instanceof Error ? error.message : 'Unknown parsing error';
            throw new Error(`Failed to parse SOAP response: ${message}. Response snippet: ${snippet}`);
        }
    }
    extractFaultString(xml) {
        const match = xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
        return match?.[1]?.trim();
    }
    async sendRawHttp11(xml, soapAction) {
        const soapBody = this.normalizeSoapBody(xml);
        const url = new URL(this.endpoint);
        const path = '/sdk/vimService';
        const contentLength = Buffer.byteLength(soapBody, 'utf8');
        const headers = {
            Host: url.host,
            'Content-Type': 'text/xml; charset=utf-8',
            Accept: 'text/xml',
            SOAPAction: soapAction,
            'Content-Length': contentLength.toString(),
            Connection: 'close',
        };
        if (this.sessionCookie) {
            headers.Cookie = `vmware_soap_session=${this.sessionCookie}`;
        }
        if (this.options.debugHttp) {
            // eslint-disable-next-line no-console
            console.debug('[vcenter-soap:http:req]', {
                startLine: `POST ${path} HTTP/1.1`,
                headers,
                bodyPreview: soapBody.slice(0, 120),
            });
        }
        return new Promise((resolve, reject) => {
            const req = https.request({
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || 443,
                method: 'POST',
                path,
                headers,
                agent: this.httpsAgent,
                rejectUnauthorized: !this.options.allowInsecure,
                timeout: this.options.timeout ?? 15000,
            }, (res) => {
                let data = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (this.options.debugHttp) {
                        // eslint-disable-next-line no-console
                        console.debug('[vcenter-soap:http:res]', {
                            status: res.statusCode,
                            bodyPreview: data.slice(0, 200),
                        });
                    }
                    resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, bodyText: data });
                });
            });
            req.on('error', (error) => reject(error));
            req.on('timeout', () => {
                req.destroy(new Error('SOAP request timed out'));
            });
            req.write(soapBody, 'utf8');
            req.end();
        });
    }
    async send(body, soapAction = 'urn:vim25/7.0') {
        const soapBody = this.normalizeSoapBody(body);
        const response = await this.sendRawHttp11(soapBody, soapAction);
        if (response.statusCode === 404) {
            throw new Error('SOAP endpoint not reachable (404). Your Envoy/LB is not routing /sdk/vimService. Fix routing or use direct vCenter URL.');
        }
        const setCookieHeader = response.headers['set-cookie'];
        const setCookies = Array.isArray(setCookieHeader)
            ? setCookieHeader
            : typeof setCookieHeader === 'string'
                ? [setCookieHeader]
                : [];
        if (setCookies.length) {
            const session = setCookies.find((cookie) => cookie.startsWith('vmware_soap_session'));
            if (session) {
                const match = session.match(/vmware_soap_session=([^;]+)/);
                if (match?.[1]) {
                    this.sessionCookie = match[1];
                }
            }
        }
        if (response.statusCode !== 200) {
            const bodySnippet = response.bodyText;
            const snippet = (response.statusCode === 500 ? this.extractFaultString(bodySnippet) ?? bodySnippet : bodySnippet).slice(0, 500);
            throw new Error(`SOAP request failed (status ${response.statusCode}) for ${this.endpoint} [SOAPAction: ${soapAction}]: ${snippet}`);
        }
        const parsed = this.parseResponse(response.bodyText ?? '');
        const bodyNode = parsed.envelope?.Body ?? parsed.envelope?.body;
        if (!bodyNode)
            throw new Error(`Invalid SOAP response. Response snippet: ${(response.bodyText ?? '').slice(0, 500)}`);
        return bodyNode;
    }
    async retrieveServiceContent() {
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
        if (!result)
            throw new Error('Missing RetrieveServiceContent response');
        return {
            rootFolder: result.rootFolder?.val ?? result.rootFolder,
            propertyCollector: result.propertyCollector?.val ?? result.propertyCollector,
            sessionManager: result.sessionManager?.val ?? result.sessionManager,
            about: result.about ?? {},
        };
    }
    async login() {
        const body = {
            'urn:Login': {
                'urn:_this': { '@_type': 'SessionManager', '#text': 'SessionManager' },
                'urn:userName': this.options.username,
                'urn:password': this.options.password,
            },
        };
        const response = await this.send(body, 'urn:vim25/7.0');
        const cookie = this.sessionCookie ?? '';
        if (!cookie)
            throw new Error('Login did not return a session cookie');
        return { sessionCookie: cookie };
    }
    normalizeValues(values) {
        if (values === undefined || values === null)
            return [];
        if (Array.isArray(values))
            return values.map((value) => value.val ?? value);
        return [values.val ?? values];
    }
    extractObjects(response) {
        const objects = response.RetrievePropertiesExResponse?.returnval?.objects ?? response.retrievePropertiesExResponse?.returnval?.objects;
        if (!objects)
            return [];
        return Array.isArray(objects) ? objects : [objects];
    }
    async retrieveProperties(objectType, properties, objectRefs) {
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
    async getRootChildren(rootFolder) {
        const objects = await this.retrieveProperties('Folder', ['childEntity'], [rootFolder]);
        const childProps = objects[0]?.propSet ?? [];
        const propArray = Array.isArray(childProps) ? childProps : [childProps];
        const values = propArray.find((p) => p.name === 'childEntity')?.val ?? [];
        return this.normalizeValues(values);
    }
    async getDatacentersInfo(datacenterIds) {
        const objects = await this.retrieveProperties('Datacenter', ['name', 'vmFolder'], datacenterIds);
        return objects.map((obj) => {
            const props = Array.isArray(obj.propSet) ? obj.propSet : [obj.propSet];
            const name = props.find((p) => p.name === 'name')?.val ?? '';
            const vmFolder = (props.find((p) => p.name === 'vmFolder')?.val?.val ?? props.find((p) => p.name === 'vmFolder')?.val) ?? '';
            return { moRef: obj.obj?.val ?? obj.obj, name, vmFolder };
        });
    }
    async getFolderChildren(folderIds) {
        const objects = await this.retrieveProperties('Folder', ['childEntity'], folderIds);
        const folderMap = {};
        for (const obj of objects) {
            const props = Array.isArray(obj.propSet) ? obj.propSet : [obj.propSet];
            const children = this.normalizeValues(props.find((p) => p.name === 'childEntity')?.val ?? []);
            folderMap[obj.obj?.val ?? obj.obj] = children;
        }
        return folderMap;
    }
    async getVmNames(vmIds) {
        const objects = await this.retrieveProperties('VirtualMachine', ['name'], vmIds);
        const nameMap = {};
        for (const obj of objects) {
            const props = Array.isArray(obj.propSet) ? obj.propSet : [obj.propSet];
            const name = props.find((p) => p.name === 'name')?.val ?? '';
            nameMap[obj.obj?.val ?? obj.obj] = name;
        }
        return nameMap;
    }
    async getVmDetails(vmIds) {
        const objects = await this.retrieveProperties('VirtualMachine', ['name', 'runtime.powerState', 'summary.config.uuid', 'summary.config.vmPathName'], vmIds);
        const detailMap = {};
        for (const obj of objects) {
            const props = Array.isArray(obj.propSet) ? obj.propSet : [obj.propSet];
            const ref = obj.obj?.val ?? obj.obj;
            detailMap[ref] = {
                name: props.find((p) => p.name === 'name')?.val ?? '',
                powerState: props.find((p) => p.name === 'runtime.powerState')?.val ?? undefined,
                uuid: props.find((p) => p.name === 'summary.config.uuid')?.val ?? undefined,
                vmPathName: props.find((p) => p.name === 'summary.config.vmPathName')?.val ?? undefined,
            };
        }
        return detailMap;
    }
    async testConnection() {
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
        }
        catch (error) {
            throw error;
        }
    }
    async findVmsByName(options) {
        const debugLog = {};
        const content = await this.retrieveServiceContent();
        debugLog.rootFolder = content.rootFolder;
        const childEntities = await this.getRootChildren(content.rootFolder);
        const datacenters = childEntities.filter((id) => id.startsWith('datacenter-'));
        debugLog.datacenters = datacenters;
        const dcInfo = await this.getDatacentersInfo(datacenters);
        const maxResults = options.maxResults ?? 100;
        const visitedFolders = new Set();
        const visitedVMs = new Set();
        const matched = [];
        const queue = [];
        for (const dc of dcInfo) {
            queue.push({ folder: dc.vmFolder, dcName: dc.name, dcRef: dc.moRef });
        }
        while (queue.length && matched.length < maxResults) {
            const current = queue.shift();
            if (visitedFolders.has(current.folder))
                continue;
            visitedFolders.add(current.folder);
            const children = (await this.getFolderChildren([current.folder]))[current.folder] ?? [];
            const folders = children.filter((id) => id.startsWith('group-'));
            const vms = children.filter((id) => id.startsWith('vm-'));
            for (const folder of folders) {
                queue.push({ folder, dcName: current.dcName, dcRef: current.dcRef });
            }
            for (const vm of vms) {
                if (visitedVMs.has(vm))
                    continue;
                visitedVMs.add(vm);
            }
        }
        const vmList = Array.from(visitedVMs);
        debugLog.foldersVisited = visitedFolders.size;
        debugLog.vmsDiscovered = vmList.length;
        const nameMap = await this.getVmNames(vmList);
        const filter = (name) => name.toLowerCase().includes(options.nameQuery.toLowerCase());
        const filteredIds = vmList.filter((id) => filter(nameMap[id] ?? ''));
        let detailsMap = {};
        if (options.includePowerState || options.includeUuid) {
            detailsMap = await this.getVmDetails(filteredIds);
        }
        for (const dc of dcInfo) {
            for (const vm of filteredIds) {
                if (matched.length >= maxResults)
                    break;
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
exports.VCenterSoapClient = VCenterSoapClient;
//# sourceMappingURL=soapClient.js.map