import fetch from 'node-fetch';

const STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
const ARGUMENT_NAMES = /([^\s,]+)/g;

import cookie from 'cookie';

class ZServer {    
    static get version() {return 0.1}

    /**
     * 
     * @param {ExpressApp} app
     * @param {string} pathPrefix Requests staring with this prefix will be handled by this Server
     */
    constructor(app, pathPrefix="/") {
        this.app = app;
        this.prefix = pathPrefix.startsWith("/")?pathPrefix:("/" + pathPrefix);
        this.modules = {};
        this.internalErrorMessage = 'ERR_ERROR_INTERNO'
        this._oasPaths = [];
        this._oasSchemas = {};
        this._loggingCode = null;
        this._logger = null;
    }

    /**
     * 
     * @param {ZModule} module Object extending ZModule who publish and resolve endPoints
     */
    registerModule(module) {
        this.modules[module.moduleName] = {module, methodArguments:{}};
        module.zServer = this;
        module.init();
    }

    _registerEndPoint(module, httpMethod, path, endPointResolver, oasOperation, authorization) {
        if (!endPointResolver instanceof Function) throw "endPointResolver should be a Function (reveived " + typeof endPointResolver + ")";
        path = path.startsWith("/")?path:("/" + path);        

        // Register for OpenAPI doc generation
        let fullPath = this.prefix + path;

        let swaggerFormatPath = fullPath.split("/").map(p => {
            if (p.startsWith(":")) return "{" + p.substring(1, p.length) + "}";
            else return p;
        }).join("/");

        let p = this._oasPaths.find(p => p.path == fullPath);
        if (!p) p = {path: fullPath, swaggerPath: swaggerFormatPath, operations:{}}
        this._oasPaths.push(p);
        
        let moduleSpec = this.modules[module.moduleName];
        let methodArgs = this._getArgumentNames(endPointResolver);
        moduleSpec.methodArguments[endPointResolver.name] = methodArgs;
        let parameters = [];
        let pathFields = path.split("/"), bodyArg, requestBody;
        for (let arg of methodArgs) {
            let argSpec = {name:arg}, _in, _type;
            if (arg.startsWith("_")) {
                _in = "special";
                _type = "special";
            } else {
                let idx = pathFields.findIndex(f => (":" + arg) == f);
                if (idx >= 0) {
                    _in = "path";
                    _type = "string";

                } else if (httpMethod.toLowerCase() == "get" || httpMethod.toLowerCase() == "delete") {
                    _in = "query";   
                    _type = "string";             
                }
            }
            if (!_in && ";POST;PUT;".indexOf(httpMethod.toUpperCase()) >= 0) {
                if (bodyArg) throw (endPointResolver?endPointResolver.name:"") + ": Two possible candidates for body in method signature (" + bodyArg + " and " + arg + ")";
                bodyArg = arg;
                requestBody = {
                    required:true,
                    content: {"application/json":{schema:{type:"Object"}}}
                }
            }
            if (_in) {
                argSpec.in = _in;
                if (_type) argSpec.type = _type;
                if (argSpec.type != "special") parameters.push(argSpec);
            }
        }

        let opSpec = {
            responses:{
                "200":{content:{"application/json":{}}},
                "400":{description: "Invalid arguments. See error response for details"},
                "500":{description: this.internalErrorMessage}
            }
        }        
        if (oasOperation && oasOperation.parameters) {
            for (let p of oasOperation.parameters) {
                let idx = parameters.findIndex(x => x.name == p.name);
                if (idx >= 0) parameters[idx] = p;
            }
            delete oasOperation.parameters;
        }
        if (parameters.length) opSpec.parameters = parameters;
        if (requestBody) opSpec.requestBody = requestBody;
        if (module.getOASTags()) opSpec.tags = module.getOASTags();
        // Overrite with oasOperation spec
        if (oasOperation) this._copyRecusrive(opSpec, oasOperation);

        p.operations[httpMethod.toLowerCase()] = opSpec;

        // Express route
        this.app[httpMethod.toLowerCase()](this.prefix + path, (req, res) => {
            this._resolveRequest(module, endPointResolver, httpMethod, req, res, bodyArg, authorization, path)
                .then(ret => this._returnOK(res, ret))
                .catch(async error => {
                    // Log error
                    try {                        
                        if (this._logger) {
                            let severity, errorText;
                            let details = error.stack;
                            let {originType, origin} = await this._logger.getAuthInfo(req);
                            if (typeof error == "string") {
                                severity = 2; errorText = "[400] Error de Negocio: " + error;
                            } else { 
                                if (error.message && error.status) {
                                    severity = 2; errorText = "[" + error.status + "] Error de Negocio: " + error.message;
                                } else {
                                    severity = 3; errorText = "[500] Error no Capturado: " + error.toString();                                    
                                }
                            }
                            await this.log(severity, "evento", errorText, details, null, null, originType, origin);
                        }
                    } catch (error2) {
                        console.error("ZServer: Error loggin error", error2)
                    }
                    this._returnError(res, error)
                });
        });
    }

