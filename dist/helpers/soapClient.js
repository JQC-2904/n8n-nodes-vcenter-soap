"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VCenterSoapClient = void 0;
const https_1 = __importDefault(require("https"));
const url_1 = require("url");
const xml2js_1 = require("xml2js");
class VCenterSoapClient {
    constructor(config) {
        this.endpoint = VCenterSoapClient.normalizeEndpoint(config.serverUrl);
        this.config = config;
    }
    static normalizeEndpoint(serverUrl) {
        const url = new url_1.URL(serverUrl);
        if (url.protocol !== 'https:') {
            throw new Error('Server URL must use https');
        }
        url.pathname = '/sdk/vimService';
        url.search = '';
        url.hash = '';
        return url;
    }
    async testConnection() {
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
    async retrieveServiceContent() {
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
        };
    }
    async login(sessionManager) {
        const escapedUsername = this.escapeXml(this.config.username);
        const escapedPassword = this.escapeXml(this.config.password);
        const body = this.buildEnvelope(`    <Login xmlns="urn:vim25">\n      <_this type="SessionManager">${sessionManager}</_this>\n      <userName>${escapedUsername}</userName>\n      <password>${escapedPassword}</password>\n    </Login>`);
        const responseXml = await this.sendSoapRequest(body);
        await this.parseSoapBody(responseXml);
        if (!this.sessionCookie) {
            throw new Error('Authentication failed: session cookie not received');
        }
    }
    buildEnvelope(innerXml) {
        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">',
            '  <soapenv:Body>',
            innerXml,
            '  </soapenv:Body>',
            '</soapenv:Envelope>',
        ].join('\n');
    }
    escapeXml(value) {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
    logDebug(message, details) {
        if (!this.config.debug) {
            return;
        }
        const logger = this.config.logger ?? console.log;
        logger(`${message}: ${JSON.stringify(details)}`);
    }
    async sendSoapRequest(body) {
        const bodyBuffer = Buffer.from(body, 'utf8');
        const headers = {
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
        const options = {
            protocol: this.endpoint.protocol,
            hostname: this.endpoint.hostname,
            port,
            path: this.endpoint.pathname,
            method: 'POST',
            headers,
            rejectUnauthorized: !this.config.allowInsecure,
            servername: this.endpoint.hostname,
        };
        return new Promise((resolve, reject) => {
            const req = https_1.default.request(options, (res) => {
                const chunks = [];
                const setCookieHeader = res.headers['set-cookie'];
                if (Array.isArray(setCookieHeader)) {
                    const cookie = this.extractSessionCookie(setCookieHeader);
                    if (cookie) {
                        this.sessionCookie = cookie;
                    }
                }
                res.on('data', (chunk) => {
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
            req.on('error', (error) => {
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
    extractSessionCookie(cookies) {
        for (const cookie of cookies) {
            const match = cookie.match(/vmware_soap_session=([^;]+)/i);
            if (match) {
                return `vmware_soap_session=${match[1]}`;
            }
        }
        return undefined;
    }
    async parseSoapBody(xml) {
        let parsed;
        try {
            parsed = await (0, xml2js_1.parseStringPromise)(xml, {
                explicitArray: false,
                tagNameProcessors: [xml2js_1.processors.stripPrefix],
                attrNameProcessors: [xml2js_1.processors.stripPrefix],
                mergeAttrs: true,
            });
        }
        catch (error) {
            throw new Error(`Failed to parse SOAP response: ${error.message}`);
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
}
exports.VCenterSoapClient = VCenterSoapClient;
