import fetch from "node-fetch";


class ZClient {
    constructor(prefix, apiKey) {
        this.apiKey = apiKey;
        this.pathPrefix = prefix;
    }


    async _parseResponse(ret) {
        if (ret.status == 200) return await ret.json();
        let text = await ret.text();
        if (text && text.startsWith("{")) {
            let json = null;
            try {
                json = JSON.parse(text);
            } catch (error) {                
            }
            if (json && json.error) {
                throw {status: ret.status, message: json.error, detalle: json}
            }
        }
        throw "[" + ret.status + "] " + text;
    }

    async get(path, args) {
        let query = Object.keys(args || {}).reduce((st, a) => {
            let v = args[a];
            if (v !== null) {
                if (st) st += "&";
                if (typeof v == "object" || Array.isArray(v)) v = JSON.stringify(v);
                return st + a + "=" + encodeURIComponent(v);
            } else {
                return st;
            }
        }, "");
        let headers = {"Content-Type": "application/json"};
        if (this.apiKey) headers["X-API-Key"] = this.apiKey;

        let fullPath = this.pathPrefix + path + (query?"?" + query:"");
        let ret = await fetch(fullPath, {headers});
        
        return await this._parseResponse(ret);
    }

    async post(path, body) {
        let headers = {"Content-Type": "application/json"};
        if (this.apiKey) headers["X-API-Key"] = this.apiKey;

        let fullPath = this.pathPrefix + path;
        let ret = await fetch(fullPath, {headers, method:"POST", body:JSON.stringify(body || {})});
        
        return await this._parseResponse(ret);
    }

    async put(path, body) {
        let headers = {"Content-Type": "application/json"};
        if (this.apiKey) headers["X-API-Key"] = this.apiKey;

        let fullPath = this.pathPrefix + path;
        let ret = await fetch(fullPath, {headers, method:"PUT", body:JSON.stringify(body || {})});
        
        return await this._parseResponse(ret);
    }

    async delete(path, args) {
        let query = Object.keys(args || {}).reduce((st, a) => {
            let v = args[a];
            if (v !== null) {
                if (st) st += "&";
                if (typeof v == "object" || Array.isArray(v)) v = JSON.stringify(v);
                return st + a + "=" + encodeURIComponent(v);
            } else {
                return st;
            }
        }, "");
        let headers = {"Content-Type": "application/json"};
        if (this.apiKey) headers["X-API-Key"] = this.apiKey;

        let fullPath = this.pathPrefix + path + (query?"?" + query:"");
        let ret = await fetch(fullPath, {headers, method:"DELETE"});
        
        return await this._parseResponse(ret);
    }
}

export default ZClient;