    _copyRecusrive(targetObject, sourceObject) {
        let keys = Object.keys(sourceObject);
        for (let key of keys) {
            let source = sourceObject[key];
            if (source instanceof Object) {
                let current = targetObject[key];
                if (!current) {
                    targetObject[key] = source;
                } else {
                    this._copyRecusrive(current, source);
                }
            } else {
                targetObject[key] = source;
            }
        }
    }
    
    _returnError(res, error) {
        if (typeof error == "string") {
            res.status(400).json({error});
        } else { 
            if (error.message && error.status) {
                res.status(error.status).json({error:error.message});
            } else {
                console.error(this.internalErrorMessage, error);        
                console.trace(error);
                res.status(500).json({error:this.internalErrorMessage});
            }
        }
    }
    _returnOK(res, ret) {
        res.json(ret?ret:null);
    }
    _getArgumentNames(method) {
        var fnStr = method.toString().replace(STRIP_COMMENTS, '');
        var result = fnStr.slice(fnStr.indexOf('(')+1, fnStr.indexOf(')')).match(ARGUMENT_NAMES);
        if(result === null) result = [];
        return result;
    }
    async _resolveRequest(module, endPointResolver, httpMethod, req, res, bodyArg, authorization, sourceURL) {
        let _bearerToken = req.get("Authorization");
        if (!_bearerToken) {
            let cookies = cookie.parse(req.headers.cookie || '');
            _bearerToken = cookies.bearerToken;
        }
        if (!_bearerToken && req.cookies) _bearerToken = req.cookies.bearerToken;
        if (_bearerToken && _bearerToken.startsWith("Bearer ")) _bearerToken = _bearerToken.substring(7);
        let _apiKey = req.get("X-API-Key");

        let specialArgs= {
            _request:req, _response:res, _bearerToken, _apiKey
        }

        let moduleSpec = this.modules[module.moduleName];
        let methodArgs = moduleSpec.methodArguments[endPointResolver.name];
        let invokeArgs = methodArgs.map(arg => {
            let v = req.params?req.params[arg]:null;
            v = v || (req.query?req.query[arg]:null);
            v = v || (arg == bodyArg?req.body:null);
            if (v === null && arg.startsWith("_")) {
                v = specialArgs[arg];
            }
            return v;            
        });
        // Authorizer
        if (this.authorizerClass) {
            let authorizer = new this.authorizerClass(endPointResolver, httpMethod, methodArgs, invokeArgs, specialArgs, sourceURL);
            try {
                await authorizer.globalAuthorize();
                if (authorization) {
                    await authorizer.authorize(authorization);
                }
            } catch (error) {
                let msg = error.message?error.message:authorizer.get403Message();
                throw {status:403, message:msg};
            }
        }
        // Invoke
        let resultOrPromise = endPointResolver.apply(module, invokeArgs);
        if (!resultOrPromise) {
            return null;
        } else if (resultOrPromise instanceof Promise) {
            return await resultOrPromise;
        } else {
            return resultOrPromise;
        }
    }

    setAuthorizerClass(authorizerClass) {
        this.authorizerClass = authorizerClass;
    }

    /**
     * 
     * @param {object} info                     Info Object at root of OpenAPI specification (required)
     * @param {string} info.title               API Title (required)
     * @param {string} info.summary  
     * @param {string} info.description
     * @param {string} info.termsOfService
     */
    oasSetInfo(info) {        
        this._oasInfo = info;
    }
    oasGetInfo() {return this._oasInfo}

    _oasDeclareSchema(schemaName, schema) {
        this._oasSchemas[schemaName] = schema;
    }
    
