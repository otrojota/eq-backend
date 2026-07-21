import { ZModule } from "./ZServer.js";
import mongo from "./MongoDB.js";
import Proceso from "./Proceso.js";

class EjecucionProceso extends ZModule {
    static get instance() {
        if (EjecucionProceso._singleton) return EjecucionProceso._singleton;
        EjecucionProceso._singleton = new EjecucionProceso();
        return EjecucionProceso._singleton;
    }

    getOASTags() { return ["API para manejo de ejecucion de procesos"]; }

    init() {
        this.oasDeclareSchema("LogProceso", {
            type: "object",
            properties: {
                fechaUTC: { type: "string", format: "date-time" },
                tipo: { type: "string", enum: ["debug", "info", "warning", "error"] },
                mensaje: { type: "string" },
                detalle: { type: "string" }
            }
        });
        this.oasDeclareSchema("EjecucionProceso", {
            type: "object",
            properties: {
                _id: { type: "string" },
                codigo: { type: "string" },
                nombre: { type: "string" },
                descripcion: { type: "string" },
                estado: { type: "string", enum: ["pendiente", "ejecutando", "deteniendo", "ok", "warning", "error"] },
                inicioUTC: { type: "string", format: "date-time" },
                terminoUTC: { type: "string", format: "date-time" },
                ultimoLogUTC: { type: "string", format: "date-time" },
                ultimoError: { type: "string" },
                logs: {
                    type: "array",
                    items: { $ref: "#/components/schemas/LogProceso" }
                }
            }
        });

        this.registerEndPoint("GET", "ejecucion-proceso/procesos", this.getProcesos, {
            summary: "Lista procesos registrados disponibles para ejecucion",
            responses: {
                "200": {
                    description: "Lista de procesos registrados",
                    content: { "application/json": { schema: { type: "array" } } }
                }
            }
        });
        this.registerEndPoint("GET", "ejecucion-proceso", this.getEjecucionesProceso, {
            summary: "Lista ejecuciones de procesos",
            parameters: [
                { name: "estado", in: "query", required: false, description: "Filtra por estado", schema: { type: "string" } },
                { name: "codigo", in: "query", required: false, description: "Filtra por codigo de proceso", schema: { type: "string" } },
                { name: "limit", in: "query", required: false, description: "Cantidad maxima de ejecuciones", schema: { type: "integer" } },
                { name: "desde", in: "query", required: false, description: "Inicio UTC del rango de ejecuciones", schema: { type: "string", format: "date-time" } },
                { name: "hasta", in: "query", required: false, description: "Fin UTC exclusivo del rango de ejecuciones", schema: { type: "string", format: "date-time" } }
            ],
            responses: {
                "200": {
                    description: "Lista de ejecuciones",
                    content: {
                        "application/json": {
                            schema: {
                                type: "array",
                                items: { $ref: "#/components/schemas/EjecucionProceso" }
                            }
                        }
                    }
                }
            }
        });
        this.registerEndPoint("GET", "ejecucion-proceso/:codigo/logs", this.getLogsProceso, {
            summary: "Lista logs de un proceso",
            parameters: [
                { name: "codigo", in: "path", required: true, description: "Codigo del proceso", schema: { type: "string" } },
                { name: "tipo", in: "query", required: false, description: "Filtra por tipo de log", schema: { type: "string" } },
                { name: "limit", in: "query", required: false, description: "Cantidad maxima de logs", schema: { type: "integer" } }
            ],
            responses: {
                "200": {
                    description: "Logs del proceso",
                    content: {
                        "application/json": {
                            schema: {
                                type: "array",
                                items: { $ref: "#/components/schemas/LogProceso" }
                            }
                        }
                    }
                }
            }
        });
        this.registerEndPoint("GET", "ejecucion-proceso/:id", this.getEjecucionProceso, {
            summary: "Obtiene la ejecucion de un proceso",
            parameters: [
                { name: "id", in: "path", required: true, description: "Id de ejecucion o codigo del proceso", schema: { type: "string" } },
                { name: "incluirLogs", in: "query", required: false, description: "Incluye arreglo de logs en la respuesta", schema: { type: "boolean" } }
            ],
            responses: {
                "200": {
                    description: "Ejecucion del proceso",
                    content: { "application/json": { schema: { $ref: "#/components/schemas/EjecucionProceso" } } }
                },
                "404": { description: "Proceso no encontrado" }
            }
        });
        this.registerEndPoint("DELETE", "ejecucion-proceso/:codigo/logs", this.limpiaLogsProceso, {
            summary: "Limpia logs de un proceso",
            parameters: [
                { name: "codigo", in: "path", required: true, description: "Codigo del proceso", schema: { type: "string" } }
            ],
            responses: {
                "200": {
                    description: "Logs eliminados",
                    content: { "application/json": { schema: { type: "object" } } }
                }
            }
        });
        this.registerEndPoint("DELETE", "ejecucion-proceso/:id", this.eliminaEjecucionProceso, {
            summary: "Elimina un registro de ejecucion de proceso",
            parameters: [
                { name: "id", in: "path", required: true, description: "Id de ejecucion", schema: { type: "string" } }
            ],
            responses: {
                "200": {
                    description: "Ejecucion eliminada",
                    content: { "application/json": { schema: { type: "object" } } }
                },
                "404": { description: "Ejecucion no encontrada" }
            }
        });
        this.registerEndPoint("POST", "ejecucion-proceso/:codigo/run", this.ejecutaProceso, {
            summary: "Ejecuta un proceso registrado",
            parameters: [
                { name: "codigo", in: "path", required: true, description: "Codigo del proceso", schema: { type: "string" } }
            ],
            requestBody: {
                required: false,
                content: { "application/json": { schema: { type: "object" } } }
            },
            responses: {
                "200": {
                    description: "Resultado de ejecucion",
                    content: { "application/json": { schema: { type: "object" } } }
                },
                "404": { description: "Proceso no encontrado" }
            }
        });
        this.registerEndPoint("POST", "ejecucion-proceso/:id/stop", this.detieneEjecucionProceso, {
            summary: "Solicita detener una ejecucion en curso",
            parameters: [
                { name: "id", in: "path", required: true, description: "Id de ejecucion o codigo del proceso", schema: { type: "string" } }
            ],
            responses: {
                "200": {
                    description: "Solicitud de detencion registrada",
                    content: { "application/json": { schema: { type: "object" } } }
                },
                "404": { description: "Ejecucion no encontrada" }
            }
        });
    }

