import { ZModule } from "./ZServer.js";
import mongo from "./MongoDB.js";

class EventosAgregados extends ZModule {
    static get instance() {
        if (EventosAgregados._singleton) return EventosAgregados._singleton;
        EventosAgregados._singleton = new EventosAgregados();
        return EventosAgregados._singleton;
    }

    getOASTags() { return ["API para manejo de Eventos Agregados"]; }

    init() {
        this.oasDeclareSchema("EventoAgregado", {
            type: "object",
            required: ["_id", "codigoPlaca", "tiempoInicio", "tiempoFin", "punto", "energiaAcumulada"],
            properties: {
                _id: { type: "string" },
                codigoPlaca: { type: "string" },
                estado: { type: "string", enum: ["abierto", "cerrado"] },
                inicioUTC: { type: "string", format: "date-time" },
                finUTC: { type: "string", format: "date-time" },
                tiempoInicio: { type: "number" },
                tiempoFin: { type: "number" },
                punto: {
                    type: "object",
                    properties: {
                        latitud: { type: "number" },
                        longitud: { type: "number" }
                    }
                },
                energiaAcumulada: { type: "number" },
                magnitudPrincipal: { type: "number" },
                cantidadTemblores: { type: "integer" },
                parametrosCluster: {
                    type: "object",
                    properties: { radioKm: { type: "number" }, ventanaDias: { type: "number" }, version: { type: "string" } }
                }
            }
        });

        this.registerEndPoint("GET", "eventos-agregados", this.getEventosAgregados, {
            summary: "Lista eventos agregados",
            parameters: this.parametrosConsulta(),
            responses: { "200": { description: "Lista de eventos agregados", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/EventoAgregado" } } } } } }
        });
        this.registerEndPoint("GET", "eventos-agregados/puntos", this.getPuntosEventosAgregados, {
            summary: "Lista puntos livianos de eventos agregados para el mapa",
            parameters: this.parametrosConsulta(true),
            responses: { "200": { description: "Puntos de eventos agregados", content: { "application/json": { schema: { type: "array", items: { type: "object", properties: { _id: { type: "string" }, latitud: { type: "number" }, longitud: { type: "number" }, tiempo: { type: "number" }, tiempoFin: { type: "number" }, energia: { type: "number" }, magnitud: { type: "number" }, radioKm: { type: "number" } } } } } } } }
        });
        this.registerEndPoint("GET", "eventos-agregados/:id", this.getEventoAgregado, {
            summary: "Obtiene un evento agregado por id",
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "Evento agregado encontrado", content: { "application/json": { schema: { $ref: "#/components/schemas/EventoAgregado" } } } }, "404": { description: "Evento agregado no encontrado" } }
        });
        this.registerEndPoint("POST", "eventos-agregados", this.creaEventoAgregado, {
            summary: "Crea un evento agregado",
            requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EventoAgregado" } } } },
            responses: { "200": { description: "Evento agregado creado", content: { "application/json": { schema: { $ref: "#/components/schemas/EventoAgregado" } } } } }
        });
        this.registerEndPoint("PUT", "eventos-agregados/:id", this.actualizaEventoAgregado, {
            summary: "Actualiza un evento agregado",
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EventoAgregado" } } } },
            responses: { "200": { description: "Evento agregado actualizado", content: { "application/json": { schema: { $ref: "#/components/schemas/EventoAgregado" } } } } }
        });
        this.registerEndPoint("DELETE", "eventos-agregados/:id", this.eliminaEventoAgregado, {
            summary: "Elimina un evento agregado",
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "Evento agregado eliminado" } }
        });
    }

    parametrosConsulta(incluyeDecada = false) {
        const parametros = [];
        if (incluyeDecada) parametros.push({ name: "decada", in: "query", required: false, description: "Decada a consultar, por ejemplo 1990", schema: { type: "integer" } });
        parametros.push(
            { name: "desde", in: "query", required: false, description: "Fecha UTC o timestamp minimo", schema: { type: "string" } },
            { name: "hasta", in: "query", required: false, description: "Fecha UTC o timestamp maximo", schema: { type: "string" } },
            { name: "codigoPlaca", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer" } }
        );
        return parametros;
    }

    parseTiempo(valor) {
        if (valor === undefined || valor === null || valor === "") return null;
        if (!isNaN(Number(valor))) return Number(valor);
        const tiempo = Date.parse(valor);
        if (isNaN(tiempo)) throw "ERR_FECHA_INVALIDA";
        return tiempo;
    }

    creaQuery(decada, desde, hasta, codigoPlaca) {
        const query = {};
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
        if (Object.keys(tiempo).length) query.tiempoInicio = tiempo;
        if (codigoPlaca) query.codigoPlaca = codigoPlaca;
        return query;
    }

    normalizaLimit(limit, limitPorDefecto = 200000) {
        let n = Number(limit || limitPorDefecto);
        if (!Number.isFinite(n) || n < 1) n = limitPorDefecto;
        return Math.min(n, 500000);
    }

    async getEventosAgregados(desde, hasta, codigoPlaca, limit) {
        const col = await mongo.collection("eventos_agregados");
        return await col.find(this.creaQuery(null, desde, hasta, codigoPlaca)).sort({ tiempoInicio: 1 }).limit(this.normalizaLimit(limit)).toArray();
    }

    async getPuntosEventosAgregados(decada, desde, hasta, codigoPlaca, limit) {
        const col = await mongo.collection("eventos_agregados");
        const query = this.creaQuery(null, desde, hasta, codigoPlaca);
        if (decada !== undefined && decada !== null && decada !== "") {
            const nDecada = Number(decada);
            if (!Number.isInteger(nDecada) || nDecada < 1900 || nDecada % 10 !== 0) throw "ERR_DECADA_INVALIDA";
            query.$and = [
                { tiempoInicio: { $lt: Date.UTC(nDecada + 10, 0, 1) } },
                { tiempoFin: { $gte: Date.UTC(nDecada, 0, 1) } }
            ];
        }
        query["punto.latitud"] = { $type: "number" };
        query["punto.longitud"] = { $type: "number" };
        return await col.aggregate([
            { $match: query },
            { $sort: { tiempoInicio: 1 } },
            { $limit: this.normalizaLimit(limit, 500000) },
            { $project: { _id: 1, latitud: "$punto.latitud", longitud: "$punto.longitud", tiempo: "$tiempoInicio", tiempoFin: 1, energia: "$energiaAcumulada", magnitud: "$magnitudPrincipal", radioKm: "$parametrosCluster.radioKm", codigoPlaca: 1, cantidadTemblores: 1 } }
        ]).toArray();
    }

    async getEventoAgregado(id) {
        const col = await mongo.collection("eventos_agregados");
        const evento = await col.findOne({ _id: id });
        if (!evento) throw { status: 404, message: "ERR_EVENTO_AGREGADO_NO_ENCONTRADO" };
        return evento;
    }

    validaEvento(evento) {
        if (!evento || !evento._id || !evento.codigoPlaca || !evento.punto) throw "ERR_EVENTO_AGREGADO_INVALIDO";
        return evento;
    }

    async creaEventoAgregado(evento) {
        this.validaEvento(evento);
        const col = await mongo.collection("eventos_agregados");
        await col.insertOne(evento);
        return evento;
    }

    async actualizaEventoAgregado(id, evento) {
        evento = { ...(evento || {}), _id: id };
        this.validaEvento(evento);
        const col = await mongo.collection("eventos_agregados");
        await col.replaceOne({ _id: id }, evento, { upsert: true });
        return evento;
    }

    async eliminaEventoAgregado(id) {
        const col = await mongo.collection("eventos_agregados");
        await col.deleteOne({ _id: id });
        return { id };
    }
}

export default EventosAgregados.instance;