    getOpenAPIDoc() {        
        let doc = {
            openapi: "3.0.0",
            info: this._oasInfo,
            //servers:[{url:"", description:"This Server"}],
            paths:this._oasPaths.reduce((pathsObject, p) => {
                pathsObject[p.swaggerPath] = p.operations;
                return pathsObject;
            }, {}),
            components:{
                schemas:this._oasSchemas
            }
        }        
        return doc;
    }

    async startSwaggerServer(path) {
        try {
            const swaggerUI = await import("swagger-ui-express");
            this.app.use(path, swaggerUI.serve, swaggerUI.setup(this.getOpenAPIDoc()));
        } catch(error) {
            console.error("Error starting swagger-ui server");
            console.error(error);
        }
    }

    async _registerProxyEndPoint(httpMethod, sourceURL, targetHost, authorization) {
        if (!sourceURL.startsWith("/")) sourceURL = "/" + sourceURL;
        this.app[httpMethod.toLowerCase()](this.prefix + sourceURL, async (req, res) => {
            if (authorization) {
                let _bearerToken = req.get("Authorization");
                if (!_bearerToken) {
                    let cookies = cookie.parse(req.headers.cookie || '');
                    _bearerToken = cookies.bearerToken;
                }
                if (!_bearerToken && req.cookies) _bearerToken = req.cookies.bearerToken;
                if (_bearerToken && _bearerToken.startsWith("Bearer ")) _bearerToken = _bearerToken.substring(7);
                let _apiKey = req.get("X-API-Key");
                let specialArgs= {_request:req, _response:res, _bearerToken, _apiKey}
                let authorizer = new this.authorizerClass(null, httpMethod, null, null, specialArgs, sourceURL);
                try {
                    await authorizer.globalAuthorize();
                    if (authorization) {
                        await authorizer.authorize(authorization);
                    }
                } catch (error) {
                    let msg = error.message?error.message:authorizer.get403Message();
                    let status = error.status?error.status:403;
                    this._returnError(res, {status, message:msg});
                    return;
                }
            }
            let targetURL = targetHost + req.url;
            let headers = req.headers;            
            let fetchResponse;
            headers["Cache-Control"] = "no-cache";
            try {
                if (httpMethod.toLowerCase() == "get" || httpMethod.toLowerCase() == "delete") {
                    fetchResponse = await fetch(targetURL, {headers, method:httpMethod})
                } else if (httpMethod.toLowerCase() == "post" || httpMethod.toLowerCase() == "put") {
                    let body = JSON.stringify(req.body || {});
                    fetchResponse = await fetch(targetURL, {headers, method:httpMethod, body})
                } else {
                    throw "ERR_METODO_PROXY_NO_SOPORTADO";
                }
            } catch(error) {
                this._returnError(res, {status:500, message:typeof error == "string" ? error : (error?.message || "ERR_ERROR_INTERNO")})
                return;
            }
            if (fetchResponse.status == 200) {
                try {
                    for (let h of fetchResponse.headers.keys()) {
                        res.set(h, fetchResponse.headers.get(h));
                    }
                    this._returnOK(res, await fetchResponse.json());
                } catch(error) {
                    console.error("Error converting response to json");
                    console.error(error);
                    this._returnError(res, {status:500, message:"ERR_ERROR_INTERNO"});
                }
            } else {
                let text = await fetchResponse.text();
                if (text.startsWith("{")) {
                    let json = JSON.parse(text);
                    if (json.message) text = json.message;
                    if (json.error) text = json.error;
                }
                this._returnError(res, {status:fetchResponse.status, message:text});
            }
        });
    }

    // Logging
    loggingSetServiceCode(serviceCode) {
        this._loggingCode = serviceCode;
    }

    setLogger(logger) {this._logger = logger}

    async log(severity, type, title, details, entityCode, entityPK, originType, origin) {
        if (!this._logger) return;
        if (!this._loggingCode) throw "No looging service code assigned. Please call ZServer.loggingSetServiceCode(code)";        
        // Don't stop operation if logging error
        try {
            await this._logger.log(severity, type, this._loggingCode, title, details, entityCode, entityPK, originType, origin);
        } catch (error) {
            console.error("Error creating log");
            console.error(error);
        }
    }
}

/**
 * @abstract
 */
class ZModule {
    get moduleName() {return this.constructor.name}    
    get zServer() {return this._zServer}
    set zServer(z) {this._zServer = z}

    /**
     * @abstract Called by ZServer on initialization. Call here "registerEnpoint" for each HTTP endpoint you wich to expose
     */
    init() {}

