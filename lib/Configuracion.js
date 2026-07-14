import { ZModule } from "./ZServer.js";

class Configuracion extends ZModule {
    static get instance() {
        if (Configuracion._singleton) return Configuracion._singleton;
        Configuracion._singleton = new Configuracion();
        return Configuracion._singleton;
    }

    getOASTags() { return ["Configuracion publica del portal"]; }

    init() {
        this.registerEndPoint("GET", "configuracion/mapbox-token", this.getMapboxToken, {
            summary: "Obtiene el token publico de Mapbox",
            responses: {
                "200": {
                    description: "Token publico utilizado por los mapas del portal",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["token"],
                                properties: { token: { type: "string" } }
                            }
                        }
                    }
                }
            }
        });
    }

    getMapboxToken() {
        return { token: process.env.MAPBOX_TOKEN || "" };
    }
}

export default Configuracion.instance;
