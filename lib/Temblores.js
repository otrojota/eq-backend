import { ZModule } from "./ZServer.js";
import mongo from "./MongoDB.js";

class Temblores extends ZModule {
    static get instance() {
        if (Temblores._singleton) return Temblores._singleton;
        Temblores._singleton = new Temblores();
        return Temblores._singleton;
    }

    getOASTags() { return ["API para manejo de Temblores"]; }

    init() {
        this.oasDeclareSchema("Temblor", {
            type: "object",
            required: ["_id", "fuente", "fechaUTC", "tiempo", "latitud", "longitud"],
            properties: {
                _id: { type: "string", description: "Identificador del evento en USGS" },
                fuente: { type: "string", description: "Fuente de datos" },
                fechaUTC: { type: "string", format: "date-time", description: "Fecha y hora UTC del evento" },
                tiempo: { type: "number", description: "Timestamp Unix UTC en milisegundos" },
                latitud: { type: "number", description: "Latitud del epicentro" },
                longitud: { type: "number", description: "Longitud del epicentro" },
                profundidadKm: { type: "number", description: "Profundidad en kilometros" },
                magnitud: { type: "number", description: "Magnitud principal" },
                tipoMagnitud: { type: "string", description: "Tipo o unidad de magnitud principal" },
                procesado: { type: "boolean", description: "Indica si el evento ya fue procesado" },
                valido: { type: "boolean", description: "Indica si el evento fue marcado como valido" },
                energia: { type: "number", description: "Energia radiada aproximada en joules" },
                motivoInvalido: { type: "string", description: "Motivo por el que el evento fue descartado" },
                distanciaBordeKm: { type: "number", description: "Distancia al borde tectonico mas cercano en kilometros" },
                puntoBordeCercano: { type: "object", description: "Punto interpolado sobre el borde tectonico mas cercano" },
                bordeTectonico: { type: "object", description: "Metadatos del borde tectonico mas cercano" },
                coordenadasPlacas: {
                    type: "array",
                    description: "Coordenadas internas por placa asociada al borde tectonico mas cercano",
                    items: {
                        type: "object",
                        properties: {
                            codigoPlaca: { type: "string" },
                            indice_borde: { type: "number" },
                            km: { type: "number" }
                        }
                    }
                }
            }
        });

        this.registerEndPoint("GET", "temblores", this.getTemblores, {
            summary: "Lista temblores",
            parameters: [
                { name: "desde", in: "query", required: false, description: "Fecha UTC o timestamp minimo", schema: { type: "string" } },
                { name: "hasta", in: "query", required: false, description: "Fecha UTC o timestamp maximo", schema: { type: "string" } },
                { name: "minMagnitud", in: "query", required: false, description: "Magnitud minima", schema: { type: "number" } },
                { name: "maxMagnitud", in: "query", required: false, description: "Magnitud maxima", schema: { type: "number" } },
                { name: "limit", in: "query", required: false, description: "Cantidad maxima de registros", schema: { type: "integer" } }
            ],
            responses: {
                "200": {
                    description: "Lista de temblores",
                    content: {
                        "application/json": {
                            schema: {
                                type: "array",
                                items: { $ref: "#/components/schemas/Temblor" }
                            }
                        }
                    }
                }
            }
        });
        this.registerEndPoint("GET", "temblores/puntos", this.getPuntosTemblores, {
            summary: "Lista puntos livianos de temblores para mapa",
            parameters: [
                { name: "decada", in: "query", required: false, description: "Decada a consultar, por ejemplo 1990", schema: { type: "integer" } },
                { name: "desde", in: "query", required: false, description: "Fecha UTC o timestamp minimo", schema: { type: "string" } },
                { name: "hasta", in: "query", required: false, description: "Fecha UTC o timestamp maximo", schema: { type: "string" } },
                { name: "limit", in: "query", required: false, description: "Cantidad maxima de puntos", schema: { type: "integer" } }
            ],
            responses: {
                "200": {
                    description: "Puntos de temblores",
                    content: {
                        "application/json": {
                            schema: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        _id: { type: "string" },
                                        latitud: { type: "number" },
                                        longitud: { type: "number" },
                                        tiempo: { type: "number" },
                                        fechaUTC: { type: "string", format: "date-time" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
        this.registerEndPoint("GET", "temblores/puntos-normalizados", this.getPuntosTembloresNormalizados, {
            summary: "Lista puntos livianos de temblores validos normalizados al borde tectonico",
            parameters: [
                { name: "decada", in: "query", required: false, description: "Decada a consultar, por ejemplo 1990", schema: { type: "integer" } },
                { name: "desde", in: "query", required: false, description: "Fecha UTC o timestamp minimo", schema: { type: "string" } },
                { name: "hasta", in: "query", required: false, description: "Fecha UTC o timestamp maximo", schema: { type: "string" } },
                { name: "limit", in: "query", required: false, description: "Cantidad maxima de puntos", schema: { type: "integer" } }
            ],
            responses: {
                "200": {
                    description: "Puntos normalizados de temblores validos",
                    content: {
                        "application/json": {
                            schema: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        _id: { type: "string" },
                                        latitud: { type: "number" },
                                        longitud: { type: "number" },
                                        tiempo: { type: "number" },
                                        fechaUTC: { type: "string", format: "date-time" },
                                        magnitud: { type: "number" },
                                        energia: { type: "number" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
        this.registerEndPoint("GET", "temblores/:id", this.getTemblor, {
            summary: "Obtiene un temblor por id",
            parameters: [
                { name: "id", in: "path", required: true, description: "Identificador del evento USGS", schema: { type: "string" } }
            ],
            responses: {
                "200": {
                    description: "Temblor encontrado",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Temblor" } } }
                },
                "404": { description: "Temblor no encontrado" }
            }
        });
        this.registerEndPoint("POST", "temblores", this.creaTemblor, {
            summary: "Crea o actualiza un temblor",
            requestBody: {
                required: true,
                content: { "application/json": { schema: { $ref: "#/components/schemas/Temblor" } } }
            },
            responses: {
                "200": {
                    description: "Temblor creado o actualizado",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Temblor" } } }
                }
            }
        });
        this.registerEndPoint("PUT", "temblores/:id", this.actualizaTemblor, {
            summary: "Actualiza un temblor",
            parameters: [
                { name: "id", in: "path", required: true, description: "Identificador del evento USGS", schema: { type: "string" } }
            ],
            requestBody: {
                required: true,
                content: { "application/json": { schema: { $ref: "#/components/schemas/Temblor" } } }
            },
            responses: {
                "200": {
                    description: "Temblor actualizado",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/Temblor" } } }
                }
            }
        });
        this.registerEndPoint("DELETE", "temblores/:id", this.eliminaTemblor, {
            summary: "Elimina un temblor",
            parameters: [
                { name: "id", in: "path", required: true, description: "Identificador del evento USGS", schema: { type: "string" } }
            ],
            responses: {
                "200": {
                    description: "Temblor eliminado",
                    content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } }
                }
            }
        });
    }

    parseTiempo(valor) {
        if (valor === undefined || valor === null || valor === "") return null;
        if (!isNaN(Number(valor))) return Number(valor);
        let tiempo = Date.parse(valor);
        if (isNaN(tiempo)) throw "ERR_FECHA_INVALIDA";
        return tiempo;
    }

    normalizaTemblor(temblor) {
        if (!temblor) throw "ERR_TEMBLOR_INVALIDO";
        if (!temblor._id) throw "ERR_TEMBLOR_SIN_ID";
        if (temblor.tiempo === undefined || temblor.tiempo === null) throw "ERR_TEMBLOR_SIN_TIEMPO";
        if (temblor.latitud === undefined || temblor.latitud === null) throw "ERR_TEMBLOR_SIN_LATITUD";
        if (temblor.longitud === undefined || temblor.longitud === null) throw "ERR_TEMBLOR_SIN_LONGITUD";
        temblor.fuente = temblor.fuente || "USGS";
        temblor.tiempo = Number(temblor.tiempo);
        temblor.fechaUTC = temblor.fechaUTC || new Date(temblor.tiempo).toISOString();
        temblor.procesado = Boolean(temblor.procesado);
        temblor.valido = Boolean(temblor.valido);
        return temblor;
    }

    async getTemblores(desde, hasta, minMagnitud, maxMagnitud, limit) {
        const col = await mongo.collection("temblores");
        const query = {};
        const tiempo = {};
        const desdeTiempo = this.parseTiempo(desde);
        const hastaTiempo = this.parseTiempo(hasta);
        if (desdeTiempo !== null) tiempo.$gte = desdeTiempo;
        if (hastaTiempo !== null) tiempo.$lte = hastaTiempo;
        if (Object.keys(tiempo).length) query.tiempo = tiempo;

        const magnitud = {};
        if (minMagnitud !== undefined && minMagnitud !== null && minMagnitud !== "") magnitud.$gte = Number(minMagnitud);
        if (maxMagnitud !== undefined && maxMagnitud !== null && maxMagnitud !== "") magnitud.$lte = Number(maxMagnitud);
        if (Object.keys(magnitud).length) query.magnitud = magnitud;

        let nLimit = Number(limit || 1000);
        if (!Number.isFinite(nLimit) || nLimit < 1) nLimit = 1000;
        nLimit = Math.min(nLimit, 10000);
        return await col.find(query).sort({ tiempo: -1 }).limit(nLimit).toArray();
    }

    async getPuntosTemblores(decada, desde, hasta, limit) {
        const col = await mongo.collection("temblores");
        const query = this.creaQueryPuntosTemblores(decada, desde, hasta, {
            latitud: { $ne: null },
            longitud: { $ne: null },
            tiempo: { $ne: null }
        });
        const nLimit = this.normalizaLimitPuntos(limit);

        return await col.find(query, {
            projection: {
                _id: 1,
                latitud: 1,
                longitud: 1,
                tiempo: 1,
                fechaUTC: 1
            }
        }).sort({ tiempo: 1 }).limit(nLimit).toArray();
    }

    async getPuntosTembloresNormalizados(decada, desde, hasta, limit) {
        const col = await mongo.collection("temblores");
        const query = this.creaQueryPuntosTemblores(decada, desde, hasta, {
            valido: true,
            tiempo: { $ne: null },
            "puntoBordeCercano.latitud": { $type: "number" },
            "puntoBordeCercano.longitud": { $type: "number" }
        });
        const nLimit = this.normalizaLimitPuntos(limit);

        return await col.aggregate([
            { $match: query },
            { $sort: { tiempo: 1 } },
            { $limit: nLimit },
            {
                $project: {
                    _id: 1,
                    latitud: "$puntoBordeCercano.latitud",
                    longitud: "$puntoBordeCercano.longitud",
                    tiempo: 1,
                    fechaUTC: 1,
                    magnitud: 1,
                    energia: 1
                }
            }
        ]).toArray();
    }

    creaQueryPuntosTemblores(decada, desde, hasta, baseQuery) {
        const query = { ...baseQuery };
        const tiempo = {};

        if (decada !== undefined && decada !== null && decada !== "") {
            const nDecada = Number(decada);
            if (!Number.isInteger(nDecada) || nDecada < 1900 || nDecada % 10 !== 0) throw "ERR_DECADA_INVALIDA";
            tiempo.$gte = Date.UTC(nDecada, 0, 1);
            tiempo.$lt = Date.UTC(nDecada + 10, 0, 1);
        }

        const desdeTiempo = this.parseTiempo(desde);
        const hastaTiempo = this.parseTiempo(hasta);
        if (desdeTiempo !== null) tiempo.$gte = tiempo.$gte === undefined ? desdeTiempo : Math.max(tiempo.$gte, desdeTiempo);
        if (hastaTiempo !== null) tiempo.$lte = hastaTiempo;
        if (Object.keys(tiempo).length) query.tiempo = tiempo;
        return query;
    }

    normalizaLimitPuntos(limit) {
        let nLimit = Number(limit || 200000);
        if (!Number.isFinite(nLimit) || nLimit < 1) nLimit = 200000;
        return Math.min(nLimit, 500000);
    }

    async getTemblor(id) {
        const col = await mongo.collection("temblores");
        const temblor = await col.findOne({ _id: id });
        if (!temblor) throw { status: 404, message: "ERR_TEMBLOR_NO_ENCONTRADO" };
        return temblor;
    }

    async creaTemblor(temblor) {
        return await this.guardaTemblor(temblor);
    }

    async actualizaTemblor(id, temblor) {
        temblor = temblor || {};
        temblor._id = id;
        return await this.guardaTemblor(temblor);
    }

    async eliminaTemblor(id) {
        const col = await mongo.collection("temblores");
        await col.deleteOne({ _id: id });
        return { id };
    }

    async guardaTemblor(temblor) {
        temblor = this.normalizaTemblor(temblor);
        const col = await mongo.collection("temblores");
        const resultado = await col.findOneAndUpdate(
            { _id: temblor._id },
            {
                $set: this.limpiaTemblorPersistible(temblor)
            },
            { upsert: true, returnDocument: "after" }
        );
        return resultado;
    }

    async guardaTemblores(temblores) {
        if (!Array.isArray(temblores)) throw "ERR_TEMBLORES_INVALIDOS";
        const normalizados = temblores.map(temblor => this.normalizaTemblor(temblor));
        if (!normalizados.length) return [];

        const col = await mongo.collection("temblores");
        const ids = normalizados.map(temblor => temblor._id);
        const ops = [];

        for (const temblor of normalizados) {
            const persistible = this.limpiaTemblorPersistible(temblor);
            delete persistible.procesado;
            delete persistible.valido;
            ops.push({
                updateOne: {
                    filter: { _id: temblor._id },
                    update: {
                        $set: persistible,
                        $setOnInsert: {
                            procesado: false,
                            valido: false
                        }
                    },
                    upsert: true
                }
            });
        }

        if (ops.length) await col.bulkWrite(ops, { ordered: false });
        return normalizados;
    }

    limpiaTemblorPersistible(temblor) {
        const {
            _id,
            magnitudes,
            lugar,
            url,
            detalleUrl,
            actualizadoUTC,
            actualizadoTiempo,
            raw,
            ...persistible
        } = temblor;
        return persistible;
    }

    async getUltimoTiempoTemblor() {
        const col = await mongo.collection("temblores");
        const ultimo = await col.find({ tiempo: { $ne: null } }).sort({ tiempo: -1 }).limit(1).toArray();
        return ultimo.length ? ultimo[0].tiempo : null;
    }
}

export default Temblores.instance;
