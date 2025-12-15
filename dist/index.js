"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.credentials = exports.nodes = void 0;
const VCenterSoap_node_1 = require("./nodes/VCenterSoap/VCenterSoap.node");
const VCenterSoapApi_credentials_1 = require("./credentials/VCenterSoapApi.credentials");
exports.nodes = [VCenterSoap_node_1.VCenterSoap];
exports.credentials = [VCenterSoapApi_credentials_1.VCenterSoapApi];
//# sourceMappingURL=index.js.map