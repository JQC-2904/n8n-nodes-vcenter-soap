"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VCenterSoapClient = void 0;
const axios_1 = __importDefault(require("axios"));
const https_1 = __importDefault(require("https"));
const fast_xml_parser_1 = require("fast-xml-parser");
const SOAP_ENV_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const VIM_NS = 'urn:vim25';
class VCenterSoapClient {
    constructor(options) {
        this.sessionCookie = null;
        this.parser = new fast_xml_parser_1.XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true });
        this.builder = new fast_xml_parser_1.XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '', suppressBooleanAttributes: false });
        this.options = options;
        // TLS handling is explicit and scoped: use a custom https.Agent for SOAP requests only.
        // - If allowInsecure is true, certificate verification is skipped for lab environments.
        // - If a custom CA is provided, it is injected while keeping verification enabled.
        // - Otherwise, Node.js default verification is used.
        const httpsAgent = this.createHttpsAgent();
        const axiosConfig = {
            baseURL: `${options.baseUrl.replace(/\/$/, '')}/sdk`,
            timeout: options.timeout ?? 15000,
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
            },
        };
        if (httpsAgent) {
            axiosConfig.httpsAgent = httpsAgent;
        }
        this.http = axios_1.default.create(axiosConfig);
    }
    createHttpsAgent() {
        if (this.options.allowInsecure) {
            return new https_1.default.Agent({ rejectUnauthorized: false });
        }
        if (this.options.caCertificate) {
            return new https_1.default.Agent({
                ca: this.options.caCertificate,
                rejectUnauthorized: true,
            });
        }
        return undefined;
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
    parseResponse(xml) {
        const envelope = this.parser.parse(xml)['Envelope'] ?? this.parser.parse(xml)['soapenv:Envelope'];
        return { envelope };
    }
    async send(body, soapAction) {
        const envelope = this.buildEnvelope(body);
        const headers = {
            SOAPAction: `urn:vim25/${soapAction}`,
        };
        if (this.sessionCookie) {
            headers.Cookie = this.sessionCookie;
        }
        const response = await this.http.post('', envelope, { headers });
        const setCookie = response.headers['set-cookie'];
        if (setCookie) {
            const session = setCookie.find((cookie) => cookie.startsWith('vmware_soap_session'));
            if (session) {
                this.sessionCookie = session.split(';')[0];
            }
        }
        const parsed = this.parseResponse(response.data);
        const bodyNode = parsed.envelope?.Body ?? parsed.envelope?.body;
        if (!bodyNode)
            throw new Error('Invalid SOAP response');
        return bodyNode;
    }
    async retrieveServiceContent() {
        const body = {
            'urn:RetrieveServiceContent': {
                'urn:_this': {
                    '@_type': 'ServiceInstance',
                    '#text': 'ServiceInstance',
                },
            },
        };
        const response = await this.send(body, 'RetrieveServiceContent');
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
        const response = await this.send(body, 'Login');
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