    /**
     * @abstract Return Open API Specification Tags to group all Operations provided by this module
     * @returns {Array<string<} List of tags
     */
    getOASTags() {}

    /**
     * Declares a new routing from a path to a method of this object
     * 
     * @param {"GET"|"POST"|"DELETE"|"PUT"} httpMethod HTTP Method to Listen for Requests
     * @param {string} path Path after zServer prefix
     * @param {Function} endPointResolver ZModule method to route request
     * @param {Object} Open API Specification declaration under path element
     * @param {Function} (auth => (boolean)) Authorizator function
     * 
     */
    registerEndPoint(httpMethod, path, endPointResolver, oasOperation, authorization) {
        this.zServer._registerEndPoint(this, httpMethod, path, endPointResolver, oasOperation, authorization);
    }

    /**
     * Declares a new routing from a path to an endpoint with exactly same method and contract
     * 
     * @param {"GET"|"POST"|"DELETE"|"PUT"} httpMethod HTTP Method to Listen for Requests
     * @param {string} targetURL
     * 
     */
    registerProxyEndPoint(httpMethod, sourceURL, targetHost, authorization) {
        this.zServer._registerProxyEndPoint(httpMethod, sourceURL, targetHost, authorization);
    }

    /**
     * 
     * @param {string} schemaName Name of new OAS Schema
     * @param {Object} schema Open API Specification schema specification object 
     */
    oasDeclareSchema(schemaName, schema) {
        this.zServer._oasDeclareSchema(schemaName, schema);
    }

    async logDebug(originType, origin, title, details) {
        if (!this.zServer) return;
        await this.zServer.log(0, "evento", title, details, null, null, originType, origin)
    }
    async logInfo(originType, origin, title, details) {
        if (!this.zServer) return;
        await this.zServer.log(1, "evento", title, details, null, null, originType, origin)
    }
    async logWarning(originType, origin, title, details) {
        if (!this.zServer) return;
        await this.zServer.log(2, "evento", title, details, null, null, originType, origin)
    }
    async logError(originType, origin, title, details) {
        if (!this.zServer) return;
        await this.zServer.log(3, "evento", title, details, null, null, originType, origin)
    }
    async logAccess(originType, origin, severity, title, details) {
        if (!this.zServer) return;
        await this.zServer.log(severity, "acceso", title, details, null, null, originType, origin)
    }
    async logEntity(originType, origin, severity, title, entityCode, entityPK, details) {
        if (!this.zServer) return;
        await this.zServer.log(severity, "entidad", title, details, entityCode, entityPK, originType, origin)
    }
}

/**
 * @abstract
 */
class Authorizer {
    constructor(method, httpMethod, argNames, argValues, specialArgs, sourceURL) {        
        this.method = method;
        this.httpMethod = httpMethod;
        this.argNames = argNames || [];
        this.argValues = argValues || [];
        this.specialArgs = specialArgs;
        this.sourceURL = sourceURL;
    }

    get403Message() {return "ERR_NO_AUTORIZADO"}

    async globalAuthorize() {} 
    async authorize(authorization) {
        try {
            let ret = await authorization(this);
            if (!ret) throw this.get403Message();
        } catch(error) {
            console.error("Error in authorization", error);
            throw this.get403Message();
        }
    }

    get(argName) {
        if (argName.startsWith("_")) {
            return this.specialArgs[argName];
        } else {
            let idx = this.argNames.indexOf(argName);
            if (idx >= 0) {
                return this.argValues[idx];
            }else {
                return undefined;
            }
        }
    }
    set(argName, argValue) {
        if (argName.startsWith("_")) {
            this.specialArgs[argName] = argValue;            
        } 
        let idx = this.argNames.indexOf(argName);
        if (idx >= 0) {
            this.argValues[idx] = argValue;
        }        
    }
    reject(message) {
        throw message;
    }    
}

class Logger {
    constructor(zServer) {
        this.zServer = zServer;
    }

    async log(severity, type, serviceCode, title, details, entityCode, entityPK, originType, origin) {        
    }
    async getAuthInfo(request) {return {originType:null, origin:null}}
}

class ConsoleLogger extends Logger {
    async log(severity, type, serviceCode, title, details, entityCode, entityPK, originType, origin) {
    }
}

export {ZServer, ZModule, Authorizer, Logger, ConsoleLogger};
