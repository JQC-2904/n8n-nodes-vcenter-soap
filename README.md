vCenter SOAP Node for n8n (Node.js v24.x)
Implementation Guide for Codex
Goal: Build a custom n8n community node (npm package) that talks to VMware vCenter via the vSphere SOAP API (vim25), with a connection test and VM task operations. Includes a robust, recursive VM search by name across all datacenters and folders.

1. Scope and desired outcome
We want an npm package compatible with Node.js 24.x that can be installed/linked into n8n as a custom/community node. The node must authenticate against vCenter's SOAP endpoint /sdk (vim25), keep the session cookie, and execute SOAP calls reliably.
The node set should include:
    • A credential type for vCenter (server URL, username, password, optional TLS options).
    • A 'Test connection' operation that verifies SOAP connectivity and authentication and returns basic server identity (apiType, fullName, version).
    • A VM task node (or VM resource in the same node) with an initial operation: 'Find VMs by name' that searches recursively across all datacenters and VM folders/subfolders, returning VM info.
2. vCenter SOAP fundamentals (vim25)
vCenter SOAP uses POST requests to https://<vcenter>/sdk with Content-Type text/xml; charset=utf-8 and a SOAPAction header. Authentication is done via Login on the SessionManager, returning a session cookie named vmware_soap_session. All subsequent requests must send this cookie.
Important: inventory enumeration is reference-based. Most responses return Managed Object References (MORefs) inside <val> elements. You must treat those MORef IDs (examples: datacenter-3, group-v4, vm-6075) as the real identifiers and traverse the inventory graph.
3. Required SOAP calls (the minimum working set)
These calls were validated manually and must be implemented in the node in the same logical order.
3.1 RetrieveServiceContent
Purpose: discover rootFolder and validate that /sdk responds with SOAP.
SOAP method: RetrieveServiceContent
Key output fields: rootFolder, propertyCollector, sessionManager, about.apiType
Request envelope (example):
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrieveServiceContent>
      <urn:_this type="ServiceInstance">ServiceInstance</urn:_this>
    </urn:RetrieveServiceContent>
  </soapenv:Body>
</soapenv:Envelope>
Expected response characteristics:
    • • apiType should be VirtualCenter (not HostAgent).
    • • rootFolder is typically group-d1.
3.2 Login (SessionManager)
Purpose: authenticate and receive vmware_soap_session cookie.
Request envelope (example):
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:Login>
      <urn:_this type="SessionManager">SessionManager</urn:_this>
      <urn:userName>administrator@vsphere.local</urn:userName>
      <urn:password>YOUR_PASSWORD</urn:password>
    </urn:Login>
  </soapenv:Body>
</soapenv:Envelope>
Implementation notes:
    • • Capture Set-Cookie and persist vmware_soap_session for reuse.
    • • In n8n, use the credential data and store the session in-memory per execution (or per request) and re-login if needed.
3.3 Inventory enumeration primitives (PropertyCollector)
Purpose: enumerate datacenters, folders, and VMs using RetrievePropertiesEx. The standard pattern is: RetrievePropertiesEx(PropertyCollector, specSet{ propSet{type, pathSet}, objectSet{obj} }).
Example: get rootFolder childEntity (this returns references to datacenters / top-level folders):
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrievePropertiesEx>
      <urn:_this type="PropertyCollector">propertyCollector</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>Folder</urn:type>
          <urn:pathSet>childEntity</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="Folder">group-d1</urn:obj>
        </urn:objectSet>
      </urn:specSet>
      <urn:options/>
    </urn:RetrievePropertiesEx>
  </soapenv:Body>
</soapenv:Envelope>
Critical parsing rule:
The childEntity values appear inside <val ...>TEXT</val>. The TEXT is the MORef ID (e.g., datacenter-3). Sometimes the val has type="Folder" or type="Datacenter"; sometimes it shows type="ManagedObjectReference". Do not discard a value just because its type looks generic. Always keep the MORef ID and infer behavior from its shape (datacenter-*, group-v*, vm-*).
3.4 Datacenter to vmFolder
For each Datacenter MORef, retrieve the datacenter name and the vmFolder reference.
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrievePropertiesEx>
      <urn:_this type="PropertyCollector">propertyCollector</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>Datacenter</urn:type>
          <urn:pathSet>name</urn:pathSet>
          <urn:pathSet>vmFolder</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="Datacenter">datacenter-3</urn:obj>
        </urn:objectSet>
      </urn:specSet>
      <urn:options/>
    </urn:RetrievePropertiesEx>
  </soapenv:Body>