    async getEjecucionesProceso(estado, codigo, limit, desde, hasta) {
        const col = await mongo.collection("ejecucionProceso");
        const query = {};
        if (estado) query.estado = estado;
        if (codigo) query.codigo = codigo;
        const fecha = {};
        if (desde) fecha.$gte = desde;
        if (hasta) fecha.$lt = hasta;
        if (Object.keys(fecha).length) {
            query.$or = [
                { inicioUTC: fecha },
                { terminoUTC: fecha },
                { ultimoLogUTC: fecha },
                { actualizadoUTC: fecha },
                { "logs.fechaUTC": fecha }
            ];
        }
        let nLimit = Number(limit || 100);
        if (!Number.isFinite(nLimit) || nLimit < 1) nLimit = 100;
        nLimit = Math.min(nLimit, 1000);
        const docs = await col.find(query, { projection: { logs: 0 } })
            .sort({ inicioUTC: -1, actualizadoUTC: -1, codigo: 1 })
            .limit(nLimit)
            .toArray();
        return docs;
    }

    async getProcesos() {
        return Proceso.getProcesos().map(proceso => ({
            codigo: proceso.codigo,
            nombre: proceso.nombre,
            descripcion: proceso.descripcion,
            parametros: proceso.parametros
        })).sort((p1, p2) => (p1.nombre || p1.codigo).localeCompare(p2.nombre || p2.codigo));
    }

    async getEjecucionProceso(id, incluirLogs) {
        const col = await mongo.collection("ejecucionProceso");
        const options = this.incluyeLogs(incluirLogs) ? {} : { projection: { logs: 0 } };
        const doc = await col.findOne({ _id: id }, options);
        if (doc) return doc;
        const docPorCodigo = await col.findOne({ codigo: id }, { ...options, sort: { inicioUTC: -1, actualizadoUTC: -1 } });
        if (docPorCodigo) return docPorCodigo;
        const proceso = Proceso.getProceso(id);
        if (!proceso) throw { status: 404, message: "ERR_PROCESO_NO_ENCONTRADO" };
        return {
            _id: proceso.codigo,
            codigo: proceso.codigo,
            nombre: proceso.nombre,
            descripcion: proceso.descripcion,
            estado: "pendiente",
            logs: []
        };
    }

    incluyeLogs(incluirLogs) {
        return !(incluirLogs === false || incluirLogs === "false" || incluirLogs === "0");
    }

    async getLogsProceso(codigo, tipo, limit) {
        const ejecucion = await this.getEjecucionProceso(codigo, true);
        let logs = ejecucion.logs || [];
        if (tipo) logs = logs.filter(log => log.tipo == tipo);
        if (limit === undefined || limit === null || limit === "") return logs;
        let nLimit = Number(limit);
        if (!Number.isFinite(nLimit) || nLimit < 1) return logs;
        nLimit = Math.min(nLimit, 5000);
        return logs.slice(-nLimit);
    }

    async limpiaLogsProceso(codigo) {
        const ejecucion = await this.getEjecucionProceso(codigo);
        const col = await mongo.collection("ejecucionProceso");
        await col.updateOne(
            { _id: ejecucion._id },
            { $set: { logs: [], ultimoLogUTC: null, actualizadoUTC: new Date().toISOString() } },
            { upsert: false }
        );
        return { _id: ejecucion._id, codigo: ejecucion.codigo };
    }

    async eliminaEjecucionProceso(id) {
        const col = await mongo.collection("ejecucionProceso");
        const result = await col.deleteOne({ _id: id });
        if (!result.deletedCount) throw { status: 404, message: "ERR_EJECUCION_NO_ENCONTRADA" };
        return { _id: id };
    }

    async ejecutaProceso(codigo, options) {
        const proceso = Proceso.getProceso(codigo);
        if (!proceso) throw { status: 404, message: "ERR_PROCESO_NO_ENCONTRADO" };
        return await proceso.ejecutaAsync(proceso.validaOptions(options || {}));
    }

    async detieneEjecucionProceso(id) {
        const col = await mongo.collection("ejecucionProceso");
        const ejecucion = await col.findOne({
            $or: [
                { _id: id },
                { codigo: id, estado: { $in: ["ejecutando", "deteniendo"] } }
            ]
        }, { sort: { inicioUTC: -1, actualizadoUTC: -1 } });
        if (!ejecucion) throw { status: 404, message: "ERR_EJECUCION_NO_ENCONTRADA" };
        if (!["ejecutando", "deteniendo"].includes(ejecucion.estado)) {
            return { _id: ejecucion._id, codigo: ejecucion.codigo, estado: ejecucion.estado };
        }
        const ahora = new Date().toISOString();
        await col.updateOne(
            { _id: ejecucion._id },
            {
                $set: {
                    estado: "deteniendo",
                    actualizadoUTC: ahora
                }
            }
        );
        return { _id: ejecucion._id, codigo: ejecucion.codigo, estado: "deteniendo" };
    }
}

export default EjecucionProceso.instance;