</soapenv:Envelope>
In the validated environment, this returned vmFolder = group-v4 and hostFolder = group-h5.
3.5 Recursive traversal: vmFolder -> subfolders -> VMs
This is the key behavior. The vmFolder (e.g., group-v4) may contain only subfolders (group-vXXXX) and no VMs directly. You must traverse folders recursively until VirtualMachine references (vm-XXXX) appear.
Folder children query (repeat for every Folder you visit):
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrievePropertiesEx>
      <urn:_this type="PropertyCollector">propertyCollector</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>Folder</urn:type>
          <urn:pathSet>childEntity</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="Folder">group-v4</urn:obj>
        </urn:objectSet>
      </urn:specSet>
      <urn:options/>
    </urn:RetrievePropertiesEx>
  </soapenv:Body>
</soapenv:Envelope>
Validated example outcome:
    • • group-v4 returned only group-vXXXX folders.
    • • group-v6032 returned VirtualMachine references: vm-11120, vm-6075, vm-6074, ...
3.6 Get VM properties (name and basic info)
After collecting VM MORefs, query properties such as name, runtime.powerState, summary.config, etc.
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25">
  <soapenv:Body>
    <urn:RetrievePropertiesEx>
      <urn:_this type="PropertyCollector">propertyCollector</urn:_this>
      <urn:specSet>
        <urn:propSet>
          <urn:type>VirtualMachine</urn:type>
          <urn:pathSet>name</urn:pathSet>
          <urn:pathSet>runtime.powerState</urn:pathSet>
          <urn:pathSet>summary.config.uuid</urn:pathSet>
          <urn:pathSet>summary.config.vmPathName</urn:pathSet>
        </urn:propSet>
        <urn:objectSet>
          <urn:obj type="VirtualMachine">vm-6075</urn:obj>
        </urn:objectSet>
      </urn:specSet>
      <urn:options/>
    </urn:RetrievePropertiesEx>
  </soapenv:Body>
</soapenv:Envelope>
Implementation note: batch this in chunks (e.g., 50-200 VMs per call) for speed and to avoid very large SOAP bodies.
4. Operation design in n8n
We recommend a single node package with one resource group (VM) and at least two operations.
4.1 Credentials: VCenter SOAP
Credential fields:
    • • Server URL (e.g., https://vcsa.example.com)
    • • Username
    • • Password (masked)
Optional but recommended:
    • • Allow insecure TLS (skip certificate verification) for labs
    • • Request timeout (ms)
4.2 Node: Connection Test
Add a node operation 'Test connection' that performs:
    1. 1) RetrieveServiceContent
    2. 2) Login
    3. 3) RetrieveServiceContent again (or a lightweight call) and return about.apiType and about.fullName
Return a JSON object with fields such as: apiType, fullName, version, build, rootFolder, and a boolean authenticated=true.
4.3 Node: VM Tasks
Create a VM resource with at least one operation initially: Find VMs by name.
4.3.1 Operation: Find VMs by name
Inputs:
    • • Name query (string). Support exact match and optionally 'contains' or regex-like patterns.
    • • Max results (integer).
    • • Include powered state and UUID (boolean).
Behavior (required):
The search must be recursive across all datacenters and all VM folders/subfolders. The code must not assume a flat inventory. It must traverse folder trees starting from each datacenter's vmFolder.
Recommended algorithm (BFS/DFS):
    • • Discover datacenters from rootFolder.childEntity.
    • • For each datacenter: read vmFolder.
    • • Traverse folders starting at vmFolder: for each Folder, read childEntity and enqueue subfolders; collect vm-* MORefs.
    • • Once VM MORefs are collected, fetch VM properties and filter by name.
    • • Stop when max results reached.
    • • Deduplicate with sets: visitedFolders and visitedVMs.
Name matching guidance:
    • • Prefer server-side property retrieval + client-side filtering (get VM names then filter).
    • • For performance, fetch only 'name' first, filter, then fetch full properties only for matched VMs.
5. HTTP and TLS behavior (practical notes)
SOAP POST requirements:
    • • POST to https://<host>/sdk
    • • Header: Content-Type = text/xml; charset=utf-8
    • • Header: SOAPAction = "urn:vim25/<version>" (vCenter will apply a compatible version)
    • • Cookie: vmware_soap_session=...
TLS notes:
Many lab vCenters use private CA certificates. Provide an option to skip verification (like curl -k). During manual testing, a global curl configuration forced verification until curl was run with -q -k. In the node, expose a credential flag and configure the HTTP client accordingly.
6. Output schema for Find VMs by name
Return an array of items, each item including at minimum:
    • • moRef (vm-XXXX)
    • • name
    • • datacenter (name and/or moRef)
    • • powerState (optional)
    • • uuid and vmPathName (optional)
7. Debugging requirements (must-have logs)
To prevent '0 objects' mysteries, always log or return debug fields when a debug option is enabled:
    • • rootFolder moRef
    • • datacenters discovered count and sample MORefs
    • • per datacenter: vmFolder moRef
    • • folders visited count
    • • VMs discovered count
    • • first few VM MORefs and names
If VMs discovered is zero but folders visited is >0, traversal is likely stopping early or filtering incorrectly.
